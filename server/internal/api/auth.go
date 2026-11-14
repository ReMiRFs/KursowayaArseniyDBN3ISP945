package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const sessionAge = 12 * time.Hour
const sessionCookie = "sid"

type principal struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type authContextKey struct{}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(request.Email))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 {
		writeFieldError(w, "email", "Введите корректный адрес электронной почты.")
		return
	}
	if len(request.Password) < 1 || len(request.Password) > 72 {
		writeFieldError(w, "password", "Введите пароль длиной до 72 байт.")
		return
	}

	var user principal
	var id int64
	var hash []byte
	err = s.db.QueryRow(r.Context(),
		"SELECT id, email, role, password_hash FROM users WHERE email = $1", email,
	).Scan(&id, &user.Email, &user.Role, &hash)
	missing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !missing {
		s.internalError(w, r, err)
		return
	}
	if missing {
		hash = s.dummyHash
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(request.Password)) != nil || missing {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Неверная почта или пароль.")
		return
	}

	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		s.internalError(w, r, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(),
		"DELETE FROM sessions WHERE expires_at <= now() OR token_hash = $1", requestSessionHash(r))
	if err == nil {
		_, err = tx.Exec(r.Context(), `
			INSERT INTO sessions (token_hash, user_id, expires_at)
			VALUES ($1, $2, now() + make_interval(secs => $3))`,
			hashToken(token), id, sessionAge.Seconds())
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	user.ID = strconv.FormatInt(id, 10)
	http.SetCookie(w, s.cookie(r, token, int(sessionAge/time.Second)))
	writeJSON(w, http.StatusOK, map[string]principal{"user": user})
}

func (s *Server) requireUser(adminOnly bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hash := requestSessionHash(r)
		if hash == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Войдите в систему.")
			return
		}
		var user principal
		var id int64
		err := s.db.QueryRow(r.Context(), `
			SELECT users.id, users.email, users.role
			FROM sessions
			JOIN users ON users.id = sessions.user_id
			WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`, hash,
		).Scan(&id, &user.Email, &user.Role)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Сессия истекла. Войдите снова.")
			return
		}
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		if adminOnly && user.Role != "admin" {
			writeError(w, http.StatusForbidden, "forbidden_role", "Операция доступна администратору.")
			return
		}
		user.ID = strconv.FormatInt(id, 10)
		next(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, user)))
	}
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(authContextKey{}).(principal)
	writeJSON(w, http.StatusOK, map[string]principal{"user": user})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if _, err := s.db.Exec(r.Context(),
		"DELETE FROM sessions WHERE token_hash = $1", requestSessionHash(r),
	); err != nil {
		s.internalError(w, r, err)
		return
	}
	cookie := s.cookie(r, "", -1)
	cookie.Expires = time.Unix(0, 0).UTC()
	http.SetCookie(w, cookie)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) cookie(r *http.Request, value string, age int) *http.Cookie {
	return &http.Cookie{
		Name: sessionCookie, Value: value, Path: "/", MaxAge: age, HttpOnly: true,
		Secure: s.secureCookie || r.TLS != nil, SameSite: http.SameSiteLaxMode,
	}
}

func requestSessionHash(r *http.Request) string {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || len(cookie.Value) != 43 {
		return ""
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(cookie.Value)
	if err != nil || len(raw) != 32 {
		return ""
	}
	return hashToken(cookie.Value)
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

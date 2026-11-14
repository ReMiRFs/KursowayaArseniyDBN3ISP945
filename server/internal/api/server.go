package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	db            *pgxpool.Pool
	statisticsSQL string
	origin        string
	secureCookie  bool
	dummyHash     []byte
}

func New(db *pgxpool.Pool, statisticsSQL, origin string) (*Server, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte("unused-orderstats-login-placeholder"), 12)
	if err != nil {
		return nil, err
	}
	return &Server{
		db: db, statisticsSQL: statisticsSQL, origin: origin,
		secureCookie: strings.HasPrefix(origin, "https://"),
		dummyHash:    hash,
	}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("GET /api/v1/auth/me", s.requireUser(false, s.me))
	mux.HandleFunc("POST /api/v1/auth/logout", s.requireUser(false, s.logout))
	mux.HandleFunc("GET /api/v1/statistics", s.requireUser(false, s.statistics))
	s.registerAdmin(mux)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
			origins := r.Header.Values("Origin")
			if len(origins) != 1 || origins[0] != s.origin {
				writeError(w, http.StatusForbidden, "forbidden_origin", "Источник запроса не разрешён.")
				return
			}
		}
		handler, pattern := mux.Handler(r)
		if pattern == "" {
			handler.ServeHTTP(routeError{w}, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

type routeError struct{ http.ResponseWriter }

func (w routeError) WriteHeader(status int) {
	if status == http.StatusMethodNotAllowed {
		writeError(w.ResponseWriter, status, "method_not_allowed", "Метод для этого ресурса не поддерживается.")
		return
	}
	writeError(w.ResponseWriter, status, "not_found", "Маршрут API не найден.")
}

func (w routeError) Write(body []byte) (int, error) { return len(body), nil }

type errorInfo struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Debug("HTTP response interrupted", "status", status)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]errorInfo{"error": {Code: code, Message: message}})
}

func writeFieldError(w http.ResponseWriter, field, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]errorInfo{"error": {
		Code: "invalid_input", Message: "Проверьте данные запроса.", Fields: map[string]string{field: message},
	}})
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("API request failed", "method", r.Method, "route", r.Pattern, "type", fmt.Sprintf("%T", err))
	writeError(w, http.StatusInternalServerError, "internal_error", "Сервер не смог обработать запрос.")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		writeError(w, http.StatusBadRequest, "invalid_json", "Ожидается тело запроса в формате JSON.")
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	var body json.RawMessage
	if err = decoder.Decode(&body); err != nil || len(body) == 0 || body[0] != '{' || !utf8.Valid(body) {
		writeError(w, http.StatusBadRequest, "invalid_json", "Ожидается один JSON-объект до 16 КБ.")
		return false
	}
	var extra json.RawMessage
	if err = decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_json", "Ожидается один JSON-объект до 16 КБ.")
		return false
	}
	fields := json.NewDecoder(bytes.NewReader(body))
	fields.DisallowUnknownFields()
	if err = fields.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "JSON содержит неизвестные поля или неверные типы.")
		return false
	}
	return true
}

func NormalizeOrigin(value string) (string, error) {
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" ||
		(u.Path != "" && u.Path != "/") {
		return "", errors.New("ORDERS_ORIGIN must contain an HTTP or HTTPS origin without a path")
	}
	host := strings.ToLower(u.Host)
	switch {
	case u.Scheme == "http" && u.Port() == "80":
		host = strings.TrimSuffix(host, ":80")
	case u.Scheme == "https" && u.Port() == "443":
		host = strings.TrimSuffix(host, ":443")
	}
	return u.Scheme + "://" + host, nil
}

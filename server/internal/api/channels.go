package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type salesChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type channelList struct {
	Items []salesChannel `json:"items"`
}

func (s *Server) listSalesChannels(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), "SELECT id::text, name FROM sales_channels ORDER BY name, id")
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (salesChannel, error) {
		return scanChannel(row)
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, channelList{Items: items})
}

func (s *Server) getSalesChannel(w http.ResponseWriter, r *http.Request) {
	id, ok := readAdminID(w, r, "channelId")
	if !ok {
		return
	}
	channel, err := scanChannel(s.db.QueryRow(r.Context(),
		"SELECT id::text, name FROM sales_channels WHERE id = $1", id))
	if err != nil {
		s.writeChannelError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, channel)
}

func (s *Server) createSalesChannel(w http.ResponseWriter, r *http.Request) {
	name, ok := readChannelName(w, r)
	if !ok {
		return
	}
	channel, err := scanChannel(s.db.QueryRow(r.Context(),
		"INSERT INTO sales_channels (name) VALUES ($1) RETURNING id::text, name", name))
	if err != nil {
		s.writeChannelError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/sales-channels/"+channel.ID)
	writeJSON(w, http.StatusCreated, channel)
}

func (s *Server) updateSalesChannel(w http.ResponseWriter, r *http.Request) {
	id, ok := readAdminID(w, r, "channelId")
	if !ok {
		return
	}
	name, ok := readChannelName(w, r)
	if !ok {
		return
	}
	channel, err := scanChannel(s.db.QueryRow(r.Context(),
		"UPDATE sales_channels SET name = $2 WHERE id = $1 RETURNING id::text, name", id, name))
	if err != nil {
		s.writeChannelError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, channel)
}

func (s *Server) deleteSalesChannel(w http.ResponseWriter, r *http.Request) {
	id, ok := readAdminID(w, r, "channelId")
	if !ok {
		return
	}
	result, err := s.db.Exec(r.Context(), "DELETE FROM sales_channels WHERE id = $1", id)
	if err != nil {
		s.writeChannelError(w, r, err)
		return
	}
	if result.RowsAffected() == 0 {
		s.writeChannelError(w, r, pgx.ErrNoRows)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func scanChannel(row pgx.Row) (salesChannel, error) {
	var channel salesChannel
	err := row.Scan(&channel.ID, &channel.Name)
	return channel, err
}

func readChannelName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Name json.RawMessage `json:"name"`
	}
	if !decodeJSON(w, r, &body) {
		return "", false
	}
	var name string
	if !decodeAdminField(body.Name, &name) {
		writeFieldError(w, "name", "Укажите название канала текстом.")
		return "", false
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 50 || strings.ContainsRune(name, 0) {
		writeFieldError(w, "name", "Название должно содержать от 1 до 50 символов.")
		return "", false
	}
	return name, true
}

func (s *Server) writeChannelError(w http.ResponseWriter, r *http.Request, err error) {
	var pgError *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, http.StatusNotFound, "channel_not_found", "Канал продаж не найден.")
	case errors.As(err, &pgError) && pgError.Code == "23505":
		writeError(w, http.StatusConflict, "duplicate_channel_name", "Канал с таким названием уже существует.")
	case pgError != nil && (pgError.Code == "23503" || pgError.Code == "23001"):
		writeError(w, http.StatusConflict, "channel_in_use", "Канал нельзя удалить, пока к нему привязаны заказы.")
	default:
		s.internalError(w, r, err)
	}
}

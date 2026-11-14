package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func parseDate(input string) (time.Time, error) {
	const calendarDate = "2006-01-02"
	date, err := time.Parse(calendarDate, input)
	if err != nil || date.Year() < 1 || date.Format(calendarDate) != input {
		return time.Time{}, errors.New("expected a calendar date in YYYY-MM-DD format")
	}
	return date, nil
}

func (s *Server) statistics(w http.ResponseWriter, r *http.Request) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_query", "Не удалось прочитать параметры периода.")
		return
	}
	from, err := parseDate(query.Get("from"))
	if err != nil || len(query["from"]) != 1 {
		writeFieldError(w, "from", "Укажите дату начала в формате ГГГГ-ММ-ДД.")
		return
	}
	to, err := parseDate(query.Get("to"))
	if err != nil || len(query["to"]) != 1 {
		writeFieldError(w, "to", "Укажите дату окончания в формате ГГГГ-ММ-ДД.")
		return
	}
	if to.Before(from) || !to.Before(from.AddDate(0, 0, 366)) {
		writeFieldError(w, "to", "Начало должно предшествовать окончанию или совпадать с ним. Максимум 366 дней.")
		return
	}

	var payload []byte
	err = s.db.QueryRow(r.Context(), s.statisticsSQL,
		pgtype.Date{Time: from, Valid: true}, pgtype.Date{Time: to, Valid: true},
	).Scan(&payload)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(payload))
}

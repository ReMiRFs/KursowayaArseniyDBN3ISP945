package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	orderPageSize = 20
	maxOrderTotal = 999999999
)

var orderNumberPattern = regexp.MustCompile("^[A-Za-z0-9-]{1,32}$")

type orderRecord struct {
	ID           string    `json:"id"`
	Number       string    `json:"number"`
	CreatedAt    time.Time `json:"createdAt"`
	Status       string    `json:"status"`
	ChannelID    string    `json:"channelId"`
	ChannelName  string    `json:"channelName"`
	TotalKopecks int64     `json:"totalKopecks"`
}

type orderPage struct {
	Items    []orderRecord `json:"items"`
	Page     int64         `json:"page"`
	PageSize int           `json:"pageSize"`
	Total    int64         `json:"total"`
}

type orderFilters struct {
	query     string
	from      *string
	to        *string
	status    *string
	channelID *int64
	page      int64
}

type orderChanges struct {
	number       *string
	channelID    *int64
	totalKopecks *int64
	status       *string
}

func (s *Server) registerAdmin(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/orders", s.requireUser(true, s.listOrders))
	mux.HandleFunc("POST /api/v1/orders", s.requireUser(true, s.createOrder))
	mux.HandleFunc("GET /api/v1/orders/{orderId}", s.requireUser(true, s.getOrder))
	mux.HandleFunc("PATCH /api/v1/orders/{orderId}", s.requireUser(true, s.updateOrder))

	mux.HandleFunc("GET /api/v1/sales-channels", s.requireUser(true, s.listSalesChannels))
	mux.HandleFunc("POST /api/v1/sales-channels", s.requireUser(true, s.createSalesChannel))
	mux.HandleFunc("GET /api/v1/sales-channels/{channelId}", s.requireUser(true, s.getSalesChannel))
	mux.HandleFunc("PATCH /api/v1/sales-channels/{channelId}", s.requireUser(true, s.updateSalesChannel))
	mux.HandleFunc("DELETE /api/v1/sales-channels/{channelId}", s.requireUser(true, s.deleteSalesChannel))
}

const orderColumns = `o.id::text, o.number, o.created_at, o.status,
	o.sales_channel_id::text, c.name, o.total_kopecks`
const orderSource = `orders AS o
	JOIN sales_channels AS c ON c.id = o.sales_channel_id`

const ordersWhere = `
	WHERE ($1::text = '' OR strpos(o.number, $1) > 0)
	  AND ($2::text IS NULL OR o.created_at >=
		($2::text::date::timestamp AT TIME ZONE 'Europe/Moscow'))
	  AND ($3::text IS NULL OR o.created_at <
		(($3::text::date + 1)::timestamp AT TIME ZONE 'Europe/Moscow'))
	  AND ($4::text IS NULL OR o.status = $4)
	  AND ($5::bigint IS NULL OR o.sales_channel_id = $5)`

func (s *Server) listOrders(w http.ResponseWriter, r *http.Request) {
	filters, ok := readOrderFilters(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer tx.Rollback(ctx)

	arguments := []any{filters.query, filters.from, filters.to, filters.status, filters.channelID}
	page := orderPage{Items: []orderRecord{}, Page: filters.page, PageSize: orderPageSize}
	err = tx.QueryRow(ctx, "SELECT count(*) FROM orders AS o"+ordersWhere, arguments...).Scan(&page.Total)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	offset := (filters.page - 1) * orderPageSize
	if offset < page.Total {
		rows, err := tx.Query(ctx, "SELECT "+orderColumns+" FROM "+orderSource+ordersWhere+`
			ORDER BY o.created_at DESC, o.id DESC LIMIT $6 OFFSET $7`,
			append(arguments, orderPageSize, offset)...)
		if err == nil {
			page.Items, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (orderRecord, error) {
				return scanOrder(row)
			})
		}
		if err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func readOrderFilters(w http.ResponseWriter, r *http.Request) (orderFilters, bool) {
	filters := orderFilters{page: 1}
	params, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeFieldError(w, "query", "Проверьте параметры запроса.")
		return filters, false
	}
	for _, field := range []string{"q", "from", "to", "status", "channelId", "page"} {
		if len(params[field]) > 1 {
			writeFieldError(w, field, "Укажите параметр один раз.")
			return filters, false
		}
	}

	query := params.Get("q")
	if !utf8.ValidString(query) || utf8.RuneCountInString(query) > 32 || strings.ContainsRune(query, 0) {
		writeFieldError(w, "q", "Запрос должен содержать не более 32 символов.")
		return filters, false
	}
	filters.query = strings.ToUpper(strings.TrimSpace(query))

	for _, field := range []string{"from", "to"} {
		if !params.Has(field) {
			continue
		}
		input := params.Get(field)
		if _, err := parseDate(input); err != nil {
			writeFieldError(w, field, "Укажите корректную дату в формате ГГГГ-ММ-ДД.")
			return filters, false
		}
		if field == "from" {
			filters.from = &input
		} else {
			filters.to = &input
		}
	}
	if filters.from != nil && filters.to != nil && *filters.from > *filters.to {
		writeFieldError(w, "to", "Конечная дата должна быть не раньше начальной.")
		return filters, false
	}
	if params.Has("status") {
		status := params.Get("status")
		if !validOrderStatus(status) {
			writeFieldError(w, "status", "Выберите допустимый статус.")
			return filters, false
		}
		filters.status = &status
	}
	if params.Has("channelId") {
		id, ok := parseAdminID(params.Get("channelId"))
		if !ok {
			writeFieldError(w, "channelId", "Укажите корректный идентификатор канала.")
			return filters, false
		}
		filters.channelID = &id
	}
	if params.Has("page") {
		page, err := strconv.ParseInt(params.Get("page"), 10, 64)
		if err != nil || page < 1 || page-1 > math.MaxInt64/orderPageSize {
			writeFieldError(w, "page", "Укажите допустимый номер страницы, начиная с 1.")
			return filters, false
		}
		filters.page = page
	}
	return filters, true
}

func scanOrder(row pgx.Row) (orderRecord, error) {
	var order orderRecord
	err := row.Scan(&order.ID, &order.Number, &order.CreatedAt,
		&order.Status, &order.ChannelID, &order.ChannelName, &order.TotalKopecks)
	order.CreatedAt = order.CreatedAt.UTC()
	return order, err
}

func (s *Server) getOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := readAdminID(w, r, "orderId")
	if !ok {
		return
	}
	order, err := scanOrder(s.db.QueryRow(r.Context(),
		"SELECT "+orderColumns+" FROM "+orderSource+" WHERE o.id = $1", id))
	if err != nil {
		s.writeOrderError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) createOrder(w http.ResponseWriter, r *http.Request) {
	input, ok := readOrderChanges(w, r, true)
	if !ok {
		return
	}
	order, err := scanOrder(s.db.QueryRow(r.Context(), `
		WITH o AS (
			INSERT INTO orders (number, sales_channel_id, total_kopecks)
			VALUES ($1, $2, $3)
			RETURNING *
		)
		SELECT `+orderColumns+` FROM o JOIN sales_channels AS c ON c.id = o.sales_channel_id`,
		*input.number, *input.channelID, *input.totalKopecks))
	if err != nil {
		s.writeOrderError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/orders/"+order.ID)
	writeJSON(w, http.StatusCreated, order)
}

func (s *Server) updateOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := readAdminID(w, r, "orderId")
	if !ok {
		return
	}
	changes, ok := readOrderChanges(w, r, false)
	if !ok {
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer tx.Rollback(ctx)

	var currentStatus string
	err = tx.QueryRow(ctx, "SELECT status FROM orders WHERE id = $1 FOR UPDATE", id).Scan(&currentStatus)
	if err != nil {
		s.writeOrderError(w, r, err)
		return
	}
	if currentStatus == "completed" || currentStatus == "cancelled" {
		writeError(w, http.StatusConflict, "order_final", "Завершённый или отменённый заказ изменить нельзя.")
		return
	}
	if changes.status != nil && !validOrderTransition(currentStatus, *changes.status) {
		writeError(w, http.StatusConflict, "invalid_status_transition", "Этот переход между статусами недопустим.")
		return
	}
	order, err := scanOrder(tx.QueryRow(ctx, `
		WITH o AS (
			UPDATE orders SET
				number = coalesce($2, number),
				sales_channel_id = coalesce($3, sales_channel_id),
				total_kopecks = coalesce($4, total_kopecks),
				status = coalesce($5, status)
			WHERE id = $1
			RETURNING *
		)
		SELECT `+orderColumns+` FROM o JOIN sales_channels AS c ON c.id = o.sales_channel_id`,
		id, changes.number, changes.channelID, changes.totalKopecks, changes.status))
	if err != nil {
		s.writeOrderError(w, r, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.writeOrderError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func readOrderChanges(w http.ResponseWriter, r *http.Request, creating bool) (orderChanges, bool) {
	var body struct {
		Number       json.RawMessage `json:"number"`
		ChannelID    json.RawMessage `json:"channelId"`
		TotalKopecks json.RawMessage `json:"totalKopecks"`
		Status       json.RawMessage `json:"status"`
	}
	var changes orderChanges
	if !decodeJSON(w, r, &body) {
		return changes, false
	}

	if creating || body.Number != nil {
		var value string
		if !decodeAdminField(body.Number, &value) {
			writeFieldError(w, "number", "Укажите номер заказа текстом.")
			return changes, false
		}
		value, ok := normalizeOrderNumber(value)
		if !ok {
			writeFieldError(w, "number", "Введите от 1 до 32 латинских букв, цифр или дефисов.")
			return changes, false
		}
		changes.number = &value
	}

	if creating || body.ChannelID != nil {
		var value string
		if !decodeAdminField(body.ChannelID, &value) {
			writeFieldError(w, "channelId", "Укажите идентификатор канала строкой.")
			return changes, false
		}
		id, ok := parseAdminID(value)
		if !ok {
			writeFieldError(w, "channelId", "Выберите существующий канал.")
			return changes, false
		}
		changes.channelID = &id
	}

	if creating || body.TotalKopecks != nil {
		var value int64
		if !decodeAdminField(body.TotalKopecks, &value) || value < 0 || value > maxOrderTotal {
			writeFieldError(w, "totalKopecks", "Укажите целую сумму от 0 до 999 999 999 копеек.")
			return changes, false
		}
		changes.totalKopecks = &value
	}

	if body.Status != nil {
		if creating {
			writeFieldError(w, "status", "Новый заказ автоматически получает статус «Новый».")
			return changes, false
		}
		var status string
		if !decodeAdminField(body.Status, &status) || !validOrderStatus(status) {
			writeFieldError(w, "status", "Выберите допустимый статус.")
			return changes, false
		}
		changes.status = &status
	}
	if changes.number == nil && changes.channelID == nil && changes.totalKopecks == nil && changes.status == nil {
		writeError(w, http.StatusBadRequest, "invalid_input", "Укажите хотя бы одно поле для изменения.")
		return changes, false
	}
	return changes, true
}

func normalizeOrderNumber(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if !orderNumberPattern.MatchString(value) {
		return "", false
	}
	return strings.ToUpper(value), true
}

func validOrderStatus(status string) bool {
	switch status {
	case "new", "processing", "completed", "cancelled":
		return true
	default:
		return false
	}
}

func validOrderTransition(from, to string) bool {
	switch from {
	case "new":
		return to == "processing" || to == "cancelled"
	case "processing":
		return to == "completed" || to == "cancelled"
	default:
		return false
	}
}

func decodeAdminField[T any](raw json.RawMessage, target *T) bool {
	return raw != nil && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) && json.Unmarshal(raw, target) == nil
}

func readAdminID(w http.ResponseWriter, r *http.Request, field string) (int64, bool) {
	id, ok := parseAdminID(r.PathValue(field))
	if !ok {
		writeFieldError(w, field, "Укажите корректный идентификатор.")
	}
	return id, ok
}

func parseAdminID(input string) (int64, bool) {
	if input == "" || input[0] < '1' || input[0] > '9' {
		return 0, false
	}
	id, err := strconv.ParseInt(input, 10, 64)
	return id, err == nil
}

func (s *Server) writeOrderError(w http.ResponseWriter, r *http.Request, err error) {
	var pgError *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, http.StatusNotFound, "order_not_found", "Заказ не найден.")
	case errors.As(err, &pgError) && pgError.Code == "23505":
		writeError(w, http.StatusConflict, "duplicate_order_number", "Заказ с таким номером уже существует.")
	case pgError != nil && pgError.Code == "23503":
		writeError(w, http.StatusNotFound, "channel_not_found", "Канал продаж не найден.")
	default:
		s.internalError(w, r, err)
	}
}

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestOrderStatusTransitions(t *testing.T) {
	allowed := map[[2]string]bool{
		{"new", "processing"}:       true,
		{"new", "cancelled"}:        true,
		{"processing", "completed"}: true,
		{"processing", "cancelled"}: true,
	}
	statuses := []string{"new", "processing", "completed", "cancelled", "invalid"}
	for _, from := range statuses {
		for _, to := range statuses {
			if got, want := validOrderTransition(from, to), allowed[[2]string{from, to}]; got != want {
				t.Errorf("%q -> %q = %v; want %v", from, to, got, want)
			}
		}
	}
}

func TestChannelNameValidation(t *testing.T) {
	for _, tc := range []struct {
		body string
		want string
	}{
		{`{"name":"  Выставка " }`, "Выставка"},
		{`{"name":""}`, ""},
		{`{"name":"\t  "}`, ""},
		{`{"name":"A\u0000B"}`, ""},
		{`{"name":null}`, ""},
		{`{"name":"` + strings.Repeat("я", 51) + `"}`, ""},
	} {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		name, accepted := readChannelName(response, req)
		if name != tc.want || accepted != (tc.want != "") {
			t.Errorf("%s: got %q / %v, want %q", tc.body, name, accepted, tc.want)
		}
	}
}

func TestChannelDeletionConstraintResponse(t *testing.T) {
	server := Server{}
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	for _, code := range []string{"23001", "23503"} {
		response := httptest.NewRecorder()
		server.writeChannelError(response, req, &pgconn.PgError{Code: code})
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "channel_in_use") {
			t.Errorf("PG %s produced %d with body %s", code, response.Code, response.Body.String())
		}
	}
}

func TestOrderChangesValidation(t *testing.T) {
	for _, tc := range []struct {
		name     string
		body     string
		creating bool
		accepted bool
	}{
		{"create with zero", `{"number":" z-106 ","channelId":"1","totalKopecks":0}`, true, true},
		{"create missing total", `{"number":"Z-106","channelId":"1"}`, true, false},
		{"create with user-selected status", `{"number":"Z-106","channelId":"1","totalKopecks":0,"status":"new"}`, true, false},
		{"change to zero", `{"totalKopecks":0}`, false, true},
		{"change to max", `{"totalKopecks":999999999}`, false, true},
		{"change to null", `{"totalKopecks":null}`, false, false},
		{"change to fraction", `{"totalKopecks":1.25}`, false, false},
		{"change to negative", `{"totalKopecks":-1}`, false, false},
		{"change to too high", `{"totalKopecks":1000000000}`, false, false},
		{"integer rather than string ID", `{"channelId":1}`, false, false},
		{"ID exceeds int64", `{"channelId":"9223372036854775808"}`, false, false},
		{"non-ASCII order number", `{"number":"ı"}`, false, false},
		{"empty patch", `{}`, false, false},
		{"bad status", `{"status":"refunded"}`, false, false},
		{"unknown field", `{"currency":"RUB"}`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			changes, accepted := readOrderChanges(response, req, tc.creating)
			if accepted != tc.accepted {
				t.Fatalf("accepted = %v; want %v. Body: %s", accepted, tc.accepted, response.Body.String())
			}
			if !accepted && response.Code != http.StatusBadRequest {
				t.Fatalf("rejected input returned HTTP %d", response.Code)
			}
			if tc.creating && accepted && (changes.number == nil || *changes.number != "Z-106" ||
				changes.totalKopecks == nil || *changes.totalKopecks != 0) {
				t.Fatalf("number or explicit zero was lost: %+v", changes)
			}
		})
	}
}

func TestOrderFilters(t *testing.T) {
	for _, tc := range []struct {
		query    string
		accepted bool
	}{
		{"", true},
		{"q=z-104&from=2026-11-16&to=2026-11-24&status=processing&channelId=2&page=3", true},
		{"from=2026-11-24&to=2026-11-16", false},
		{"from=2026-02-30", false},
		{"to=2026-1-01", false},
		{"from=0000-01-01", false},
		{"q=%ff", false},
		{"status=unknown", false},
		{"channelId=032", false},
		{"page=0", false},
		{"page=9223372036854775807", false},
		{"page=1&page=2", false},
	} {
		t.Run(tc.query, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/?"+tc.query, nil)
			response := httptest.NewRecorder()
			filters, accepted := readOrderFilters(response, req)
			if accepted != tc.accepted {
				t.Fatalf("accepted = %v; want %v. Body: %s", accepted, tc.accepted, response.Body.String())
			}
			if tc.accepted && strings.HasPrefix(tc.query, "q=") && (filters.query != "Z-104" ||
				filters.channelID == nil || *filters.channelID != 2 || filters.page != 3) {
				t.Fatalf("unexpected parsed filters: %+v", filters)
			}
		})
	}
}

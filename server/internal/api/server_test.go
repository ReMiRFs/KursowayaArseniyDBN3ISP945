package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeOrigin(t *testing.T) {
	origin, err := NormalizeOrigin("https://EXAMPLE.test:443/")
	if err != nil || origin != "https://example.test" {
		t.Fatalf("expected canonical origin, got %q, %v", origin, err)
	}
	for _, invalid := range []string{"*", "file:///tmp", "http://example.test/app", "http://example.test?q=1"} {
		if _, err := NormalizeOrigin(invalid); err == nil {
			t.Errorf("accepted %q", invalid)
		}
	}
}

func TestSessionCookieFlags(t *testing.T) {
	server := &Server{}
	for _, secure := range []bool{false, true} {
		scheme := "http"
		if secure {
			scheme = "https"
		}
		cookie := server.cookie(httptest.NewRequest(http.MethodPost, scheme+"://example.test/", nil), "demo", 43200)
		if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Secure != secure || cookie.MaxAge != 43200 {
			t.Errorf("unexpected flags on %s", scheme)
		}
	}
	server.secureCookie = true
	if cookie := server.cookie(httptest.NewRequest(http.MethodPost, "http://127.0.0.1/", nil), "demo", 43200); !cookie.Secure {
		t.Error("HTTPS origin behind a proxy should emit a Secure cookie")
	}
}

func TestDecodeJSON(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		ok   bool
	}{
		{"valid object", `{"name":"canal"}`, true},
		{"null", `null`, false},
		{"array", `[]`, false},
		{"wrong type", `{"name":10}`, false},
		{"unknown field", `{"unexpected":1}`, false},
		{"second object", `{"name":"canal"} {}`, false},
		{"too large", `{"name":"` + strings.Repeat("x", 16*1024) + `"}`, false},
		{"invalid UTF-8", "{\"name\":\"\xff\"}", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(test.body))
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
			res := httptest.NewRecorder()
			var target struct {
				Name string `json:"name"`
			}
			if ok := decodeJSON(res, req, &target); ok != test.ok {
				t.Fatalf("decodeJSON = %v, want %v", ok, test.ok)
			}
			if !test.ok && res.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", res.Code)
			}
		})
	}
}

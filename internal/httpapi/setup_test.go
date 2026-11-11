package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/testutil"
)

func setupHarness(t *testing.T) (*testHarness, string) {
	t.Helper()
	s := testutil.Database(t)
	h := &testHarness{t: t, now: time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC), password: security.Token()}
	s.Now = func() time.Time { return h.now }
	token := security.Token()
	digest := sha256.Sum256([]byte(token))
	h.s = &Server{Store: s, Config: Config{
		Origins: []string{"https://keybox.test"}, HashKey: bytes.Repeat([]byte{42}, 32),
		CSRFKey: bytes.Repeat([]byte{43}, 32), SetupTokenHash: digest[:], SessionTTL: time.Hour,
	}, Log: slog.New(slog.NewJSONHandler(&h.log, nil))}
	h.handler = New(h.s)
	return h, token
}

func setupBody(t *testing.T, token, username, password string) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"setup_token": token, "username": username, "password": password})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func requireCode(t *testing.T, r *httptest.ResponseRecorder, status, code int) {
	t.Helper()
	requireStatus(t, r, status)
	var result envelope
	if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil || result.Code != code {
		t.Fatalf("want code %d: %s", code, r.Body)
	}
}

func TestMySQLWebAdminSetup(t *testing.T) {
	h, token := setupHarness(t)
	// The full create-and-login flow must work at the exact eight-byte boundary.
	h.password = security.Token()[:8]
	path := "/api/v1/admin/setup"
	post := func(body []byte, ip string) *httptest.ResponseRecorder {
		return h.request("POST", path, body, "application/json", ip, false, false, false)
	}
	t.Run("fresh deployment and missing token", func(t *testing.T) {
		r := h.request("GET", path, nil, "", "192.0.2.1", false, false, false)
		requireStatus(t, r, 200)
		data := jsonData(t, r)
		if data["initialized"] != false || data["setup_available"] != true || len(data) != 2 {
			t.Fatal("unexpected setup status", r.Body)
		}
		hash := h.s.Config.SetupTokenHash
		h.s.Config.SetupTokenHash = nil
		r = h.request("GET", path, nil, "", "192.0.2.1", false, false, false)
		if jsonData(t, r)["setup_available"] != false {
			t.Fatal("unconfigured setup exposed")
		}
		requireCode(t, post(setupBody(t, token, "operator", h.password), "192.0.2.1"), 403, 40304)
		h.s.Config.SetupTokenHash = hash
	})
	t.Run("origin content type and token are required", func(t *testing.T) {
		body := setupBody(t, token, "operator", h.password)
		for _, origin := range []string{"", "https://evil.test", "null"} {
			req := httptest.NewRequest("POST", path, bytes.NewReader(body))
			req.Header.Set("Origin", origin)
			req.Header.Set("Content-Type", "application/json")
			req.RemoteAddr = "192.0.2.2:1000"
			r := httptest.NewRecorder()
			h.handler.ServeHTTP(r, req)
			requireCode(t, r, 403, 40303)
		}
		requireCode(t, h.request("POST", path, body, "text/plain", "192.0.2.2", false, false, false), 415, 41501)
		requireCode(t, post(setupBody(t, security.Token(), "operator", h.password), "192.0.2.2"), 401, 40102)
		requireCode(t, post([]byte(`{"username":"operator"}`), "192.0.2.2"), 401, 40102)
		requireCode(t, post([]byte(`{"setup_token":`), "192.0.2.2"), 400, 40001)
	})
	t.Run("password username and request bounds", func(t *testing.T) {
		for i, pair := range [][2]string{
			{"operator", strings.Repeat("a", 7)},
			{"operator", strings.Repeat("密", 25)},
			{" \t ", h.password},
			{strings.Repeat("a", 129), h.password},
			{"user\nname", h.password},
		} {
			requireCode(t, post(setupBody(t, token, pair[0], pair[1]), fmt.Sprintf("192.0.2.%d", 10+i)), 400, 40001)
		}
		requireCode(t, post(setupBody(t, token, "operator", strings.Repeat("a", 9000)), "192.0.2.15"), 400, 40001)
		requireCode(t, post([]byte(`{"unknown_field":true}`), "192.0.2.15"), 400, 40001)
		var count int64
		if err := h.s.Store.DB.Model(&store.Admin{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatal("rejected input created administrator", err)
		}
	})
	t.Run("create audit login and close permanently", func(t *testing.T) {
		r := post(setupBody(t, token, "  operator  ", h.password), "192.0.2.20")
		requireCode(t, r, 201, 0)
		if len(r.Result().Cookies()) != 0 || strings.Contains(r.Body.String(), token) || strings.Contains(r.Body.String(), h.password) {
			t.Fatal("setup issued session or exposed secrets")
		}
		data := jsonData(t, r)
		created := data["admin"].(map[string]any)
		if data["initialized"] != true || created["username"] != "operator" || len(created) != 2 {
			t.Fatal("unexpected safe setup response")
		}
		var admin store.Admin
		if err := h.s.Store.DB.First(&admin).Error; err != nil {
			t.Fatal(err)
		}
		if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(h.password)) != nil {
			t.Fatal("stored password hash mismatch")
		}
		if cost, err := bcrypt.Cost([]byte(admin.PasswordHash)); err != nil || cost != 12 {
			t.Fatal("wrong bcrypt cost")
		}
		var audit store.AuditLog
		if err := h.s.Store.DB.Where("action = 'admin_bootstrap'").Take(&audit).Error; err != nil {
			t.Fatal(err)
		}
		if audit.AdminID == nil || *audit.AdminID != admin.ID || audit.TargetID == nil || *audit.TargetID != admin.ID ||
			audit.Result != "success" || audit.IPHash == "" || audit.UserAgentHash == "" || audit.RequestID != r.Header().Get("X-Request-ID") {
			t.Fatal("bootstrap audit incomplete")
		}
		r = h.request("GET", path, nil, "", "192.0.2.20", false, false, false)
		if jsonData(t, r)["initialized"] != true || jsonData(t, r)["setup_available"] != false {
			t.Fatal("setup not closed")
		}
		requireCode(t, post(setupBody(t, token, "new-operator", h.password), "192.0.2.21"), 409, 40904)
		// Removing the deployment token after setup does not break ordinary login.
		h.s.Config.SetupTokenHash = nil
		body, _ := json.Marshal(map[string]string{"username": "operator", "password": h.password})
		r = h.request("POST", "/api/v1/admin/login", body, "application/json", "192.0.2.22", false, false, false)
		requireCode(t, r, 200, 0)
		if len(r.Result().Cookies()) != 1 || !r.Result().Cookies()[0].Secure {
			t.Fatal("normal login failed")
		}
		requireCode(t, post(setupBody(t, token, "new-operator", h.password), "192.0.2.23"), 409, 40904)
		var audits []store.AuditLog
		if err := h.s.Store.DB.Find(&audits).Error; err != nil {
			t.Fatal(err)
		}
		rejected := 0
		for _, event := range audits {
			if event.Action == "admin_write_rejected" {
				rejected++
			}
			for _, secret := range []string{token, h.password, admin.PasswordHash} {
				if bytes.Contains(event.DetailsJSON, []byte(secret)) || strings.Contains(h.log.String(), secret) {
					t.Fatal("setup credentials leaked into logs")
				}
			}
		}
		if rejected == 0 {
			t.Fatal("setup rejections were not audited")
		}
	})
}

func TestMySQLWebSetupRateLimitAndStorageFailure(t *testing.T) {
	h, token := setupHarness(t)
	path := "/api/v1/admin/setup"
	body := setupBody(t, security.Token(), "operator", h.password)
	for i := 0; i < 5; i++ {
		requireCode(t, h.request("POST", path, body, "application/json", "192.0.2.1", false, false, false), 401, 40102)
	}
	r := h.request("POST", path, body, "application/json", "192.0.2.1", false, false, false)
	requireCode(t, r, 429, 42901)
	if r.Header().Get("Retry-After") == "" {
		t.Fatal("setup quota omitted Retry-After")
	}
	// Missing migration state must never make an empty installation claimable.
	if err := h.s.Store.DB.Exec("DELETE FROM settings WHERE setting_key = 'admin_setup_completed'").Error; err != nil {
		t.Fatal(err)
	}
	requireCode(t, h.request("GET", path, nil, "", "192.0.2.2", false, false, false), 503, 50301)
	requireCode(t, h.request("POST", path, setupBody(t, token, "operator", h.password), "application/json", "192.0.2.2", false, false, false), 503, 50301)
}

func TestMySQLWebSetupConcurrentRequests(t *testing.T) {
	h, token := setupHarness(t)
	body := setupBody(t, token, "operator", h.password)
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			req := httptest.NewRequest("POST", "/api/v1/admin/setup", bytes.NewReader(body))
			req.RemoteAddr = fmt.Sprintf("192.0.2.%d:1000", i+1)
			req.Header.Set("Origin", "https://keybox.test")
			req.Header.Set("Content-Type", "application/json")
			r := httptest.NewRecorder()
			h.handler.ServeHTTP(r, req)
			results <- r
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for r := range results {
		if r.Code == 201 {
			success++
		} else {
			requireCode(t, r, 409, 40904)
		}
	}
	if success != 1 {
		t.Fatalf("successful setup requests = %d", success)
	}
}

package httpapi

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/testutil"
	"keybox/internal/validator"
)

type testRoots struct{ certs []*x509.Certificate }

func (r *testRoots) Snapshot() validator.RootSet {
	return validator.RootSet{Version: "integration-root-v1", Certs: r.certs}
}

type testCRL struct {
	usable  bool
	entries map[string]string
}

func (c *testCRL) Snapshot(context.Context) (validator.Revocations, error) {
	return validator.Revocations{Version: "integration-crl-v1", Usable: c.usable, Entries: c.entries}, nil
}

type testHarness struct {
	t        *testing.T
	s        *Server
	handler  http.Handler
	now      time.Time
	cookie   *http.Cookie
	csrf     string
	log      bytes.Buffer
	password string
}

func (h *testHarness) request(method, path string, body []byte, contentType, ip string, admin, csrf, confirm bool) *httptest.ResponseRecorder {
	h.t.Helper()
	h.now = h.now.Add(time.Second)
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.RemoteAddr = ip + ":12345"
	req.Header.Set("User-Agent", "integration")
	req.Header.Set("Origin", "https://keybox.test")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if admin && h.cookie != nil {
		req.AddCookie(h.cookie)
	}
	if csrf {
		req.Header.Set("X-CSRF-Token", h.csrf)
	}
	if confirm {
		req.Header.Set("X-Confirm-Guest-Download", "enable-sensitive-downloads")
	}
	out := httptest.NewRecorder()
	h.handler.ServeHTTP(out, req)
	if out.Header().Get("X-Request-ID") == "" {
		h.t.Fatal("missing request ID")
	}
	if out.Header().Get("Cache-Control") != "no-store" {
		h.t.Fatal("missing no-store")
	}
	if strings.HasPrefix(out.Header().Get("Content-Type"), "application/json") {
		var result envelope
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			h.t.Fatalf("invalid JSON: %s", out.Body)
		}
		if result.RequestID != out.Header().Get("X-Request-ID") {
			h.t.Fatal("request ID mismatch")
		}
		for _, secret := range []string{"BEGIN PRIVATE KEY", "storage_ref", "ciphertext", "password_hash", "session_hash", "cert_der"} {
			if strings.Contains(out.Body.String(), secret) {
				h.t.Fatalf("sensitive field leaked: %s", secret)
			}
		}
	}
	return out
}
func (h *testHarness) upload(path string, raw []byte, ip string) *httptest.ResponseRecorder {
	h.t.Helper()
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	p, err := m.CreateFormFile("file", "keybox.xml")
	if err != nil {
		h.t.Fatal(err)
	}
	if _, err = p.Write(raw); err != nil {
		h.t.Fatal(err)
	}
	if err = m.Close(); err != nil {
		h.t.Fatal(err)
	}
	return h.request("POST", path, b.Bytes(), m.FormDataContentType(), ip, false, false, false)
}
func requireStatus(t *testing.T, r *httptest.ResponseRecorder, status int) {
	t.Helper()
	if r.Code != status {
		t.Fatalf("want %d got %d: %s", status, r.Code, r.Body)
	}
}
func jsonData(t *testing.T, r *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Data
}

func TestMySQLAPIEndToEnd(t *testing.T) {
	s := testutil.Database(t)
	fixture := testutil.Make(t, false, false, false)
	h := &testHarness{t: t, now: fixture.Now, password: security.Token()}
	s.Now = func() time.Time { return h.now }
	vault, err := security.NewVault("test", map[string][]byte{"test": bytes.Repeat([]byte{31}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	roots := &testRoots{[]*x509.Certificate{fixture.Root}}
	crl := &testCRL{true, map[string]string{}}
	h.s = &Server{Store: s, Vault: vault, Validator: &validator.Validator{Now: s.Now, Roots: roots, CRL: crl},
		Config: Config{Origins: []string{"https://keybox.test"}, HashKey: bytes.Repeat([]byte{42}, 32), CSRFKey: bytes.Repeat([]byte{43}, 32),
			MaxFileBytes: 1 << 20, UploadPerHour: 10, GlobalUploadsPerHour: 200, GuestDownloadsPerHour: 20, GlobalDownloadsPerHour: 200, SessionTTL: time.Hour},
		Log: slog.New(slog.NewJSONHandler(&h.log, nil))}
	h.handler = New(h.s)
	hash, _ := bcrypt.GenerateFromPassword([]byte(h.password), bcrypt.MinCost)
	admin := store.Admin{ID: domain.NewID(), Username: "test-operator", PasswordHash: string(hash), Status: "active", CreatedAt: h.now}
	if err := s.DB.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	var id string
	t.Run("validate does not store a formal keybox", func(t *testing.T) {
		r := h.upload("/api/v1/keyboxes/validate", fixture.XML, "192.0.2.1")
		requireStatus(t, r, 200)
		if jsonData(t, r)["overall_status"] != "valid" {
			t.Fatal(r.Body)
		}
		var count int64
		s.DB.Model(&store.Keybox{}).Count(&count)
		if count != 0 {
			t.Fatal("validation stored formal record")
		}
	})
	t.Run("valid upload is atomic and encrypted", func(t *testing.T) {
		r := h.upload("/api/v1/keyboxes", fixture.XML, "192.0.2.2")
		requireStatus(t, r, 201)
		id = jsonData(t, r)["id"].(string)
		blob, err := s.Blob(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(blob.Ciphertext, []byte("PRIVATE KEY")) || bytes.Equal(blob.Ciphertext, fixture.XML) {
			t.Fatal("plaintext storage")
		}
		raw, err := vault.Open(id, blob.KeyID, blob.Nonce, blob.Ciphertext)
		if err != nil || !bytes.Equal(raw, fixture.XML) {
			t.Fatal("encrypted file changed")
		}
		var rows []store.ValidationRun
		s.DB.Find(&rows)
		for _, row := range rows {
			if bytes.Contains(row.ResultJSON, []byte("PRIVATE KEY")) {
				t.Fatal("validation history leak")
			}
		}
	})
	t.Run("invalid uploads never create formal records", func(t *testing.T) {
		requireStatus(t, h.upload("/api/v1/keyboxes", []byte(`<!DOCTYPE a><a/>`), "192.0.2.3"), 422)
		expired := testutil.Make(t, true, false, false)
		roots.certs = append(roots.certs, expired.Root)
		requireStatus(t, h.upload("/api/v1/keyboxes", expired.XML, "192.0.2.4"), 422)
		requireStatus(t, h.upload("/api/v1/keyboxes", bytes.Repeat([]byte{'x'}, (1<<20)+1), "192.0.2.5"), 413)
		var count int64
		s.DB.Model(&store.Keybox{}).Count(&count)
		if count != 1 {
			t.Fatalf("formal record count %d", count)
		}
	})
	t.Run("file and certificate-set duplicates return conflict", func(t *testing.T) {
		requireStatus(t, h.upload("/api/v1/keyboxes", fixture.XML, "192.0.2.6"), 409)
		modified := append([]byte(" \n"), fixture.XML...)
		requireStatus(t, h.upload("/api/v1/keyboxes", modified, "192.0.2.7"), 409)
	})
	t.Run("public queries and certificate lookup", func(t *testing.T) {
		for _, path := range []string{"/api/v1/keyboxes?status=valid", "/api/v1/keyboxes/" + id, "/api/v1/keyboxes/" + id + "/status", "/api/v1/certificates/status?serial_number=000200"} {
			requireStatus(t, h.request("GET", path, nil, "", "192.0.2.8", false, false, false), 200)
		}
		data := jsonData(t, h.request("GET", "/api/v1/keyboxes/"+id, nil, "", "192.0.2.8", false, false, false))
		if data["guest_downloadable_effective"] != false || data["guest_download_enabled"] != false {
			t.Fatal("guest downloads defaulted to enabled")
		}
	})
	t.Run("guest download defaults off and is logged", func(t *testing.T) {
		requireStatus(t, h.request("GET", "/api/v1/keyboxes/"+id+"/download", nil, "", "192.0.2.9", false, false, false), 403)
		var n int64
		s.DB.Model(&store.DownloadLog{}).Where("keybox_id = ? AND actor_type = 'guest' AND result = 'denied'", id).Count(&n)
		if n != 1 {
			t.Fatal("denial not logged")
		}
	})
	t.Run("authentication secure cookie CSRF confirmation", func(t *testing.T) {
		requireStatus(t, h.request("GET", "/api/v1/admin/me", nil, "", "192.0.2.10", false, false, false), 401)
		requireStatus(t, h.request("GET", "/api/v1/admin/keyboxes/"+id+"/download", nil, "", "192.0.2.10", false, false, false), 401)
		body, _ := json.Marshal(map[string]string{"username": admin.Username, "password": h.password})
		r := h.request("POST", "/api/v1/admin/login", body, "application/json", "192.0.2.10", false, false, false)
		requireStatus(t, r, 200)
		h.cookie = r.Result().Cookies()[0]
		if !h.cookie.HttpOnly || !h.cookie.Secure || h.cookie.SameSite != http.SameSiteStrictMode || h.cookie.Path != "/" || h.cookie.Domain != "" {
			t.Fatal("unsafe session cookie")
		}
		h.csrf = jsonData(t, r)["csrf_token"].(string)
		requireStatus(t, h.request("PATCH", "/api/v1/admin/settings/guest-download", []byte(`{"enabled":true}`), "application/json", "192.0.2.10", true, false, true), 403)
		requireStatus(t, h.request("PATCH", "/api/v1/admin/settings/guest-download", []byte(`{"enabled":true}`), "application/json", "192.0.2.10", true, true, false), 409)
		requireStatus(t, h.request("GET", "/api/v1/admin/me", nil, "", "192.0.2.10", true, false, false), 200)
		requireStatus(t, h.request("GET", "/api/v1/admin/keyboxes?guest_download_policy=inherit", nil, "", "192.0.2.10", true, false, false), 200)
	})
	t.Run("complete guest download policy matrix", func(t *testing.T) {
		counter := 20
		for _, enabled := range []bool{false, true} {
			body := []byte(fmt.Sprintf(`{"enabled":%v}`, enabled))
			requireStatus(t, h.request("PATCH", "/api/v1/admin/settings/guest-download", body, "application/json", "192.0.2.11", true, true, enabled), 200)
			for _, policy := range []string{"inherit", "allowed", "denied"} {
				requireStatus(t, h.request("PATCH", "/api/v1/admin/keyboxes/"+id, []byte(`{"guest_download_policy":"`+policy+`"}`), "application/json", "192.0.2.11", true, true, false), 200)
				counter++
				ip := fmt.Sprintf("192.0.2.%d", counter)
				r := h.request("GET", "/api/v1/keyboxes/"+id+"/download", nil, "", ip, false, false, false)
				if enabled && policy != "denied" {
					requireStatus(t, r, 200)
					if !bytes.Equal(r.Body.Bytes(), fixture.XML) {
						t.Fatal("original file altered")
					}
					if r.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(r.Header().Get("Content-Disposition"), "attachment;") {
						t.Fatal("unsafe download headers")
					}
				} else {
					requireStatus(t, r, 403)
				}
			}
		}
		requireStatus(t, h.request("PATCH", "/api/v1/admin/keyboxes/"+id, []byte(`{"guest_download_policy":"allowed"}`), "application/json", "192.0.2.11", true, true, false), 200)
		requireStatus(t, h.request("PATCH", "/api/v1/admin/settings/guest-download", []byte(`{"enabled":false}`), "application/json", "192.0.2.11", true, true, false), 200)
		requireStatus(t, h.request("GET", "/api/v1/keyboxes/"+id+"/download", nil, "", "192.0.2.30", false, false, false), 403)
	})
	t.Run("downloads and upload are rate limited", func(t *testing.T) {
		for i := 0; i < 2; i++ {
			requireStatus(t, h.request("GET", "/api/v1/keyboxes/"+id+"/download", nil, "", "192.0.2.31", false, false, false), 403)
		}
		r := h.request("GET", "/api/v1/keyboxes/"+id+"/download", nil, "", "192.0.2.31", false, false, false)
		requireStatus(t, r, 429)
		if r.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry-after")
		}
		h.s.Config.UploadPerHour = 1
		requireStatus(t, h.upload("/api/v1/keyboxes/validate", fixture.XML, "192.0.2.32"), 200)
		r = h.upload("/api/v1/keyboxes/validate", fixture.XML, "192.0.2.32")
		requireStatus(t, r, 429)
		if r.Header().Get("Retry-After") == "" {
			t.Fatal("missing upload retry-after")
		}
		h.s.Config.UploadPerHour = 10
	})
	t.Run("administrator download audited without CSRF on GET", func(t *testing.T) {
		r := h.request("GET", "/api/v1/admin/keyboxes/"+id+"/download", nil, "", "192.0.2.33", true, false, false)
		requireStatus(t, r, 200)
		if !bytes.Equal(r.Body.Bytes(), fixture.XML) {
			t.Fatal("admin download mismatch")
		}
		var count int64
		s.DB.Model(&store.AuditLog{}).Where("action = 'keybox_download' AND admin_id = ? AND result = 'authorized'", admin.ID).Count(&count)
		if count != 1 {
			t.Fatal("admin download missing audit")
		}
	})
	t.Run("stale CRL fails closed for upload and queries", func(t *testing.T) {
		crl.usable = false
		r := h.upload("/api/v1/keyboxes", fixture.XML, "192.0.2.34")
		requireStatus(t, r, 422)
		if jsonData(t, r)["overall_status"] != "indeterminate" {
			t.Fatal(r.Body)
		}
		r = h.request("GET", "/api/v1/keyboxes/"+id, nil, "", "192.0.2.34", false, false, false)
		requireStatus(t, r, 200)
		if jsonData(t, r)["overall_status"] != "indeterminate" {
			t.Fatal("unknown promoted to valid")
		}
		r = h.request("GET", "/api/v1/keyboxes?status=valid", nil, "", "192.0.2.34", false, false, false)
		requireStatus(t, r, 200)
		if jsonData(t, r)["total"].(float64) != 0 {
			t.Fatal("stale record in valid list")
		}
		crl.usable = true
	})
	t.Run("revoked root affects every chain revalidation history", func(t *testing.T) {
		crl.entries["100"] = "REVOKED"
		r := h.request("POST", "/api/v1/admin/keyboxes/"+id+"/revalidate", nil, "", "192.0.2.35", true, true, false)
		requireStatus(t, r, 200)
		if jsonData(t, r)["overall_status"] != "revoked" {
			t.Fatal(r.Body)
		}
		requireStatus(t, h.request("GET", "/api/v1/admin/keyboxes/"+id+"/validation-runs", nil, "", "192.0.2.35", true, false, false), 200)
		delete(crl.entries, "100")
		requireStatus(t, h.request("POST", "/api/v1/admin/keyboxes/"+id+"/revalidate", nil, "", "192.0.2.35", true, true, false), 200)
	})
	t.Run("hidden and deleted records are not public", func(t *testing.T) {
		requireStatus(t, h.request("PATCH", "/api/v1/admin/keyboxes/"+id, []byte(`{"visibility":"hidden","admin_note":"reviewed"}`), "application/json", "192.0.2.36", true, true, false), 200)
		for _, suffix := range []string{"", "/status", "/download"} {
			requireStatus(t, h.request("GET", "/api/v1/keyboxes/"+id+suffix, nil, "", "192.0.2.37", false, false, false), 404)
		}
		requireStatus(t, h.request("GET", "/api/v1/admin/keyboxes/"+id, nil, "", "192.0.2.36", true, false, false), 200)
		requireStatus(t, h.request("PATCH", "/api/v1/admin/keyboxes/"+id, []byte(`{"visibility":"public"}`), "application/json", "192.0.2.36", true, true, false), 200)
		requireStatus(t, h.request("DELETE", "/api/v1/admin/keyboxes/"+id, nil, "", "192.0.2.36", true, true, false), 200)
		requireStatus(t, h.request("GET", "/api/v1/keyboxes/"+id, nil, "", "192.0.2.36", false, false, false), 404)
		var b store.Keybox
		if err := s.DB.Where("id = ?", id).Take(&b).Error; err != nil || b.DeletedAt == nil {
			t.Fatal("not a soft delete")
		}
	})
	t.Run("audit actions log redaction logout", func(t *testing.T) {
		for _, action := range []string{"guest_download_setting_update", "keybox_download_policy_update", "keybox_update", "keybox_revalidate", "keybox_delete", "admin_login"} {
			var n int64
			s.DB.Model(&store.AuditLog{}).Where("action = ?", action).Count(&n)
			if n == 0 {
				t.Fatalf("missing %s", action)
			}
		}
		requireStatus(t, h.request("GET", "/api/v1/admin/audit-logs", nil, "", "192.0.2.38", true, false, false), 200)
		requireStatus(t, h.request("GET", "/api/v1/admin/download-logs", nil, "", "192.0.2.38", true, false, false), 200)
		requireStatus(t, h.request("POST", "/api/v1/admin/logout", nil, "", "192.0.2.38", true, true, false), 200)
		requireStatus(t, h.request("GET", "/api/v1/admin/me", nil, "", "192.0.2.38", true, false, false), 401)
		for _, secret := range []string{"PRIVATE KEY", h.password, h.cookie.Value, h.csrf, "192.0.2.1"} {
			if strings.Contains(h.log.String(), secret) {
				t.Fatal("secret in application logs")
			}
		}
	})
}

func TestForwardedIPTrustBoundary(t *testing.T) {
	s := &Server{}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:123"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	if s.clientIP(r) != "192.0.2.1" {
		t.Fatal("untrusted forwarded IP accepted")
	}
}

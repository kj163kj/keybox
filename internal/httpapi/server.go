package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/trust"
	"keybox/internal/validator"
)

type Config struct {
	Origins                                       []string
	TrustedProxies                                []netip.Prefix
	HashKey, CSRFKey                              []byte
	MaxFileBytes                                  int64
	UploadPerHour, GlobalUploadsPerHour           int
	GuestDownloadsPerHour, GlobalDownloadsPerHour int
	SessionTTL                                    time.Duration
}
type Server struct {
	Store     *store.Store
	Vault     *security.Vault
	Validator *validator.Validator
	Roots     *trust.Roots
	CRL       *trust.CRL
	Config    Config
	Log       *slog.Logger
	dummyHash []byte
}
type requestMeta struct {
	ID, IPHash, UAHash string
	Admin              *store.Admin
	Session            *store.AdminSession
	Token              string
}
type contextKey struct{}

func meta(r *http.Request) *requestMeta { return r.Context().Value(contextKey{}).(*requestMeta) }
func actor(r *http.Request) store.Actor {
	m := meta(r)
	a := store.Actor{IPHash: m.IPHash, UAHash: m.UAHash, RequestID: m.ID}
	if m.Admin != nil {
		a.AdminID = &m.Admin.ID
	}
	return a
}

type envelope struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Data      any    `json:"data"`
	RequestID string `json:"request_id"`
}

func (s *Server) write(w http.ResponseWriter, r *http.Request, status, code int, message string, data any) {
	if status >= 400 && strings.HasPrefix(r.URL.Path, "/api/v1/admin/") && r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
		if err := s.Store.Audit(s.Store.DB.WithContext(r.Context()), actor(r), "admin_write_rejected", "request", "", "denied", map[string]any{"http_status": status, "code": code}); err != nil {
			status, code, message, data = 503, 50301, "service unavailable", nil
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Code: code, Message: message, Data: data, RequestID: meta(r).ID})
}
func (s *Server) ok(w http.ResponseWriter, r *http.Request, data any) {
	s.write(w, r, 200, 0, "ok", data)
}
func (s *Server) failure(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.write(w, r, 404, 40401, "not found", nil)
	case errors.Is(err, store.ErrDuplicate):
		s.write(w, r, 409, 40901, "duplicate keybox", nil)
	case errors.Is(err, store.ErrConflict):
		s.write(w, r, 409, 40902, "state conflict; retry", nil)
	case errors.Is(err, store.ErrDenied):
		s.write(w, r, 403, 40301, "download disabled", nil)
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		s.write(w, r, 408, 40801, "request timeout", nil)
	default:
		s.write(w, r, 503, 50301, "service unavailable", nil)
	}
}
func New(s *Server) http.Handler {
	if s.Log == nil {
		s.Log = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	s.dummyHash, _ = bcrypt.GenerateFromPassword([]byte(security.Token()), 12)
	r := chi.NewRouter()
	r.Use(s.middleware)
	r.NotFound(func(w http.ResponseWriter, r *http.Request) { s.write(w, r, 404, 40401, "not found", nil) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) { s.write(w, r, 405, 40501, "method not allowed", nil) })
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { s.ok(w, r, map[string]string{"status": "up"}) })
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/keyboxes/validate", s.validate)
		r.Post("/keyboxes", s.upload)
		r.Get("/keyboxes", s.listPublic)
		r.Get("/keyboxes/{id}", s.detailPublic)
		r.Get("/keyboxes/{id}/status", s.status)
		r.Get("/keyboxes/{id}/download", s.downloadGuest)
		r.Get("/certificates/status", s.certificateStatus)
		r.Post("/admin/login", s.login)
		r.Route("/admin", func(r chi.Router) {
			r.Use(s.authenticate)
			r.Post("/logout", s.logout)
			r.Get("/me", s.me)
			r.Get("/keyboxes", s.listAdmin)
			r.Get("/keyboxes/{id}", s.detailAdmin)
			r.Post("/keyboxes/{id}/revalidate", s.revalidate)
			r.Patch("/keyboxes/{id}", s.patch)
			r.Delete("/keyboxes/{id}", s.delete)
			r.Get("/keyboxes/{id}/validation-runs", s.runs)
			r.Get("/keyboxes/{id}/download", s.downloadAdmin)
			r.Get("/settings/guest-download", s.getGuestSetting)
			r.Patch("/settings/guest-download", s.setGuestSetting)
			r.Get("/audit-logs", s.auditLogs)
			r.Get("/download-logs", s.downloadLogs)
			r.Get("/system/health", s.health)
			r.Post("/system/crl/refresh", s.refreshCRL)
		})
	})
	return r
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (w *responseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *responseWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(b)
}
func (w *responseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		m := &requestMeta{ID: domain.NewID(), IPHash: security.Digest(s.Config.HashKey, "ip", s.clientIP(r)), UAHash: security.Digest(s.Config.HashKey, "ua", r.UserAgent())}
		ctx, cancel := context.WithTimeout(context.WithValue(r.Context(), contextKey{}, m), 15*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		rw := &responseWriter{ResponseWriter: w}
		w.Header().Set("X-Request-ID", m.ID)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if recover() != nil {
				// Deliberately omit panic value, stack and request bodies.
				if rw.status == 0 {
					s.write(rw, r, 500, 50001, "internal error", nil)
				}
				s.Log.Error("request panic", "request_id", m.ID)
			}
			route := chi.RouteContext(r.Context()).RoutePattern()
			if route == "" {
				route = "unmatched"
			}
			s.Log.Info("request", "request_id", m.ID, "method", r.Method, "path", route, "status", rw.status, "duration_ms", time.Since(start).Milliseconds(), "ip_hash", m.IPHash)
		}()
		if origin := r.Header.Get("Origin"); origin != "" {
			if !s.allowedOrigin(origin) {
				s.write(rw, r, 403, 40303, "origin forbidden", nil)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, Retry-After, Content-Disposition")
		}
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Confirm-Guest-Download")
			s.ok(rw, r, nil)
			return
		}
		// Bound all requests, including read-side enumeration, across replicas.
		if r.URL.Path != "/healthz" && !s.limit(rw, r, []store.Limit{
			{Key: "requests:ip:" + m.IPHash, Max: 120, Window: time.Minute},
			{Key: "requests:global", Max: 3000, Window: time.Minute},
		}) {
			return
		}
		next.ServeHTTP(rw, r)
	})
}
func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	address, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}
	address = address.Unmap()
	isTrusted := func(a netip.Addr) bool {
		for _, prefix := range s.Config.TrustedProxies {
			if prefix.Contains(a) {
				return true
			}
		}
		return false
	}
	if isTrusted(address) {
		forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if len(forwarded) <= 16 {
			for i := len(forwarded) - 1; i >= 0; i-- {
				next, err := netip.ParseAddr(strings.TrimSpace(forwarded[i]))
				if err != nil {
					return address.String()
				}
				address = next.Unmap()
				if !isTrusted(address) {
					break
				}
			}
		}
	}
	return address.String()
}
func (s *Server) allowedOrigin(origin string) bool {
	for _, allowed := range s.Config.Origins {
		if origin == allowed {
			return true
		}
	}
	return false
}
func (s *Server) limit(w http.ResponseWriter, r *http.Request, limits []store.Limit) bool {
	retry, err := s.Store.Allow(r.Context(), limits)
	if err == nil {
		return true
	}
	if errors.Is(err, store.ErrRateLimited) {
		if strings.HasSuffix(r.URL.Path, "/download") {
			actorType := "guest"
			if strings.HasPrefix(r.URL.Path, "/api/v1/admin/") {
				actorType = "admin"
			}
			if logErr := s.Store.LogDownload(s.Store.DB.WithContext(r.Context()), "", actorType, "rate_limited", actor(r)); logErr != nil {
				s.failure(w, r, logErr)
				return false
			}
		}
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		s.write(w, r, 429, 42901, "rate limit exceeded", nil)
	} else {
		s.failure(w, r, err)
	}
	return false
}
func (s *Server) decode(w http.ResponseWriter, r *http.Request, out any) bool {
	kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" {
		s.write(w, r, 415, 41501, "application/json required", nil)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		s.write(w, r, 400, 40001, "invalid JSON body", nil)
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		s.write(w, r, 400, 40001, "single JSON object required", nil)
		return false
	}
	return true
}
func (s *Server) pagination(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	page, size := 1, 20
	var err error
	if x := r.URL.Query().Get("page"); x != "" {
		page, err = strconv.Atoi(x)
		if err != nil {
			page = 0
		}
	}
	if x := r.URL.Query().Get("page_size"); x != "" {
		size, err = strconv.Atoi(x)
		if err != nil {
			size = 0
		}
	}
	if page < 1 || page > 10000 || size < 1 || size > 100 {
		s.write(w, r, 400, 40001, "invalid pagination", nil)
		return 0, 0, false
	}
	return page, size, true
}
func (s *Server) id(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if len(id) != 32 {
		s.write(w, r, 404, 40401, "not found", nil)
		return "", false
	}
	for _, ch := range id {
		if !strings.ContainsRune("0123456789abcdef", ch) {
			s.write(w, r, 404, 40401, "not found", nil)
			return "", false
		}
	}
	return id, true
}
func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
)

const cookieName = "__Host-keybox_session"

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.allowedOrigin(r.Header.Get("Origin")) {
		s.write(w, r, 403, 40303, "origin required", nil)
		return
	}
	if !s.limit(w, r, []store.Limit{{Key: "login:ip:" + meta(r).IPHash, Max: 5, Window: 15 * time.Minute}, {Key: "login:global", Max: 50, Window: time.Minute}}) {
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !s.decode(w, r, &input) {
		return
	}
	if len(input.Username) == 0 || len(input.Username) > 128 || len(input.Password) > 72 {
		s.write(w, r, 400, 40001, "invalid credentials format", nil)
		return
	}
	userKey := security.Digest(s.Config.HashKey, "username", input.Username)
	if !s.limit(w, r, []store.Limit{{Key: "login:username:" + userKey, Max: 10, Window: 15 * time.Minute}}) {
		return
	}
	release, ok := s.validationSlot(w, r)
	if !ok {
		return
	}
	defer release()
	var admin store.Admin
	err := s.Store.DB.WithContext(r.Context()).Where("username = ?", input.Username).Take(&admin).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		s.failure(w, r, err)
		return
	}
	hash := s.dummyHash
	if err == nil {
		hash = []byte(admin.PasswordHash)
	}
	match := bcrypt.CompareHashAndPassword(hash, []byte(input.Password)) == nil
	if err != nil || !match || admin.Status != "active" {
		if auditErr := s.Store.Audit(s.Store.DB.WithContext(r.Context()), actor(r), "admin_login", "admin", "", "denied", nil); auditErr != nil {
			s.failure(w, r, auditErr)
			return
		}
		s.write(w, r, 401, 40101, "invalid credentials", nil)
		return
	}
	token := security.Token()
	csrf := security.Digest(s.Config.CSRFKey, "csrf", token)
	now := s.Store.Now().UTC()
	session := store.AdminSession{ID: domain.NewID(), AdminID: admin.ID, SessionHash: security.Hash(token), CSRFTokenHash: security.Hash(csrf),
		ExpiresAt: now.Add(s.Config.SessionTTL), CreatedAt: now}
	meta(r).Admin = &admin
	err = s.Store.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&session).Error; err != nil {
			return err
		}
		if err := tx.Model(&admin).Update("last_login_at", now).Error; err != nil {
			return err
		}
		return s.Store.Audit(tx, actor(r), "admin_login", "admin", admin.ID, "success", nil)
	})
	if err != nil {
		s.failure(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, Expires: session.ExpiresAt, MaxAge: int(s.Config.SessionTTL.Seconds())})
	s.ok(w, r, map[string]any{"admin": map[string]string{"id": admin.ID, "username": admin.Username}, "csrf_token": csrf, "expires_at": session.ExpiresAt})
}
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil || len(cookie.Value) != 43 {
			s.authReject(w, r, 401, 40101, "authentication required")
			return
		}
		var session store.AdminSession
		err = s.Store.DB.WithContext(r.Context()).Where("session_hash = ? AND revoked_at IS NULL AND expires_at > ?", security.Hash(cookie.Value), s.Store.Now().UTC()).Take(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s.authReject(w, r, 401, 40101, "authentication required")
			return
		}
		if err != nil {
			s.failure(w, r, err)
			return
		}
		var admin store.Admin
		err = s.Store.DB.WithContext(r.Context()).Where("id = ? AND status = 'active'", session.AdminID).Take(&admin).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s.authReject(w, r, 401, 40101, "authentication required")
			return
		}
		if err != nil {
			s.failure(w, r, err)
			return
		}
		m := meta(r)
		m.Admin = &admin
		m.Session = &session
		m.Token = cookie.Value
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			if !s.allowedOrigin(r.Header.Get("Origin")) || !equal(security.Hash(r.Header.Get("X-CSRF-Token")), session.CSRFTokenHash) {
				s.authReject(w, r, 403, 40302, "CSRF verification failed")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) authReject(w http.ResponseWriter, r *http.Request, status, code int, message string) {
	// Failed writes and unauthenticated admin download attempts remain auditable.
	if strings.HasSuffix(r.URL.Path, "/download") {
		if err := s.Store.LogDownload(s.Store.DB.WithContext(r.Context()), "", "admin", "unauthorized", actor(r)); err != nil {
			s.failure(w, r, err)
			return
		}
	} else if r.Method != "GET" {
		if err := s.Store.Audit(s.Store.DB.WithContext(r.Context()), actor(r), "admin_request_rejected", "request", "", "denied", nil); err != nil {
			s.failure(w, r, err)
			return
		}
	}
	s.write(w, r, status, code, message, nil)
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	m := meta(r)
	s.ok(w, r, map[string]any{"id": m.Admin.ID, "username": m.Admin.Username, "csrf_token": security.Digest(s.Config.CSRFKey, "csrf", m.Token), "expires_at": m.Session.ExpiresAt})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	m := meta(r)
	err := s.Store.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&store.AdminSession{}).Where("id = ?", m.Session.ID).Update("revoked_at", s.Store.Now().UTC()).Error; err != nil {
			return err
		}
		return s.Store.Audit(tx, actor(r), "admin_logout", "admin", m.Admin.ID, "success", nil)
	})
	if err != nil {
		s.failure(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	s.ok(w, r, nil)
}

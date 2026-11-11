package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"keybox/internal/security"
	"keybox/internal/store"
)

func (s *Server) setupStatus(w http.ResponseWriter, r *http.Request) {
	initialized, err := s.Store.AdminInitialized(r.Context())
	if err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]bool{
		"initialized": initialized, "setup_available": !initialized && len(s.Config.SetupTokenHash) == sha256.Size,
	})
}

func (s *Server) setupAdmin(w http.ResponseWriter, r *http.Request) {
	if !s.allowedOrigin(r.Header.Get("Origin")) {
		s.write(w, r, 403, 40303, "origin required", nil)
		return
	}
	if !s.limit(w, r, []store.Limit{
		{Key: "setup:ip:" + meta(r).IPHash, Max: 5, Window: 15 * time.Minute},
		{Key: "setup:global", Max: 30, Window: 15 * time.Minute},
	}) {
		return
	}
	initialized, err := s.Store.AdminInitialized(r.Context())
	if err != nil {
		s.failure(w, r, err)
		return
	}
	if initialized {
		s.write(w, r, 409, 40904, "admin setup already completed", nil)
		return
	}
	if len(s.Config.SetupTokenHash) != sha256.Size {
		s.write(w, r, 403, 40304, "admin setup unavailable", nil)
		return
	}
	var input struct {
		SetupToken string `json:"setup_token"`
		Username   string `json:"username"`
		Password   string `json:"password"`
	}
	// JSON-only plus exact Origin and a deployment secret protect this pre-session
	// endpoint. No session/CSRF token or authenticated identity exists yet.
	if !s.decode(w, r, &input) {
		return
	}
	tokenHash := sha256.Sum256([]byte(input.SetupToken))
	input.SetupToken = ""
	if subtle.ConstantTimeCompare(tokenHash[:], s.Config.SetupTokenHash) != 1 {
		s.write(w, r, 401, 40102, "invalid setup token", nil)
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	if !security.AdminCredentialsValid(input.Username, input.Password) {
		s.write(w, r, 400, 40001, "username must be 1-128 UTF-8 bytes without control characters; password must be 8-72 UTF-8 bytes", nil)
		return
	}
	release, ok := s.validationSlot(w, r)
	if !ok {
		return
	}
	defer release()
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), 12)
	input.Password = ""
	if err != nil {
		s.failure(w, r, err)
		return
	}
	admin, err := s.Store.BootstrapAdmin(r.Context(), input.Username, string(hash), actor(r))
	if errors.Is(err, store.ErrSetupComplete) {
		s.write(w, r, 409, 40904, "admin setup already completed", nil)
		return
	}
	if err != nil {
		s.failure(w, r, err)
		return
	}
	// The user signs in separately; setup never issues a session or echoes secrets.
	s.write(w, r, 201, 0, "ok", map[string]any{
		"initialized": true, "admin": map[string]string{"id": admin.ID, "username": admin.Username},
	})
}

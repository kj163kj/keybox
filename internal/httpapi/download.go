package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"keybox/internal/security"
	"keybox/internal/store"
)

func (s *Server) downloadGuest(w http.ResponseWriter, r *http.Request) { s.download(w, r, "guest") }
func (s *Server) downloadAdmin(w http.ResponseWriter, r *http.Request) { s.download(w, r, "admin") }
func (s *Server) download(w http.ResponseWriter, r *http.Request, actorType string) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	a := actor(r)
	limits := []store.Limit{{Key: "download:global", Max: s.Config.GlobalDownloadsPerHour, Window: time.Hour}}
	if actorType == "guest" {
		limits = append(limits, store.Limit{Key: "download:guest:keybox:" + id, Max: 20, Window: time.Hour},
			store.Limit{Key: "download:guest:ip:" + a.IPHash, Max: s.Config.GuestDownloadsPerHour, Window: time.Hour},
			store.Limit{Key: "download:guest:ip-keybox:" + a.IPHash + ":" + id, Max: 2, Window: time.Hour})
	} else {
		limits = append(limits, store.Limit{Key: "download:admin:" + *a.AdminID, Max: 20, Window: time.Hour},
			store.Limit{Key: "download:admin-keybox:" + *a.AdminID + ":" + id, Max: 5, Window: time.Hour})
	}
	retry, err := s.Store.Allow(r.Context(), limits)
	if err != nil {
		if errors.Is(err, store.ErrRateLimited) {
			if logErr := s.Store.LogDownload(s.Store.DB.WithContext(r.Context()), id, actorType, "rate_limited", a); logErr != nil {
				s.failure(w, r, logErr)
				return
			}
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			s.write(w, r, 429, 42901, "rate limit exceeded", nil)
		} else {
			s.failure(w, r, err)
		}
		return
	}
	release, err := s.Store.Acquire(r.Context())
	if err != nil {
		if errors.Is(err, store.ErrRateLimited) {
			if logErr := s.Store.LogDownload(s.Store.DB.WithContext(r.Context()), id, actorType, "capacity_limited", a); logErr != nil {
				s.failure(w, r, logErr)
				return
			}
			w.Header().Set("Retry-After", "5")
			s.write(w, r, 429, 42902, "operation capacity exhausted", nil)
		} else {
			s.failure(w, r, err)
		}
		return
	}
	defer release()
	blob, err := s.Store.AuthorizeDownload(r.Context(), id, actorType, a)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	raw, err := s.Vault.Open(id, blob.KeyID, blob.Nonce, blob.Ciphertext)
	if err != nil {
		_ = s.Store.LogDownload(s.Store.DB.WithContext(r.Context()), id, actorType, "decrypt_failed", a)
		s.failure(w, r, err)
		return
	}
	defer security.Wipe(raw)
	w.Header().Set("Content-Disposition", `attachment; filename="keybox-`+id+`.xml"`)
	w.Header().Set("Content-Type", "application/xml")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Surrogate-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	n, err := io.Copy(w, bytes.NewReader(raw))
	result := "completed"
	if err != nil || n != int64(len(raw)) {
		result = "transfer_failed"
	}
	// Completion is a separate append-only event. The authorization event already
	// exists if the process crashes or this completion append fails.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := s.Store.LogDownload(s.Store.DB.WithContext(ctx), id, actorType, result, a); err != nil {
		s.Log.Error("download completion log failed", "request_id", a.RequestID)
	}
}

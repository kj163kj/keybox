package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"keybox/internal/security"
	"keybox/internal/store"
)

func (s *Server) patch(w http.ResponseWriter, r *http.Request) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	var in struct {
		Visibility          *string `json:"visibility"`
		AdminNote           *string `json:"admin_note"`
		GuestDownloadPolicy *string `json:"guest_download_policy"`
	}
	if !s.decode(w, r, &in) {
		return
	}
	fields := map[string]any{}
	if in.Visibility != nil {
		if *in.Visibility != "public" && *in.Visibility != "hidden" {
			s.write(w, r, 400, 40001, "invalid visibility", nil)
			return
		}
		fields["visibility"] = *in.Visibility
	}
	if in.AdminNote != nil {
		if len(*in.AdminNote) > 2000 {
			s.write(w, r, 400, 40001, "admin note too long", nil)
			return
		}
		fields["admin_note"] = *in.AdminNote
	}
	if in.GuestDownloadPolicy != nil {
		p := *in.GuestDownloadPolicy
		if p != "inherit" && p != "allowed" && p != "denied" {
			s.write(w, r, 400, 40001, "invalid download policy", nil)
			return
		}
		fields["guest_download_policy"] = p
	}
	if len(fields) == 0 {
		s.write(w, r, 400, 40001, "at least one field required", nil)
		return
	}
	if err := s.Store.Patch(r.Context(), id, fields, actor(r)); err != nil {
		s.failure(w, r, err)
		return
	}
	s.detail(w, r, true)
}
func (s *Server) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	if err := s.Store.Delete(r.Context(), id, actor(r)); err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]any{"id": id, "deleted": true})
}
func (s *Server) revalidate(w http.ResponseWriter, r *http.Request) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	if !s.limit(w, r, []store.Limit{{Key: "revalidate:admin:" + meta(r).Admin.ID, Max: 30, Window: time.Hour}}) {
		return
	}
	if _, err := s.Store.Keybox(r.Context(), id, true); err != nil {
		s.failure(w, r, err)
		return
	}
	release, ok := s.validationSlot(w, r)
	if !ok {
		return
	}
	defer release()
	blob, err := s.Store.Blob(r.Context(), id)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	raw, err := s.Vault.Open(id, blob.KeyID, blob.Nonce, blob.Ciphertext)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	defer security.Wipe(raw)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	report, err := s.Validator.Validate(ctx, raw)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	if err := s.Store.Revalidate(r.Context(), id, report, actor(r)); err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, report)
}
func (s *Server) runs(w http.ResponseWriter, r *http.Request) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	if _, err := s.Store.Keybox(r.Context(), id, true); err != nil {
		s.failure(w, r, err)
		return
	}
	page, size, ok := s.pagination(w, r)
	if !ok {
		return
	}
	q := s.Store.DB.WithContext(r.Context()).Model(&store.ValidationRun{}).Where("keybox_id = ?", id)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	var rows []store.ValidationRun
	if err := q.Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	items := []map[string]any{}
	for _, row := range rows {
		items = append(items, map[string]any{"id": row.ID, "keybox_id": row.KeyboxID, "input_sha256": row.InputSHA256,
			"overall_status": row.OverallStatus, "root_set_version": row.RootSetVersion, "crl_version": row.CRLVersion,
			"created_at": row.CreatedAt, "validation": json.RawMessage(row.ResultJSON)})
	}
	s.ok(w, r, map[string]any{"items": items, "total": total, "page": page, "page_size": size})
}
func (s *Server) getGuestSetting(w http.ResponseWriter, r *http.Request) {
	enabled, err := s.Store.GuestEnabled(r.Context())
	if err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]bool{"enabled": enabled})
}
func (s *Server) setGuestSetting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if !s.decode(w, r, &in) {
		return
	}
	if in.Enabled == nil {
		s.write(w, r, 400, 40001, "enabled is required", nil)
		return
	}
	if *in.Enabled && r.Header.Get("X-Confirm-Guest-Download") != "enable-sensitive-downloads" {
		if err := s.Store.Audit(s.Store.DB.WithContext(r.Context()), actor(r), "guest_download_setting_update", "setting", "guest_download_enabled", "confirmation_required", nil); err != nil {
			s.failure(w, r, err)
			return
		}
		s.write(w, r, 409, 40903, "explicit sensitive download confirmation required", nil)
		return
	}
	if err := s.Store.SetGuestEnabled(r.Context(), *in.Enabled, actor(r)); err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]bool{"enabled": *in.Enabled})
}
func (s *Server) auditLogs(w http.ResponseWriter, r *http.Request) {
	page, size, ok := s.pagination(w, r)
	if !ok {
		return
	}
	q := s.Store.DB.WithContext(r.Context()).Model(&store.AuditLog{})
	if action := r.URL.Query().Get("action"); action != "" {
		if len(action) > 64 {
			s.write(w, r, 400, 40001, "invalid action", nil)
			return
		}
		q = q.Where("action = ?", action)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	items := []store.AuditLog{}
	if err := q.Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]any{"items": items, "total": total, "page": page, "page_size": size})
}
func (s *Server) downloadLogs(w http.ResponseWriter, r *http.Request) {
	page, size, ok := s.pagination(w, r)
	if !ok {
		return
	}
	q := s.Store.DB.WithContext(r.Context()).Model(&store.DownloadLog{})
	var total int64
	if err := q.Count(&total).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	items := []store.DownloadLog{}
	if err := q.Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]any{"items": items, "total": total, "page": page, "page_size": size})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	dbState := "up"
	sqlDB, err := s.Store.DB.DB()
	if err != nil {
		dbState = "down"
	} else if err = sqlDB.PingContext(r.Context()); err != nil {
		dbState = "down"
	}
	crl, crlErr := s.Validator.CRL.Snapshot(r.Context())
	enabled, settingErr := s.Store.GuestEnabled(r.Context())
	if settingErr != nil {
		dbState = "down"
	}
	roots := s.Validator.Roots.Snapshot()
	now := s.Store.Now().UTC()
	status := "healthy"
	if dbState != "up" || crlErr != nil || !crl.Usable || len(roots.Certs) == 0 {
		status = "degraded"
	}
	data := map[string]any{"status": status, "database": dbState, "root_set_version": roots.Version, "root_count": len(roots.Certs),
		"crl": map[string]any{"version": crl.Version, "fetched_at": crl.FetchedAt, "expires_at": crl.ExpiresAt,
			"expired": crl.ExpiresAt.IsZero() || now.After(crl.ExpiresAt), "usable": crlErr == nil && crl.Usable},
		"guest_download_enabled": enabled}
	if status != "healthy" {
		s.write(w, r, 503, 50302, "dependencies degraded", data)
		return
	}
	s.ok(w, r, data)
}
func (s *Server) refreshCRL(w http.ResponseWriter, r *http.Request) {
	if !s.limit(w, r, []store.Limit{{Key: "crl:manual:global", Max: 2, Window: time.Minute}}) {
		return
	}
	if err := s.CRL.Refresh(r.Context(), actor(r)); err != nil {
		if logErr := s.Store.Audit(s.Store.DB.WithContext(r.Context()), actor(r), "crl_refresh", "crl", "", "failed", nil); logErr != nil {
			s.failure(w, r, logErr)
			return
		}
		s.write(w, r, 503, 50303, "CRL refresh failed", nil)
		return
	}
	crl, err := s.CRL.Snapshot(r.Context())
	if err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]any{"version": crl.Version, "fetched_at": crl.FetchedAt, "expires_at": crl.ExpiresAt, "usable": crl.Usable})
}

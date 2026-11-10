package httpapi

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/validator"
)

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if enc := r.Header.Get("Content-Encoding"); enc != "" && enc != "identity" {
		s.write(w, r, 415, 41501, "compressed uploads unsupported", nil)
		return nil, false
	}
	max := s.Config.MaxFileBytes
	if max <= 0 || max > validator.MaxFileBytes {
		max = validator.MaxFileBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, max+64*1024)
	reader, err := r.MultipartReader()
	if err != nil {
		s.write(w, r, 415, 41501, "multipart/form-data required", nil)
		return nil, false
	}
	var raw []byte
	found := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			security.Wipe(raw)
			var large *http.MaxBytesError
			if errors.As(err, &large) {
				s.write(w, r, 413, 41301, "file too large", nil)
			} else {
				s.write(w, r, 400, 40001, "invalid multipart body", nil)
			}
			return nil, false
		}
		if found || part.FormName() != "file" || strings.ToLower(filepath.Ext(part.FileName())) != ".xml" {
			security.Wipe(raw)
			part.Close()
			s.write(w, r, 415, 41501, "exactly one XML file required", nil)
			return nil, false
		}
		kind := part.Header.Get("Content-Type")
		if kind != "" {
			m, _, err := mime.ParseMediaType(kind)
			if err != nil || (m != "application/xml" && m != "text/xml" && m != "application/octet-stream") {
				part.Close()
				s.write(w, r, 415, 41501, "unsupported file content type", nil)
				return nil, false
			}
		}
		raw, err = io.ReadAll(io.LimitReader(part, max+1))
		part.Close()
		if int64(len(raw)) > max {
			security.Wipe(raw)
			s.write(w, r, 413, 41301, "file too large", nil)
			return nil, false
		}
		if err != nil {
			security.Wipe(raw)
			s.write(w, r, 400, 40001, "file read failed", nil)
			return nil, false
		}
		found = true
	}
	if !found || len(raw) == 0 {
		security.Wipe(raw)
		s.write(w, r, 400, 40001, "file is required", nil)
		return nil, false
	}
	return raw, true
}
func (s *Server) validationSlot(w http.ResponseWriter, r *http.Request) (func(), bool) {
	release, err := s.Store.Acquire(r.Context())
	if errors.Is(err, store.ErrRateLimited) {
		w.Header().Set("Retry-After", "5")
		s.write(w, r, 429, 42902, "operation capacity exhausted", nil)
		return nil, false
	}
	if err != nil {
		s.failure(w, r, err)
		return nil, false
	}
	return release, true
}
func (s *Server) validate(w http.ResponseWriter, r *http.Request) { s.processUpload(w, r, false) }
func (s *Server) upload(w http.ResponseWriter, r *http.Request)   { s.processUpload(w, r, true) }
func (s *Server) processUpload(w http.ResponseWriter, r *http.Request, save bool) {
	if !s.limit(w, r, []store.Limit{
		{Key: "upload:ip:" + meta(r).IPHash, Max: s.Config.UploadPerHour, Window: time.Hour},
		{Key: "upload:global", Max: s.Config.GlobalUploadsPerHour, Window: time.Hour},
	}) {
		return
	}
	release, ok := s.validationSlot(w, r)
	if !ok {
		return
	}
	defer release()
	raw, ok := s.readFile(w, r)
	if !ok {
		return
	}
	defer security.Wipe(raw)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	report, err := s.Validator.Validate(ctx, raw)
	if err != nil {
		if !errors.Is(err, validator.ErrXML) {
			s.failure(w, r, err)
			return
		}
		report.Errors = append(report.Errors, domain.Problem{Code: "XML_OR_KEY_INVALID"})
		if e := s.Store.SaveRun(s.Store.DB.WithContext(r.Context()), nil, report); e != nil {
			s.failure(w, r, e)
			return
		}
		s.write(w, r, 422, 42201, "invalid keybox XML or key material", report)
		return
	}
	if !save || report.OverallStatus != domain.Valid {
		if err := s.Store.SaveRun(s.Store.DB.WithContext(r.Context()), nil, report); err != nil {
			s.failure(w, r, err)
			return
		}
		if save {
			s.write(w, r, 422, 42202, "keybox validation failed", report)
		} else {
			s.ok(w, r, report)
		}
		return
	}
	box, err := s.Store.CreateKeybox(r.Context(), report, raw, actor(r), s.Vault)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	s.write(w, r, 201, 0, "ok", map[string]any{"id": box.ID, "overall_status": box.OverallStatus, "created_at": box.CreatedAt})
}

type summary struct {
	ID                         string        `json:"id"`
	FileSHA256                 string        `json:"file_sha256"`
	OverallStatus              domain.Status `json:"overall_status"`
	LastValidationStatus       domain.Status `json:"last_validation_status"`
	CreatedAt                  time.Time     `json:"created_at"`
	LastValidatedAt            time.Time     `json:"last_validated_at"`
	GuestDownloadableEffective bool          `json:"guest_downloadable_effective"`
	Visibility                 string        `json:"visibility,omitempty"`
	GuestDownloadPolicy        string        `json:"guest_download_policy,omitempty"`
}

func (s *Server) listPublic(w http.ResponseWriter, r *http.Request) { s.list(w, r, false) }
func (s *Server) listAdmin(w http.ResponseWriter, r *http.Request)  { s.list(w, r, true) }
func (s *Server) list(w http.ResponseWriter, r *http.Request, admin bool) {
	page, size, ok := s.pagination(w, r)
	if !ok {
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && !domain.IsStatus(status) {
		s.write(w, r, 400, 40001, "invalid status", nil)
		return
	}
	policy := ""
	if admin {
		policy = r.URL.Query().Get("guest_download_policy")
		if policy != "" && policy != "inherit" && policy != "allowed" && policy != "denied" {
			s.write(w, r, 400, 40001, "invalid policy", nil)
			return
		}
	}
	crl, crlErr := s.Validator.CRL.Snapshot(r.Context())
	gate := store.StatusGate{RootVersion: s.Validator.Roots.Snapshot().Version, CRLVersion: crl.Version, CRLUsable: crlErr == nil && crl.Usable}
	boxes, total, err := s.Store.List(r.Context(), admin, page, size, status, policy, gate)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	global, err := s.Store.GuestEnabled(r.Context())
	if err != nil {
		s.failure(w, r, err)
		return
	}
	items := []summary{}
	for _, b := range boxes {
		item := summary{ID: b.ID, FileSHA256: b.FileSHA256, OverallStatus: b.EffectiveStatus, LastValidationStatus: b.OverallStatus,
			CreatedAt: b.CreatedAt, LastValidatedAt: b.LastValidatedAt, GuestDownloadableEffective: domain.DownloadAllowed(global, b.GuestDownloadPolicy, b.Visibility, b.DeletedAt != nil)}
		if admin {
			item.Visibility = b.Visibility
			item.GuestDownloadPolicy = b.GuestDownloadPolicy
		}
		items = append(items, item)
	}
	s.ok(w, r, map[string]any{"items": items, "page": page, "page_size": size, "total": total})
}

type detail struct {
	ID string `json:"id"`
	domain.Report
	CreatedAt                  time.Time `json:"created_at"`
	StatusCheckedAt            time.Time `json:"status_checked_at"`
	GuestDownloadEnabled       bool      `json:"guest_download_enabled"`
	GuestDownloadPolicy        string    `json:"guest_download_policy"`
	GuestDownloadableEffective bool      `json:"guest_downloadable_effective"`
	Visibility                 string    `json:"visibility,omitempty"`
	AdminNote                  *string   `json:"admin_note,omitempty"`
}

func (s *Server) detailPublic(w http.ResponseWriter, r *http.Request) { s.detail(w, r, false) }
func (s *Server) detailAdmin(w http.ResponseWriter, r *http.Request)  { s.detail(w, r, true) }
func (s *Server) detail(w http.ResponseWriter, r *http.Request, admin bool) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	box, err := s.Store.Keybox(r.Context(), id, admin)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	report, err := s.currentReport(r.Context(), id)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	global, err := s.Store.GuestEnabled(r.Context())
	if err != nil {
		s.failure(w, r, err)
		return
	}
	out := detail{ID: id, Report: report, CreatedAt: box.CreatedAt, StatusCheckedAt: s.Store.Now().UTC(),
		GuestDownloadEnabled: global, GuestDownloadPolicy: box.GuestDownloadPolicy,
		GuestDownloadableEffective: domain.DownloadAllowed(global, box.GuestDownloadPolicy, box.Visibility, false)}
	if admin {
		out.Visibility = box.Visibility
		out.AdminNote = &box.AdminNote
	}
	s.ok(w, r, out)
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	id, ok := s.id(w, r)
	if !ok {
		return
	}
	if _, err := s.Store.Keybox(r.Context(), id, false); err != nil {
		s.failure(w, r, err)
		return
	}
	report, err := s.currentReport(r.Context(), id)
	if err != nil {
		s.failure(w, r, err)
		return
	}
	s.ok(w, r, map[string]any{"id": id, "validation": report, "status_checked_at": s.Store.Now().UTC()})
}

// Signatures/private-key matching are immutable facts from the saved full run.
// Expiry, current trust anchors and revocation are evaluated on every detail/
// status lookup. This path never decrypts private material or fetches the network.
func (s *Server) currentReport(ctx context.Context, id string) (domain.Report, error) {
	r, err := s.Store.LatestReport(ctx, id)
	if err != nil {
		return r, err
	}
	now := s.Store.Now().UTC()
	roots := s.Validator.Roots.Snapshot()
	crl, err := s.Validator.CRL.Snapshot(ctx)
	usable := err == nil && crl.Usable
	r.RootSetVersion, r.CRLVersion, r.CRLUsable = roots.Version, crl.Version, usable
	r.CRLFetchedAt, r.CRLExpiresAt = nil, nil
	if !crl.FetchedAt.IsZero() {
		r.CRLFetchedAt = &crl.FetchedAt
		r.CRLExpiresAt = &crl.ExpiresAt
	}
	r.Errors = []domain.Problem{}
	if !usable {
		r.Errors = append(r.Errors, domain.Problem{Code: "CRL_UNAVAILABLE"})
	}
	fps := map[string]bool{}
	for _, c := range roots.Certs {
		fps[validator.Fingerprint(c.Raw)] = true
	}
	states := []domain.Status{}
	for i := range r.Chains {
		chain := &r.Chains[i]
		cs := []domain.Status{}
		trusted := len(chain.Certificates) > 0 && fps[chain.Certificates[len(chain.Certificates)-1].FingerprintSHA256]
		if !chain.PrivateKeyValid {
			cs = append(cs, domain.Invalid)
		}
		for j := range chain.Certificates {
			c := &chain.Certificates[j]
			ss := []domain.Status{}
			c.RootTrusted = trusted
			c.TimeValid = !now.Before(c.NotBefore) && !now.After(c.NotAfter)
			c.CRLStatus = "unknown"
			if usable {
				c.CRLStatus = "not_revoked"
			}
			if _, revoked := crl.Entries[c.SerialNumber]; revoked {
				c.CRLStatus = "revoked"
			}
			if !c.ChainSignatureValid {
				ss = append(ss, domain.ChainInvalid)
			}
			if !trusted {
				ss = append(ss, domain.UntrustedRoot)
			}
			if now.After(c.NotAfter) {
				ss = append(ss, domain.Expired)
			} else if now.Before(c.NotBefore) {
				ss = append(ss, domain.Invalid)
			}
			if c.CRLStatus == "unknown" {
				ss = append(ss, domain.Indeterminate)
			}
			if c.CRLStatus == "revoked" {
				ss = append(ss, domain.Revoked)
			}
			c.CertificateStatus = domain.Combine(ss...)
			cs = append(cs, c.CertificateStatus)
			if c.CertificateStatus != domain.Valid {
				position := j
				r.Errors = append(r.Errors, domain.Problem{Code: strings.ToUpper(string(c.CertificateStatus)), Chain: chain.Index, Position: &position})
			}
		}
		chain.ChainStatus = domain.Combine(cs...)
		states = append(states, chain.ChainStatus)
	}
	r.OverallStatus = domain.Combine(states...)
	return r, nil
}
func (s *Server) certificateStatus(w http.ResponseWriter, r *http.Request) {
	serial, fp := r.URL.Query().Get("serial_number"), r.URL.Query().Get("fingerprint_sha256")
	if (serial == "") == (fp == "") {
		s.write(w, r, 400, 40001, "exactly one certificate selector required", nil)
		return
	}
	var err error
	if serial != "" {
		serial, err = validator.NormalizeSerial(serial)
	} else {
		fp, err = validator.NormalizeFingerprint(fp)
	}
	if err != nil {
		s.write(w, r, 400, 40001, "invalid certificate selector", nil)
		return
	}
	page, size, ok := s.pagination(w, r)
	if !ok {
		return
	}
	type match struct {
		KeyboxID, ChainID string
		Position          int
	}
	q := s.Store.DB.WithContext(r.Context()).Table("certificates c").Joins("JOIN keyboxes k ON k.id = c.keybox_id").
		Where("k.visibility = 'public' AND k.deleted_at IS NULL")
	if serial != "" {
		q = q.Where("c.serial_number = ?", serial)
	} else {
		q = q.Where("c.fingerprint_sha256 = ?", fp)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	// A serial is not globally unique. Return paginated matches, never one
	// arbitrary certificate from an unrelated issuer.
	var matches []match
	if err := q.Select("c.keybox_id,c.chain_id,c.position").Order("c.keybox_id,c.chain_id,c.position").Offset((page - 1) * size).Limit(size).Scan(&matches).Error; err != nil {
		s.failure(w, r, err)
		return
	}
	items := []map[string]any{}
	reports := map[string]domain.Report{}
	for _, m := range matches {
		report, ok := reports[m.KeyboxID]
		if !ok {
			report, err = s.currentReport(r.Context(), m.KeyboxID)
			if err != nil {
				s.failure(w, r, err)
				return
			}
			reports[m.KeyboxID] = report
		}
		var chain store.KeyboxChain
		if err := s.Store.DB.WithContext(r.Context()).Where("id = ?", m.ChainID).Take(&chain).Error; err != nil {
			s.failure(w, r, err)
			return
		}
		for _, c := range report.Chains {
			if c.Index == chain.ChainIndex {
				for _, cert := range c.Certificates {
					if cert.Position == m.Position {
						items = append(items, map[string]any{"keybox_id": m.KeyboxID, "chain_index": c.Index, "certificate": cert})
					}
				}
			}
		}
	}
	queryCRLStatus := "unknown"
	if serial != "" {
		current, err := s.Validator.CRL.Snapshot(r.Context())
		if err == nil && current.Usable {
			queryCRLStatus = "not_revoked"
		}
		if _, revoked := current.Entries[serial]; revoked {
			queryCRLStatus = "revoked"
		}
	}
	// A serial absent from the CRL does not establish certificate validity.
	queryStatus := domain.Indeterminate
	if queryCRLStatus == "revoked" {
		queryStatus = domain.Revoked
	}
	s.ok(w, r, map[string]any{"items": items, "total": total, "page": page, "page_size": size,
		"query":             map[string]any{"serial_number": serial, "fingerprint_sha256": fp, "crl_status": queryCRLStatus, "certificate_status": queryStatus},
		"status_checked_at": s.Store.Now().UTC()})
}

package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"keybox/internal/domain"
	"keybox/internal/security"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrDuplicate   = errors.New("duplicate keybox")
	ErrDenied      = errors.New("download denied")
	ErrRateLimited = errors.New("rate limited")
	ErrConflict    = errors.New("conflicting state")
)

type Store struct {
	DB  *gorm.DB
	Now func() time.Time
}

func Open(dsn string) (*Store, error) {
	cfg, err := driver.ParseDSN(dsn)
	if err != nil {
		return nil, errors.New("invalid MySQL DSN")
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.MultiStatements = false
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 10 * time.Second
	cfg.WriteTimeout = 10 * time.Second
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	cfg.Params["time_zone"] = "'+00:00'"
	db, err := gorm.Open(mysql.Open(cfg.FormatDSN()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, errors.New("database unavailable")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(24)
	sqlDB.SetMaxIdleConns(8)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	return &Store{DB: db, Now: time.Now}, nil
}

func translated(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	var mysqlErr *driver.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return ErrDuplicate
	}
	return err
}

func (s *Store) Audit(tx *gorm.DB, actor Actor, action, targetType, targetID, result string, details any) error {
	data, err := json.Marshal(details)
	if err != nil {
		return err
	}
	var target *string
	if targetID != "" {
		target = &targetID
	}
	return tx.Create(&AuditLog{ID: domain.NewID(), AdminID: actor.AdminID, Action: action, TargetType: targetType,
		TargetID: target, IPHash: actor.IPHash, UserAgentHash: actor.UAHash, Result: result, RequestID: actor.RequestID,
		DetailsJSON: data, CreatedAt: s.Now().UTC()}).Error
}

func (s *Store) SaveRun(tx *gorm.DB, keyboxID *string, r domain.Report) error {
	safe, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return tx.Create(&ValidationRun{ID: domain.NewID(), KeyboxID: keyboxID, InputSHA256: r.FileSHA256,
		OverallStatus: r.OverallStatus, ResultJSON: safe, RootSetVersion: r.RootSetVersion, CRLVersion: r.CRLVersion,
		CRLFetchedAt: r.CRLFetchedAt, CRLExpiresAt: r.CRLExpiresAt, CreatedAt: r.ValidatedAt}).Error
}

func (s *Store) CreateKeybox(ctx context.Context, r domain.Report, raw []byte, actor Actor, vault *security.Vault) (Keybox, error) {
	if r.OverallStatus != domain.Valid {
		return Keybox{}, ErrDenied
	}
	now := s.Now().UTC()
	box := Keybox{ID: domain.NewID(), FileSHA256: r.FileSHA256, CertificateSetSHA256: r.CertificateSetSHA256,
		OriginalFilename: "keybox.xml", OverallStatus: r.OverallStatus, Visibility: "public", GuestDownloadPolicy: "inherit",
		UploadIPHash: actor.IPHash, LastValidatedAt: r.ValidatedAt, CreatedAt: now, UpdatedAt: now,
		RootSetVersion: r.RootSetVersion, CRLVersion: r.CRLVersion}
	box.NotBefore, box.NotAfter = validityWindow(r)
	keyID, nonce, encrypted, err := vault.Seal(box.ID, raw)
	if err != nil {
		return Keybox{}, err
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&box).Error; err != nil {
			return err
		}
		if err := tx.Create(&KeyboxBlob{KeyboxID: box.ID, KeyID: keyID, Nonce: nonce, Ciphertext: encrypted}).Error; err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, chain := range r.Chains {
			fp := chain.Certificates[0].FingerprintSHA256
			if !seen[fp] {
				if err := tx.Create(&KeyboxKeyFingerprint{FingerprintSHA256: fp, KeyboxID: box.ID}).Error; err != nil {
					return err
				}
				seen[fp] = true
			}
		}
		if err := s.replaceCertificates(tx, box.ID, r); err != nil {
			return err
		}
		if err := s.SaveRun(tx, &box.ID, r); err != nil {
			return err
		}
		return s.Audit(tx, actor, "keybox_upload", "keybox", box.ID, "success", map[string]string{"status": string(r.OverallStatus)})
	})
	return box, translated(err)
}

func (s *Store) replaceCertificates(tx *gorm.DB, id string, r domain.Report) error {
	if err := tx.Where("keybox_id = ?", id).Delete(&Certificate{}).Error; err != nil {
		return err
	}
	if err := tx.Where("keybox_id = ?", id).Delete(&KeyboxChain{}).Error; err != nil {
		return err
	}
	for _, c := range r.Chains {
		chain := KeyboxChain{ID: domain.NewID(), KeyboxID: id, ChainIndex: c.Index, Algorithm: c.Algorithm, ChainStatus: c.ChainStatus, CreatedAt: r.ValidatedAt}
		if err := tx.Create(&chain).Error; err != nil {
			return err
		}
		for _, cert := range c.Certificates {
			row := Certificate{ID: domain.NewID(), KeyboxID: id, ChainID: chain.ID, Position: cert.Position,
				Subject: cert.Subject, Issuer: cert.Issuer, SerialNumber: cert.SerialNumber, FingerprintSHA256: cert.FingerprintSHA256,
				CertDER: cert.DER, NotBefore: cert.NotBefore, NotAfter: cert.NotAfter, IsRoot: cert.IsRoot, RootTrusted: cert.RootTrusted,
				ChainSignatureValid: cert.ChainSignatureValid, TimeValid: cert.TimeValid, CRLStatus: cert.CRLStatus,
				CertificateStatus: cert.CertificateStatus, CreatedAt: r.ValidatedAt}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) Keybox(ctx context.Context, id string, admin bool) (Keybox, error) {
	q := s.DB.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id)
	if !admin {
		q = q.Where("visibility = 'public'")
	}
	var box Keybox
	err := q.Take(&box).Error
	return box, translated(err)
}

type StatusGate struct {
	RootVersion, CRLVersion string
	CRLUsable               bool
}

func (s *Store) List(ctx context.Context, admin bool, page, size int, status, policy string, gate StatusGate) ([]Keybox, int64, error) {
	now := s.Now().UTC()
	projection := `CASE
	WHEN overall_status = 'valid' AND not_after < ? THEN 'expired'
	WHEN overall_status = 'valid' AND not_before > ? THEN 'invalid'
	WHEN overall_status = 'valid' AND (? = false OR root_set_version <> ? OR crl_version <> ?) THEN 'indeterminate'
	ELSE overall_status END`
	base := s.DB.WithContext(ctx).Model(&Keybox{}).Select("keyboxes.*, "+projection+" AS effective_status", now, now, gate.CRLUsable, gate.RootVersion, gate.CRLVersion)
	q := s.DB.WithContext(ctx).Table("(?) AS snapshots", base).Where("deleted_at IS NULL")
	if !admin {
		q = q.Where("visibility = 'public'")
	}
	if status != "" {
		q = q.Where("effective_status = ?", status)
	}
	if policy != "" {
		q = q.Where("guest_download_policy = ?", policy)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	boxes := []Keybox{}
	err := q.Order("created_at DESC, id DESC").Limit(size).Offset((page - 1) * size).Find(&boxes).Error
	return boxes, total, err
}
func (s *Store) LatestReport(ctx context.Context, id string) (domain.Report, error) {
	var row ValidationRun
	if err := s.DB.WithContext(ctx).Where("keybox_id = ?", id).Order("created_at DESC, id DESC").Take(&row).Error; err != nil {
		return domain.Report{}, translated(err)
	}
	var r domain.Report
	err := json.Unmarshal(row.ResultJSON, &r)
	return r, err
}
func (s *Store) Blob(ctx context.Context, id string) (KeyboxBlob, error) {
	var row KeyboxBlob
	err := s.DB.WithContext(ctx).Where("keybox_id = ?", id).Take(&row).Error
	return row, translated(err)
}
func (s *Store) Revalidate(ctx context.Context, id string, r domain.Report, actor Actor) error {
	return translated(s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var box Keybox
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND deleted_at IS NULL", id).Take(&box).Error; err != nil {
			return err
		}
		// Prevent a slow older run from replacing a newer validation.
		if r.ValidatedAt.Before(box.LastValidatedAt) {
			return ErrConflict
		}
		if r.FileSHA256 != box.FileSHA256 {
			return ErrConflict
		}
		if err := s.replaceCertificates(tx, id, r); err != nil {
			return err
		}
		notBefore, notAfter := validityWindow(r)
		if err := tx.Model(&box).Updates(map[string]any{"overall_status": r.OverallStatus, "last_validated_at": r.ValidatedAt, "updated_at": s.Now().UTC(),
			"root_set_version": r.RootSetVersion, "crl_version": r.CRLVersion, "not_before": notBefore, "not_after": notAfter}).Error; err != nil {
			return err
		}
		if err := s.SaveRun(tx, &id, r); err != nil {
			return err
		}
		return s.Audit(tx, actor, "keybox_revalidate", "keybox", id, "success", map[string]string{"status": string(r.OverallStatus)})
	}))
}
func validityWindow(r domain.Report) (time.Time, time.Time) {
	var start, end time.Time
	for _, chain := range r.Chains {
		for _, cert := range chain.Certificates {
			if cert.NotBefore.After(start) {
				start = cert.NotBefore
			}
			if end.IsZero() || cert.NotAfter.Before(end) {
				end = cert.NotAfter
			}
		}
	}
	return start, end
}
func (s *Store) Patch(ctx context.Context, id string, fields map[string]any, actor Actor) error {
	return translated(s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var box Keybox
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND deleted_at IS NULL", id).Take(&box).Error; err != nil {
			return err
		}
		details := map[string]any{}
		for key, value := range fields {
			if key == "admin_note" {
				details[key] = "changed"
			} else {
				details[key] = value
			}
		}
		fields["updated_at"] = s.Now().UTC()
		beforePolicy := box.GuestDownloadPolicy
		if err := tx.Model(&box).Updates(fields).Error; err != nil {
			return err
		}
		if policy, ok := fields["guest_download_policy"]; ok {
			if err := s.Audit(tx, actor, "keybox_download_policy_update", "keybox", id, "success", map[string]any{"before": beforePolicy, "after": policy}); err != nil {
				return err
			}
		}
		return s.Audit(tx, actor, "keybox_update", "keybox", id, "success", details)
	}))
}
func (s *Store) Delete(ctx context.Context, id string, actor Actor) error {
	return translated(s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Keybox{}).Where("id = ? AND deleted_at IS NULL", id).Updates(map[string]any{"deleted_at": s.Now().UTC(), "updated_at": s.Now().UTC(), "visibility": "hidden"})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrNotFound
		}
		return s.Audit(tx, actor, "keybox_delete", "keybox", id, "success", nil)
	}))
}
func (s *Store) GuestEnabled(ctx context.Context) (bool, error) {
	var setting Setting
	err := s.DB.WithContext(ctx).Where("setting_key = 'guest_download_enabled'").Take(&setting).Error
	return setting.SettingValue == "true", err
}
func (s *Store) SetGuestEnabled(ctx context.Context, enabled bool, actor Actor) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Setting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("setting_key = 'guest_download_enabled'").Take(&row).Error; err != nil {
			return err
		}
		value := "false"
		if enabled {
			value = "true"
		}
		before := row.SettingValue == "true"
		if err := tx.Model(&row).Updates(map[string]any{"setting_value": value, "updated_by": actor.AdminID, "updated_at": s.Now().UTC()}).Error; err != nil {
			return err
		}
		return s.Audit(tx, actor, "guest_download_setting_update", "setting", "guest_download_enabled", "success", map[string]bool{"before": before, "after": enabled})
	})
}

func (s *Store) LogDownload(tx *gorm.DB, id, actorType, result string, actor Actor) error {
	var boxID *string
	if id != "" {
		boxID = &id
	}
	if err := tx.Create(&DownloadLog{ID: domain.NewID(), KeyboxID: boxID, ActorType: actorType, AdminID: actor.AdminID,
		IPHash: actor.IPHash, UserAgentHash: actor.UAHash, Result: result, RequestID: actor.RequestID, CreatedAt: s.Now().UTC()}).Error; err != nil {
		return err
	}
	if actorType == "admin" {
		return s.Audit(tx, actor, "keybox_download", "keybox", id, result, nil)
	}
	return nil
}

// Lock ordering is setting -> keybox. Log authorization durably before returning
// any plaintext. Once this transaction completes a transfer is already admitted;
// changing a policy cannot retract bytes already released.
func (s *Store) AuthorizeDownload(ctx context.Context, id, actorType string, actor Actor) (KeyboxBlob, error) {
	var blob KeyboxBlob
	var decision error
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		enabled := true
		if actorType == "guest" {
			var setting Setting
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("setting_key = 'guest_download_enabled'").Take(&setting).Error; err != nil {
				return err
			}
			enabled = setting.SettingValue == "true"
		}
		var box Keybox
		err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND deleted_at IS NULL", id).Take(&box).Error
		result := "authorized"
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			decision = ErrNotFound
			result = "not_found"
		case err != nil:
			return err
		case actorType == "guest" && box.Visibility != "public":
			decision = ErrNotFound
			result = "not_found"
		case actorType == "guest" && !domain.DownloadAllowed(enabled, box.GuestDownloadPolicy, box.Visibility, false):
			decision = ErrDenied
			result = "denied"
		}
		if decision == nil {
			if err := tx.Where("keybox_id = ?", id).Take(&blob).Error; err != nil {
				return err
			}
		}
		return s.LogDownload(tx, id, actorType, result, actor)
	})
	if err != nil {
		return KeyboxBlob{}, err
	}
	return blob, decision
}

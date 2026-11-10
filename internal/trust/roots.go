package trust

import (
	"bytes"
	"context"
	"crypto/x509"
	_ "embed"
	"encoding/pem"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"keybox/internal/domain"
	"keybox/internal/store"
	"keybox/internal/validator"
)

// Google public attestation roots, fetched 2026-11-10 from the official HTTPS
// endpoint. Trust changes require explicit approval, never an automatic download.
//
//go:embed google_roots.pem
var BuiltinPEM []byte

type Roots struct {
	mu    sync.RWMutex
	set   validator.RootSet
	store *store.Store
}

func ParseBundle(raw []byte, now time.Time) (validator.RootSet, error) {
	if len(raw) > 128*1024 {
		return validator.RootSet{}, errors.New("root bundle too large")
	}
	certs := []*x509.Certificate{}
	fingerprints := []string{}
	seen := map[string]bool{}
	for len(bytes.TrimSpace(raw)) > 0 {
		block, rest := pem.Decode(raw)
		if block == nil || block.Type != "CERTIFICATE" || len(block.Headers) != 0 {
			return validator.RootSet{}, errors.New("invalid root PEM")
		}
		// pem.Decode searches for blocks: reject ignored prefixes.
		if !bytes.HasPrefix(bytes.TrimSpace(raw), []byte("-----BEGIN CERTIFICATE-----")) {
			return validator.RootSet{}, errors.New("unexpected root data")
		}
		c, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !c.IsCA || !c.BasicConstraintsValid || c.KeyUsage&x509.KeyUsageCertSign == 0 ||
			!bytes.Equal(c.RawSubject, c.RawIssuer) || c.CheckSignatureFrom(c) != nil ||
			now.Before(c.NotBefore) || now.After(c.NotAfter) {
			return validator.RootSet{}, errors.New("invalid or expired root")
		}
		fp := validator.Fingerprint(c.Raw)
		if seen[fp] {
			return validator.RootSet{}, errors.New("duplicate root")
		}
		seen[fp] = true
		fingerprints = append(fingerprints, fp)
		certs = append(certs, c)
		raw = rest
		if len(certs) > 16 {
			return validator.RootSet{}, errors.New("too many roots")
		}
	}
	if len(certs) == 0 {
		return validator.RootSet{}, errors.New("empty root bundle")
	}
	sort.Strings(fingerprints)
	return validator.RootSet{Version: validator.Fingerprint([]byte(strings.Join(fingerprints, "\n"))), Certs: certs}, nil
}

func NewRoots(ctx context.Context, s *store.Store) (*Roots, error) {
	manager := &Roots{store: s}
	var count int64
	if err := s.DB.WithContext(ctx).Model(&store.TrustedRoot{}).Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 {
		set, err := ParseBundle(BuiltinPEM, s.Now())
		if err != nil {
			return nil, err
		}
		if err := manager.persist(ctx, set, store.Actor{RequestID: domain.NewID()}, "root_set_bootstrap"); err != nil {
			return nil, err
		}
	}
	if err := manager.Reload(ctx); err != nil {
		return nil, err
	}
	return manager, nil
}
func (r *Roots) Snapshot() validator.RootSet {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return validator.RootSet{Version: r.set.Version, Certs: append([]*x509.Certificate(nil), r.set.Certs...)}
}
func (r *Roots) Reload(ctx context.Context) error {
	var rows []store.TrustedRoot
	if err := r.store.DB.WithContext(ctx).Where("active = true").Order("fingerprint_sha256").Find(&rows).Error; err != nil {
		return err
	}
	var bundle []byte
	version := ""
	for _, row := range rows {
		if version != "" && version != row.Version {
			return errors.New("mixed active root versions")
		}
		version = row.Version
		bundle = append(bundle, []byte(row.CertPEM)...)
	}
	set, err := ParseBundle(bundle, r.store.Now())
	if err != nil {
		// Do not continue trusting an expired in-memory set after a reload failure.
		r.mu.Lock()
		r.set = validator.RootSet{}
		r.mu.Unlock()
		return err
	}
	if set.Version != version {
		return errors.New("root version integrity failure")
	}
	r.mu.Lock()
	r.set = set
	r.mu.Unlock()
	return nil
}
func (r *Roots) Apply(ctx context.Context, bundle []byte, approvedSHA string, actor store.Actor) error {
	if approvedSHA == "" || validator.Fingerprint(bundle) != approvedSHA {
		return errors.New("root approval hash mismatch")
	}
	set, err := ParseBundle(bundle, r.store.Now())
	if err != nil {
		return err
	}
	if err = r.persist(ctx, set, actor, "root_set_update"); err != nil {
		return err
	}
	return r.Reload(ctx)
}
func (r *Roots) persist(ctx context.Context, set validator.RootSet, actor store.Actor, action string) error {
	return r.store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// One lock also serializes root bootstrap and concurrent controlled updates.
		var lock store.Setting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("setting_key = 'guest_download_enabled'").Take(&lock).Error; err != nil {
			return err
		}
		if action == "root_set_bootstrap" {
			var count int64
			if err := tx.Model(&store.TrustedRoot{}).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return nil
			}
		}
		if err := tx.Model(&store.TrustedRoot{}).Where("active = true").Update("active", false).Error; err != nil {
			return err
		}
		for _, c := range set.Certs {
			row := store.TrustedRoot{ID: domain.NewID(), Name: "Google Android attestation", FingerprintSHA256: validator.Fingerprint(c.Raw),
				CertPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw})), Version: set.Version, Active: true, CreatedAt: r.store.Now().UTC()}
			if err := tx.Clauses(clause.OnConflict{DoUpdates: clause.AssignmentColumns([]string{"active"})}).Create(&row).Error; err != nil {
				return err
			}
		}
		return r.store.Audit(tx, actor, action, "root_set", set.Version, "success", map[string]int{"count": len(set.Certs)})
	})
}

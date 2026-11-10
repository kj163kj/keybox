package jobs

import (
	"context"
	"log/slog"
	"time"

	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/trust"
	"keybox/internal/validator"
)

type Worker struct {
	Store     *store.Store
	Roots     *trust.Roots
	CRL       *trust.CRL
	Validator *validator.Validator
	Vault     *security.Vault
	Log       *slog.Logger
}

func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	rootCheckAt := time.Time{}
	for {
		w.tick(ctx, &rootCheckAt)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (w *Worker) tick(ctx context.Context, rootCheckAt *time.Time) {
	short, cancel := context.WithTimeout(ctx, 12*time.Second)
	if err := w.Roots.Reload(short); err != nil {
		w.Log.Error("root reload failed")
	}
	crl, err := w.CRL.Snapshot(short)
	if err != nil || w.Store.Now().Sub(crl.FetchedAt) > 10*time.Minute {
		if err := w.CRL.Refresh(short, store.Actor{RequestID: domain.NewID()}); err != nil {
			w.Log.Warn("CRL refresh failed")
		}
	}
	cancel()
	cleanup, done := context.WithTimeout(ctx, 10*time.Second)
	now := w.Store.Now().UTC()
	for _, operation := range []func() error{
		func() error {
			return w.Store.DB.WithContext(cleanup).Where("keybox_id IS NULL AND created_at < ?", now.Add(-24*time.Hour)).Delete(&store.ValidationRun{}).Error
		},
		func() error {
			return w.Store.DB.WithContext(cleanup).Where("expires_at < ?", now.Add(-24*time.Hour)).Delete(&store.AdminSession{}).Error
		},
		func() error {
			return w.Store.DB.WithContext(cleanup).Exec("DELETE FROM rate_buckets WHERE expires_at < ? LIMIT 10000", now.Add(-time.Hour)).Error
		},
	} {
		if err := operation(); err != nil {
			w.Log.Warn("scheduled cleanup failed")
		}
	}
	done()
	// Bounded work per tick, oldest first; shared leases cap all replicas.
	queryCtx, queryCancel := context.WithTimeout(ctx, 5*time.Second)
	crl, _ = w.CRL.Snapshot(queryCtx)
	var boxes []store.Keybox
	err = w.Store.DB.WithContext(queryCtx).Where("deleted_at IS NULL AND (last_validated_at < ? OR crl_version <> ? OR root_set_version <> ?)",
		now.Add(-time.Hour), crl.Version, w.Roots.Snapshot().Version).Order("last_validated_at ASC").Limit(20).Find(&boxes).Error
	queryCancel()
	if err == nil {
		for _, box := range boxes {
			if ctx.Err() != nil {
				return
			}
			runCtx, runCancel := context.WithTimeout(ctx, 10*time.Second)
			w.revalidate(runCtx, box.ID)
			runCancel()
		}
	}
	if now.Sub(*rootCheckAt) >= 24*time.Hour {
		checkCtx, checkCancel := context.WithTimeout(ctx, 10*time.Second)
		_, version, err := trust.CheckRootCandidate(checkCtx, w.CRL.Client, now)
		checkCancel()
		if err != nil {
			w.Log.Warn("root update check failed")
		} else if version != w.Roots.Snapshot().Version {
			w.Log.Warn("root update awaits explicit approval", "candidate_version", version)
		}
		*rootCheckAt = now
	}
}
func (w *Worker) revalidate(ctx context.Context, id string) {
	release, err := w.Store.Acquire(ctx)
	if err != nil {
		return
	}
	defer release()
	blob, err := w.Store.Blob(ctx, id)
	if err != nil {
		return
	}
	raw, err := w.Vault.Open(id, blob.KeyID, blob.Nonce, blob.Ciphertext)
	if err != nil {
		w.Log.Error("scheduled decryption failed", "keybox_id", id)
		return
	}
	defer security.Wipe(raw)
	r, err := w.Validator.Validate(ctx, raw)
	if err != nil {
		w.Log.Warn("scheduled validation failed", "keybox_id", id)
		return
	}
	if err := w.Store.Revalidate(ctx, id, r, store.Actor{RequestID: domain.NewID()}); err != nil {
		w.Log.Warn("scheduled validation persistence failed", "keybox_id", id)
	}
}

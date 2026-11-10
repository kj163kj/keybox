package store_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"keybox/internal/domain"
	"keybox/internal/store"
	"keybox/internal/testutil"
)

func TestMySQLQuotaAtomicityAndLeases(t *testing.T) {
	s := testutil.Database(t)
	s.Now = func() time.Time { return time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC) }
	ctx := context.Background()
	var allowed atomic.Int32
	var unexpected atomic.Int32
	var wg sync.WaitGroup
	// Lock all dimensions in deterministic order, including under contention.
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Allow(ctx, []store.Limit{{Key: "global", Max: 7, Window: time.Hour}, {Key: "ip", Max: 100, Window: time.Hour}})
			if err == nil {
				allowed.Add(1)
			} else if !errors.Is(err, store.ErrRateLimited) {
				unexpected.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 7 || unexpected.Load() != 0 {
		t.Fatalf("allowed=%d unexpected=%d", allowed.Load(), unexpected.Load())
	}
	var hits int64
	s.DB.Table("rate_buckets").Select("COALESCE(SUM(hits),0)").Scan(&hits)
	if hits != 14 {
		t.Fatalf("partial quota consumption: %d", hits)
	}
	releases := []func(){}
	for i := 0; i < 8; i++ {
		release, err := s.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	if _, err := s.Acquire(ctx); !errors.Is(err, store.ErrRateLimited) {
		t.Fatal("concurrency bound bypassed")
	}
	releases[0]()
	release, err := s.Acquire(ctx)
	if err != nil {
		t.Fatal("released slot unavailable")
	}
	release()
	for _, release := range releases[1:] {
		release()
	}
}
func TestMySQLAuditFailureRollsBackSetting(t *testing.T) {
	s := testutil.Database(t)
	err := s.DB.Callback().Create().Before("gorm:create").Register("test:deny_audit", func(tx *gorm.DB) {
		if tx.Statement.Table == "audit_logs" {
			tx.AddError(errors.New("synthetic audit outage"))
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Callback().Create().Remove("test:deny_audit")
	err = s.SetGuestEnabled(context.Background(), true, store.Actor{RequestID: domain.NewID()})
	if err == nil {
		t.Fatal("setting committed without audit")
	}
	enabled, err := s.GuestEnabled(context.Background())
	if err != nil || enabled {
		t.Fatal("failed transaction changed setting")
	}
}

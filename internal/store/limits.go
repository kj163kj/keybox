package store

import (
	"context"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"keybox/internal/domain"
	"keybox/internal/security"
)

type Limit struct {
	Key    string
	Max    int
	Window time.Duration
}
type rateBucket struct {
	BucketKey   string `gorm:"primaryKey"`
	WindowStart int64  `gorm:"primaryKey"`
	Hits        int
	ExpiresAt   time.Time
}
type concurrencySlot struct {
	ID        int
	Owner     string
	ExpiresAt time.Time
}

// Atomic multi-dimensional fixed windows. Rejected requests roll back increments
// in every dimension. Sorting prevents inconsistent lock ordering across replicas.
func (s *Store) Allow(ctx context.Context, limits []Limit) (int, error) {
	type scoped struct {
		key     string
		start   int64
		max     int
		expires time.Time
	}
	scopes := make([]scoped, 0, len(limits))
	now := s.Now().UTC()
	for _, limit := range limits {
		window := int64(limit.Window / time.Second)
		if window < 1 || limit.Max < 1 {
			return 60, ErrRateLimited
		}
		start := now.Unix() / window * window
		scopes = append(scopes, scoped{security.Hash(limit.Key), start, limit.Max, time.Unix(start+window, 0).UTC()})
	}
	sort.Slice(scopes, func(i, j int) bool { return scopes[i].key < scopes[j].key })
	retry := 1
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, scope := range scopes {
			row := rateBucket{BucketKey: scope.key, WindowStart: scope.start, ExpiresAt: scope.expires}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("bucket_key = ? AND window_start = ?", scope.key, scope.start).Take(&row).Error; err != nil {
				return err
			}
			if row.Hits >= scope.max {
				retry = int(scope.expires.Sub(now).Seconds()) + 1
				return ErrRateLimited
			}
			if err := tx.Model(&row).UpdateColumn("hits", gorm.Expr("hits + 1")).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return retry, err
}

// Eight database leases bound concurrent validation across all replicas.
// The handler must finish within 15s; leases expire after 30s after a crash.
func (s *Store) Acquire(ctx context.Context) (func(), error) {
	var slot concurrencySlot
	owner := domain.NewID()
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("expires_at <= ?", s.Now().UTC()).Order("id").Take(&slot).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return ErrRateLimited
			}
			return err
		}
		return tx.Model(&slot).Updates(map[string]any{"owner": owner, "expires_at": s.Now().UTC().Add(30 * time.Second)}).Error
	})
	if err != nil {
		return nil, err
	}
	return func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		s.DB.WithContext(cleanup).Model(&concurrencySlot{}).Where("id = ? AND owner = ?", slot.ID, owner).Updates(map[string]any{"owner": "", "expires_at": s.Now().UTC()})
	}, nil
}

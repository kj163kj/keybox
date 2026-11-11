package store

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"keybox/internal/domain"
)

var ErrSetupComplete = errors.New("admin setup already completed")

const adminSetupKey = "admin_setup_completed"

// AdminInitialized fails closed if the migration/marker is missing or corrupt.
// Disabled accounts count too; setup is never an account recovery endpoint.
func (s *Store) AdminInitialized(ctx context.Context) (bool, error) {
	var marker Setting
	if err := s.DB.WithContext(ctx).Where("setting_key = ?", adminSetupKey).Take(&marker).Error; err != nil {
		return false, err
	}
	return adminInitialized(s.DB.WithContext(ctx), marker)
}

func adminInitialized(db *gorm.DB, marker Setting) (bool, error) {
	switch marker.SettingValue {
	case "true":
		return true, nil
	case "false":
		var count int64
		err := db.Model(&Admin{}).Count(&count).Error
		return count > 0, err
	default:
		return false, errors.New("invalid admin setup state")
	}
}

// BootstrapAdmin receives only a prevalidated username and bcrypt hash. The
// password hash is computed before entering the transaction. Both CLI and Web
// use this same row lock, so only one first administrator can be committed.
func (s *Store) BootstrapAdmin(ctx context.Context, username, passwordHash string, actor Actor) (Admin, error) {
	admin := Admin{ID: domain.NewID(), Username: username, PasswordHash: passwordHash, Status: "active", CreatedAt: s.Now().UTC()}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var marker Setting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("setting_key = ?", adminSetupKey).Take(&marker).Error; err != nil {
			return err
		}
		initialized, err := adminInitialized(tx, marker)
		if err != nil {
			return err
		}
		if initialized {
			return ErrSetupComplete
		}
		if err := tx.Create(&admin).Error; err != nil {
			return err
		}
		if err := tx.Model(&marker).Updates(map[string]any{
			"setting_value": "true", "updated_by": admin.ID, "updated_at": s.Now().UTC(),
		}).Error; err != nil {
			return err
		}
		actor.AdminID = &admin.ID
		return s.Audit(tx, actor, "admin_bootstrap", "admin", admin.ID, "success", nil)
	})
	if err != nil {
		return Admin{}, err
	}
	return admin, nil
}

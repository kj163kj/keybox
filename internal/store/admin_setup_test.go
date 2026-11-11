package store_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/testutil"
	"keybox/migrations"
)

func bootstrapHash(t *testing.T) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(security.Token()), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return string(hash)
}

func TestMySQLAdminSetupConcurrentAndPermanent(t *testing.T) {
	s := testutil.Database(t)
	ctx := context.Background()
	initialized, err := s.AdminInitialized(ctx)
	if err != nil || initialized {
		t.Fatal("fresh deployment should be uninitialized", err)
	}
	hash := bootstrapHash(t)
	start := make(chan struct{})
	results := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, err := s.BootstrapAdmin(ctx, fmt.Sprintf("operator-%d", i), hash, store.Actor{RequestID: domain.NewID()})
			results <- err
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, store.ErrSetupComplete) {
			t.Fatal("unexpected bootstrap result", err)
		}
	}
	if success != 1 {
		t.Fatalf("created %d administrators concurrently", success)
	}
	for _, table := range []string{"admins", "audit_logs"} {
		var count int64
		if err := s.DB.Table(table).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("%s rows: %d, err: %v", table, count, err)
		}
	}
	// Simulate out-of-band account deletion: the persistent latch must stay closed.
	if err := s.DB.Exec("DELETE FROM admins").Error; err != nil {
		t.Fatal(err)
	}
	if initialized, err := s.AdminInitialized(ctx); err != nil || !initialized {
		t.Fatal("setup reopened after account removal", err)
	}
	if _, err := s.BootstrapAdmin(ctx, "replacement", hash, store.Actor{}); !errors.Is(err, store.ErrSetupComplete) {
		t.Fatal("setup became a password recovery path", err)
	}
}

func TestMySQLAdminSetupAuditRollback(t *testing.T) {
	s := testutil.Database(t)
	hash := bootstrapHash(t)
	// Force the audit insert to fail without changing application code or grants.
	if err := s.DB.Exec("CREATE TRIGGER reject_bootstrap_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test audit failure'").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.BootstrapAdmin(context.Background(), "operator", hash, store.Actor{RequestID: domain.NewID()}); err == nil {
		t.Fatal("bootstrap succeeded without audit")
	}
	var count int64
	if err := s.DB.Model(&store.Admin{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed transaction left an administrator", err)
	}
	if initialized, err := s.AdminInitialized(context.Background()); err != nil || initialized {
		t.Fatal("failed transaction closed setup", err)
	}
	if err := s.DB.Exec("DROP TRIGGER reject_bootstrap_audit").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.BootstrapAdmin(context.Background(), "operator", hash, store.Actor{RequestID: domain.NewID()}); err != nil {
		t.Fatal("cannot retry after rollback", err)
	}
}

func TestMySQLAdminSetupMigrationAndClosedStates(t *testing.T) {
	s := testutil.Database(t)
	ctx := context.Background()
	admin := store.Admin{ID: domain.NewID(), Username: "existing", PasswordHash: bootstrapHash(t), Status: "disabled", CreatedAt: s.Now().UTC()}
	if err := s.DB.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	// Even before the latch is set, an existing disabled account prevents takeover.
	if initialized, err := s.AdminInitialized(ctx); err != nil || !initialized {
		t.Fatal("disabled account did not close setup", err)
	}
	if _, err := s.BootstrapAdmin(ctx, "new", admin.PasswordHash, store.Actor{}); !errors.Is(err, store.ErrSetupComplete) {
		t.Fatal("existing account allowed bootstrap", err)
	}
	for _, file := range []string{"000002_admin_setup.down.sql", "000002_admin_setup.up.sql"} {
		raw, err := migrations.Files.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.DB.Exec(string(raw)).Error; err != nil {
			t.Fatal(err)
		}
	}
	var marker store.Setting
	if err := s.DB.Where("setting_key = 'admin_setup_completed'").Take(&marker).Error; err != nil || marker.SettingValue != "true" {
		t.Fatal("upgrade did not close setup for existing admin", err)
	}
	if err := s.DB.Model(&marker).Update("setting_value", "corrupt").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdminInitialized(ctx); err == nil {
		t.Fatal("corrupt marker did not fail closed")
	}
	if _, err := s.BootstrapAdmin(ctx, "new", admin.PasswordHash, store.Actor{}); err == nil {
		t.Fatal("corrupt marker allowed setup")
	}
	if err := s.DB.Delete(&marker).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdminInitialized(ctx); err == nil {
		t.Fatal("missing migration did not fail closed")
	}
	if _, err := s.BootstrapAdmin(ctx, "new", admin.PasswordHash, store.Actor{}); err == nil {
		t.Fatal("missing marker allowed setup")
	}
}

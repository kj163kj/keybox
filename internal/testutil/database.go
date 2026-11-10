package testutil

import (
	"database/sql"
	"os"
	"testing"

	driver "github.com/go-sql-driver/mysql"
	"keybox/internal/domain"
	"keybox/internal/store"
	"keybox/migrations"
)

// Database creates and drops ONLY a newly named, isolated test database. The
// configured DSN database is never migrated, truncated or deleted.
func Database(t testing.TB) *store.Store {
	t.Helper()
	dsn := os.Getenv("KEYBOX_TEST_DSN")
	if dsn == "" {
		t.Skip("KEYBOX_TEST_DSN unset; real MySQL integration test not run")
	}
	cfg, err := driver.ParseDSN(dsn)
	if err != nil {
		t.Fatal("invalid test DSN")
	}
	cfg.DBName = ""
	control, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	name := "keybox_test_" + domain.NewID()
	if _, err = control.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4"); err != nil {
		control.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := control.Exec("DROP DATABASE `" + name + "`")
		if err != nil {
			t.Error(err)
		}
		control.Close()
	})
	cfg.DBName = name
	if err := migrations.Up(cfg.FormatDSN()); err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db, _ := s.DB.DB(); db.Close() })
	return s
}

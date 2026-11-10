package store_test

import (
	"os"
	"strings"
	"testing"

	driver "github.com/go-sql-driver/mysql"
	"keybox/internal/domain"
	"keybox/internal/security"
	"keybox/internal/store"
	"keybox/internal/testutil"
)

func TestMySQLRuntimeRoleCannotModifyLogs(t *testing.T) {
	s := testutil.Database(t)
	var database string
	if err := s.DB.Raw("SELECT DATABASE()").Scan(&database).Error; err != nil {
		t.Fatal(err)
	}
	suffix := domain.NewID()[:16]
	user, role := "kbtest_"+suffix, "kbrole_"+suffix
	password := security.Token()
	// Names and password are generated from fixed safe alphabets, never input.
	if err := s.DB.Exec("CREATE USER '" + user + "'@'localhost' IDENTIFIED BY '" + password + "'").Error; err != nil {
		t.Fatal("create isolated test account failed")
	}
	t.Cleanup(func() {
		if err := s.DB.Exec("DROP USER '" + user + "'@'localhost'").Error; err != nil {
			t.Error("drop isolated test account failed")
		}
	})
	script, err := os.ReadFile("../../deploy/runtime-grants.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ReplaceAll(string(script), "'keybox_runtime'", "'"+role+"'")
	text = strings.ReplaceAll(text, "keybox.", database+".")
	for _, statement := range strings.Split(text, ";") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if err := s.DB.Exec(statement).Error; err != nil {
			t.Fatal("runtime grants script failed", err)
		}
	}
	t.Cleanup(func() {
		if err := s.DB.Exec("DROP ROLE '" + role + "'").Error; err != nil {
			t.Error("drop isolated test role failed")
		}
	})
	for _, statement := range []string{
		"GRANT '" + role + "' TO '" + user + "'@'localhost'",
		"SET DEFAULT ROLE '" + role + "' TO '" + user + "'@'localhost'",
	} {
		if err := s.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	cfg, err := driver.ParseDSN(os.Getenv("KEYBOX_TEST_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	cfg.User, cfg.Passwd, cfg.DBName = user, password, database
	runtime, err := store.Open(cfg.FormatDSN())
	if err != nil {
		t.Fatal("cannot connect runtime account")
	}
	db, _ := runtime.DB.DB()
	defer db.Close()
	if err := runtime.Audit(runtime.DB, store.Actor{RequestID: domain.NewID()}, "test_append_only", "request", "", "success", nil); err != nil {
		t.Fatal("runtime cannot append audit")
	}
	if err := runtime.LogDownload(runtime.DB, "", "guest", "denied", store.Actor{RequestID: domain.NewID()}); err != nil {
		t.Fatal("runtime cannot append download log")
	}
	for _, table := range []string{"audit_logs", "download_logs"} {
		for _, sql := range []string{
			"DELETE FROM " + table + " WHERE result = 'denied'",
			"UPDATE " + table + " SET result = 'changed'",
			"TRUNCATE TABLE " + table,
		} {
			if err := runtime.DB.Exec(sql).Error; err == nil {
				t.Fatalf("runtime modified protected %s", table)
			}
		}
	}
}

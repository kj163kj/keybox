package config

import (
	"bytes"
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"keybox/internal/security"
)

func TestSetupTokenConfiguration(t *testing.T) {
	t.Setenv("KEYBOX_SETUP_TOKEN", "")
	t.Setenv("KEYBOX_SETUP_TOKEN_FILE", "")
	if digest, err := setupTokenHash(); err != nil || len(digest) != 0 {
		t.Fatal("unconfigured setup must stay disabled")
	}
	token := security.Token()
	t.Setenv("KEYBOX_SETUP_TOKEN", token)
	want := sha256.Sum256([]byte(token))
	if digest, err := setupTokenHash(); err != nil || !bytes.Equal(digest, want[:]) {
		t.Fatal("token was not hashed correctly")
	}
	for _, value := range []string{"too-short", strings.Repeat("x", 257), strings.Repeat("x", 32) + "\n", strings.Repeat("密", 16)} {
		t.Setenv("KEYBOX_SETUP_TOKEN", value)
		if _, err := setupTokenHash(); err == nil || strings.Contains(err.Error(), value) {
			t.Fatal("invalid token accepted or leaked in config error")
		}
	}
	path := filepath.Join(t.TempDir(), "setup-token")
	t.Setenv("KEYBOX_SETUP_TOKEN_FILE", path)
	// A configured but missing secret file is an error, never an implicit fallback.
	t.Setenv("KEYBOX_SETUP_TOKEN", token)
	if _, err := setupTokenHash(); err == nil {
		t.Fatal("missing secret file accepted")
	}
	fileToken := security.Token()
	if err := os.WriteFile(path, []byte(fileToken+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	want = sha256.Sum256([]byte(fileToken))
	if digest, err := setupTokenHash(); err != nil || !bytes.Equal(digest, want[:]) {
		t.Fatal("secret mount did not override environment value")
	}
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := setupTokenHash(); err == nil {
		t.Fatal("empty secret file accepted")
	}
}

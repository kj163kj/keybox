package security

import (
	"strings"
	"testing"
)

func TestAdminCredentialByteBoundaries(t *testing.T) {
	password := Token()
	for _, tc := range []struct {
		name, username, password string
		want                     bool
	}{
		{"normal", "operator", password, true},
		{"lower password boundary", "operator", strings.Repeat("a", 8), true},
		{"multibyte lower password boundary", "operator", "密钥ab", true},
		{"multibyte short password", "operator", "密钥a", false},
		{"upper password boundary", "operator", strings.Repeat("a", 72), true},
		{"multibyte password valid", "operator", strings.Repeat("密", 24), true},
		{"multibyte password too long", "operator", strings.Repeat("密", 25), false},
		{"short password", "operator", strings.Repeat("a", 7), false},
		{"long password", "operator", strings.Repeat("a", 73), false},
		{"password spaces preserved", "operator", " " + password + " ", true},
		{"empty username", "", password, false},
		{"untrimmed username", " operator ", password, false},
		{"control username", "oper\nator", password, false},
		{"username boundary", strings.Repeat("a", 128), password, true},
		{"multibyte username too long", strings.Repeat("名", 43), password, false},
		{"invalid UTF8 username", string([]byte{0xff}), password, false},
		{"invalid UTF8 password", "operator", password + string([]byte{0xff}), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := AdminCredentialsValid(tc.username, tc.password); got != tc.want {
				t.Fatalf("valid = %v, want %v", got, tc.want)
			}
		})
	}
}

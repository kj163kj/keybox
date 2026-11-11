package security

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// AdminCredentialsValid is shared by Web setup and the offline bootstrap command.
// Lengths are UTF-8 bytes; passwords are never trimmed or truncated for bcrypt.
func AdminCredentialsValid(username, password string) bool {
	if !utf8.ValidString(username) || !utf8.ValidString(password) ||
		username == "" || username != strings.TrimSpace(username) || len(username) > 128 ||
		len(password) < 16 || len(password) > 72 {
		return false
	}
	for _, ch := range username {
		if unicode.IsControl(ch) {
			return false
		}
	}
	return true
}

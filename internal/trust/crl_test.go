package trust

import (
	"testing"
	"time"
)

func TestCRLParsing(t *testing.T) {
	r, err := ParseCRL([]byte(`{"entries":{"00AB":{"status":"REVOKED"},"0010":{"status":"SUSPENDED","reason":"KEY_COMPROMISE"}}}`))
	if err != nil || r["ab"] != "REVOKED" || r["10"] != "SUSPENDED" {
		t.Fatal(r, err)
	}
	for _, raw := range []string{`{}`, `{"entries":null}`, `{"entries":{"01":{"status":"GOOD"}}}`, `{"entries":{"01":{"status":"REVOKED"},"1":{"status":"SUSPENDED"}}}`, `{"entries":{},"entries":{}}`, `{"entries":{}} {}`} {
		if _, err := ParseCRL([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
func TestBuiltinRoots(t *testing.T) {
	set, err := ParseBundle(BuiltinPEM, time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC))
	if err != nil || len(set.Certs) != 2 {
		t.Fatalf("roots=%d err=%v", len(set.Certs), err)
	}
}
func TestCacheTTL(t *testing.T) {
	if cacheTTL("public, max-age=86400", time.Hour) != time.Hour {
		t.Fatal("TTL cap ignored")
	}
	if cacheTTL("max-age=60", time.Hour) != time.Minute {
		t.Fatal("server TTL ignored")
	}
}

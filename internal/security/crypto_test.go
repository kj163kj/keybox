package security

import (
	"bytes"
	"testing"
)

func TestVault(t *testing.T) {
	v, err := NewVault("one", map[string][]byte{"one": bytes.Repeat([]byte{7}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	key, nonce, sealed, err := v.Seal("id", []byte("synthetic secret"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := v.Open("id", key, nonce, sealed)
	if err != nil || string(raw) != "synthetic secret" {
		t.Fatal("round trip failed")
	}
	if _, err = v.Open("other", key, nonce, sealed); err == nil {
		t.Fatal("record substitution accepted")
	}
	sealed[0] ^= 1
	if _, err = v.Open("id", key, nonce, sealed); err == nil {
		t.Fatal("tamper accepted")
	}
}

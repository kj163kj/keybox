package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
)

type Vault struct {
	active string
	keys   map[string][]byte
}

func NewVault(active string, keys map[string][]byte) (*Vault, error) {
	if len(keys[active]) != 32 {
		return nil, errors.New("active encryption key must be 32 bytes")
	}
	copied := map[string][]byte{}
	for id, key := range keys {
		if id == "" || len(id) > 64 || len(key) != 32 {
			return nil, errors.New("invalid encryption keyring")
		}
		copied[id] = append([]byte(nil), key...)
	}
	return &Vault{active: active, keys: copied}, nil
}

func (v *Vault) Seal(id string, plain []byte) (keyID string, nonce, encrypted []byte, err error) {
	block, err := aes.NewCipher(v.keys[v.active])
	if err != nil {
		return "", nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", nil, nil, err
	}
	return v.active, nonce, gcm.Seal(nil, nonce, plain, []byte("keybox:v1:"+id)), nil
}

func (v *Vault) Open(id, keyID string, nonce, encrypted []byte) ([]byte, error) {
	key, exists := v.keys[keyID]
	if !exists {
		return nil, errors.New("encryption key unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(nonce) != gcm.NonceSize() {
		return nil, errors.New("invalid encrypted record")
	}
	return gcm.Open(nil, nonce, encrypted, []byte("keybox:v1:"+id))
}

func Hash(value string) string {
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}

func Digest(secret []byte, kind, value string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(kind + ":" + value))
	return hex.EncodeToString(m.Sum(nil))
}

func Token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("system entropy unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Best effort only: Go does not guarantee erasure of all copies made by its GC
// or cryptographic parsers. Core dumps and process debugging must be disabled.
func Wipe(b []byte) { clear(b) }

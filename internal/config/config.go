package config

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"keybox/internal/httpapi"
)

type Config struct {
	DSN, Address, ActiveKey string
	EncryptionKeys          map[string][]byte
	HTTP                    httpapi.Config
	CRLTTL, CRLMaxStale     time.Duration
}

// *_FILE permits Docker/Kubernetes secret mounts. Secret content never appears
// in config errors or application logs.
func Secret(name string) string {
	if path := os.Getenv(name + "_FILE"); path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(raw))
	}
	return os.Getenv(name)
}
func key(name string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(Secret(name))
	if err != nil || len(raw) != 32 {
		return nil, errors.New(name + " must be base64 of 32 random bytes")
	}
	return raw, nil
}
func Load() (Config, error) {
	c := Config{DSN: Secret("KEYBOX_DB_DSN"), Address: os.Getenv("KEYBOX_HTTP_ADDR"), ActiveKey: os.Getenv("KEYBOX_ACTIVE_KEY_ID"),
		EncryptionKeys: map[string][]byte{}, CRLTTL: time.Hour, CRLMaxStale: 24 * time.Hour}
	if c.DSN == "" {
		return c, errors.New("KEYBOX_DB_DSN is required")
	}
	if c.Address == "" {
		c.Address = ":8080"
	}
	var keys map[string]string
	if json.Unmarshal([]byte(Secret("KEYBOX_ENCRYPTION_KEYS")), &keys) != nil {
		return c, errors.New("invalid KEYBOX_ENCRYPTION_KEYS")
	}
	for id, k := range keys {
		raw, err := base64.StdEncoding.DecodeString(k)
		if err != nil || len(raw) != 32 {
			return c, errors.New("encryption keys must be base64 of 32 bytes")
		}
		c.EncryptionKeys[id] = raw
	}
	if len(c.EncryptionKeys[c.ActiveKey]) != 32 {
		return c, errors.New("KEYBOX_ACTIVE_KEY_ID not in keyring")
	}
	var err error
	c.HTTP.HashKey, err = key("KEYBOX_IP_HASH_KEY")
	if err != nil {
		return c, err
	}
	c.HTTP.CSRFKey, err = key("KEYBOX_CSRF_KEY")
	if err != nil {
		return c, err
	}
	c.HTTP.SetupTokenHash, err = setupTokenHash()
	if err != nil {
		return c, err
	}
	for _, origin := range strings.Split(os.Getenv("KEYBOX_ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "https" || u.Host == "" || strings.Contains(u.Host, "*") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return c, errors.New("allowed origins must be exact HTTPS origins without paths")
		}
		c.HTTP.Origins = append(c.HTTP.Origins, origin)
	}
	if len(c.HTTP.Origins) == 0 {
		return c, errors.New("KEYBOX_ALLOWED_ORIGINS is required")
	}
	for _, p := range strings.Split(os.Getenv("KEYBOX_TRUSTED_PROXIES"), ",") {
		if strings.TrimSpace(p) == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(strings.TrimSpace(p))
		if err != nil {
			return c, errors.New("invalid trusted proxy CIDR")
		}
		if prefix.Bits() == 0 {
			return c, errors.New("universal trusted proxy CIDR forbidden")
		}
		c.HTTP.TrustedProxies = append(c.HTTP.TrustedProxies, prefix)
	}
	c.HTTP.SessionTTL = 8 * time.Hour
	options := []struct {
		name          string
		fallback, max int
		dst           *int
	}{
		{"KEYBOX_UPLOADS_PER_IP_HOUR", 10, 1000, &c.HTTP.UploadPerHour},
		{"KEYBOX_UPLOADS_GLOBAL_HOUR", 100, 100000, &c.HTTP.GlobalUploadsPerHour},
		{"KEYBOX_GUEST_DOWNLOADS_PER_IP_HOUR", 5, 1000, &c.HTTP.GuestDownloadsPerHour},
		{"KEYBOX_DOWNLOADS_GLOBAL_HOUR", 100, 100000, &c.HTTP.GlobalDownloadsPerHour},
	}
	for _, o := range options {
		*o.dst = o.fallback
		if value := os.Getenv(o.name); value != "" {
			v, e := strconv.Atoi(value)
			if e != nil || v < 1 || v > o.max {
				return c, errors.New("invalid " + o.name)
			}
			*o.dst = v
		}
	}
	c.HTTP.MaxFileBytes = 1 << 20
	if v := os.Getenv("KEYBOX_MAX_FILE_BYTES"); v != "" {
		n, e := strconv.ParseInt(v, 10, 64)
		if e != nil || n < 1024 || n > 1<<20 {
			return c, errors.New("invalid KEYBOX_MAX_FILE_BYTES")
		}
		c.HTTP.MaxFileBytes = n
	}
	if v := os.Getenv("KEYBOX_CRL_MAX_STALE"); v != "" {
		d, e := time.ParseDuration(v)
		if e != nil || d < 0 || d > 24*time.Hour {
			return c, errors.New("invalid KEYBOX_CRL_MAX_STALE")
		}
		c.CRLMaxStale = d
	}
	return c, nil
}

func setupTokenHash() ([]byte, error) {
	raw := Secret("KEYBOX_SETUP_TOKEN")
	if raw == "" && os.Getenv("KEYBOX_SETUP_TOKEN_FILE") == "" {
		return nil, nil // Unconfigured setup stays closed; existing login still works.
	}
	if len(raw) < 32 || len(raw) > 256 {
		return nil, errors.New("KEYBOX_SETUP_TOKEN must be 32-256 printable ASCII bytes")
	}
	for _, ch := range []byte(raw) {
		if ch < 0x21 || ch > 0x7e {
			return nil, errors.New("KEYBOX_SETUP_TOKEN must be 32-256 printable ASCII bytes")
		}
	}
	digest := sha256.Sum256([]byte(raw))
	return digest[:], nil
}

package trust

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"keybox/internal/domain"
	"keybox/internal/store"
	"keybox/internal/validator"
)

const CRLURL = "https://android.googleapis.com/attestation/status"
const RootURL = "https://android.googleapis.com/attestation/root"
const maxCRLBytes = 8 << 20

type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}
type CRL struct {
	Store         *store.Store
	Client        HTTPClient
	Now           func() time.Time
	TTL, MaxStale time.Duration
	refresh       sync.Mutex
	mu            sync.Mutex
	parsedVersion string
	parsedEntries map[string]string
}

func NewHTTPClient() *http.Client {
	return &http.Client{Timeout: 8 * time.Second, Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment, MaxIdleConns: 4, MaxIdleConnsPerHost: 2, IdleConnTimeout: 30 * time.Second,
		TLSHandshakeTimeout: 4 * time.Second, ResponseHeaderTimeout: 5 * time.Second, DisableCompression: true,
	}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects forbidden") }}
}

func ParseCRL(payload []byte) (map[string]string, error) {
	if len(payload) == 0 || len(payload) > maxCRLBytes {
		return nil, errors.New("invalid CRL size")
	}
	// Reject duplicate JSON object members to avoid ambiguous version semantics.
	if err := uniqueJSON(payload); err != nil {
		return nil, err
	}
	var doc struct {
		Entries map[string]struct {
			Status string `json:"status"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(payload, &doc); err != nil || doc.Entries == nil {
		return nil, errors.New("invalid CRL schema")
	}
	entries := map[string]string{}
	for serial, item := range doc.Entries {
		n, err := validator.NormalizeSerial(serial)
		if err != nil {
			return nil, errors.New("invalid CRL serial")
		}
		if item.Status != "REVOKED" && item.Status != "SUSPENDED" {
			return nil, errors.New("unknown CRL status")
		}
		if _, ok := entries[n]; ok {
			return nil, errors.New("duplicate normalized CRL serial")
		}
		entries[n] = item.Status
	}
	return entries, nil
}
func uniqueJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 12 {
			return errors.New("CRL JSON too deep")
		}
		t, err := decoder.Token()
		if err != nil {
			return err
		}
		switch t {
		case json.Delim('{'):
			seen := map[string]bool{}
			for decoder.More() {
				name, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := name.(string)
				if !ok || seen[key] {
					return errors.New("duplicate CRL JSON key")
				}
				seen[key] = true
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return errors.New("invalid CRL JSON")
			}
		case json.Delim('['):
			for decoder.More() {
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return errors.New("invalid CRL JSON")
			}
		}
		return nil
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("trailing CRL JSON")
	}
	return nil
}

func (c *CRL) current(ctx context.Context) (store.CRLCache, error) {
	var row store.CRLCache
	err := c.Store.DB.WithContext(ctx).Where("status = 'ok'").Order("fetched_at DESC, id DESC").Take(&row).Error
	return row, err
}
func (c *CRL) Snapshot(ctx context.Context) (validator.Revocations, error) {
	row, err := c.current(ctx)
	if err != nil {
		return validator.Revocations{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.parsedVersion != row.Version {
		entries, err := ParseCRL(row.Payload)
		if err != nil {
			return validator.Revocations{}, err
		}
		if validator.Fingerprint(row.Payload) != row.Version {
			return validator.Revocations{}, errors.New("CRL integrity failure")
		}
		c.parsedVersion, c.parsedEntries = row.Version, entries
	}
	now := c.Now().UTC()
	usable := !now.Before(row.FetchedAt.Add(-time.Minute)) && !now.After(row.ExpiresAt.Add(c.MaxStale))
	// Consumers treat this map as immutable.
	return validator.Revocations{Version: row.Version, FetchedAt: row.FetchedAt, ExpiresAt: row.ExpiresAt, Entries: c.parsedEntries, Usable: usable}, nil
}
func (c *CRL) Refresh(ctx context.Context, actor store.Actor) error {
	c.refresh.Lock()
	defer c.refresh.Unlock()
	old, oldErr := c.current(ctx)
	if oldErr != nil && !errors.Is(oldErr, gorm.ErrRecordNotFound) {
		return oldErr
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, CRLURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if oldErr == nil {
		if old.Etag != "" {
			req.Header.Set("If-None-Match", old.Etag)
		}
		if old.LastModified != "" {
			req.Header.Set("If-Modified-Since", old.LastModified)
		}
	}
	resp, err := c.Client.Do(req)
	if err != nil {
		return errors.New("CRL upstream unavailable")
	}
	defer resp.Body.Close()
	now := c.Now().UTC()
	ttl := cacheTTL(resp.Header.Get("Cache-Control"), c.TTL)
	row := old
	switch resp.StatusCode {
	case http.StatusNotModified:
		if oldErr != nil {
			return errors.New("unexpected CRL 304")
		}
		if _, err := ParseCRL(old.Payload); err != nil {
			return err
		}
		if validator.Fingerprint(old.Payload) != old.Version {
			return errors.New("CRL integrity failure")
		}
	case http.StatusOK:
		raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCRLBytes+1))
		if err != nil {
			return errors.New("CRL read failed")
		}
		if _, err := ParseCRL(raw); err != nil {
			return err
		}
		row = store.CRLCache{ID: domain.NewID(), SourceURL: CRLURL, Payload: raw, Version: validator.Fingerprint(raw), Status: "ok"}
	default:
		return errors.New("CRL upstream response rejected")
	}
	row.FetchedAt, row.ExpiresAt = now, now.Add(ttl)
	if etag := resp.Header.Get("ETag"); len(etag) <= 255 && etag != "" {
		row.Etag = etag
	}
	if modified := resp.Header.Get("Last-Modified"); len(modified) <= 255 && modified != "" {
		row.LastModified = modified
	}
	return c.Store.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoUpdates: clause.AssignmentColumns([]string{"fetched_at", "expires_at", "etag", "last_modified"})}).Create(&row).Error; err != nil {
			return err
		}
		return c.Store.Audit(tx, actor, "crl_refresh", "crl", row.Version, "success", nil)
	})
}
func cacheTTL(header string, cap time.Duration) time.Duration {
	ttl := cap
	for _, part := range strings.Split(header, ",") {
		pair := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(pair) == 2 && pair[0] == "max-age" {
			if seconds, err := strconv.Atoi(strings.Trim(pair[1], `"`)); err == nil && seconds >= 0 {
				candidate := time.Duration(seconds) * time.Second
				if candidate < ttl {
					ttl = candidate
				}
			}
		}
	}
	return ttl
}

// CheckRootCandidate only retrieves and validates. It never activates new trust.
func CheckRootCandidate(ctx context.Context, client HTTPClient, now time.Time) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, RootURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", errors.New("root upstream unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, "", errors.New("root response rejected")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		return nil, "", errors.New("root response too large")
	}
	var certs []string
	if err := json.Unmarshal(raw, &certs); err != nil {
		return nil, "", errors.New("invalid root response")
	}
	bundle := []byte(strings.Join(certs, "\n"))
	set, err := ParseBundle(bundle, now)
	if err != nil {
		return nil, "", err
	}
	return bundle, set.Version, nil
}

package trust

import (
	"context"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"keybox/internal/domain"
	"keybox/internal/store"
	"keybox/internal/testutil"
	"keybox/internal/validator"
)

type clientFunc func(*http.Request) (*http.Response, error)

func (f clientFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

func TestMySQLCRLCacheLifecycle(t *testing.T) {
	s := testutil.Database(t)
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	step := 0
	client := clientFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != CRLURL {
			t.Fatal("CRL URL changed")
		}
		switch step {
		case 0:
			return &http.Response{StatusCode: 200, Header: http.Header{"Etag": []string{`"v1"`}, "Cache-Control": []string{"max-age=60"}},
				Body: io.NopCloser(strings.NewReader(`{"entries":{"000A":{"status":"SUSPENDED"}}}`))}, nil
		case 1:
			if r.Header.Get("If-None-Match") != `"v1"` {
				t.Fatal("missing conditional request")
			}
			return &http.Response{StatusCode: 304, Header: http.Header{"Cache-Control": []string{"max-age=60"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		case 2:
			return nil, errors.New("upstream down")
		case 3:
			return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"entries":{"a":{"status":"UNRECOGNIZED"}}}`))}, nil
		}
		return nil, errors.New("unexpected step")
	})
	c := &CRL{Store: s, Now: s.Now, Client: client, TTL: time.Hour, MaxStale: time.Hour}
	ctx := context.Background()
	actor := store.Actor{RequestID: domain.NewID()}
	if _, err := c.Snapshot(ctx); err == nil {
		t.Fatal("missing cache treated as valid")
	}
	if err := c.Refresh(ctx, actor); err != nil {
		t.Fatal(err)
	}
	r, err := c.Snapshot(ctx)
	if err != nil || !r.Usable || r.Entries["a"] != "SUSPENDED" {
		t.Fatal(r, err)
	}
	version := r.Version
	if r.ExpiresAt.Sub(r.FetchedAt) != time.Minute {
		t.Fatal("cache control ignored")
	}
	step = 1
	now = now.Add(2 * time.Minute)
	if err := c.Refresh(ctx, actor); err != nil {
		t.Fatal(err)
	}
	r, err = c.Snapshot(ctx)
	if err != nil || r.Version != version || !r.FetchedAt.Equal(now) {
		t.Fatal("304 did not refresh metadata")
	}
	step = 2
	now = now.Add(30 * time.Minute)
	if err := c.Refresh(ctx, actor); err == nil {
		t.Fatal("upstream failure hidden")
	}
	r, _ = c.Snapshot(ctx)
	if !r.Usable {
		t.Fatal("bounded stale cache unexpectedly unusable")
	}
	now = now.Add(32 * time.Minute)
	r, _ = c.Snapshot(ctx)
	if r.Usable {
		t.Fatal("expired maximum staleness accepted")
	}
	step = 3
	if err := c.Refresh(ctx, actor); err == nil {
		t.Fatal("unknown status accepted")
	}
	r, _ = c.Snapshot(ctx)
	if r.Version != version || r.Usable {
		t.Fatal("invalid update replaced trusted cache")
	}
	var count int64
	s.DB.Model(&store.CRLCache{}).Count(&count)
	if count != 1 {
		t.Fatal("304 created spurious version")
	}
}

func TestMySQLControlledRoots(t *testing.T) {
	s := testutil.Database(t)
	f := testutil.Make(t, false, false, false)
	s.Now = func() time.Time { return f.Now }
	r, err := NewRoots(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	old := r.Snapshot()
	bundle := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: f.Root.Raw})
	if err := r.Apply(context.Background(), bundle, "wrong", store.Actor{RequestID: domain.NewID()}); err == nil {
		t.Fatal("approval hash ignored")
	}
	if r.Snapshot().Version != old.Version {
		t.Fatal("rejected bundle changed trust")
	}
	if err := r.Apply(context.Background(), bundle, validator.Fingerprint(bundle), store.Actor{RequestID: domain.NewID()}); err != nil {
		t.Fatal(err)
	}
	if r.Snapshot().Version == old.Version || len(r.Snapshot().Certs) != 1 {
		t.Fatal("reviewed root set not activated")
	}
	var oldCount int64
	s.DB.Model(&store.TrustedRoot{}).Where("version = ? AND active = false", old.Version).Count(&oldCount)
	if oldCount != int64(len(old.Certs)) {
		t.Fatal("historical root set lost")
	}
}

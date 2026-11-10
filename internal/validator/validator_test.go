package validator

import (
	"context"
	"crypto/x509"
	"encoding/asn1"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"strings"
	"testing"
	"time"

	"keybox/internal/domain"
	"keybox/internal/testutil"
)

type rootsStub struct{ certs []*x509.Certificate }

func (r rootsStub) Snapshot() RootSet { return RootSet{Version: "test-v1", Certs: r.certs} }

type crlStub struct {
	usable  bool
	entries map[string]string
}

func (c crlStub) Snapshot(context.Context) (Revocations, error) {
	return Revocations{Version: "test-crl", Usable: c.usable, Entries: c.entries}, nil
}

func TestValidation(t *testing.T) {
	tests := []struct {
		name                                                 string
		expired, future, mismatch, untrusted, stale, revoked bool
		want                                                 domain.Status
	}{
		{name: "valid RSA and ECDSA", want: domain.Valid},
		{name: "expired", expired: true, want: domain.Expired},
		{name: "not yet valid", future: true, want: domain.Invalid},
		{name: "private key mismatch", mismatch: true, want: domain.Invalid},
		{name: "untrusted root", untrusted: true, want: domain.UntrustedRoot},
		{name: "stale CRL fail closed", stale: true, want: domain.Indeterminate},
		{name: "revoked root invalidates both chains", revoked: true, want: domain.Revoked},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := testutil.Make(t, tt.expired, tt.future, tt.mismatch)
			roots := []*x509.Certificate{f.Root}
			if tt.untrusted {
				roots = nil
			}
			entries := map[string]string{}
			if tt.revoked {
				entries["100"] = "SUSPENDED"
			}
			v := Validator{Now: func() time.Time { return f.Now }, Roots: rootsStub{roots}, CRL: crlStub{!tt.stale, entries}}
			r, err := v.Validate(context.Background(), f.XML)
			if err != nil || r.OverallStatus != tt.want {
				t.Fatalf("status=%s err=%v", r.OverallStatus, err)
			}
			if len(r.Chains) != 2 {
				t.Fatal("missing chain")
			}
			out, _ := json.Marshal(r)
			for _, s := range []string{"BEGIN PRIVATE KEY", "storage_ref", "DeviceID", "BEGIN CERTIFICATE"} {
				if strings.Contains(string(out), s) {
					t.Fatalf("leak: %s", s)
				}
			}
		})
	}
}

func TestXMLGuards(t *testing.T) {
	f := testutil.Make(t, false, false, false)
	tests := [][]byte{
		[]byte(`<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><AndroidAttestation>&leak;</AndroidAttestation>`),
		[]byte(`<AndroidAttestation xmlns="evil"/>`),
		append(append([]byte{}, f.XML...), f.XML...),
		[]byte(strings.Replace(string(f.XML), "<NumberOfKeyboxes>1", "<NumberOfKeyboxes>2", 1)),
		[]byte(strings.Replace(string(f.XML), "<PrivateKey format", "<Unknown format", 1)),
		[]byte(strings.Repeat("x", MaxFileBytes+1)),
	}
	for i, raw := range tests {
		if _, err := parse(context.Background(), raw); err == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := parse(ctx, f.XML); err == nil {
		t.Fatal("cancellation ignored")
	}
}

func TestSignatureTampering(t *testing.T) {
	f := testutil.Make(t, false, false, false)
	keys, err := parse(context.Background(), f.XML)
	if err != nil {
		t.Fatal(err)
	}
	original := keys[0].certs[0].Raw
	tampered := append([]byte(nil), original...)
	tampered[len(tampered)-1] ^= 1
	raw := []byte(strings.Replace(string(f.XML),
		string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: original})),
		string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: tampered})), 1))
	v := Validator{Now: func() time.Time { return f.Now }, Roots: rootsStub{[]*x509.Certificate{f.Root}}, CRL: crlStub{true, map[string]string{}}}
	report, err := v.Validate(context.Background(), raw)
	if err != nil || report.OverallStatus != domain.ChainInvalid {
		t.Fatalf("tampered chain: %s %v", report.OverallStatus, err)
	}
}

func TestInclusiveValidityBoundaries(t *testing.T) {
	f := testutil.Make(t, false, false, false)
	now := f.Now.Add(24 * time.Hour)
	v := Validator{Now: func() time.Time { return now }, Roots: rootsStub{[]*x509.Certificate{f.Root}}, CRL: crlStub{true, map[string]string{}}}
	report, err := v.Validate(context.Background(), f.XML)
	if err != nil || report.OverallStatus != domain.Valid {
		t.Fatal("notAfter boundary must be inclusive")
	}
	now = now.Add(time.Nanosecond)
	report, err = v.Validate(context.Background(), f.XML)
	if err != nil || report.OverallStatus != domain.Expired {
		t.Fatal("expiry boundary not enforced")
	}
}

func TestBOMAndBoundedPrivateDER(t *testing.T) {
	f := testutil.Make(t, false, false, false)
	withBOM := append([]byte{0xef, 0xbb, 0xbf}, f.XML...)
	v := Validator{Now: func() time.Time { return f.Now }, Roots: rootsStub{[]*x509.Certificate{f.Root}}, CRL: crlStub{true, map[string]string{}}}
	report, err := v.Validate(context.Background(), withBOM)
	if err != nil || report.OverallStatus != domain.Valid || report.FileSHA256 != Fingerprint(withBOM) {
		t.Fatal("BOM normalization changed input identity or validity")
	}
	key := struct {
		Version               int
		N                     *big.Int
		E                     int
		D, P, Q, Dp, Dq, Qinv *big.Int
	}{
		N: new(big.Int).Lsh(big.NewInt(1), 8192), E: 65537, D: big.NewInt(1), P: big.NewInt(1), Q: big.NewInt(1),
		Dp: big.NewInt(1), Dq: big.NewInt(1), Qinv: big.NewInt(1),
	}
	der, err := asn1.Marshal(key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parsePrivate(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der})); err == nil {
		t.Fatal("oversized RSA integers accepted")
	}
	keys, err := parse(context.Background(), f.XML)
	if err != nil {
		t.Fatal(err)
	}
	pk, err := x509.MarshalPKCS8PrivateKey(keys[0].private)
	if err != nil {
		t.Fatal(err)
	}
	p := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pk})
	if _, err := parsePrivate(append([]byte("ignored-prefix\n"), p...)); err == nil {
		t.Fatal("unvalidated PEM prefix accepted")
	}
}

func TestSerialNormalization(t *testing.T) {
	for input, want := range map[string]string{"00:AB:12": "ab12", "0x000123": "123", "0000": "0", "10": "10", " FF ": "ff"} {
		got, err := NormalizeSerial(input)
		if err != nil || got != want {
			t.Fatalf("%s -> %s %v", input, got, err)
		}
	}
	for _, input := range []string{"", "-1", "+1", "zz", "1.5"} {
		if _, err := NormalizeSerial(input); err == nil {
			t.Fatalf("accepted %q", input)
		}
	}
}

// Package testutil generates synthetic, never Google-trusted certificates.
package testutil

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"strings"
	"testing"
	"time"
)

type Fixture struct {
	XML  []byte
	Root *x509.Certificate
	Now  time.Time
}

func Make(t testing.TB, expired, future, mismatch bool) Fixture {
	t.Helper()
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(0x100), Subject: pkix.Name{CommonName: "Synthetic test root"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(48 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		MaxPathLen: 2,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, template, template, rootKey.Public(), rootKey)
	if err != nil {
		t.Fatal(err)
	}
	root, err := x509.ParseCertificate(rootDER)
	if err != nil {
		t.Fatal(err)
	}
	rootPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}))
	var keys strings.Builder
	for i, algorithm := range []string{"rsa", "ecdsa"} {
		var key crypto.Signer
		if algorithm == "rsa" {
			key, err = rsa.GenerateKey(rand.Reader, 2048)
		} else {
			key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		}
		if err != nil {
			t.Fatal(err)
		}
		leaf := &x509.Certificate{
			SerialNumber: big.NewInt(int64(0x200 + i)), Subject: pkix.Name{CommonName: "Synthetic " + algorithm},
			NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
			IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
			MaxPathLenZero: true,
		}
		if expired {
			leaf.NotAfter = now.Add(-time.Minute)
		}
		if future {
			leaf.NotBefore = now.Add(time.Minute)
		}
		der, err := x509.CreateCertificate(rand.Reader, leaf, root, key.Public(), rootKey)
		if err != nil {
			t.Fatal(err)
		}
		if mismatch && algorithm == "ecdsa" {
			key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
		}
		pk, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&keys, `<Key algorithm="%s"><PrivateKey format="pem">%s</PrivateKey><CertificateChain><NumberOfCertificates>2</NumberOfCertificates><Certificate format="pem">%s</Certificate><Certificate format="pem">%s</Certificate></CertificateChain></Key>`,
			algorithm, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pk}),
			pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), rootPEM)
	}
	return Fixture{XML: []byte(`<AndroidAttestation><NumberOfKeyboxes>1</NumberOfKeyboxes><Keybox DeviceID="test">` + keys.String() + `</Keybox></AndroidAttestation>`), Root: root, Now: now}
}

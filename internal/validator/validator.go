package validator

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"sort"
	"strings"
	"time"

	"keybox/internal/domain"
)

type RootSet struct {
	Version string
	Certs   []*x509.Certificate
}

type Revocations struct {
	Version   string
	FetchedAt time.Time
	ExpiresAt time.Time
	Entries   map[string]string
	Usable    bool
}

type Roots interface{ Snapshot() RootSet }
type CRL interface {
	Snapshot(context.Context) (Revocations, error)
}

type Validator struct {
	Now   func() time.Time
	Roots Roots
	CRL   CRL
}

func Fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

func (v *Validator) Validate(ctx context.Context, raw []byte) (domain.Report, error) {
	report := domain.Report{
		FileSHA256: Fingerprint(raw), ValidatedAt: v.Now().UTC(),
		OverallStatus: domain.Invalid, Chains: []domain.Chain{}, Errors: []domain.Problem{},
	}
	keys, err := parse(ctx, raw)
	if err != nil {
		return report, safeParseError(err)
	}
	roots := v.Roots.Snapshot()
	crl, crlErr := v.CRL.Snapshot(ctx)
	report.RootSetVersion, report.CRLVersion = roots.Version, crl.Version
	report.CRLUsable = crlErr == nil && crl.Usable
	if !crl.FetchedAt.IsZero() {
		report.CRLFetchedAt, report.CRLExpiresAt = &crl.FetchedAt, &crl.ExpiresAt
	}
	if !report.CRLUsable {
		report.Errors = append(report.Errors, domain.Problem{Code: "CRL_UNAVAILABLE"})
	}
	if len(roots.Certs) == 0 {
		report.Errors = append(report.Errors, domain.Problem{Code: "ROOT_SET_UNAVAILABLE"})
	}
	var states []domain.Status
	fingerprints := map[string]bool{}
	for i, key := range keys {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		chain := domain.Chain{Index: i + 1, Algorithm: key.algorithm, Certificates: []domain.Certificate{}}
		top := key.certs[len(key.certs)-1]
		trusted := false
		for _, root := range roots.Certs {
			if bytes.Equal(root.Raw, top.Raw) {
				trusted = true
				break
			}
		}
		chain.PrivateKeyValid = keyMatches(key.private, key.certs[0], key.algorithm)
		chainStates := []domain.Status{}
		if !chain.PrivateKeyValid {
			chainStates = append(chainStates, domain.Invalid)
			report.Errors = append(report.Errors, domain.Problem{Code: "PRIVATE_KEY_MISMATCH", Chain: i + 1})
		}
		if !trusted {
			chainStates = append(chainStates, domain.UntrustedRoot)
		}
		for j, cert := range key.certs {
			isRoot := j == len(key.certs)-1
			issuer := top
			if !isRoot {
				issuer = key.certs[j+1]
			}
			sigOK := bytes.Equal(cert.RawIssuer, issuer.RawSubject) &&
				cert.CheckSignatureFrom(issuer) == nil && reasonableCertificate(cert) &&
				len(cert.UnhandledCriticalExtensions) == 0
			if isRoot {
				sigOK = sigOK && bytes.Equal(cert.RawIssuer, cert.RawSubject) && cert.IsCA
			}
			timeOK := !report.ValidatedAt.Before(cert.NotBefore) && !report.ValidatedAt.After(cert.NotAfter)
			serial, serialErr := NormalizeSerial(cert.SerialNumber.Text(16))
			if serialErr != nil || cert.SerialNumber.Sign() <= 0 {
				sigOK = false
			}
			crlStatus := "unknown"
			if report.CRLUsable {
				crlStatus = "not_revoked"
			}
			// A known revocation is never erased because the cache is stale.
			if _, exists := crl.Entries[serial]; exists {
				crlStatus = "revoked"
			}
			certStates := []domain.Status{}
			if !sigOK {
				certStates = append(certStates, domain.ChainInvalid)
			}
			if !timeOK {
				if report.ValidatedAt.After(cert.NotAfter) {
					certStates = append(certStates, domain.Expired)
				} else {
					certStates = append(certStates, domain.Invalid)
				}
			}
			if !trusted {
				certStates = append(certStates, domain.UntrustedRoot)
			}
			if crlStatus == "revoked" {
				certStates = append(certStates, domain.Revoked)
			}
			if crlStatus == "unknown" {
				certStates = append(certStates, domain.Indeterminate)
			}
			certStatus := domain.Combine(certStates...)
			fp := Fingerprint(cert.Raw)
			fingerprints[fp] = true
			chain.Certificates = append(chain.Certificates, domain.Certificate{
				Subject: cert.Subject.String(), Issuer: cert.Issuer.String(), SerialNumber: serial,
				FingerprintSHA256: fp, NotBefore: cert.NotBefore.UTC(), NotAfter: cert.NotAfter.UTC(),
				Position: j, IsRoot: isRoot, RootTrusted: trusted, ChainSignatureValid: sigOK,
				TimeValid: timeOK, CRLStatus: crlStatus, CertificateStatus: certStatus, DER: cert.Raw,
			})
			chainStates = append(chainStates, certStatus)
			if certStatus != domain.Valid {
				position := j
				report.Errors = append(report.Errors, domain.Problem{Code: strings.ToUpper(string(certStatus)), Chain: i + 1, Position: &position})
			}
		}
		// Verify path-length constraints, name constraints, critical extensions and
		// CA usage with Go's verifier. No system roots and no network AIA fetching.
		pool, intermediates := x509.NewCertPool(), x509.NewCertPool()
		pool.AddCert(top)
		for _, c := range key.certs[1 : len(key.certs)-1] {
			intermediates.AddCert(c)
		}
		// Check structural constraints independently of the injected current time.
		// Otherwise a not-yet-valid path could later become "valid" without ever
		// having had its path-length constraints verified.
		start, end := key.certs[0].NotBefore, key.certs[0].NotAfter
		for _, c := range key.certs {
			if c.NotBefore.After(start) {
				start = c.NotBefore
			}
			if c.NotAfter.Before(end) {
				end = c.NotAfter
			}
		}
		verifyTime := report.ValidatedAt
		if verifyTime.Before(start) {
			verifyTime = start
		}
		if verifyTime.After(end) {
			verifyTime = end
		}
		paths, verifyErr := key.certs[0].Verify(x509.VerifyOptions{
			Roots: pool, Intermediates: intermediates, CurrentTime: verifyTime,
			KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
		})
		exact := false
		for _, path := range paths {
			if len(path) != len(key.certs) {
				continue
			}
			same := true
			for j := range path {
				same = same && bytes.Equal(path[j].Raw, key.certs[j].Raw)
			}
			exact = exact || same
		}
		if !start.After(end) && (verifyErr != nil || !exact) {
			chainStates = append(chainStates, domain.ChainInvalid)
			report.Errors = append(report.Errors, domain.Problem{Code: "PATH_CONSTRAINTS_INVALID", Chain: i + 1})
			for j := range chain.Certificates {
				chain.Certificates[j].ChainSignatureValid = false
				chain.Certificates[j].CertificateStatus = domain.Combine(chain.Certificates[j].CertificateStatus, domain.ChainInvalid)
			}
		}
		chain.ChainStatus = domain.Combine(chainStates...)
		states = append(states, chain.ChainStatus)
		report.Chains = append(report.Chains, chain)
	}
	sorted := make([]string, 0, len(fingerprints))
	for f := range fingerprints {
		sorted = append(sorted, f)
	}
	sort.Strings(sorted)
	report.CertificateSetSHA256 = Fingerprint([]byte(strings.Join(sorted, "\n")))
	report.OverallStatus = domain.Combine(states...)
	return report, nil
}

func keyMatches(key crypto.Signer, cert *x509.Certificate, algorithm string) bool {
	switch key.(type) {
	case *rsa.PrivateKey:
		if algorithm != "rsa" {
			return false
		}
	case *ecdsa.PrivateKey:
		if algorithm != "ecdsa" {
			return false
		}
	default:
		return false
	}
	a, errA := x509.MarshalPKIXPublicKey(key.Public())
	b, errB := x509.MarshalPKIXPublicKey(cert.PublicKey)
	return errA == nil && errB == nil && bytes.Equal(a, b)
}

func reasonableCertificate(c *x509.Certificate) bool {
	if c.KeyUsage == 0 {
		return false
	}
	if c.IsCA && (!c.BasicConstraintsValid || c.KeyUsage&x509.KeyUsageCertSign == 0) {
		return false
	}
	if !c.IsCA && c.KeyUsage&(x509.KeyUsageDigitalSignature|x509.KeyUsageCertSign) == 0 {
		return false
	}
	switch c.PublicKey.(type) {
	case *rsa.PublicKey:
		key := c.PublicKey.(*rsa.PublicKey)
		if key.N.BitLen() < 2048 || key.N.BitLen() > 8192 || key.E < 65537 {
			return false
		}
	case *ecdsa.PublicKey:
		bits := c.PublicKey.(*ecdsa.PublicKey).Curve.Params().BitSize
		if bits != 256 && bits != 384 && bits != 521 {
			return false
		}
	default:
		return false
	}
	switch c.SignatureAlgorithm {
	case x509.SHA256WithRSA, x509.SHA384WithRSA, x509.SHA512WithRSA,
		x509.SHA256WithRSAPSS, x509.SHA384WithRSAPSS, x509.SHA512WithRSAPSS,
		x509.ECDSAWithSHA256, x509.ECDSAWithSHA384, x509.ECDSAWithSHA512:
		return true
	default:
		return false
	}
}

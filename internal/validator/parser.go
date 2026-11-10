package validator

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math/big"
	"strconv"
	"strings"
)

const MaxFileBytes = 1 << 20

var ErrXML = errors.New("invalid keybox XML")

type parsedKey struct {
	algorithm string
	private   crypto.Signer
	certs     []*x509.Certificate
}

type xmlKey struct {
	Algorithm string `xml:"algorithm,attr"`
	Private   struct {
		Format string `xml:"format,attr"`
		Text   string `xml:",chardata"`
	} `xml:"PrivateKey"`
	Chain struct {
		Count int `xml:"NumberOfCertificates"`
		Certs []struct {
			Format string `xml:"format,attr"`
			Text   string `xml:",chardata"`
		} `xml:"Certificate"`
	} `xml:"CertificateChain"`
}

type xmlBox struct {
	Keys []xmlKey `xml:"Key"`
}
type xmlDocument struct {
	Count int      `xml:"NumberOfKeyboxes"`
	Boxes []xmlBox `xml:"Keybox"`
}

// First pass enforces a small, closed grammar. encoding/xml never fetches
// external entities; directives are rejected as well, including DOCTYPE.
func checkXML(ctx context.Context, raw []byte) error {
	if len(raw) == 0 || len(raw) > MaxFileBytes {
		return ErrXML
	}
	d := xml.NewDecoder(bytes.NewReader(raw))
	d.Strict = true
	stack := []string{}
	counts := []map[string]int{}
	nodes, roots := 0, 0
	allowed := map[string]map[string]int{
		"":                   {"AndroidAttestation": 1},
		"AndroidAttestation": {"NumberOfKeyboxes": 1, "Keybox": 8},
		"Keybox":             {"Key": 2},
		"Key":                {"PrivateKey": 1, "CertificateChain": 1},
		"CertificateChain":   {"NumberOfCertificates": 1, "Certificate": 8},
	}
	attrs := map[string]string{"Keybox": "DeviceID", "Key": "algorithm", "PrivateKey": "format", "Certificate": "format"}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return ErrXML // Never include parser input in an error or log.
		}
		switch t := token.(type) {
		case xml.Directive:
			return ErrXML
		case xml.ProcInst:
			if t.Target != "xml" || roots != 0 {
				return ErrXML
			}
		case xml.StartElement:
			nodes++
			if nodes > 256 || len(stack) >= 8 || t.Name.Space != "" {
				return ErrXML
			}
			parent := ""
			if len(stack) > 0 {
				parent = stack[len(stack)-1]
			}
			limit := allowed[parent][t.Name.Local]
			if limit == 0 {
				return ErrXML
			}
			if len(counts) > 0 {
				counts[len(counts)-1][t.Name.Local]++
				if counts[len(counts)-1][t.Name.Local] > limit {
					return ErrXML
				}
			} else {
				roots++
				if roots != 1 {
					return ErrXML
				}
			}
			seen := map[string]bool{}
			for _, a := range t.Attr {
				if a.Name.Space != "" || a.Name.Local != attrs[t.Name.Local] || seen[a.Name.Local] {
					return ErrXML
				}
				seen[a.Name.Local] = true
			}
			stack = append(stack, t.Name.Local)
			counts = append(counts, map[string]int{})
		case xml.EndElement:
			if len(stack) == 0 {
				return ErrXML
			}
			name := stack[len(stack)-1]
			c := counts[len(counts)-1]
			switch name {
			case "AndroidAttestation":
				if c["NumberOfKeyboxes"] != 1 || c["Keybox"] == 0 {
					return ErrXML
				}
			case "Keybox":
				if c["Key"] == 0 {
					return ErrXML
				}
			case "Key":
				if c["PrivateKey"] != 1 || c["CertificateChain"] != 1 {
					return ErrXML
				}
			case "CertificateChain":
				if c["NumberOfCertificates"] != 1 || c["Certificate"] < 2 {
					return ErrXML
				}
			}
			stack = stack[:len(stack)-1]
			counts = counts[:len(counts)-1]
		case xml.CharData:
			if len(stack) == 0 || len(allowed[stack[len(stack)-1]]) > 0 {
				if strings.TrimSpace(string(t)) != "" {
					return ErrXML
				}
			}
		}
	}
	if roots != 1 || len(stack) != 0 {
		return ErrXML
	}
	return nil
}

func parse(ctx context.Context, raw []byte) ([]parsedKey, error) {
	if len(raw) > MaxFileBytes {
		return nil, ErrXML
	}
	raw = bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})
	if err := checkXML(ctx, raw); err != nil {
		return nil, err
	}
	var doc xmlDocument
	if err := xml.Unmarshal(raw, &doc); err != nil || doc.Count != len(doc.Boxes) {
		return nil, ErrXML
	}
	var result []parsedKey
	for _, box := range doc.Boxes {
		algorithms := map[string]bool{}
		for _, key := range box.Keys {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			alg := strings.ToLower(strings.TrimSpace(key.Algorithm))
			if (alg != "rsa" && alg != "ecdsa") || algorithms[alg] {
				return nil, ErrXML
			}
			algorithms[alg] = true
			if key.Private.Format != "pem" || key.Chain.Count != len(key.Chain.Certs) {
				return nil, ErrXML
			}
			p, err := parsePrivate([]byte(key.Private.Text))
			if err != nil {
				return nil, ErrXML
			}
			k := parsedKey{algorithm: alg, private: p}
			for _, cert := range key.Chain.Certs {
				block := singlePEM([]byte(cert.Text))
				if cert.Format != "pem" || block == nil || block.Type != "CERTIFICATE" {
					return nil, ErrXML
				}
				c, err := x509.ParseCertificate(block.Bytes)
				if err != nil {
					return nil, ErrXML
				}
				k.certs = append(k.certs, c)
			}
			result = append(result, k)
		}
	}
	return result, nil
}

func parsePrivate(raw []byte) (crypto.Signer, error) {
	block := singlePEM(raw)
	if block == nil || len(block.Bytes) > 8*1024 {
		return nil, ErrXML
	}
	if err := boundPrivateDER(block.Type, block.Bytes); err != nil {
		return nil, err
	}
	var key any
	var err error
	switch block.Type {
	case "PRIVATE KEY":
		key, err = x509.ParsePKCS8PrivateKey(block.Bytes)
	case "RSA PRIVATE KEY":
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	case "EC PRIVATE KEY":
		key, err = x509.ParseECPrivateKey(block.Bytes)
	default:
		return nil, ErrXML
	}
	if err != nil {
		return nil, ErrXML
	}
	switch k := key.(type) {
	case *rsa.PrivateKey:
		if k.N.BitLen() < 2048 || k.N.BitLen() > 8192 || k.Validate() != nil {
			return nil, ErrXML
		}
		return k, nil
	case *ecdsa.PrivateKey:
		if k.Curve.Params().BitSize != 256 && k.Curve.Params().BitSize != 384 && k.Curve.Params().BitSize != 521 {
			return nil, ErrXML
		}
		return k, nil
	default:
		return nil, ErrXML
	}
}

func singlePEM(raw []byte) *pem.Block {
	raw = bytes.TrimSpace(raw)
	if !bytes.HasPrefix(raw, []byte("-----BEGIN ")) || bytes.Count(raw, []byte("-----BEGIN ")) != 1 {
		return nil
	}
	block, rest := pem.Decode(raw)
	if block == nil || len(block.Headers) != 0 || len(bytes.TrimSpace(rest)) != 0 {
		return nil
	}
	return block
}

// x509.ParsePKCS1PrivateKey performs RSA precomputation internally. Bound all
// integers BEFORE invoking it, not merely after returning a *rsa.PrivateKey.
func boundPrivateDER(kind string, der []byte) error {
	switch kind {
	case "PRIVATE KEY":
		var wrapper struct {
			Version    int
			Algorithm  pkix.AlgorithmIdentifier
			PrivateKey []byte
		}
		rest, err := asn1.Unmarshal(der, &wrapper)
		if err != nil || len(rest) != 0 || wrapper.Version != 0 {
			return ErrXML
		}
		switch {
		case wrapper.Algorithm.Algorithm.Equal(asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 1, 1}):
			return boundPrivateDER("RSA PRIVATE KEY", wrapper.PrivateKey)
		case wrapper.Algorithm.Algorithm.Equal(asn1.ObjectIdentifier{1, 2, 840, 10045, 2, 1}):
			return boundPrivateDER("EC PRIVATE KEY", wrapper.PrivateKey)
		default:
			return ErrXML
		}
	case "RSA PRIVATE KEY":
		var key struct {
			Version               int
			N                     *big.Int
			E                     int
			D, P, Q, Dp, Dq, Qinv *big.Int
			AdditionalPrimes      []struct{ Prime, Exponent, Coefficient *big.Int } `asn1:"optional,omitempty"`
		}
		rest, err := asn1.Unmarshal(der, &key)
		if err != nil || len(rest) != 0 || key.Version != 0 || len(key.AdditionalPrimes) != 0 || key.E < 65537 || key.E > 2147483647 || key.E%2 == 0 {
			return ErrXML
		}
		for _, n := range []*big.Int{key.N, key.D, key.P, key.Q, key.Dp, key.Dq, key.Qinv} {
			if n == nil || n.Sign() <= 0 || n.BitLen() > 8192 {
				return ErrXML
			}
		}
		if key.N.BitLen() < 2048 {
			return ErrXML
		}
		return nil
	case "EC PRIVATE KEY":
		if len(der) > 1024 {
			return ErrXML
		}
		return nil
	default:
		return ErrXML
	}
}

// NormalizeSerial always interprets a serial as hexadecimal, including all-digit
// strings. A serial is never silently interpreted as decimal.
func NormalizeSerial(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "0x")
	s = strings.ReplaceAll(s, ":", "")
	if len(s) == 0 || len(s) > 80 {
		return "", ErrXML
	}
	for _, ch := range s {
		if !strings.ContainsRune("0123456789abcdef", ch) {
			return "", ErrXML
		}
	}
	s = strings.TrimLeft(s, "0")
	if s == "" {
		s = "0"
	}
	return s, nil
}

func NormalizeFingerprint(s string) (string, error) {
	s = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), ":", ""))
	if len(s) != 64 {
		return "", ErrXML
	}
	for _, ch := range s {
		if _, err := strconv.ParseUint(string(ch), 16, 4); err != nil {
			return "", ErrXML
		}
	}
	return s, nil
}

func safeParseError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return err
	}
	return fmt.Errorf("%w", ErrXML)
}

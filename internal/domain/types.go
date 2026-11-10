package domain

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

type Status string

const (
	Valid         Status = "valid"
	Invalid       Status = "invalid"
	Revoked       Status = "revoked"
	Expired       Status = "expired"
	UntrustedRoot Status = "untrusted_root"
	ChainInvalid  Status = "chain_invalid"
	Indeterminate Status = "indeterminate"
)

var StatusValues = []Status{Valid, Invalid, Revoked, Expired, UntrustedRoot, ChainInvalid, Indeterminate}

func IsStatus(s string) bool {
	for _, v := range StatusValues {
		if string(v) == s {
			return true
		}
	}
	return false
}

// Combine has a fixed precedence so repeated validations are reproducible.
func Combine(states ...Status) Status {
	for _, candidate := range []Status{Revoked, ChainInvalid, UntrustedRoot, Expired, Invalid, Indeterminate} {
		for _, state := range states {
			if state == candidate {
				return candidate
			}
		}
	}
	return Valid
}

type Problem struct {
	Code     string `json:"code"`
	Chain    int    `json:"chain,omitempty"`
	Position *int   `json:"position,omitempty"`
}

type Certificate struct {
	Subject             string    `json:"subject"`
	Issuer              string    `json:"issuer"`
	SerialNumber        string    `json:"serial_number"`
	FingerprintSHA256   string    `json:"fingerprint_sha256"`
	NotBefore           time.Time `json:"not_before"`
	NotAfter            time.Time `json:"not_after"`
	Position            int       `json:"position"`
	IsRoot              bool      `json:"is_root"`
	RootTrusted         bool      `json:"root_trusted"`
	ChainSignatureValid bool      `json:"chain_signature_valid"`
	TimeValid           bool      `json:"time_valid"`
	CRLStatus           string    `json:"crl_status"`
	CertificateStatus   Status    `json:"certificate_status"`
	DER                 []byte    `json:"-"`
}

type Chain struct {
	Index           int           `json:"index"`
	Algorithm       string        `json:"algorithm"`
	ChainStatus     Status        `json:"chain_status"`
	PrivateKeyValid bool          `json:"private_key_valid"`
	Certificates    []Certificate `json:"certificates"`
}

type Report struct {
	OverallStatus        Status     `json:"overall_status"`
	FileSHA256           string     `json:"file_sha256"`
	CertificateSetSHA256 string     `json:"-"`
	Chains               []Chain    `json:"chains"`
	Errors               []Problem  `json:"errors"`
	RootSetVersion       string     `json:"root_set_version"`
	CRLVersion           string     `json:"crl_version"`
	CRLFetchedAt         *time.Time `json:"crl_fetched_at"`
	CRLExpiresAt         *time.Time `json:"crl_expires_at"`
	CRLUsable            bool       `json:"crl_usable"`
	ValidatedAt          time.Time  `json:"validated_at"`
}

func DownloadAllowed(global bool, policy, visibility string, deleted bool) bool {
	return global && (policy == "inherit" || policy == "allowed") && visibility == "public" && !deleted
}

func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("system entropy unavailable")
	}
	return hex.EncodeToString(b)
}

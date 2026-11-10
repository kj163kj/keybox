package store

import (
	"time"

	"keybox/internal/domain"
)

// Database models are never marshalled to API responses.
type Keybox struct {
	ID, FileSHA256, CertificateSetSHA256, OriginalFilename   string
	OverallStatus                                            domain.Status
	Visibility, GuestDownloadPolicy, UploadIPHash, AdminNote string
	LastValidatedAt, CreatedAt, UpdatedAt                    time.Time
	DeletedAt                                                *time.Time
	RootSetVersion, CRLVersion                               string
	NotBefore, NotAfter                                      time.Time
	EffectiveStatus                                          domain.Status `gorm:"->;column:effective_status"`
}
type KeyboxBlob struct {
	KeyboxID          string `gorm:"primaryKey"`
	KeyID             string
	Nonce, Ciphertext []byte
}
type KeyboxChain struct {
	ID, KeyboxID string
	ChainIndex   int
	Algorithm    string
	ChainStatus  domain.Status
	CreatedAt    time.Time
}
type KeyboxKeyFingerprint struct {
	FingerprintSHA256 string `gorm:"primaryKey"`
	KeyboxID          string
}
type Certificate struct {
	ID, KeyboxID, ChainID                               string
	Position                                            int
	Subject, Issuer, SerialNumber, FingerprintSHA256    string
	CertDER                                             []byte
	NotBefore, NotAfter                                 time.Time
	IsRoot, RootTrusted, ChainSignatureValid, TimeValid bool
	CRLStatus                                           string
	CertificateStatus                                   domain.Status
	CreatedAt                                           time.Time
}
type ValidationRun struct {
	ID                         string
	KeyboxID                   *string
	InputSHA256                string
	OverallStatus              domain.Status
	ResultJSON                 []byte
	RootSetVersion, CRLVersion string
	CRLFetchedAt, CRLExpiresAt *time.Time
	CreatedAt                  time.Time
}
type Admin struct {
	ID, Username, PasswordHash, Status string
	CreatedAt                          time.Time
	LastLoginAt                        *time.Time
}
type AdminSession struct {
	ID, AdminID, SessionHash, CSRFTokenHash string
	ExpiresAt, CreatedAt                    time.Time
	RevokedAt                               *time.Time
}
type AuditLog struct {
	ID            string    `json:"id"`
	AdminID       *string   `json:"admin_id"`
	Action        string    `json:"action"`
	TargetType    string    `json:"target_type"`
	TargetID      *string   `json:"target_id"`
	IPHash        string    `json:"ip_hash"`
	UserAgentHash string    `json:"user_agent_hash"`
	Result        string    `json:"result"`
	RequestID     string    `json:"request_id"`
	DetailsJSON   []byte    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
}
type DownloadLog struct {
	ID            string    `json:"id"`
	KeyboxID      *string   `json:"keybox_id"`
	ActorType     string    `json:"actor_type"`
	AdminID       *string   `json:"admin_id"`
	IPHash        string    `json:"ip_hash"`
	UserAgentHash string    `json:"user_agent_hash"`
	Result        string    `json:"result"`
	RequestID     string    `json:"request_id"`
	CreatedAt     time.Time `json:"created_at"`
}
type Setting struct {
	ID                       uint64
	SettingKey, SettingValue string
	UpdatedBy                *string
	UpdatedAt                time.Time
}
type CRLCache struct {
	ID, Version, SourceURL, Etag, LastModified string
	Payload                                    []byte
	FetchedAt, ExpiresAt                       time.Time
	Status                                     string
}

func (CRLCache) TableName() string { return "crl_cache" }

type TrustedRoot struct {
	ID, Name, FingerprintSHA256, CertPEM, Version string
	Active                                        bool
	CreatedAt                                     time.Time
}

type Actor struct {
	AdminID                   *string
	IPHash, UAHash, RequestID string
}

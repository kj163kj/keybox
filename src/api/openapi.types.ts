/* eslint-disable */
// AUTO-GENERATED FROM api/openapi.json BY scripts/generate_api_types.mjs — DO NOT EDIT MANUALLY.

export interface ApiSuccessEnvelope<T> {
  code: 0;
  message: string;
  data: T;
  request_id: string;
}

export interface ApiErrorEnvelope<T = null> {
  code: number;
  message: string;
  data: T;
  request_id: string;
}

export type Status = "valid" | "invalid" | "revoked" | "expired" | "untrusted_root" | "chain_invalid" | "indeterminate";

export type DownloadPolicy = "inherit" | "allowed" | "denied";

export interface Problem {
  code: string;
  chain?: number;
  position?: number;
}

export interface Certificate {
  subject: string;
  issuer: string;
  serial_number: string;
  fingerprint_sha256: string;
  not_before: string;
  not_after: string;
  position: number;
  is_root: boolean;
  root_trusted: boolean;
  chain_signature_valid: boolean;
  time_valid: boolean;
  crl_status: "not_revoked" | "revoked" | "unknown";
  certificate_status: Status;
}

export interface Chain {
  index: number;
  algorithm: "rsa" | "ecdsa";
  chain_status: Status;
  private_key_valid: boolean;
  certificates: Array<Certificate>;
}

export interface Validation {
  overall_status: Status;
  file_sha256: string;
  chains: Array<Chain>;
  errors: Array<Problem>;
  root_set_version: string;
  crl_version: string;
  crl_fetched_at: string | null;
  crl_expires_at: string | null;
  crl_usable: boolean;
  validated_at: string;
}

export interface KeyboxSummary {
  id: string;
  file_sha256: string;
  overall_status: Status;
  last_validation_status: Status;
  created_at: string;
  last_validated_at: string;
  guest_downloadable_effective: boolean;
}

export interface AdminKeyboxSummary {
  id: string;
  file_sha256: string;
  overall_status: Status;
  last_validation_status: Status;
  created_at: string;
  last_validated_at: string;
  guest_downloadable_effective: boolean;
  visibility: "public" | "hidden";
  guest_download_policy: DownloadPolicy;
}

export interface KeyboxDetail {
  id: string;
  overall_status: Status;
  file_sha256: string;
  chains: Array<Chain>;
  errors: Array<Problem>;
  root_set_version: string;
  crl_version: string;
  crl_fetched_at: string | null;
  crl_expires_at: string | null;
  crl_usable: boolean;
  validated_at: string;
  created_at: string;
  status_checked_at: string;
  guest_download_enabled: boolean;
  guest_download_policy: DownloadPolicy;
  guest_downloadable_effective: boolean;
}

export interface AdminKeyboxDetail {
  id: string;
  overall_status: Status;
  file_sha256: string;
  chains: Array<Chain>;
  errors: Array<Problem>;
  root_set_version: string;
  crl_version: string;
  crl_fetched_at: string | null;
  crl_expires_at: string | null;
  crl_usable: boolean;
  validated_at: string;
  created_at: string;
  status_checked_at: string;
  guest_download_enabled: boolean;
  guest_download_policy: DownloadPolicy;
  guest_downloadable_effective: boolean;
  visibility: "public" | "hidden";
  /** Maximum 2000 UTF-8 bytes. */
  admin_note: string;
}

export interface KeyboxCreated {
  id: string;
  overall_status: "valid";
  created_at: string;
}

export interface StatusResult {
  id: string;
  validation: Validation;
  status_checked_at: string;
}

export interface CertificateMatch {
  keybox_id: string;
  chain_index: number;
  certificate: Certificate;
}

export interface CertificateQuery {
  serial_number: string;
  fingerprint_sha256: string;
  crl_status: "not_revoked" | "revoked" | "unknown";
  certificate_status: Status;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResult {
  admin: {
    id: string;
    username: string;
  };
  csrf_token: string;
  expires_at: string;
}

export interface AdminSetupStatus {
  initialized: boolean;
  setup_available: boolean;
}

export interface AdminSetupInput {
  /** Deployment-only secret. Never store in browser storage or URLs. */
  setup_token: string;
  /** Trimmed username, 1-128 UTF-8 bytes; no control characters. */
  username: string;
  /** 8-72 UTF-8 bytes, not characters. Never trimmed or truncated. */
  password: string;
}

export interface AdminSetupResult {
  initialized: true;
  admin: {
    id: string;
    username: string;
  };
}

export interface Me {
  id: string;
  username: string;
  csrf_token: string;
  expires_at: string;
}

export interface KeyboxPatch {
  visibility?: "public" | "hidden";
  /** Maximum 2000 UTF-8 bytes. */
  admin_note?: string;
  guest_download_policy?: DownloadPolicy;
}

export interface GuestDownloadSetting {
  enabled: boolean;
}

export interface ValidationRun {
  id: string;
  keybox_id: string;
  input_sha256: string;
  overall_status: Status;
  root_set_version: string;
  crl_version: string;
  created_at: string;
  validation: Validation;
}

export interface AuditLog {
  id: string;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  ip_hash: string;
  user_agent_hash: string;
  result: string;
  request_id: string;
  created_at: string;
}

export interface DownloadLog {
  id: string;
  keybox_id: string | null;
  actor_type: "guest" | "admin";
  admin_id: string | null;
  ip_hash: string;
  user_agent_hash: string;
  result: string;
  request_id: string;
  created_at: string;
}

export interface Health {
  status: "healthy" | "degraded";
  database: "up" | "down";
  root_set_version: string;
  root_count: number;
  crl: {
    version: string;
    fetched_at: string;
    expires_at: string;
    expired: boolean;
    usable: boolean;
  };
  guest_download_enabled: boolean;
}

export interface CRLRefresh {
  version: string;
  fetched_at: string;
  expires_at: string;
  usable: boolean;
}

export interface Error {
  code: number;
  message: string;
  data: null;
  request_id: string;
}

export interface KeyboxSummaryPage {
  items: Array<KeyboxSummary>;
  page: number;
  page_size: number;
  total: number;
}

export interface AdminKeyboxSummaryPage {
  items: Array<AdminKeyboxSummary>;
  page: number;
  page_size: number;
  total: number;
}

export interface ValidationRunPage {
  items: Array<ValidationRun>;
  page: number;
  page_size: number;
  total: number;
}

export interface AuditLogPage {
  items: Array<AuditLog>;
  page: number;
  page_size: number;
  total: number;
}

export interface DownloadLogPage {
  items: Array<DownloadLog>;
  page: number;
  page_size: number;
  total: number;
}

export interface CertificatePage {
  items: Array<CertificateMatch>;
  page: number;
  page_size: number;
  total: number;
  query: CertificateQuery;
  status_checked_at: string;
}

export type ApiCode = 0 | 40001 | 40101 | 40102 | 40301 | 40302 | 40303 | 40304 | 40401 | 40501 | 40801 | 40901 | 40902 | 40903 | 40904 | 41301 | 41501 | 42201 | 42202 | 42901 | 42902 | 50001 | 50301 | 50302 | 50303;

export const OPENAPI_OPERATIONS = {
  validateKeybox: { method: "POST", path: "/api/v1/keyboxes/validate", requiresAdminSession: false, requiresCsrf: false },
  uploadKeybox: { method: "POST", path: "/api/v1/keyboxes", requiresAdminSession: false, requiresCsrf: false },
  listKeyboxes: { method: "GET", path: "/api/v1/keyboxes", requiresAdminSession: false, requiresCsrf: false },
  getKeybox: { method: "GET", path: "/api/v1/keyboxes/{id}", requiresAdminSession: false, requiresCsrf: false },
  getKeyboxStatus: { method: "GET", path: "/api/v1/keyboxes/{id}/status", requiresAdminSession: false, requiresCsrf: false },
  downloadKeybox: { method: "GET", path: "/api/v1/keyboxes/{id}/download", requiresAdminSession: false, requiresCsrf: false },
  getCertificateStatus: { method: "GET", path: "/api/v1/certificates/status", requiresAdminSession: false, requiresCsrf: false },
  adminSetupStatus: { method: "GET", path: "/api/v1/admin/setup", requiresAdminSession: false, requiresCsrf: false },
  adminSetup: { method: "POST", path: "/api/v1/admin/setup", requiresAdminSession: false, requiresCsrf: false },
  adminLogin: { method: "POST", path: "/api/v1/admin/login", requiresAdminSession: false, requiresCsrf: false },
  adminLogout: { method: "POST", path: "/api/v1/admin/logout", requiresAdminSession: true, requiresCsrf: true },
  adminMe: { method: "GET", path: "/api/v1/admin/me", requiresAdminSession: true, requiresCsrf: false },
  adminListKeyboxes: { method: "GET", path: "/api/v1/admin/keyboxes", requiresAdminSession: true, requiresCsrf: false },
  adminGetKeybox: { method: "GET", path: "/api/v1/admin/keyboxes/{id}", requiresAdminSession: true, requiresCsrf: false },
  adminPatchKeybox: { method: "PATCH", path: "/api/v1/admin/keyboxes/{id}", requiresAdminSession: true, requiresCsrf: true },
  adminDeleteKeybox: { method: "DELETE", path: "/api/v1/admin/keyboxes/{id}", requiresAdminSession: true, requiresCsrf: true },
  adminRevalidateKeybox: { method: "POST", path: "/api/v1/admin/keyboxes/{id}/revalidate", requiresAdminSession: true, requiresCsrf: true },
  adminListValidationRuns: { method: "GET", path: "/api/v1/admin/keyboxes/{id}/validation-runs", requiresAdminSession: true, requiresCsrf: false },
  adminDownloadKeybox: { method: "GET", path: "/api/v1/admin/keyboxes/{id}/download", requiresAdminSession: true, requiresCsrf: false },
  adminGetGuestDownloadSetting: { method: "GET", path: "/api/v1/admin/settings/guest-download", requiresAdminSession: true, requiresCsrf: false },
  adminSetGuestDownloadSetting: { method: "PATCH", path: "/api/v1/admin/settings/guest-download", requiresAdminSession: true, requiresCsrf: true },
  adminListAuditLogs: { method: "GET", path: "/api/v1/admin/audit-logs", requiresAdminSession: true, requiresCsrf: false },
  adminListDownloadLogs: { method: "GET", path: "/api/v1/admin/download-logs", requiresAdminSession: true, requiresCsrf: false },
  adminHealth: { method: "GET", path: "/api/v1/admin/system/health", requiresAdminSession: true, requiresCsrf: false },
  adminRefreshCRL: { method: "POST", path: "/api/v1/admin/system/crl/refresh", requiresAdminSession: true, requiresCsrf: true },
  liveness: { method: "GET", path: "/healthz", requiresAdminSession: false, requiresCsrf: false },
} as const;

export type OperationId = keyof typeof OPENAPI_OPERATIONS;

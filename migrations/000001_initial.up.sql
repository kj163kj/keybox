CREATE TABLE keyboxes (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  file_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  certificate_set_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_filename VARCHAR(128) NOT NULL,
  overall_status ENUM('valid','invalid','revoked','expired','untrusted_root','chain_invalid','indeterminate') NOT NULL,
  root_set_version VARCHAR(128) CHARACTER SET ascii NOT NULL,
  crl_version VARCHAR(128) CHARACTER SET ascii NOT NULL,
  not_before DATETIME(6) NOT NULL,
  not_after DATETIME(6) NOT NULL,
  visibility ENUM('public','hidden') NOT NULL DEFAULT 'public',
  guest_download_policy ENUM('inherit','allowed','denied') NOT NULL DEFAULT 'inherit',
  upload_ip_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  admin_note VARCHAR(2000) NOT NULL DEFAULT '',
  last_validated_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  UNIQUE KEY uq_keybox_file (file_sha256),
  UNIQUE KEY uq_keybox_certificate_set (certificate_set_sha256),
  KEY idx_keybox_public (visibility, deleted_at, overall_status, created_at, id),
  KEY idx_keybox_policy (guest_download_policy, deleted_at, created_at),
  KEY idx_keybox_revalidate (deleted_at, last_validated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The reference is the keybox ID; no filesystem paths or plaintext XML exist.
CREATE TABLE keybox_blobs (
  keybox_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  key_id VARCHAR(64) CHARACTER SET ascii NOT NULL,
  nonce VARBINARY(12) NOT NULL,
  ciphertext MEDIUMBLOB NOT NULL,
  CONSTRAINT fk_blob_keybox FOREIGN KEY (keybox_id) REFERENCES keyboxes(id)
) ENGINE=InnoDB;

CREATE TABLE keybox_chains (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  keybox_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chain_index INT UNSIGNED NOT NULL,
  algorithm ENUM('rsa','ecdsa') NOT NULL,
  chain_status ENUM('valid','invalid','revoked','expired','untrusted_root','chain_invalid','indeterminate') NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_chain_index (keybox_id, chain_index),
  CONSTRAINT fk_chain_keybox FOREIGN KEY (keybox_id) REFERENCES keyboxes(id)
) ENGINE=InnoDB;

-- Only chain-first certificates are globally unique. Shared roots/intermediates
-- must remain reusable by unrelated keyboxes.
CREATE TABLE keybox_key_fingerprints (
  fingerprint_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  keybox_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  KEY idx_key_fingerprint_box (keybox_id),
  CONSTRAINT fk_key_fingerprint_box FOREIGN KEY (keybox_id) REFERENCES keyboxes(id)
) ENGINE=InnoDB;

CREATE TABLE certificates (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  keybox_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chain_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position INT UNSIGNED NOT NULL,
  subject MEDIUMTEXT NOT NULL,
  issuer MEDIUMTEXT NOT NULL,
  serial_number VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fingerprint_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cert_der MEDIUMBLOB NOT NULL,
  not_before DATETIME(6) NOT NULL,
  not_after DATETIME(6) NOT NULL,
  is_root BOOLEAN NOT NULL,
  root_trusted BOOLEAN NOT NULL,
  chain_signature_valid BOOLEAN NOT NULL,
  time_valid BOOLEAN NOT NULL,
  crl_status ENUM('not_revoked','revoked','unknown') NOT NULL,
  certificate_status ENUM('valid','invalid','revoked','expired','untrusted_root','chain_invalid','indeterminate') NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_certificate_position (chain_id, position),
  KEY idx_certificate_serial (serial_number),
  KEY idx_certificate_fingerprint (fingerprint_sha256),
  KEY idx_certificate_box (keybox_id),
  CONSTRAINT fk_cert_box FOREIGN KEY (keybox_id) REFERENCES keyboxes(id),
  CONSTRAINT fk_cert_chain FOREIGN KEY (chain_id) REFERENCES keybox_chains(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE validation_runs (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  keybox_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  overall_status ENUM('valid','invalid','revoked','expired','untrusted_root','chain_invalid','indeterminate') NOT NULL,
  result_json JSON NOT NULL,
  root_set_version VARCHAR(128) CHARACTER SET ascii NOT NULL,
  crl_version VARCHAR(128) CHARACTER SET ascii NOT NULL,
  crl_fetched_at DATETIME(6) NULL,
  crl_expires_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_run_box (keybox_id, created_at, id),
  KEY idx_run_cleanup (keybox_id, created_at),
  CONSTRAINT fk_run_box FOREIGN KEY (keybox_id) REFERENCES keyboxes(id)
) ENGINE=InnoDB;

CREATE TABLE admins (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL,
  last_login_at DATETIME(6) NULL,
  UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_sessions (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  admin_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  UNIQUE KEY uq_session_hash (session_hash),
  KEY idx_session_admin (admin_id),
  KEY idx_session_expiry (expires_at),
  CONSTRAINT fk_session_admin FOREIGN KEY (admin_id) REFERENCES admins(id)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  admin_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action VARCHAR(64) CHARACTER SET ascii NOT NULL,
  target_type VARCHAR(32) CHARACTER SET ascii NOT NULL,
  target_id VARCHAR(128) CHARACTER SET ascii NULL,
  ip_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  user_agent_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  result VARCHAR(32) CHARACTER SET ascii NOT NULL,
  request_id CHAR(32) CHARACTER SET ascii NOT NULL,
  details_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_audit_time (created_at, id),
  KEY idx_audit_actor (admin_id, created_at),
  KEY idx_audit_target (target_type, target_id, created_at),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_request (request_id)
) ENGINE=InnoDB;

CREATE TABLE download_logs (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  keybox_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_type ENUM('guest','admin') NOT NULL,
  admin_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  user_agent_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  result VARCHAR(32) CHARACTER SET ascii NOT NULL,
  request_id CHAR(32) CHARACTER SET ascii NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_download_box (keybox_id, created_at),
  KEY idx_download_actor (actor_type, admin_id, created_at),
  KEY idx_download_ip (ip_hash, created_at),
  KEY idx_download_request (request_id)
) ENGINE=InnoDB;

CREATE TABLE settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  setting_value VARCHAR(32) CHARACTER SET ascii NOT NULL,
  updated_by CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_setting_key (setting_key)
) ENGINE=InnoDB;
INSERT INTO settings (setting_key, setting_value, updated_at)
VALUES ('guest_download_enabled', 'false', UTC_TIMESTAMP(6));

-- Immutable payload versions are retained for reproducible validations.
CREATE TABLE crl_cache (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  version CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_url VARCHAR(255) CHARACTER SET ascii NOT NULL,
  etag VARCHAR(255) NOT NULL DEFAULT '',
  last_modified VARCHAR(255) NOT NULL DEFAULT '',
  payload MEDIUMBLOB NOT NULL,
  fetched_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  status ENUM('ok','error') NOT NULL,
  UNIQUE KEY uq_crl_version (version),
  KEY idx_crl_current (status, fetched_at)
) ENGINE=InnoDB;

CREATE TABLE trusted_roots (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  fingerprint_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cert_pem TEXT NOT NULL,
  version VARCHAR(128) CHARACTER SET ascii NOT NULL,
  active BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_root_version (version, fingerprint_sha256),
  KEY idx_root_active (active, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rate_buckets (
  bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  window_start BIGINT NOT NULL,
  hits INT UNSIGNED NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  PRIMARY KEY (bucket_key, window_start),
  KEY idx_rate_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE concurrency_slots (
  id INT UNSIGNED PRIMARY KEY,
  owner CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  expires_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
INSERT INTO concurrency_slots (id, expires_at) VALUES
(1,'2000-01-01'),(2,'2000-01-01'),(3,'2000-01-01'),(4,'2000-01-01'),
(5,'2000-01-01'),(6,'2000-01-01'),(7,'2000-01-01'),(8,'2000-01-01');

-- Run as DBA after migrations. This creates a ROLE, never an account/password.
-- Create the runtime user separately with a generated password, then grant this
-- role and SET DEFAULT ROLE. Do not use the migrator/root DSN for the API.
CREATE ROLE IF NOT EXISTS 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE ON keybox.keyboxes TO 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE ON keybox.keybox_blobs TO 'keybox_runtime';
GRANT SELECT, INSERT, DELETE ON keybox.keybox_chains TO 'keybox_runtime';
GRANT SELECT, INSERT ON keybox.keybox_key_fingerprints TO 'keybox_runtime';
GRANT SELECT, INSERT, DELETE ON keybox.certificates TO 'keybox_runtime';
GRANT SELECT, INSERT, DELETE ON keybox.validation_runs TO 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE ON keybox.admins TO 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE, DELETE ON keybox.admin_sessions TO 'keybox_runtime';
GRANT SELECT, INSERT ON keybox.audit_logs TO 'keybox_runtime';
GRANT SELECT, INSERT ON keybox.download_logs TO 'keybox_runtime';
GRANT SELECT, UPDATE ON keybox.settings TO 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE ON keybox.crl_cache TO 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE ON keybox.trusted_roots TO 'keybox_runtime';
GRANT SELECT, INSERT, UPDATE, DELETE ON keybox.rate_buckets TO 'keybox_runtime';
GRANT SELECT, UPDATE ON keybox.concurrency_slots TO 'keybox_runtime';

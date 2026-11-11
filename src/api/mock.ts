import {
  CONTRACT_MAX_UPLOAD_BYTES,
  GUEST_DOWNLOAD_CONFIRM_HEADER,
  KEYBOX_ID_REGEX,
  normalizeFingerprintInput,
  normalizeSerialInput,
} from './contract';
import { ApiClientError } from './errors';
import { getPreviewCredentials } from './preview-config';
import type {
  AdminKeyboxDetail,
  AdminKeyboxSummary,
  AdminKeyboxSummaryPage,
  AuditLog,
  AuditLogPage,
  CertificateMatch,
  CertificatePage,
  CRLRefresh,
  DownloadLog,
  DownloadLogPage,
  DownloadPolicy,
  GuestDownloadSetting,
  Health,
  KeyboxCreated,
  KeyboxDetail,
  KeyboxPatch,
  KeyboxSummary,
  KeyboxSummaryPage,
  LoginInput,
  LoginResult,
  Me,
  Status,
  StatusResult,
  Validation,
  ValidationRun,
  ValidationRunPage,
} from './openapi.types';

interface StoredKeyboxRecord extends AdminKeyboxDetail {
  last_validation_status: Status;
  last_validated_at: string;
  deleted: boolean;
  validation_runs: ValidationRun[];
}

let reqCounter = 1000;
export function nextRequestId(): string {
  reqCounter += 1;
  return `a1b2c3d4e5f60718293a4b5c${reqCounter.toString(16).padStart(8, '0')}`.slice(0, 32);
}

const ROOT_VERSION = 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17';
const INITIAL_CRL_VERSION = '9c4e71b208f3d41a5e6c8b90123456789abcdef0123456789abcdef012345678';

function createInitialRecords(): StoredKeyboxRecord[] {
  const kb1Id = '1f2e3d4c5b6a79880123456789abcdef';
  const kb1Validation: Validation = {
    overall_status: 'valid',
    file_sha256: '4a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
    root_set_version: ROOT_VERSION,
    crl_version: INITIAL_CRL_VERSION,
    crl_fetched_at: '2026-11-11T00:40:00Z',
    crl_expires_at: '2026-11-11T06:40:00Z',
    crl_usable: true,
    validated_at: '2026-11-11T00:45:12Z',
    errors: [],
    chains: [
      {
        index: 1,
        algorithm: 'ecdsa',
        chain_status: 'valid',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android Keystore Leaf ECDSA,O=Android,C=US',
            issuer: 'CN=TEE Intermediate ECDSA CA,O=Google LLC,C=US',
            serial_number: '1a8f09c4e2b17d33',
            fingerprint_sha256: '11223344556677889900aabbccddeeff0011223344556677889900aabbccdd01',
            not_before: '2025-01-01T00:00:00Z',
            not_after: '2032-01-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 1,
            subject: 'CN=TEE Intermediate ECDSA CA,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '4c9200ab11fe08',
            fingerprint_sha256: '223344556677889900aabbccddeeff0011223344556677889900aabbccddee02',
            not_before: '2024-06-01T00:00:00Z',
            not_after: '2034-06-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 2,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17',
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
      {
        index: 2,
        algorithm: 'rsa',
        chain_status: 'valid',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android Keystore Leaf RSA-2048,O=Android,C=US',
            issuer: 'CN=TEE Intermediate RSA CA,O=Google LLC,C=US',
            serial_number: '2b7e18d5f3c29a44',
            fingerprint_sha256: '3344556677889900aabbccddeeff0011223344556677889900aabbccddeeff03',
            not_before: '2025-01-01T00:00:00Z',
            not_after: '2032-01-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 1,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17',
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
    ],
  };

  const kb2Id = '2a3b4c5d6e7f8091a2b3c4d5e6f70819';
  const kb2Validation: Validation = {
    overall_status: 'revoked',
    file_sha256: '7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
    root_set_version: ROOT_VERSION,
    crl_version: INITIAL_CRL_VERSION,
    crl_fetched_at: '2026-11-11T00:40:00Z',
    crl_expires_at: '2026-11-11T06:40:00Z',
    crl_usable: true,
    validated_at: '2026-11-10T22:15:00Z',
    errors: [{ code: 'REVOKED', chain: 1, position: 1 }],
    chains: [
      {
        index: 1,
        algorithm: 'ecdsa',
        chain_status: 'revoked',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android Keystore Leaf B41,O=Android,C=US',
            issuer: 'CN=Revoked OEM Attestation SubCA,O=OEM Corp,C=TW',
            serial_number: '7f00deadbeef01',
            fingerprint_sha256: '44556677889900aabbccddeeff0011223344556677889900aabbccddeeff0004',
            not_before: '2024-03-01T00:00:00Z',
            not_after: '2029-03-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 1,
            subject: 'CN=Revoked OEM Attestation SubCA,O=OEM Corp,C=TW',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: 'badc0ffee0ddf00d',
            fingerprint_sha256: '556677889900aabbccddeeff0011223344556677889900aabbccddeeff001105',
            not_before: '2023-01-01T00:00:00Z',
            not_after: '2030-01-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'revoked',
            certificate_status: 'revoked',
          },
          {
            position: 2,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17',
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
    ],
  };

  const kb3Id = '3c4d5e6f708192a3b4c5d6e7f8091a2b';
  const kb3Validation: Validation = {
    overall_status: 'indeterminate',
    file_sha256: '9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f',
    root_set_version: ROOT_VERSION,
    crl_version: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    crl_fetched_at: '2026-11-08T10:00:00Z',
    crl_expires_at: '2026-11-08T16:00:00Z',
    crl_usable: false,
    validated_at: '2026-11-08T12:00:00Z',
    errors: [{ code: 'CRL_UNAVAILABLE', chain: 1, position: 0 }],
    chains: [
      {
        index: 1,
        algorithm: 'rsa',
        chain_status: 'indeterminate',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android Keystore Stale CRL Check,O=Android,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '600dcafe1234',
            fingerprint_sha256: '6677889900aabbccddeeff0011223344556677889900aabbccddeeff00112206',
            not_before: '2025-02-01T00:00:00Z',
            not_after: '2031-02-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'unknown',
            certificate_status: 'indeterminate',
          },
          {
            position: 1,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17',
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'unknown',
            certificate_status: 'indeterminate',
          },
        ],
      },
    ],
  };

  const kb4Id = '4d5e6f708192a3b4c5d6e7f8091a2b3c';
  const kb4Validation: Validation = {
    overall_status: 'valid',
    file_sha256: 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2',
    root_set_version: ROOT_VERSION,
    crl_version: INITIAL_CRL_VERSION,
    crl_fetched_at: '2026-11-11T00:40:00Z',
    crl_expires_at: '2026-11-11T06:40:00Z',
    crl_usable: true,
    validated_at: '2026-11-11T00:50:00Z',
    errors: [],
    chains: [
      {
        index: 1,
        algorithm: 'ecdsa',
        chain_status: 'valid',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android StrongBox Denied Policy Leaf,O=Android,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '88aa77bb66cc55dd',
            fingerprint_sha256: '77889900aabbccddeeff0011223344556677889900aabbccddeeff0011223307',
            not_before: '2025-05-01T00:00:00Z',
            not_after: '2035-05-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 1,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17',
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
    ],
  };

  const kb5Id = '5e6f708192a3b4c5d6e7f8091a2b3c4d';
  const kb5Validation: Validation = {
    overall_status: 'expired',
    file_sha256: 'c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
    root_set_version: ROOT_VERSION,
    crl_version: INITIAL_CRL_VERSION,
    crl_fetched_at: '2026-11-11T00:40:00Z',
    crl_expires_at: '2026-11-11T06:40:00Z',
    crl_usable: true,
    validated_at: '2026-11-09T18:20:00Z',
    errors: [{ code: 'EXPIRED', chain: 1, position: 0 }],
    chains: [
      {
        index: 1,
        algorithm: 'rsa',
        chain_status: 'expired',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Legacy Keymaster 3.0 Expired Leaf,O=Android,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '3311ff00aa22',
            fingerprint_sha256: '889900aabbccddeeff0011223344556677889900aabbccddeeff001122334408',
            not_before: '2020-01-01T00:00:00Z',
            not_after: '2025-12-31T23:59:59Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: false,
            crl_status: 'not_revoked',
            certificate_status: 'expired',
          },
          {
            position: 1,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: 'add931656106e4f32dcfc29aca0d36cb71dc37f9c68ae4803314762a64ef6f17',
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
    ],
  };

  return [
    {
      ...kb1Validation,
      id: kb1Id,
      created_at: '2026-11-11T00:45:12Z',
      status_checked_at: '2026-11-11T01:05:00Z',
      last_validation_status: 'valid',
      last_validated_at: '2026-11-11T00:45:12Z',
      guest_download_enabled: false,
      guest_download_policy: 'allowed',
      guest_downloadable_effective: false,
      visibility: 'public',
      admin_note: 'Pixel 9 Pro TEE 双算法证书链样本（单条策略为 allowed，受全局开关控制）',
      deleted: false,
      validation_runs: [
        {
          id: 'run0123456789abcdef0123456789ab01',
          keybox_id: kb1Id,
          input_sha256: kb1Validation.file_sha256,
          overall_status: 'valid',
          root_set_version: ROOT_VERSION,
          crl_version: INITIAL_CRL_VERSION,
          created_at: '2026-11-11T00:45:12Z',
          validation: kb1Validation,
        },
      ],
    },
    {
      ...kb4Validation,
      id: kb4Id,
      created_at: '2026-11-11T00:50:00Z',
      status_checked_at: '2026-11-11T01:05:00Z',
      last_validation_status: 'valid',
      last_validated_at: '2026-11-11T00:50:00Z',
      guest_download_enabled: false,
      guest_download_policy: 'denied',
      guest_downloadable_effective: false,
      visibility: 'public',
      admin_note: '高保密 StrongBox 样本（单条策略显式设置为 denied，即使全局开启也禁止游客下载）',
      deleted: false,
      validation_runs: [
        {
          id: 'run0123456789abcdef0123456789ab04',
          keybox_id: kb4Id,
          input_sha256: kb4Validation.file_sha256,
          overall_status: 'valid',
          root_set_version: ROOT_VERSION,
          crl_version: INITIAL_CRL_VERSION,
          created_at: '2026-11-11T00:50:00Z',
          validation: kb4Validation,
        },
      ],
    },
    {
      ...kb2Validation,
      id: kb2Id,
      created_at: '2026-11-10T20:10:00Z',
      status_checked_at: '2026-11-11T01:05:00Z',
      last_validation_status: 'revoked',
      last_validated_at: '2026-11-10T22:15:00Z',
      guest_download_enabled: false,
      guest_download_policy: 'inherit',
      guest_downloadable_effective: false,
      visibility: 'public',
      admin_note: '中间 CA 已被 Google 状态表标记为 REVOKED',
      deleted: false,
      validation_runs: [
        {
          id: 'run0123456789abcdef0123456789ab02',
          keybox_id: kb2Id,
          input_sha256: kb2Validation.file_sha256,
          overall_status: 'revoked',
          root_set_version: ROOT_VERSION,
          crl_version: INITIAL_CRL_VERSION,
          created_at: '2026-11-10T22:15:00Z',
          validation: kb2Validation,
        },
      ],
    },
    {
      ...kb3Validation,
      id: kb3Id,
      created_at: '2026-11-08T12:00:00Z',
      status_checked_at: '2026-11-11T01:05:00Z',
      last_validation_status: 'valid',
      last_validated_at: '2026-11-08T12:00:00Z',
      guest_download_enabled: false,
      guest_download_policy: 'inherit',
      guest_downloadable_effective: false,
      visibility: 'public',
      admin_note: '历史校验 valid，因快照版本变化投影为 indeterminate，等待重新校验',
      deleted: false,
      validation_runs: [
        {
          id: 'run0123456789abcdef0123456789ab03',
          keybox_id: kb3Id,
          input_sha256: kb3Validation.file_sha256,
          overall_status: 'indeterminate',
          root_set_version: ROOT_VERSION,
          crl_version: kb3Validation.crl_version,
          created_at: '2026-11-08T12:00:00Z',
          validation: kb3Validation,
        },
      ],
    },
    {
      ...kb5Validation,
      id: kb5Id,
      created_at: '2026-11-09T18:20:00Z',
      status_checked_at: '2026-11-11T01:05:00Z',
      last_validation_status: 'expired',
      last_validated_at: '2026-11-09T18:20:00Z',
      guest_download_enabled: false,
      guest_download_policy: 'inherit',
      guest_downloadable_effective: false,
      visibility: 'hidden',
      admin_note: '已过期且已由管理员下架隐藏（hidden），仅在管理后台列表中可见',
      deleted: false,
      validation_runs: [
        {
          id: 'run0123456789abcdef0123456789ab05',
          keybox_id: kb5Id,
          input_sha256: kb5Validation.file_sha256,
          overall_status: 'expired',
          root_set_version: ROOT_VERSION,
          crl_version: INITIAL_CRL_VERSION,
          created_at: '2026-11-09T18:20:00Z',
          validation: kb5Validation,
        },
      ],
    },
  ];
}

interface MockState {
  globalGuestDownloadEnabled: boolean;
  adminSession: {
    id: string;
    username: string;
    csrf_token: string;
    expires_at: string;
  } | null;
  crl: {
    version: string;
    fetched_at: string;
    expires_at: string;
    expired: boolean;
    usable: boolean;
  };
  records: StoredKeyboxRecord[];
  auditLogs: AuditLog[];
  downloadLogs: DownloadLog[];
}

function createDefaultMockState(): MockState {
  return {
    globalGuestDownloadEnabled: false,
    adminSession: null,
    crl: {
      version: INITIAL_CRL_VERSION,
      fetched_at: '2026-11-11T00:40:00Z',
      expires_at: '2026-11-11T06:40:00Z',
      expired: false,
      usable: true,
    },
    records: createInitialRecords(),
    auditLogs: [
      {
        id: 'aud0123456789abcdef0123456789a01',
        admin_id: 'adm0123456789abcdef0123456789a00',
        action: 'guest_download_setting_update',
        target_type: 'setting',
        target_id: 'guest_download_enabled',
        ip_hash: 'hmac_ip_89af01234567cdef',
        user_agent_hash: 'hmac_ua_71bc9023e4f5a612',
        result: 'success',
        request_id: 'req0123456789abcdef0123456789a01',
        created_at: '2026-11-11T00:15:00Z',
      },
      {
        id: 'aud0123456789abcdef0123456789a02',
        admin_id: 'adm0123456789abcdef0123456789a00',
        action: 'keybox_download_policy_update',
        target_type: 'keybox',
        target_id: '4d5e6f708192a3b4c5d6e7f8091a2b3c',
        ip_hash: 'hmac_ip_89af01234567cdef',
        user_agent_hash: 'hmac_ua_71bc9023e4f5a612',
        result: 'success',
        request_id: 'req0123456789abcdef0123456789a02',
        created_at: '2026-11-11T00:51:00Z',
      },
      {
        id: 'aud0123456789abcdef0123456789a03',
        admin_id: 'adm0123456789abcdef0123456789a00',
        action: 'keybox_download',
        target_type: 'keybox',
        target_id: '1f2e3d4c5b6a79880123456789abcdef',
        ip_hash: 'hmac_ip_89af01234567cdef',
        user_agent_hash: 'hmac_ua_71bc9023e4f5a612',
        result: 'authorized',
        request_id: 'req0123456789abcdef0123456789a03',
        created_at: '2026-11-11T00:55:00Z',
      },
      {
        id: 'aud0123456789abcdef0123456789a04',
        admin_id: null,
        action: 'crl_refresh',
        target_type: 'crl',
        target_id: INITIAL_CRL_VERSION,
        ip_hash: '',
        user_agent_hash: '',
        result: 'success',
        request_id: 'req0123456789abcdef0123456789a04',
        created_at: '2026-11-11T00:40:00Z',
      },
    ],
    downloadLogs: [
      {
        id: 'dl00123456789abcdef0123456789a01',
        keybox_id: '1f2e3d4c5b6a79880123456789abcdef',
        actor_type: 'admin',
        admin_id: 'adm0123456789abcdef0123456789a00',
        ip_hash: 'hmac_ip_89af01234567cdef',
        user_agent_hash: 'hmac_ua_71bc9023e4f5a612',
        result: 'completed',
        request_id: 'req0123456789abcdef0123456789a03',
        created_at: '2026-11-11T00:55:01Z',
      },
      {
        id: 'dl00123456789abcdef0123456789a02',
        keybox_id: '1f2e3d4c5b6a79880123456789abcdef',
        actor_type: 'guest',
        admin_id: null,
        ip_hash: 'hmac_ip_31fa9812bc047711',
        user_agent_hash: 'hmac_ua_99ef0123456789ab',
        result: 'denied',
        request_id: 'req0123456789abcdef0123456789a09',
        created_at: '2026-11-11T01:02:10Z',
      },
    ],
  };
}

let state: MockState = createDefaultMockState();

/**
 * Computes effective guest download availability strictly following docs/design.md Section 6:
 * effective = global_enabled && policy in {inherit, allowed} && visibility == public && deleted_at == NULL
 */
function syncDerivedDownloadFlags() {
  for (const r of state.records) {
    r.guest_download_enabled = state.globalGuestDownloadEnabled;
    r.guest_downloadable_effective =
      state.globalGuestDownloadEnabled &&
      (r.guest_download_policy === 'inherit' || r.guest_download_policy === 'allowed') &&
      r.visibility === 'public' &&
      !r.deleted;
  }
}

syncDerivedDownloadFlags();

export function resetMockState(options?: {
  globalGuestDownloadEnabled?: boolean;
  authenticated?: boolean;
}) {
  state = createDefaultMockState();
  if (typeof options?.globalGuestDownloadEnabled === 'boolean') {
    state.globalGuestDownloadEnabled = options.globalGuestDownloadEnabled;
  }
  if (options?.authenticated) {
    state.adminSession = {
      id: 'adm0123456789abcdef0123456789a00',
      username: 'secops_admin',
      csrf_token: 'c5f0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab',
      expires_at: '2026-11-11T09:16:00Z',
    };
  }
  syncDerivedDownloadFlags();
}

export function setMockRecordPolicy(id: string, policy: DownloadPolicy) {
  const rec = state.records.find((r) => r.id === id);
  if (rec) {
    rec.guest_download_policy = policy;
    syncDerivedDownloadFlags();
  }
}

export function setMockGlobalGuestDownload(enabled: boolean) {
  state.globalGuestDownloadEnabled = enabled;
  syncDerivedDownloadFlags();
}

function appendAudit(action: string, targetType: string, targetId: string | null, result: string) {
  const reqId = nextRequestId();
  state.auditLogs.unshift({
    id: nextRequestId(),
    admin_id: state.adminSession?.id ?? null,
    action,
    target_type: targetType,
    target_id: targetId,
    ip_hash: 'hmac_ip_89af01234567cdef',
    user_agent_hash: 'hmac_ua_71bc9023e4f5a612',
    result,
    request_id: reqId,
    created_at: new Date().toISOString(),
  });
}

function appendDownloadLog(
  keyboxId: string | null,
  actorType: 'guest' | 'admin',
  result: string,
) {
  const reqId = nextRequestId();
  state.downloadLogs.unshift({
    id: nextRequestId(),
    keybox_id: keyboxId,
    actor_type: actorType,
    admin_id: actorType === 'admin' ? (state.adminSession?.id ?? null) : null,
    ip_hash: actorType === 'admin' ? 'hmac_ip_89af01234567cdef' : 'hmac_ip_31fa9812bc047711',
    user_agent_hash: 'hmac_ua_71bc9023e4f5a612',
    result,
    request_id: reqId,
    created_at: new Date().toISOString(),
  });
}

function requireAdmin(requireCsrf: boolean, csrfHeader?: string | null) {
  if (!state.adminSession) {
    throw new ApiClientError({
      httpStatus: 401,
      code: 40101,
      serverMessage: 'unauthenticated admin session',
      requestId: nextRequestId(),
    });
  }
  if (requireCsrf && (!csrfHeader || csrfHeader !== state.adminSession.csrf_token)) {
    appendAudit('admin_request_rejected', 'request', null, 'denied');
    throw new ApiClientError({
      httpStatus: 403,
      code: 40302,
      serverMessage: 'csrf token or origin verification failed',
      requestId: nextRequestId(),
    });
  }
}

function toPublicSummary(r: StoredKeyboxRecord): KeyboxSummary {
  return {
    id: r.id,
    file_sha256: r.file_sha256,
    overall_status: r.overall_status,
    last_validation_status: r.last_validation_status,
    created_at: r.created_at,
    last_validated_at: r.last_validated_at,
    guest_downloadable_effective: r.guest_downloadable_effective,
  };
}

function toAdminSummary(r: StoredKeyboxRecord): AdminKeyboxSummary {
  return {
    ...toPublicSummary(r),
    visibility: r.visibility,
    guest_download_policy: r.guest_download_policy,
  };
}

function toPublicDetail(r: StoredKeyboxRecord): KeyboxDetail {
  return {
    id: r.id,
    overall_status: r.overall_status,
    file_sha256: r.file_sha256,
    chains: r.chains,
    errors: r.errors,
    root_set_version: r.root_set_version,
    crl_version: r.crl_version,
    crl_fetched_at: r.crl_fetched_at,
    crl_expires_at: r.crl_expires_at,
    crl_usable: r.crl_usable,
    validated_at: r.validated_at,
    created_at: r.created_at,
    status_checked_at: r.status_checked_at,
    guest_download_enabled: r.guest_download_enabled,
    guest_download_policy: r.guest_download_policy,
    guest_downloadable_effective: r.guest_downloadable_effective,
  };
}

function toAdminDetail(r: StoredKeyboxRecord): AdminKeyboxDetail {
  return {
    ...toPublicDetail(r),
    visibility: r.visibility,
    admin_note: r.admin_note,
  };
}

function buildMockValidationFromFile(file: File): Validation {
  const lowerName = file.name.toLowerCase();
  const reqId = nextRequestId();

  if (!lowerName.endsWith('.xml')) {
    throw new ApiClientError({
      httpStatus: 415,
      code: 41501,
      serverMessage: 'unsupported file extension; only .xml is accepted',
      requestId: reqId,
    });
  }

  if (file.size > CONTRACT_MAX_UPLOAD_BYTES) {
    throw new ApiClientError({
      httpStatus: 413,
      code: 41301,
      serverMessage: 'uploaded file exceeds 1048576 bytes limit',
      requestId: reqId,
    });
  }

  if (lowerName.includes('rate-limit') || lowerName.includes('429')) {
    throw new ApiClientError({
      httpStatus: 429,
      code: 42901,
      serverMessage: 'rate limit exceeded for validation endpoint',
      requestId: reqId,
      retryAfterSeconds: 25,
    });
  }

  if (lowerName.includes('503') || lowerName.includes('unavailable')) {
    throw new ApiClientError({
      httpStatus: 503,
      code: 50301,
      serverMessage: 'validation dependency temporarily unavailable',
      requestId: reqId,
    });
  }

  if (lowerName.includes('malformed') || lowerName.includes('corrupt') || lowerName.includes('422')) {
    const invalidValidation: Validation = {
      overall_status: 'invalid',
      file_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      chains: [],
      errors: [{ code: 'XML_OR_KEY_INVALID' }],
      root_set_version: ROOT_VERSION,
      crl_version: state.crl.version,
      crl_fetched_at: state.crl.fetched_at,
      crl_expires_at: state.crl.expires_at,
      crl_usable: state.crl.usable,
      validated_at: new Date().toISOString(),
    };
    throw new ApiClientError({
      httpStatus: 422,
      code: 42201,
      serverMessage: 'failed to parse AndroidAttestation XML or key material',
      requestId: reqId,
      validationData: invalidValidation,
    });
  }

  if (lowerName.includes('revoked')) {
    return {
      overall_status: 'revoked',
      file_sha256: 'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100',
      root_set_version: ROOT_VERSION,
      crl_version: state.crl.version,
      crl_fetched_at: state.crl.fetched_at,
      crl_expires_at: state.crl.expires_at,
      crl_usable: true,
      validated_at: new Date().toISOString(),
      errors: [
        { code: 'REVOKED', chain: 1, position: 0 },
        { code: 'UNTRUSTED_ROOT', chain: 2, position: 1 },
      ],
      chains: [
        {
          index: 1,
          algorithm: 'ecdsa',
          chain_status: 'revoked',
          private_key_valid: true,
          certificates: [
            {
              position: 0,
              subject: 'CN=Android Keystore Leaf (Revoked Sample),O=Android,C=US',
              issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
              serial_number: 'dead009911aa',
              fingerprint_sha256:
                '9900aabbccddeeff0011223344556677889900aabbccddeeff00112233445509',
              not_before: '2024-01-01T00:00:00Z',
              not_after: '2030-01-01T00:00:00Z',
              is_root: false,
              root_trusted: true,
              chain_signature_valid: true,
              time_valid: true,
              crl_status: 'revoked',
              certificate_status: 'revoked',
            },
            {
              position: 1,
              subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
              issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
              serial_number: '99ef01a2b3c4d5',
              fingerprint_sha256: ROOT_VERSION,
              not_before: '2024-01-01T00:00:00Z',
              not_after: '2044-01-01T00:00:00Z',
              is_root: true,
              root_trusted: true,
              chain_signature_valid: true,
              time_valid: true,
              crl_status: 'not_revoked',
              certificate_status: 'valid',
            },
          ],
        },
        {
          index: 2,
          algorithm: 'rsa',
          chain_status: 'untrusted_root',
          private_key_valid: true,
          certificates: [
            {
              position: 0,
              subject: 'CN=Android Keystore RSA Leaf,O=Android,C=US',
              issuer: 'CN=Unknown Test Root CA,O=Debug,C=US',
              serial_number: 'ab12cd34ef56',
              fingerprint_sha256:
                'aa00aabbccddeeff0011223344556677889900aabbccddeeff00112233445510',
              not_before: '2024-01-01T00:00:00Z',
              not_after: '2030-01-01T00:00:00Z',
              is_root: false,
              root_trusted: false,
              chain_signature_valid: true,
              time_valid: true,
              crl_status: 'not_revoked',
              certificate_status: 'untrusted_root',
            },
            {
              position: 1,
              subject: 'CN=Unknown Test Root CA,O=Debug,C=US',
              issuer: 'CN=Unknown Test Root CA,O=Debug,C=US',
              serial_number: 'ff00ff00ff01',
              fingerprint_sha256:
                'bb00aabbccddeeff0011223344556677889900aabbccddeeff00112233445511',
              not_before: '2020-01-01T00:00:00Z',
              not_after: '2035-01-01T00:00:00Z',
              is_root: true,
              root_trusted: false,
              chain_signature_valid: true,
              time_valid: true,
              crl_status: 'not_revoked',
              certificate_status: 'untrusted_root',
            },
          ],
        },
      ],
    };
  }

  if (lowerName.includes('indeterminate') || lowerName.includes('unknown')) {
    return {
      overall_status: 'indeterminate',
      file_sha256: 'c0ffee00112233445566778899aabbccddeeff00112233445566778899aabbcc',
      root_set_version: ROOT_VERSION,
      crl_version: state.crl.version,
      crl_fetched_at: null,
      crl_expires_at: null,
      crl_usable: false,
      validated_at: new Date().toISOString(),
      errors: [{ code: 'CRL_UNAVAILABLE', chain: 1, position: 0 }],
      chains: [
        {
          index: 1,
          algorithm: 'ecdsa',
          chain_status: 'indeterminate',
          private_key_valid: true,
          certificates: [
            {
              position: 0,
              subject: 'CN=Android Keystore Leaf (CRL Unknown),O=Android,C=US',
              issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
              serial_number: 'cc9988776655',
              fingerprint_sha256:
                'cc00aabbccddeeff0011223344556677889900aabbccddeeff00112233445512',
              not_before: '2025-01-01T00:00:00Z',
              not_after: '2032-01-01T00:00:00Z',
              is_root: false,
              root_trusted: true,
              chain_signature_valid: true,
              time_valid: true,
              crl_status: 'unknown',
              certificate_status: 'indeterminate',
            },
            {
              position: 1,
              subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
              issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
              serial_number: '99ef01a2b3c4d5',
              fingerprint_sha256: ROOT_VERSION,
              not_before: '2024-01-01T00:00:00Z',
              not_after: '2044-01-01T00:00:00Z',
              is_root: true,
              root_trusted: true,
              chain_signature_valid: true,
              time_valid: true,
              crl_status: 'unknown',
              certificate_status: 'indeterminate',
            },
          ],
        },
      ],
    };
  }

  // Default: valid Keybox
  const deterministicHash = lowerName.includes('duplicate')
    ? state.records[0].file_sha256
    : `0123456789abcdef0123456789abcdef0123456789abcdef${Date.now().toString(16).padStart(16, '0')}`.slice(
        0,
        64,
      );

  return {
    overall_status: 'valid',
    file_sha256: deterministicHash,
    root_set_version: ROOT_VERSION,
    crl_version: state.crl.version,
    crl_fetched_at: state.crl.fetched_at,
    crl_expires_at: state.crl.expires_at,
    crl_usable: state.crl.usable,
    validated_at: new Date().toISOString(),
    errors: [],
    chains: [
      {
        index: 1,
        algorithm: 'ecdsa',
        chain_status: 'valid',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android Keystore Verified ECDSA Leaf,O=Android,C=US',
            issuer: 'CN=TEE Intermediate ECDSA CA,O=Google LLC,C=US',
            serial_number: '55aa0192837465',
            fingerprint_sha256:
              'dd00aabbccddeeff0011223344556677889900aabbccddeeff00112233445513',
            not_before: '2025-01-01T00:00:00Z',
            not_after: '2033-01-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 1,
            subject: 'CN=TEE Intermediate ECDSA CA,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '4c9200ab11fe08',
            fingerprint_sha256:
              '223344556677889900aabbccddeeff0011223344556677889900aabbccddee02',
            not_before: '2024-06-01T00:00:00Z',
            not_after: '2034-06-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 2,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: ROOT_VERSION,
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
      {
        index: 2,
        algorithm: 'rsa',
        chain_status: 'valid',
        private_key_valid: true,
        certificates: [
          {
            position: 0,
            subject: 'CN=Android Keystore Verified RSA-2048 Leaf,O=Android,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '66bb0192837465',
            fingerprint_sha256:
              'ee00aabbccddeeff0011223344556677889900aabbccddeeff00112233445514',
            not_before: '2025-01-01T00:00:00Z',
            not_after: '2033-01-01T00:00:00Z',
            is_root: false,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
          {
            position: 1,
            subject: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            issuer: 'CN=Google Hardware Attestation Root 2026,O=Google LLC,C=US',
            serial_number: '99ef01a2b3c4d5',
            fingerprint_sha256: ROOT_VERSION,
            not_before: '2024-01-01T00:00:00Z',
            not_after: '2044-01-01T00:00:00Z',
            is_root: true,
            root_trusted: true,
            chain_signature_valid: true,
            time_valid: true,
            crl_status: 'not_revoked',
            certificate_status: 'valid',
          },
        ],
      },
    ],
  };
}

export const mockApi = {
  async validateKeybox(file: File): Promise<{ data: Validation; requestId: string }> {
    const validation = buildMockValidationFromFile(file);
    return { data: validation, requestId: nextRequestId() };
  },

  async uploadKeybox(file: File): Promise<{ data: KeyboxCreated; requestId: string }> {
    const reqId = nextRequestId();
    const lowerName = file.name.toLowerCase();
    const validation = buildMockValidationFromFile(file);

    if (validation.overall_status !== 'valid') {
      throw new ApiClientError({
        httpStatus: 422,
        code: 42202,
        serverMessage: 'validation overall_status is not valid',
        requestId: reqId,
        validationData: validation,
      });
    }

    if (
      lowerName.includes('duplicate') ||
      lowerName.includes('409') ||
      state.records.some((r) => r.file_sha256 === validation.file_sha256)
    ) {
      throw new ApiClientError({
        httpStatus: 409,
        code: 40901,
        serverMessage: 'duplicate keybox',
        requestId: reqId,
      });
    }

    const now = new Date().toISOString();
    const newId = `8f9e0d1c2b3a495867768594${Date.now().toString(16).slice(-8)}`.slice(0, 32);
    const newRecord: StoredKeyboxRecord = {
      ...validation,
      id: newId,
      created_at: now,
      status_checked_at: now,
      last_validation_status: 'valid',
      last_validated_at: now,
      guest_download_enabled: state.globalGuestDownloadEnabled,
      guest_download_policy: 'inherit',
      guest_downloadable_effective: state.globalGuestDownloadEnabled,
      visibility: 'public',
      admin_note: '',
      deleted: false,
      validation_runs: [
        {
          id: nextRequestId(),
          keybox_id: newId,
          input_sha256: validation.file_sha256,
          overall_status: 'valid',
          root_set_version: validation.root_set_version,
          crl_version: validation.crl_version,
          created_at: now,
          validation,
        },
      ],
    };
    state.records.unshift(newRecord);
    syncDerivedDownloadFlags();
    appendAudit('keybox_upload', 'keybox', newId, 'success');

    return {
      data: {
        id: newId,
        overall_status: 'valid',
        created_at: now,
      },
      requestId: reqId,
    };
  },

  async listKeyboxes(params: {
    page?: number;
    page_size?: number;
    status?: Status;
  }): Promise<{ data: KeyboxSummaryPage; requestId: string }> {
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    if (page < 1 || page > 10000 || pageSize < 1 || pageSize > 100) {
      throw new ApiClientError({
        httpStatus: 400,
        code: 40001,
        serverMessage: 'invalid pagination parameters',
        requestId: nextRequestId(),
      });
    }
    syncDerivedDownloadFlags();
    const filtered = state.records.filter(
      (r) =>
        !r.deleted &&
        r.visibility === 'public' &&
        (!params.status || r.overall_status === params.status),
    );
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map(toPublicSummary);
    return {
      data: {
        items,
        page,
        page_size: pageSize,
        total: filtered.length,
      },
      requestId: nextRequestId(),
    };
  },

  async getKeybox(id: string): Promise<{ data: KeyboxDetail; requestId: string }> {
    if (!KEYBOX_ID_REGEX.test(id)) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: nextRequestId(),
      });
    }
    syncDerivedDownloadFlags();
    const rec = state.records.find((r) => r.id === id && !r.deleted && r.visibility === 'public');
    if (!rec) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: nextRequestId(),
      });
    }
    return { data: toPublicDetail(rec), requestId: nextRequestId() };
  },

  async getKeyboxStatus(id: string): Promise<{ data: StatusResult; requestId: string }> {
    const { data: detail, requestId } = await this.getKeybox(id);
    const checkedAt = new Date().toISOString();
    const rec = state.records.find((r) => r.id === id);
    if (rec) {
      rec.status_checked_at = checkedAt;
    }
    return {
      data: {
        id: detail.id,
        status_checked_at: checkedAt,
        validation: {
          overall_status: detail.overall_status,
          file_sha256: detail.file_sha256,
          chains: detail.chains,
          errors: detail.errors,
          root_set_version: detail.root_set_version,
          crl_version: detail.crl_version,
          crl_fetched_at: detail.crl_fetched_at,
          crl_expires_at: detail.crl_expires_at,
          crl_usable: detail.crl_usable,
          validated_at: detail.validated_at,
        },
      },
      requestId,
    };
  },

  async checkGuestDownload(id: string): Promise<{ filename: string; requestId: string }> {
    const reqId = nextRequestId();
    if (id.includes('ratelimit') || id === '42900000000000000000000000000429') {
      appendDownloadLog(id, 'guest', 'rate_limited');
      throw new ApiClientError({
        httpStatus: 429,
        code: 42901,
        serverMessage: 'guest download quota exceeded',
        requestId: reqId,
        retryAfterSeconds: 30,
      });
    }
    syncDerivedDownloadFlags();
    const rec = state.records.find((r) => r.id === id && !r.deleted && r.visibility === 'public');
    if (!rec) {
      appendDownloadLog(id, 'guest', 'not_found');
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: reqId,
      });
    }
    if (!rec.guest_downloadable_effective) {
      appendDownloadLog(id, 'guest', 'denied');
      throw new ApiClientError({
        httpStatus: 403,
        code: 40301,
        serverMessage: 'guest download disabled by policy',
        requestId: reqId,
      });
    }
    appendDownloadLog(id, 'guest', 'completed');
    return { filename: `keybox-${id}.xml`, requestId: reqId };
  },

  async getCertificateStatus(params: {
    serial_number?: string;
    fingerprint_sha256?: string;
    page?: number;
    page_size?: number;
  }): Promise<{ data: CertificatePage; requestId: string }> {
    const reqId = nextRequestId();
    const hasSerial = Boolean(params.serial_number && params.serial_number.trim());
    const hasFp = Boolean(params.fingerprint_sha256 && params.fingerprint_sha256.trim());

    if ((hasSerial && hasFp) || (!hasSerial && !hasFp)) {
      throw new ApiClientError({
        httpStatus: 400,
        code: 40001,
        serverMessage: 'exactly one of serial_number or fingerprint_sha256 is required',
        requestId: reqId,
      });
    }

    let normSerial = '';
    let normFp = '';
    if (hasSerial) {
      const res = normalizeSerialInput(params.serial_number!);
      if (!res.valid) {
        throw new ApiClientError({
          httpStatus: 400,
          code: 40001,
          serverMessage: res.error ?? 'invalid serial_number format',
          requestId: reqId,
        });
      }
      normSerial = res.normalized;
    } else {
      const res = normalizeFingerprintInput(params.fingerprint_sha256!);
      if (!res.valid) {
        throw new ApiClientError({
          httpStatus: 400,
          code: 40001,
          serverMessage: res.error ?? 'invalid fingerprint_sha256 format',
          requestId: reqId,
        });
      }
      normFp = res.normalized;
    }

    const matches: CertificateMatch[] = [];
    for (const r of state.records) {
      if (r.deleted || r.visibility !== 'public') continue;
      for (const ch of r.chains) {
        for (const cert of ch.certificates) {
          if (
            (normSerial && cert.serial_number.toLowerCase() === normSerial) ||
            (normFp && cert.fingerprint_sha256.toLowerCase() === normFp)
          ) {
            matches.push({
              keybox_id: r.id,
              chain_index: ch.index,
              certificate: cert,
            });
          }
        }
      }
    }

    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const start = (page - 1) * pageSize;
    const pagedItems = matches.slice(start, start + pageSize);

    const isKnownRevokedSerial =
      normSerial === 'badc0ffee0ddf00d' || normSerial === 'dead009911aa';

    const queryCrlStatus: 'not_revoked' | 'revoked' | 'unknown' = normSerial
      ? isKnownRevokedSerial
        ? 'revoked'
        : state.crl.usable
          ? 'not_revoked'
          : 'unknown'
      : matches.length > 0
        ? matches[0].certificate.crl_status
        : 'unknown';

    const queryCertStatus: Status =
      queryCrlStatus === 'revoked' ? 'revoked' : 'indeterminate';

    return {
      data: {
        items: pagedItems,
        page,
        page_size: pageSize,
        total: matches.length,
        query: {
          serial_number: normSerial,
          fingerprint_sha256: normFp,
          crl_status: queryCrlStatus,
          certificate_status: queryCertStatus,
        },
        status_checked_at: new Date().toISOString(),
      },
      requestId: reqId,
    };
  },

  async adminLogin(input: LoginInput): Promise<{ data: LoginResult; requestId: string }> {
    const reqId = nextRequestId();
    if (!input.username || !input.password) {
      throw new ApiClientError({
        httpStatus: 400,
        code: 40001,
        serverMessage: 'username and password are required',
        requestId: reqId,
      });
    }
    if (input.username === 'ratelimit' || input.password === 'ratelimit') {
      throw new ApiClientError({
        httpStatus: 429,
        code: 42901,
        serverMessage: 'too many login attempts',
        requestId: reqId,
        retryAfterSeconds: 45,
      });
    }
    const credentials = getPreviewCredentials();
    if (!credentials || input.username.trim() !== credentials.username || input.password !== credentials.password) {
      appendAudit('admin_login', 'admin', null, 'denied');
      throw new ApiClientError({
        httpStatus: 401,
        code: 40101,
        serverMessage: 'invalid credentials or disabled administrator',
        requestId: reqId,
      });
    }
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    const csrfToken = 'c5f0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';
    const adminId = 'adm0123456789abcdef0123456789a00';
    state.adminSession = {
      id: adminId,
      username: input.username.trim(),
      csrf_token: csrfToken,
      expires_at: expiresAt,
    };
    appendAudit('admin_login', 'admin', adminId, 'success');
    return {
      data: {
        admin: {
          id: adminId,
          username: input.username.trim(),
        },
        csrf_token: csrfToken,
        expires_at: expiresAt,
      },
      requestId: reqId,
    };
  },

  async adminLogout(csrfHeader?: string | null): Promise<{ data: null; requestId: string }> {
    requireAdmin(true, csrfHeader);
    const adminId = state.adminSession!.id;
    appendAudit('admin_logout', 'admin', adminId, 'success');
    state.adminSession = null;
    return { data: null, requestId: nextRequestId() };
  },

  async adminMe(): Promise<{ data: Me; requestId: string }> {
    requireAdmin(false);
    return {
      data: { ...state.adminSession! },
      requestId: nextRequestId(),
    };
  },

  async adminListKeyboxes(params: {
    page?: number;
    page_size?: number;
    status?: Status;
    guest_download_policy?: DownloadPolicy;
  }): Promise<{ data: AdminKeyboxSummaryPage; requestId: string }> {
    requireAdmin(false);
    syncDerivedDownloadFlags();
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const filtered = state.records.filter(
      (r) =>
        !r.deleted &&
        (!params.status || r.overall_status === params.status) &&
        (!params.guest_download_policy || r.guest_download_policy === params.guest_download_policy),
    );
    const start = (page - 1) * pageSize;
    return {
      data: {
        items: filtered.slice(start, start + pageSize).map(toAdminSummary),
        page,
        page_size: pageSize,
        total: filtered.length,
      },
      requestId: nextRequestId(),
    };
  },

  async adminGetKeybox(id: string): Promise<{ data: AdminKeyboxDetail; requestId: string }> {
    requireAdmin(false);
    syncDerivedDownloadFlags();
    const rec = state.records.find((r) => r.id === id && !r.deleted);
    if (!rec) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: nextRequestId(),
      });
    }
    return { data: toAdminDetail(rec), requestId: nextRequestId() };
  },

  async adminPatchKeybox(
    id: string,
    patch: KeyboxPatch,
    csrfHeader?: string | null,
  ): Promise<{ data: AdminKeyboxDetail; requestId: string }> {
    requireAdmin(true, csrfHeader);
    const reqId = nextRequestId();
    if (
      patch.visibility === undefined &&
      patch.admin_note === undefined &&
      patch.guest_download_policy === undefined
    ) {
      throw new ApiClientError({
        httpStatus: 400,
        code: 40001,
        serverMessage: 'at least one patch field is required',
        requestId: reqId,
      });
    }
    const rec = state.records.find((r) => r.id === id && !r.deleted);
    if (!rec) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: reqId,
      });
    }
    if (patch.admin_note !== undefined) {
      if (new TextEncoder().encode(patch.admin_note).length > 2000) {
        throw new ApiClientError({
          httpStatus: 400,
          code: 40001,
          serverMessage: 'admin_note exceeds 2000 UTF-8 bytes',
          requestId: reqId,
        });
      }
      rec.admin_note = patch.admin_note;
    }
    if (patch.visibility !== undefined) {
      rec.visibility = patch.visibility;
    }
    if (patch.guest_download_policy !== undefined) {
      rec.guest_download_policy = patch.guest_download_policy;
      appendAudit('keybox_download_policy_update', 'keybox', id, 'success');
    }
    if (patch.visibility !== undefined || patch.admin_note !== undefined) {
      appendAudit('keybox_update', 'keybox', id, 'success');
    }
    syncDerivedDownloadFlags();
    return { data: toAdminDetail(rec), requestId: reqId };
  },

  async adminDeleteKeybox(
    id: string,
    csrfHeader?: string | null,
  ): Promise<{ data: { id: string; deleted: true }; requestId: string }> {
    requireAdmin(true, csrfHeader);
    const reqId = nextRequestId();
    const rec = state.records.find((r) => r.id === id && !r.deleted);
    if (!rec) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found or already deleted',
        requestId: reqId,
      });
    }
    rec.deleted = true;
    syncDerivedDownloadFlags();
    appendAudit('keybox_delete', 'keybox', id, 'success');
    return { data: { id, deleted: true }, requestId: reqId };
  },

  async adminRevalidateKeybox(
    id: string,
    csrfHeader?: string | null,
  ): Promise<{ data: Validation; requestId: string }> {
    requireAdmin(true, csrfHeader);
    const reqId = nextRequestId();
    const rec = state.records.find((r) => r.id === id && !r.deleted);
    if (!rec) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: reqId,
      });
    }
    const now = new Date().toISOString();
    rec.validated_at = now;
    rec.last_validated_at = now;
    rec.status_checked_at = now;
    rec.crl_version = state.crl.version;
    rec.crl_fetched_at = state.crl.fetched_at;
    rec.crl_expires_at = state.crl.expires_at;
    rec.crl_usable = state.crl.usable;

    if (rec.overall_status === 'indeterminate' && state.crl.usable) {
      rec.overall_status = 'valid';
      rec.last_validation_status = 'valid';
      rec.errors = [];
      for (const ch of rec.chains) {
        ch.chain_status = 'valid';
        for (const c of ch.certificates) {
          c.crl_status = 'not_revoked';
          c.certificate_status = 'valid';
        }
      }
    }

    const validationSnapshot: Validation = {
      overall_status: rec.overall_status,
      file_sha256: rec.file_sha256,
      chains: rec.chains,
      errors: rec.errors,
      root_set_version: rec.root_set_version,
      crl_version: rec.crl_version,
      crl_fetched_at: rec.crl_fetched_at,
      crl_expires_at: rec.crl_expires_at,
      crl_usable: rec.crl_usable,
      validated_at: rec.validated_at,
    };

    rec.validation_runs.unshift({
      id: nextRequestId(),
      keybox_id: rec.id,
      input_sha256: rec.file_sha256,
      overall_status: rec.overall_status,
      root_set_version: rec.root_set_version,
      crl_version: rec.crl_version,
      created_at: now,
      validation: validationSnapshot,
    });

    appendAudit('keybox_revalidate', 'keybox', id, 'success');
    return { data: validationSnapshot, requestId: reqId };
  },

  async adminListValidationRuns(
    id: string,
    params: { page?: number; page_size?: number },
  ): Promise<{ data: ValidationRunPage; requestId: string }> {
    requireAdmin(false);
    const rec = state.records.find((r) => r.id === id && !r.deleted);
    if (!rec) {
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: nextRequestId(),
      });
    }
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const start = (page - 1) * pageSize;
    return {
      data: {
        items: rec.validation_runs.slice(start, start + pageSize),
        page,
        page_size: pageSize,
        total: rec.validation_runs.length,
      },
      requestId: nextRequestId(),
    };
  },

  async checkAdminDownload(id: string): Promise<{ filename: string; requestId: string }> {
    requireAdmin(false);
    const reqId = nextRequestId();
    const rec = state.records.find((r) => r.id === id && !r.deleted);
    if (!rec) {
      appendDownloadLog(id, 'admin', 'not_found');
      throw new ApiClientError({
        httpStatus: 404,
        code: 40401,
        serverMessage: 'keybox not found',
        requestId: reqId,
      });
    }
    appendAudit('keybox_download', 'keybox', id, 'authorized');
    appendDownloadLog(id, 'admin', 'completed');
    return { filename: `keybox-${id}.xml`, requestId: reqId };
  },

  async adminGetGuestDownloadSetting(): Promise<{
    data: GuestDownloadSetting;
    requestId: string;
  }> {
    requireAdmin(false);
    return {
      data: { enabled: state.globalGuestDownloadEnabled },
      requestId: nextRequestId(),
    };
  },

  async adminSetGuestDownloadSetting(
    input: GuestDownloadSetting,
    headers?: { csrfToken?: string | null; confirmHeader?: string | null },
  ): Promise<{ data: GuestDownloadSetting; requestId: string }> {
    requireAdmin(true, headers?.csrfToken);
    const reqId = nextRequestId();
    if (
      input.enabled &&
      headers?.confirmHeader !== GUEST_DOWNLOAD_CONFIRM_HEADER.value
    ) {
      appendAudit(
        'guest_download_setting_update',
        'setting',
        'guest_download_enabled',
        'confirmation_required',
      );
      throw new ApiClientError({
        httpStatus: 409,
        code: 40903,
        serverMessage: 'enabling guest download requires X-Confirm-Guest-Download header',
        requestId: reqId,
      });
    }
    state.globalGuestDownloadEnabled = input.enabled;
    syncDerivedDownloadFlags();
    appendAudit('guest_download_setting_update', 'setting', 'guest_download_enabled', 'success');
    return {
      data: { enabled: state.globalGuestDownloadEnabled },
      requestId: reqId,
    };
  },

  async adminListAuditLogs(params: {
    page?: number;
    page_size?: number;
    action?: string;
  }): Promise<{ data: AuditLogPage; requestId: string }> {
    requireAdmin(false);
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const filtered = state.auditLogs.filter(
      (log) => !params.action || log.action === params.action,
    );
    const start = (page - 1) * pageSize;
    return {
      data: {
        items: filtered.slice(start, start + pageSize),
        page,
        page_size: pageSize,
        total: filtered.length,
      },
      requestId: nextRequestId(),
    };
  },

  async adminListDownloadLogs(params: {
    page?: number;
    page_size?: number;
  }): Promise<{ data: DownloadLogPage; requestId: string }> {
    requireAdmin(false);
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const start = (page - 1) * pageSize;
    return {
      data: {
        items: state.downloadLogs.slice(start, start + pageSize),
        page,
        page_size: pageSize,
        total: state.downloadLogs.length,
      },
      requestId: nextRequestId(),
    };
  },

  async adminHealth(): Promise<{ data: Health; requestId: string }> {
    requireAdmin(false);
    const health: Health = {
      status: state.crl.usable ? 'healthy' : 'degraded',
      database: 'up',
      root_set_version: ROOT_VERSION,
      root_count: 2,
      crl: { ...state.crl },
      guest_download_enabled: state.globalGuestDownloadEnabled,
    };
    if (health.status === 'degraded') {
      throw new ApiClientError({
        httpStatus: 503,
        code: 50302,
        serverMessage: 'system health degraded: CRL expired or unusable',
        requestId: nextRequestId(),
        healthData: health,
      });
    }
    return { data: health, requestId: nextRequestId() };
  },

  async adminRefreshCRL(
    csrfHeader?: string | null,
  ): Promise<{ data: CRLRefresh; requestId: string }> {
    requireAdmin(true, csrfHeader);
    const now = new Date();
    const expires = new Date(now.getTime() + 6 * 3600 * 1000);
    const newVersion = `9c4e71b208f3d41a5e6c8b90123456789abcdef012345678${now
      .getTime()
      .toString(16)
      .padStart(16, '0')}`.slice(0, 64);
    state.crl = {
      version: newVersion,
      fetched_at: now.toISOString(),
      expires_at: expires.toISOString(),
      expired: false,
      usable: true,
    };
    appendAudit('crl_refresh', 'crl', newVersion, 'success');
    return {
      data: {
        version: state.crl.version,
        fetched_at: state.crl.fetched_at,
        expires_at: state.crl.expires_at,
        usable: state.crl.usable,
      },
      requestId: nextRequestId(),
    };
  },
};

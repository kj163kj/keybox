import type { ApiCode, Certificate, DownloadPolicy, Status } from './openapi.types';

/**
 * Default max upload size from api/openapi.json & docs/api.md: 1 MiB (1,048,576 bytes).
 * Configurable via VITE_MAX_UPLOAD_BYTES, but Per docs/design.md ("配置只能收紧"), capped at 1 MiB.
 */
const envMaxBytes = Number(import.meta.env.VITE_MAX_UPLOAD_BYTES);
export const CONTRACT_MAX_UPLOAD_BYTES = 1048576;
export const MAX_UPLOAD_BYTES =
  Number.isFinite(envMaxBytes) && envMaxBytes > 0 && envMaxBytes <= CONTRACT_MAX_UPLOAD_BYTES
    ? Math.floor(envMaxBytes)
    : CONTRACT_MAX_UPLOAD_BYTES;

export const GUEST_DOWNLOAD_CONFIRM_HEADER = {
  name: 'X-Confirm-Guest-Download',
  value: 'enable-sensitive-downloads',
} as const;

export type StatusTone = 'emerald' | 'amber' | 'rose';

export interface StatusMeta {
  value: Status;
  label: string;
  shortLabel: string;
  tone: StatusTone;
  priority: number;
  description: string;
  allowConfirmUpload: boolean;
}

/**
 * Status mapping strictly based on api/openapi.json#/components/schemas/Status
 * Priority order from docs/design.md:
 * revoked > chain_invalid > untrusted_root > expired > invalid > indeterminate > valid
 */
export const STATUS_META: Record<Status, StatusMeta> = {
  valid: {
    value: 'valid',
    label: '有效',
    shortLabel: '有效',
    tone: 'emerald',
    priority: 7,
    description: '密钥与证书链校验通过。',
    allowConfirmUpload: true,
  },
  indeterminate: {
    value: 'indeterminate',
    label: '不确定',
    shortLabel: '不确定',
    tone: 'amber',
    priority: 6,
    description: '吊销信息或信任根待更新，暂无法确认有效性。',
    allowConfirmUpload: false,
  },
  invalid: {
    value: 'invalid',
    label: '无效',
    shortLabel: '无效',
    tone: 'rose',
    priority: 5,
    description: '密钥、证书或文件校验未通过。',
    allowConfirmUpload: false,
  },
  expired: {
    value: 'expired',
    label: '已过期',
    shortLabel: '已过期',
    tone: 'rose',
    priority: 4,
    description: '证书链中存在已过期证书。',
    allowConfirmUpload: false,
  },
  untrusted_root: {
    value: 'untrusted_root',
    label: '根不受信',
    shortLabel: '根不受信',
    tone: 'rose',
    priority: 3,
    description: '根证书不在受信任的 Google 根集合中。',
    allowConfirmUpload: false,
  },
  chain_invalid: {
    value: 'chain_invalid',
    label: '证书链无效',
    shortLabel: '证书链无效',
    tone: 'rose',
    priority: 2,
    description: '证书签名或链关系校验失败。',
    allowConfirmUpload: false,
  },
  revoked: {
    value: 'revoked',
    label: '已吊销',
    shortLabel: '已吊销',
    tone: 'rose',
    priority: 1,
    description: '证书链中存在已吊销或已挂起的证书。',
    allowConfirmUpload: false,
  },
};

export const ALL_STATUS_VALUES: Status[] = [
  'valid',
  'indeterminate',
  'revoked',
  'expired',
  'untrusted_root',
  'chain_invalid',
  'invalid',
];

export type CrlStatusValue = Certificate['crl_status'];

export interface CrlStatusMeta {
  value: CrlStatusValue;
  label: string;
  shortLabel: string;
  tone: StatusTone;
  description: string;
}

/**
 * CRL status mapping from api/openapi.json#/components/schemas/Certificate/properties/crl_status
 * Rule: unknown MUST NEVER be displayed as valid.
 */
export const CRL_STATUS_META: Record<CrlStatusValue, CrlStatusMeta> = {
  not_revoked: {
    value: 'not_revoked',
    label: '未发现吊销',
    shortLabel: '未发现吊销',
    tone: 'emerald',
    description: '未发现吊销记录，仍需结合完整校验结果。',
  },
  revoked: {
    value: 'revoked',
    label: '已吊销',
    shortLabel: '已吊销',
    tone: 'rose',
    description: '证书已被吊销或挂起。',
  },
  unknown: {
    value: 'unknown',
    label: '状态未知',
    shortLabel: '状态未知',
    tone: 'amber',
    description: '暂无法确认吊销状态。',
  },
};

export interface DownloadPolicyMeta {
  value: DownloadPolicy;
  label: string;
  shortLabel: string;
  description: string;
  highRisk: boolean;
}

export const DOWNLOAD_POLICY_META: Record<DownloadPolicy, DownloadPolicyMeta> = {
  inherit: {
    value: 'inherit',
    label: '继承全局',
    shortLabel: '继承全局',
    description: '全局开启且条目公开时可下载。',
    highRisk: false,
  },
  allowed: {
    value: 'allowed',
    label: '允许下载',
    shortLabel: '允许下载',
    description: '仍需全局开启且条目公开。',
    highRisk: true,
  },
  denied: {
    value: 'denied',
    label: '禁止下载',
    shortLabel: '禁止下载',
    description: '全局开启时也不可下载。',
    highRisk: false,
  },
};

export const VISIBILITY_META: Record<
  'public' | 'hidden',
  { label: string; shortLabel: string; description: string }
> = {
  public: {
    label: '公开',
    shortLabel: '公开',
    description: '访客可查看。',
  },
  hidden: {
    label: '已下架',
    shortLabel: '已隐藏',
    description: '仅管理员可查看和下载。',
  },
};

/**
 * Stable validation problem codes documented in docs/api.md
 */
export const PROBLEM_CODE_LABELS: Record<string, string> = {
  XML_OR_KEY_INVALID: 'XML 或密钥格式错误',
  PRIVATE_KEY_MISMATCH: '私钥与证书不匹配',
  CRL_UNAVAILABLE: '吊销信息不可用',
  ROOT_SET_UNAVAILABLE: '信任根不可用',
  PATH_CONSTRAINTS_INVALID: '证书链约束校验失败',
  VALID: '校验通过',
  INVALID: '证书尚未生效或校验未通过',
  REVOKED: '证书已吊销或挂起',
  EXPIRED: '证书已过期',
  UNTRUSTED_ROOT: '根证书不受信',
  CHAIN_INVALID: '证书链校验失败',
  INDETERMINATE: '暂无法确认有效性',
};

export interface ErrorCodeMeta {
  code: ApiCode;
  httpStatus: number;
  title: string;
  description: string;
  retryable: boolean;
}

/**
 * Complete error code table from docs/api.md & api/openapi.json
 */
export const ERROR_CODE_META: Record<ApiCode, ErrorCodeMeta> = {
  0: {
    code: 0,
    httpStatus: 200,
    title: '请求成功',
    description: '请求已完成。',
    retryable: false,
  },
  40001: {
    code: 40001,
    httpStatus: 400,
    title: '输入有误',
    description: '请检查输入后重试。',
    retryable: false,
  },
  40101: {
    code: 40101,
    httpStatus: 401,
    title: '请重新登录',
    description: '请检查账号和密码；会话过期时请重新登录。',
    retryable: false,
  },
  40102: {
    code: 40102,
    httpStatus: 401,
    title: '初始化令牌错误',
    description: '请核对部署时配置的初始化令牌。',
    retryable: false,
  },
  40301: {
    code: 40301,
    httpStatus: 403,
    title: '下载未开放',
    description: '该文件暂不允许游客下载。',
    retryable: false,
  },
  40302: {
    code: 40302,
    httpStatus: 403,
    title: '安全验证失败',
    description: '请刷新页面或重新登录。',
    retryable: true,
  },
  40303: {
    code: 40303,
    httpStatus: 403,
    title: '访问来源未授权',
    description: '请从站点的正式地址访问。',
    retryable: false,
  },
  40304: {
    code: 40304,
    httpStatus: 403,
    title: '初始化未开放',
    description: '请先在服务端配置初始化令牌。',
    retryable: false,
  },
  40401: {
    code: 40401,
    httpStatus: 404,
    title: '记录不可用',
    description: '记录不存在、已下架或已删除。',
    retryable: false,
  },
  40501: {
    code: 40501,
    httpStatus: 405,
    title: '不支持此操作',
    description: '请刷新页面后重试。',
    retryable: false,
  },
  40801: {
    code: 40801,
    httpStatus: 408,
    title: '请求超时或取消',
    description: '请稍后重试。',
    retryable: true,
  },
  40901: {
    code: 40901,
    httpStatus: 409,
    title: 'Keybox 已存在',
    description:
      '文件或证书已收录，无需重复上传。',
    retryable: false,
  },
  40902: {
    code: 40902,
    httpStatus: 409,
    title: '状态已更新',
    description: '已有更新的校验结果，请刷新后重试。',
    retryable: true,
  },
  40903: {
    code: 40903,
    httpStatus: 409,
    title: '请确认下载风险',
    description:
      '确认私钥公开风险后，才能开启游客下载。',
    retryable: false,
  },
  40904: {
    code: 40904,
    httpStatus: 409,
    title: '管理员已初始化',
    description: '请使用已有账号登录。',
    retryable: false,
  },
  41301: {
    code: 41301,
    httpStatus: 413,
    title: '文件过大',
    description: '文件上限为 1 MiB。',
    retryable: false,
  },
  41501: {
    code: 41501,
    httpStatus: 415,
    title: '格式不支持',
    description: '请选择未压缩的 UTF-8 XML 文件。',
    retryable: false,
  },
  42201: {
    code: 42201,
    httpStatus: 422,
    title: '文件解析失败',
    description: '请检查 XML、密钥和证书格式。',
    retryable: false,
  },
  42202: {
    code: 42202,
    httpStatus: 422,
    title: '校验未通过',
    description: '仅有效的 Keybox 可上传，请查看校验结果。',
    retryable: false,
  },
  42901: {
    code: 42901,
    httpStatus: 429,
    title: '请求过于频繁',
    description: '请在倒计时结束后重试。',
    retryable: true,
  },
  42902: {
    code: 42902,
    httpStatus: 429,
    title: '系统繁忙',
    description: '请稍候重试。',
    retryable: true,
  },
  50001: {
    code: 50001,
    httpStatus: 500,
    title: '服务异常',
    description: '请重试；若持续出现，可提供请求 ID 联系管理员。',
    retryable: true,
  },
  50301: {
    code: 50301,
    httpStatus: 503,
    title: '服务暂不可用',
    description: '服务暂不可用，请稍后重试。',
    retryable: true,
  },
  50302: {
    code: 50302,
    httpStatus: 503,
    title: '部分服务异常',
    description: '校验服务暂不完整，结果可能不确定。',
    retryable: true,
  },
  50303: {
    code: 50303,
    httpStatus: 503,
    title: 'CRL 刷新失败',
    description: '请稍后重试，旧缓存的有效期不会延长。',
    retryable: true,
  },
};

/**
 * AuditLog action definitions from docs/design.md Section 5 & internal/store
 */
export interface AuditActionOption {
  value: string;
  label: string;
  category: 'policy' | 'download' | 'keybox' | 'auth' | 'system';
}

export const AUDIT_ACTION_OPTIONS: AuditActionOption[] = [
  {
    value: 'admin_bootstrap',
    label: '初始化管理员',
    category: 'auth',
  },
  {
    value: 'guest_download_setting_update',
    label: '全局游客下载开关变更',
    category: 'policy',
  },
  {
    value: 'keybox_download_policy_update',
    label: '单条下载策略变更',
    category: 'policy',
  },
  {
    value: 'keybox_download',
    label: '管理员下载 Keybox',
    category: 'download',
  },
  {
    value: 'keybox_revalidate',
    label: '重新校验',
    category: 'keybox',
  },
  {
    value: 'keybox_update',
    label: '修改可见性/备注',
    category: 'keybox',
  },
  {
    value: 'keybox_delete',
    label: '删除 Keybox',
    category: 'keybox',
  },
  {
    value: 'keybox_upload',
    label: '上传 Keybox',
    category: 'keybox',
  },
  {
    value: 'crl_refresh',
    label: '刷新 CRL',
    category: 'system',
  },
  {
    value: 'root_set_update',
    label: '信任根集合更新',
    category: 'system',
  },
  {
    value: 'admin_login',
    label: '管理员登录',
    category: 'auth',
  },
  {
    value: 'admin_logout',
    label: '管理员退出',
    category: 'auth',
  },
  {
    value: 'admin_write_rejected',
    label: '管理操作被拒绝',
    category: 'auth',
  },
  {
    value: 'admin_request_rejected',
    label: '安全验证失败',
    category: 'auth',
  },
];

export const KEYBOX_ID_REGEX = /^[0-9a-f]{32}$/;
export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
export const SERIAL_HEX_REGEX = /^[0-9a-f]+$/;

/**
 * Normalizes serial number input according to docs/api.md & docs/design.md:
 * "serial 永远按十六进制，统一小写、去 0x/冒号及前导零；10 是十六进制 10，不是十进制。"
 */
export function normalizeSerialInput(raw: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: '请输入证书十六进制序列号' };
  }
  const withoutPrefix = trimmed.replace(/^0x/i, '').replace(/[:\s-]/g, '').toLowerCase();
  if (!withoutPrefix || !SERIAL_HEX_REGEX.test(withoutPrefix)) {
    return {
      valid: false,
      normalized: withoutPrefix,
      error: '序列号仅支持十六进制字符，可带 0x 或冒号。',
    };
  }
  if (withoutPrefix.length > 64) {
    return {
      valid: false,
      normalized: withoutPrefix,
      error: '序列号最多 64 位。',
    };
  }
  const stripped = withoutPrefix.replace(/^0+/, '') || '0';
  return { valid: true, normalized: stripped };
}

/**
 * Normalizes SHA-256 fingerprint input according to docs/api.md & openapi.json:
 * "64 hex digits ignoring colons; mutually exclusive with serial."
 */
export function normalizeFingerprintInput(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: '请输入 64 位十六进制指纹' };
  }
  const cleaned = trimmed.replace(/[:\s-]/g, '').toLowerCase();
  if (!SHA256_HEX_REGEX.test(cleaned)) {
    return {
      valid: false,
      normalized: cleaned,
      error: '去掉冒号后，指纹须为 64 位十六进制字符。',
    };
  }
  return { valid: true, normalized: cleaned };
}

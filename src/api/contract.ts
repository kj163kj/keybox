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
    label: '有效 (Valid)',
    shortLabel: '有效',
    tone: 'emerald',
    priority: 7,
    description: 'XML 结构、私钥匹配、证书链签名、Google 信任根、有效期及当前 CRL 检查全部通过。',
    allowConfirmUpload: true,
  },
  indeterminate: {
    value: 'indeterminate',
    label: '状态不确定 (Indeterminate)',
    shortLabel: '不确定',
    tone: 'amber',
    priority: 6,
    description: 'CRL 缓存不可用/过期或根版本变更待复核，当前无法断言证书未被吊销，禁止作为有效处理。',
    allowConfirmUpload: false,
  },
  invalid: {
    value: 'invalid',
    label: '无效 (Invalid)',
    shortLabel: '无效',
    tone: 'rose',
    priority: 5,
    description: 'XML/密钥不匹配、证书尚未生效（notBefore 未来时间）或基础约束不满足。',
    allowConfirmUpload: false,
  },
  expired: {
    value: 'expired',
    label: '已过期 (Expired)',
    shortLabel: '已过期',
    tone: 'rose',
    priority: 4,
    description: '链中至少一张证书已超过 not_after 有效期边界。',
    allowConfirmUpload: false,
  },
  untrusted_root: {
    value: 'untrusted_root',
    label: '根证书不受信任 (Untrusted Root)',
    shortLabel: '根不受信',
    tone: 'rose',
    priority: 3,
    description: '链尾根证书未自签或完整 DER 指纹不在当前受控 Google Attestation 根集合中。',
    allowConfirmUpload: false,
  },
  chain_invalid: {
    value: 'chain_invalid',
    label: '链签名/路径无效 (Chain Invalid)',
    shortLabel: '链签名无效',
    tone: 'rose',
    priority: 2,
    description: '证书链上级签名校验失败、issuer/subject 不连续或 X.509 路径长度/BasicConstraints 违规。',
    allowConfirmUpload: false,
  },
  revoked: {
    value: 'revoked',
    label: '已吊销 (Revoked)',
    shortLabel: '已吊销',
    tone: 'rose',
    priority: 1,
    description: '链中至少一张证书在 Google Attestation 状态表中被标记为 REVOKED 或 SUSPENDED。',
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
    label: '未发现吊销 (not_revoked)',
    shortLabel: '未吊销',
    tone: 'emerald',
    description: '当前可用 CRL 快照中未命中该证书序列号（需结合链签名与根信任综合判定）。',
  },
  revoked: {
    value: 'revoked',
    label: '已吊销 / 挂起 (revoked)',
    shortLabel: '已吊销',
    tone: 'rose',
    description: '在 Google Attestation 状态表中命中 REVOKED 或 SUSPENDED 记录。',
  },
  unknown: {
    value: 'unknown',
    label: '状态未知 / 暂不可判定 (unknown)',
    shortLabel: '状态未知',
    tone: 'amber',
    description: 'CRL 缓存缺失、已过期或按未知指纹查询无序列号，暂不可判定吊销状态（严禁视为有效）。',
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
    label: '继承全局策略 (inherit)',
    shortLabel: '继承全局',
    description: '默认策略。仅当全局总开关开启且条目公开未删除时，游客才可下载。',
    highRisk: false,
  },
  allowed: {
    value: 'allowed',
    label: '允许游客下载 (allowed)',
    shortLabel: '允许下载',
    description: '显式允许单条下载，但仍受全局总开关约束（全局关闭时依然不可下载）。',
    highRisk: true,
  },
  denied: {
    value: 'denied',
    label: '禁止游客下载 (denied)',
    shortLabel: '禁止下载',
    description: '强制禁止游客下载。即使全局总开关开启，该 Keybox 仍拒绝游客下载。',
    highRisk: false,
  },
};

export const VISIBILITY_META: Record<
  'public' | 'hidden',
  { label: string; shortLabel: string; description: string }
> = {
  public: {
    label: '公开 (public)',
    shortLabel: '公开',
    description: '在公开列表、公开详情与证书查询结果中可见。',
  },
  hidden: {
    label: '已下架 / 隐藏 (hidden)',
    shortLabel: '已隐藏',
    description: '仅管理员可见；公开列表、公开详情、证书查询与游客下载均返回 404。',
  },
};

/**
 * Stable validation problem codes documented in docs/api.md
 */
export const PROBLEM_CODE_LABELS: Record<string, string> = {
  XML_OR_KEY_INVALID: 'XML 结构受限或密钥格式不合法（拒绝外部实体/压缩/未知节点）',
  PRIVATE_KEY_MISMATCH: '私钥与链首叶证书公钥或声明算法不匹配',
  CRL_UNAVAILABLE: 'CRL 状态表缓存不可用或已超出最大容忍过期时间',
  ROOT_SET_UNAVAILABLE: '受信任根证书集合未就绪或不可用',
  PATH_CONSTRAINTS_INVALID: '证书链路径长度、CA BasicConstraints 或关键扩展校验失败',
  VALID: '校验通过',
  INVALID: '证书尚未生效或基础有效性检查未通过',
  REVOKED: '证书已被 Google Attestation 状态表吊销或挂起',
  EXPIRED: '证书已超过有效期截止时间 (not_after)',
  UNTRUSTED_ROOT: '链尾根证书不在受控 Google 根集合内',
  CHAIN_INVALID: '证书链签名或父子 DN 链接无效',
  INDETERMINATE: '依赖状态不确定，无法给出有效结论',
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
    description: '接口请求成功，业务有效性需进一步读取 overall_status。',
    retryable: false,
  },
  40001: {
    code: 40001,
    httpStatus: 400,
    title: '请求参数或格式错误',
    description: '请求字段、JSON 结构、multipart 表单、分页范围或选择器格式不符合契约要求。',
    retryable: false,
  },
  40101: {
    code: 40101,
    httpStatus: 401,
    title: '管理员未登录或会话已失效',
    description: '未携带有效会话 Cookie、会话已满 8 小时过期/已撤销，或账号凭据错误/已停用。',
    retryable: false,
  },
  40301: {
    code: 40301,
    httpStatus: 403,
    title: '管理员未开放游客下载',
    description: '当前全局游客下载总开关处于关闭状态，或该 Keybox 单条策略设置为禁止下载 (denied)。',
    retryable: false,
  },
  40302: {
    code: 40302,
    httpStatus: 403,
    title: 'CSRF 令牌或写请求 Origin 校验失败',
    description: '管理员写操作缺少有效 X-CSRF-Token 或 Origin 校验未通过，请刷新会话后重试。',
    retryable: true,
  },
  40303: {
    code: 40303,
    httpStatus: 403,
    title: '请求 Origin 不在受控白名单',
    description: '当前访问源不在服务端精确配置的 HTTPS Origin 白名单内。',
    retryable: false,
  },
  40401: {
    code: 40401,
    httpStatus: 404,
    title: '目标不存在或不可见',
    description: '请求的 Keybox 或资源不存在、已被管理员隐藏下架，或已被软删除。',
    retryable: false,
  },
  40501: {
    code: 40501,
    httpStatus: 405,
    title: '不支持的 HTTP 方法',
    description: '当前请求路径不支持所使用的 HTTP 方法。',
    retryable: false,
  },
  40801: {
    code: 40801,
    httpStatus: 408,
    title: '请求超时或已取消',
    description: '应用上下文超时（单请求预算 15s / 校验预算 5s）或请求被主动取消。',
    retryable: true,
  },
  40901: {
    code: 40901,
    httpStatus: 409,
    title: 'Keybox 文件或证书材料已存在',
    description:
      '文件 SHA-256、证书集合摘要或链首叶证书指纹与库中已有记录（含已隐藏或软删除记录）重复。服务端出于安全防枚举策略不在 409 响应中返回已有 ID。',
    retryable: false,
  },
  40902: {
    code: 40902,
    httpStatus: 409,
    title: '再校验状态冲突',
    description: '存在更新的校验快照或文件哈希冲突，本次再校验结果未被覆盖写入。',
    retryable: true,
  },
  40903: {
    code: 40903,
    httpStatus: 409,
    title: '缺少开启敏感下载二次确认请求头',
    description:
      '开启全局游客下载必须经过二次风险确认并附带 X-Confirm-Guest-Download: enable-sensitive-downloads。',
    retryable: false,
  },
  41301: {
    code: 41301,
    httpStatus: 413,
    title: '上传文件体积超限',
    description: '上传的 .xml 文件超过 1 MiB (1,048,576 字节) 或 multipart 总请求体超限。',
    retryable: false,
  },
  41501: {
    code: 41501,
    httpStatus: 415,
    title: '不支持的文件格式或 Content-Type',
    description: '仅接受未压缩的 UTF-8 .xml Keybox 文件（或写操作标准 application/json）。',
    retryable: false,
  },
  42201: {
    code: 42201,
    httpStatus: 422,
    title: 'XML、私钥或证书编码解析失败',
    description: '文件无法按封闭 AndroidAttestation XML 结构、PEM 私钥或 X.509 证书规范解析。',
    retryable: false,
  },
  42202: {
    code: 42202,
    httpStatus: 422,
    title: '完整校验未通过，拒绝入库',
    description: '正式上传要求 overall_status 必须为 valid；当前存在吊销、过期、根不受信、链无效或 CRL 不确定。',
    retryable: false,
  },
  42901: {
    code: 42901,
    httpStatus: 429,
    title: '请求过于频繁（配额超限）',
    description: '当前 IP、账号、单 Keybox 或全局固定窗口配额已达上限，请按 Retry-After 倒计时后重试。',
    retryable: true,
  },
  42902: {
    code: 42902,
    httpStatus: 429,
    title: '系统重操作并发容量耗尽',
    description: '全局密码学校验/解密并发槽位已满，请等待 Retry-After 秒后重试。',
    retryable: true,
  },
  50001: {
    code: 50001,
    httpStatus: 500,
    title: '服务器内部异常',
    description: '服务端捕获到未预期内部异常（不回传敏感堆栈），请携带 request_id 联系运维排查。',
    retryable: true,
  },
  50301: {
    code: 50301,
    httpStatus: 503,
    title: '核心依赖服务暂不可用',
    description: '数据库、密钥保险库、加密存储或审计日志子系统暂不可用（Fail-Closed 保护已触发）。',
    retryable: true,
  },
  50302: {
    code: 50302,
    httpStatus: 503,
    title: '系统健康状态退化 (Degraded)',
    description: 'CRL 缓存已过期/不可用或数据库连接异常，校验可能返回 indeterminate。',
    retryable: true,
  },
  50303: {
    code: 50303,
    httpStatus: 503,
    title: '手动刷新上游 CRL 失败',
    description: '向 Google Attestation 上游抓取状态表失败；已保留旧缓存但不会延长过期时间。',
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
    value: 'guest_download_setting_update',
    label: '全局游客下载开关变更 (guest_download_setting_update)',
    category: 'policy',
  },
  {
    value: 'keybox_download_policy_update',
    label: '单条下载策略变更 (keybox_download_policy_update)',
    category: 'policy',
  },
  {
    value: 'keybox_download',
    label: '管理员下载 Keybox (keybox_download)',
    category: 'download',
  },
  {
    value: 'keybox_revalidate',
    label: '管理员手动重新校验 (keybox_revalidate)',
    category: 'keybox',
  },
  {
    value: 'keybox_update',
    label: '修改可见性/备注 (keybox_update)',
    category: 'keybox',
  },
  {
    value: 'keybox_delete',
    label: '软删除 Keybox (keybox_delete)',
    category: 'keybox',
  },
  {
    value: 'keybox_upload',
    label: '公开上传入库 (keybox_upload)',
    category: 'keybox',
  },
  {
    value: 'crl_refresh',
    label: 'CRL 状态表刷新 (crl_refresh)',
    category: 'system',
  },
  {
    value: 'root_set_update',
    label: '信任根集合更新 (root_set_update)',
    category: 'system',
  },
  {
    value: 'admin_login',
    label: '管理员登录 (admin_login)',
    category: 'auth',
  },
  {
    value: 'admin_logout',
    label: '管理员登出 (admin_logout)',
    category: 'auth',
  },
  {
    value: 'admin_write_rejected',
    label: '管理写操作拒绝 (admin_write_rejected)',
    category: 'auth',
  },
  {
    value: 'admin_request_rejected',
    label: 'CSRF/Origin 校验拒绝 (admin_request_rejected)',
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
      error: '序列号必须为十六进制字符（0-9, a-f），支持可选 0x 前缀或冒号分隔',
    };
  }
  if (withoutPrefix.length > 64) {
    return {
      valid: false,
      normalized: withoutPrefix,
      error: '序列号长度超出规范上限（最多 64 位十六进制字符）',
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
    return { valid: false, normalized: '', error: '请输入 64 位 SHA-256 十六进制指纹' };
  }
  const cleaned = trimmed.replace(/[:\s-]/g, '').toLowerCase();
  if (!SHA256_HEX_REGEX.test(cleaned)) {
    return {
      valid: false,
      normalized: cleaned,
      error: 'SHA-256 指纹去除冒号后必须恰好为 64 位十六进制字符（0-9, a-f）',
    };
  }
  return { valid: true, normalized: cleaned };
}

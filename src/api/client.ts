import { GUEST_DOWNLOAD_CONFIRM_HEADER } from './contract';
import { ApiClientError } from './errors';
import { mockApi, nextRequestId } from '@keybox-preview-api';
import { isPreviewAvailable } from './preview-config';
import {
  OPENAPI_OPERATIONS,
  type AdminKeyboxDetail,
  type AdminKeyboxSummaryPage,
  type AuditLogPage,
  type CertificatePage,
  type CRLRefresh,
  type DownloadLogPage,
  type DownloadPolicy,
  type GuestDownloadSetting,
  type Health,
  type KeyboxCreated,
  type KeyboxDetail,
  type KeyboxPatch,
  type KeyboxSummaryPage,
  type LoginInput,
  type LoginResult,
  type Me,
  type Status,
  type StatusResult,
  type Validation,
  type ValidationRunPage,
} from './openapi.types';

export interface ApiResponseWithMeta<T> {
  data: T;
  requestId: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * In-memory CSRF token holder.
 * Security requirement: NEVER store session or CSRF tokens in localStorage or sessionStorage.
 * Admin authentication uses HttpOnly Cookie `__Host-keybox_session`.
 */
let inMemoryCsrfToken: string | null = null;
let unauthorizedCallbacks: Array<() => void> = [];

export function setCsrfToken(token: string | null) {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function onUnauthorized(cb: () => void): () => void {
  unauthorizedCallbacks.push(cb);
  return () => {
    unauthorizedCallbacks = unauthorizedCallbacks.filter((item) => item !== cb);
  };
}

function notifyUnauthorized() {
  setCsrfToken(null);
  for (const cb of unauthorizedCallbacks) {
    cb();
  }
}

let useMockMode = isPreviewAvailable();

export function isMockMode(): boolean {
  return isPreviewAvailable() && useMockMode;
}

export function setApiMockMode(enabled: boolean) {
  useMockMode = isPreviewAvailable() && enabled;
}

function createMergedAbortController(
  externalSignal?: AbortSignal,
  timeoutMs = 15000,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    controller,
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

async function requestJson<T>(
  path: string,
  init: RequestInit & { requiresCsrf?: boolean; timeoutMs?: number },
): Promise<ApiResponseWithMeta<T>> {
  const { controller, cleanup } = createMergedAbortController(
    init.signal ?? undefined,
    init.timeoutMs ?? 15000,
  );

  const headers = new Headers(init.headers);
  if (init.requiresCsrf && inMemoryCsrfToken) {
    headers.set('X-CSRF-Token', inMemoryCsrfToken);
  }

  try {
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });

    const headerRequestId = response.headers.get('X-Request-ID') ?? '';
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

    const json = (await response.json()) as {
      code?: number;
      message?: string;
      data?: unknown;
      request_id?: string;
    };

    const requestId = json.request_id || headerRequestId || nextRequestId();

    if (!response.ok || (typeof json.code === 'number' && json.code !== 0)) {
      const code = typeof json.code === 'number' && json.code !== 0 ? json.code : response.status * 100 + 1;
      const err = new ApiClientError({
        httpStatus: response.status,
        code,
        serverMessage: json.message ?? response.statusText ?? 'request failed',
        requestId,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
        validationData:
          response.status === 422 && json.data && typeof json.data === 'object'
            ? (json.data as Validation)
            : null,
        healthData:
          response.status === 503 && json.code === 50302 && json.data && typeof json.data === 'object'
            ? (json.data as Health)
            : null,
      });
      if (err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }

    return {
      data: json.data as T,
      requestId,
    };
  } catch (err) {
    if (err instanceof ApiClientError) {
      if (err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new ApiClientError({
        httpStatus: 408,
        code: 40801,
        serverMessage: err.name === 'TimeoutError' ? '请求超时' : '请求已取消',
        requestId: nextRequestId(),
      });
    }
    throw err;
  } finally {
    cleanup();
  }
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      search.set(k, String(v));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function triggerBrowserAnchorDownload(href: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export const apiClient = {
  async validateKeybox(
    file: File,
    options?: RequestOptions,
  ): Promise<ApiResponseWithMeta<Validation>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      if (options?.signal?.aborted) {
        throw new ApiClientError({
          httpStatus: 408,
          code: 40801,
          serverMessage: '请求已取消',
          requestId: nextRequestId(),
        });
      }
      return mockApi.validateKeybox(file);
    }
    const form = new FormData();
    form.append('file', file);
    return requestJson<Validation>(OPENAPI_OPERATIONS.validateKeybox.path, {
      method: OPENAPI_OPERATIONS.validateKeybox.method,
      body: form,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
  },

  async uploadKeybox(
    file: File,
    options?: RequestOptions,
  ): Promise<ApiResponseWithMeta<KeyboxCreated>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      if (options?.signal?.aborted) {
        throw new ApiClientError({
          httpStatus: 408,
          code: 40801,
          serverMessage: '请求已取消',
          requestId: nextRequestId(),
        });
      }
      return mockApi.uploadKeybox(file);
    }
    const form = new FormData();
    form.append('file', file);
    return requestJson<KeyboxCreated>(OPENAPI_OPERATIONS.uploadKeybox.path, {
      method: OPENAPI_OPERATIONS.uploadKeybox.method,
      body: form,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
  },

  async listKeyboxes(params: {
    page?: number;
    page_size?: number;
    status?: Status;
  }): Promise<ApiResponseWithMeta<KeyboxSummaryPage>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      return mockApi.listKeyboxes(params);
    }
    const qs = buildQueryString(params);
    return requestJson<KeyboxSummaryPage>(`${OPENAPI_OPERATIONS.listKeyboxes.path}${qs}`, {
      method: OPENAPI_OPERATIONS.listKeyboxes.method,
    });
  },

  async getKeybox(id: string): Promise<ApiResponseWithMeta<KeyboxDetail>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      return mockApi.getKeybox(id);
    }
    const path = OPENAPI_OPERATIONS.getKeybox.path.replace('{id}', encodeURIComponent(id));
    return requestJson<KeyboxDetail>(path, {
      method: OPENAPI_OPERATIONS.getKeybox.method,
    });
  },

  async getKeyboxStatus(id: string): Promise<ApiResponseWithMeta<StatusResult>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      return mockApi.getKeyboxStatus(id);
    }
    const path = OPENAPI_OPERATIONS.getKeyboxStatus.path.replace('{id}', encodeURIComponent(id));
    return requestJson<StatusResult>(path, {
      method: OPENAPI_OPERATIONS.getKeyboxStatus.method,
    });
  },

  /**
   * Triggers direct browser/Blob download without reading/parsing XML text or caching in memory/storage.
   * Handles 403/40301, 404/40401, 429/42901 (with Retry-After), and 503/50301 JSON error envelopes.
   */
  async downloadGuestKeybox(id: string): Promise<{ requestId: string; filename: string }> {
    const path = OPENAPI_OPERATIONS.downloadKeybox.path.replace('{id}', encodeURIComponent(id));
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      const res = await mockApi.checkGuestDownload(id);
      triggerBrowserAnchorDownload(`${path}?download=1`, res.filename);
      return res;
    }
    return executeBinaryDownload(path, `keybox-${id}.xml`);
  },

  async getCertificateStatus(params: {
    serial_number?: string;
    fingerprint_sha256?: string;
    page?: number;
    page_size?: number;
  }): Promise<ApiResponseWithMeta<CertificatePage>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      return mockApi.getCertificateStatus(params);
    }
    const qs = buildQueryString(params);
    return requestJson<CertificatePage>(`${OPENAPI_OPERATIONS.getCertificateStatus.path}${qs}`, {
      method: OPENAPI_OPERATIONS.getCertificateStatus.method,
    });
  },

  async adminLogin(input: LoginInput): Promise<ApiResponseWithMeta<LoginResult>> {
    if (__KEYBOX_PREVIEW__ && isMockMode()) {
      const res = await mockApi.adminLogin(input);
      setCsrfToken(res.data.csrf_token);
      return res;
    }
    const res = await requestJson<LoginResult>(OPENAPI_OPERATIONS.adminLogin.path, {
      method: OPENAPI_OPERATIONS.adminLogin.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    setCsrfToken(res.data.csrf_token);
    return res;
  },

  async adminLogout(): Promise<ApiResponseWithMeta<null>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        const res = await mockApi.adminLogout(inMemoryCsrfToken);
        setCsrfToken(null);
        return res;
      }
      const res = await requestJson<null>(OPENAPI_OPERATIONS.adminLogout.path, {
        method: OPENAPI_OPERATIONS.adminLogout.method,
        requiresCsrf: true,
      });
      setCsrfToken(null);
      return res;
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminMe(): Promise<ApiResponseWithMeta<Me>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        const res = await mockApi.adminMe();
        setCsrfToken(res.data.csrf_token);
        return res;
      }
      const res = await requestJson<Me>(OPENAPI_OPERATIONS.adminMe.path, {
        method: OPENAPI_OPERATIONS.adminMe.method,
      });
      setCsrfToken(res.data.csrf_token);
      return res;
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminListKeyboxes(params: {
    page?: number;
    page_size?: number;
    status?: Status;
    guest_download_policy?: DownloadPolicy;
  }): Promise<ApiResponseWithMeta<AdminKeyboxSummaryPage>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminListKeyboxes(params);
      }
      const qs = buildQueryString(params);
      return await requestJson<AdminKeyboxSummaryPage>(
        `${OPENAPI_OPERATIONS.adminListKeyboxes.path}${qs}`,
        {
          method: OPENAPI_OPERATIONS.adminListKeyboxes.method,
        },
      );
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminGetKeybox(id: string): Promise<ApiResponseWithMeta<AdminKeyboxDetail>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminGetKeybox(id);
      }
      const path = OPENAPI_OPERATIONS.adminGetKeybox.path.replace('{id}', encodeURIComponent(id));
      return await requestJson<AdminKeyboxDetail>(path, {
        method: OPENAPI_OPERATIONS.adminGetKeybox.method,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminPatchKeybox(
    id: string,
    patch: KeyboxPatch,
  ): Promise<ApiResponseWithMeta<AdminKeyboxDetail>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminPatchKeybox(id, patch, inMemoryCsrfToken);
      }
      const path = OPENAPI_OPERATIONS.adminPatchKeybox.path.replace('{id}', encodeURIComponent(id));
      return await requestJson<AdminKeyboxDetail>(path, {
        method: OPENAPI_OPERATIONS.adminPatchKeybox.method,
        requiresCsrf: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminDeleteKeybox(
    id: string,
  ): Promise<ApiResponseWithMeta<{ id: string; deleted: true }>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminDeleteKeybox(id, inMemoryCsrfToken);
      }
      const path = OPENAPI_OPERATIONS.adminDeleteKeybox.path.replace(
        '{id}',
        encodeURIComponent(id),
      );
      return await requestJson<{ id: string; deleted: true }>(path, {
        method: OPENAPI_OPERATIONS.adminDeleteKeybox.method,
        requiresCsrf: true,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminRevalidateKeybox(id: string): Promise<ApiResponseWithMeta<Validation>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminRevalidateKeybox(id, inMemoryCsrfToken);
      }
      const path = OPENAPI_OPERATIONS.adminRevalidateKeybox.path.replace(
        '{id}',
        encodeURIComponent(id),
      );
      return await requestJson<Validation>(path, {
        method: OPENAPI_OPERATIONS.adminRevalidateKeybox.method,
        requiresCsrf: true,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminListValidationRuns(
    id: string,
    params: { page?: number; page_size?: number },
  ): Promise<ApiResponseWithMeta<ValidationRunPage>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminListValidationRuns(id, params);
      }
      const path = OPENAPI_OPERATIONS.adminListValidationRuns.path.replace(
        '{id}',
        encodeURIComponent(id),
      );
      const qs = buildQueryString(params);
      return await requestJson<ValidationRunPage>(`${path}${qs}`, {
        method: OPENAPI_OPERATIONS.adminListValidationRuns.method,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async downloadAdminKeybox(id: string): Promise<{ requestId: string; filename: string }> {
    const path = OPENAPI_OPERATIONS.adminDownloadKeybox.path.replace(
      '{id}',
      encodeURIComponent(id),
    );
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        const res = await mockApi.checkAdminDownload(id);
        triggerBrowserAnchorDownload(`${path}?download=1`, res.filename);
        return res;
      }
      return await executeBinaryDownload(path, `keybox-${id}.xml`);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminGetGuestDownloadSetting(): Promise<ApiResponseWithMeta<GuestDownloadSetting>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminGetGuestDownloadSetting();
      }
      return await requestJson<GuestDownloadSetting>(
        OPENAPI_OPERATIONS.adminGetGuestDownloadSetting.path,
        {
          method: OPENAPI_OPERATIONS.adminGetGuestDownloadSetting.method,
        },
      );
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminSetGuestDownloadSetting(
    enabled: boolean,
    confirmedSensitiveDownload: boolean,
  ): Promise<ApiResponseWithMeta<GuestDownloadSetting>> {
    try {
      const confirmValue =
        enabled && confirmedSensitiveDownload ? GUEST_DOWNLOAD_CONFIRM_HEADER.value : undefined;
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminSetGuestDownloadSetting(
          { enabled },
          { csrfToken: inMemoryCsrfToken, confirmHeader: confirmValue },
        );
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (confirmValue) {
        headers[GUEST_DOWNLOAD_CONFIRM_HEADER.name] = confirmValue;
      }
      return await requestJson<GuestDownloadSetting>(
        OPENAPI_OPERATIONS.adminSetGuestDownloadSetting.path,
        {
          method: OPENAPI_OPERATIONS.adminSetGuestDownloadSetting.method,
          requiresCsrf: true,
          headers,
          body: JSON.stringify({ enabled }),
        },
      );
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminListAuditLogs(params: {
    page?: number;
    page_size?: number;
    action?: string;
  }): Promise<ApiResponseWithMeta<AuditLogPage>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminListAuditLogs(params);
      }
      const qs = buildQueryString(params);
      return await requestJson<AuditLogPage>(`${OPENAPI_OPERATIONS.adminListAuditLogs.path}${qs}`, {
        method: OPENAPI_OPERATIONS.adminListAuditLogs.method,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminListDownloadLogs(params: {
    page?: number;
    page_size?: number;
  }): Promise<ApiResponseWithMeta<DownloadLogPage>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminListDownloadLogs(params);
      }
      const qs = buildQueryString(params);
      return await requestJson<DownloadLogPage>(
        `${OPENAPI_OPERATIONS.adminListDownloadLogs.path}${qs}`,
        {
          method: OPENAPI_OPERATIONS.adminListDownloadLogs.method,
        },
      );
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminHealth(): Promise<ApiResponseWithMeta<Health>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminHealth();
      }
      return await requestJson<Health>(OPENAPI_OPERATIONS.adminHealth.path, {
        method: OPENAPI_OPERATIONS.adminHealth.method,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },

  async adminRefreshCRL(): Promise<ApiResponseWithMeta<CRLRefresh>> {
    try {
      if (__KEYBOX_PREVIEW__ && isMockMode()) {
        return await mockApi.adminRefreshCRL(inMemoryCsrfToken);
      }
      return await requestJson<CRLRefresh>(OPENAPI_OPERATIONS.adminRefreshCRL.path, {
        method: OPENAPI_OPERATIONS.adminRefreshCRL.method,
        requiresCsrf: true,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        notifyUnauthorized();
      }
      throw err;
    }
  },
};

/**
 * Executes binary stream download without reading text contents into JS string memory or storage.
 * When status >= 400, parses the JSON error envelope (e.g. 40301, 40401, 42901 + Retry-After).
 * When status == 200, streams directly into an ephemeral Blob URL and immediately revokes it.
 */
async function executeBinaryDownload(
  path: string,
  fallbackFilename: string,
): Promise<{ requestId: string; filename: string }> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });

  const requestId = response.headers.get('X-Request-ID') || nextRequestId();
  const retryAfterHeader = response.headers.get('Retry-After');
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

  if (!response.ok) {
    let code = response.status * 100 + 1;
    let message = response.statusText || 'download failed';
    let finalReqId = requestId;
    try {
      const errJson = (await response.json()) as {
        code?: number;
        message?: string;
        request_id?: string;
      };
      if (typeof errJson.code === 'number') code = errJson.code;
      if (errJson.message) message = errJson.message;
      if (errJson.request_id) finalReqId = errJson.request_id;
    } catch {
      // Fallback if proxy returned non-JSON error
    }
    const apiErr = new ApiClientError({
      httpStatus: response.status,
      code,
      serverMessage: message,
      requestId: finalReqId,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    });
    if (apiErr.isUnauthorized) {
      notifyUnauthorized();
    }
    throw apiErr;
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] || fallbackFilename;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerBrowserAnchorDownload(objectUrl, filename);
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }

  return { requestId, filename };
}

import { ERROR_CODE_META } from './contract';
import type { ApiCode, Health, Validation } from './openapi.types';

export interface ApiClientErrorInit {
  httpStatus: number;
  code: number;
  serverMessage: string;
  requestId: string;
  retryAfterSeconds?: number | null;
  validationData?: Validation | null;
  healthData?: Health | null;
}

export class ApiClientError extends Error {
  readonly httpStatus: number;
  readonly code: number;
  readonly serverMessage: string;
  readonly requestId: string;
  readonly retryAfterSeconds: number | null;
  readonly validationData: Validation | null;
  readonly healthData: Health | null;

  constructor(init: ApiClientErrorInit) {
    const meta = ERROR_CODE_META[init.code as ApiCode];
    const friendlyTitle = meta?.title ?? `请求失败 (HTTP ${init.httpStatus})`;
    super(`${friendlyTitle}: ${init.serverMessage}`);
    this.name = 'ApiClientError';
    this.httpStatus = init.httpStatus;
    this.code = init.code;
    this.serverMessage = init.serverMessage;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.validationData = init.validationData ?? null;
    this.healthData = init.healthData ?? null;
  }

  get meta() {
    return ERROR_CODE_META[this.code as ApiCode] ?? null;
  }

  get isUnauthorized(): boolean {
    return this.httpStatus === 401 || this.code === 40101;
  }

  get isForbidden(): boolean {
    return this.httpStatus === 403;
  }

  get isRateLimited(): boolean {
    return this.httpStatus === 429 || this.code === 42901 || this.code === 42902;
  }

  get isServerUnavailable(): boolean {
    return this.httpStatus >= 500;
  }
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

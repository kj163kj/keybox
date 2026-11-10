import { useEffect, useState } from 'react';
import { AlertOctagon, Clock, Copy, Check, RefreshCw } from 'lucide-react';
import { ERROR_CODE_META } from '../api/contract';
import { isApiClientError } from '../api/errors';
import type { ApiCode } from '../api/openapi.types';

export function ErrorBanner({
  error,
  onRetry,
  customTitle,
}: {
  error: unknown;
  onRetry?: () => void;
  customTitle?: string;
}) {
  const [copied, setCopied] = useState(false);
  const apiError = isApiClientError(error) ? error : null;
  const initialRetrySeconds = apiError?.retryAfterSeconds ?? 0;
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialRetrySeconds);

  useEffect(() => {
    setRemainingSeconds(apiError?.retryAfterSeconds ?? 0);
  }, [apiError?.retryAfterSeconds, apiError?.requestId]);

  useEffect(() => {
    if (remainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingSeconds]);

  if (!error) return null;

  const codeMeta = apiError ? ERROR_CODE_META[apiError.code as ApiCode] : null;
  const title =
    customTitle ??
    codeMeta?.title ??
    (apiError ? `请求失败 (HTTP ${apiError.httpStatus})` : '请求发生异常');
  const description =
    codeMeta?.description ??
    (error instanceof Error ? error.message : '未知网络或客户端错误，请稍后重试。');

  const handleCopyRequestId = async () => {
    if (!apiError?.requestId) return;
    try {
      await navigator.clipboard.writeText(apiError.requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failures in headless environments
    }
  };

  return (
    <div
      role="alert"
      data-testid="api-error-banner"
      className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-rose-950 shadow-xs"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2 font-semibold text-rose-900">
              <span>{title}</span>
              {apiError && (
                <span className="rounded bg-rose-100 px-2 py-0.5 font-mono text-xs text-rose-800">
                  HTTP {apiError.httpStatus} · code {apiError.code}
                </span>
              )}
            </div>
            <p className="text-rose-800">{description}</p>
            {apiError?.serverMessage && (
              <p className="text-xs text-rose-700">
                服务端消息 (<code className="font-mono">message</code>)：{apiError.serverMessage}
              </p>
            )}
            {apiError?.isRateLimited && (
              <div
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900"
                data-testid="retry-after-countdown"
              >
                <Clock className="h-4 w-4 text-amber-700" />
                {remainingSeconds > 0 ? (
                  <span>
                    触发服务端限流保护（Retry-After: {apiError.retryAfterSeconds}s），请等待{' '}
                    <strong className="font-mono text-sm">{remainingSeconds}</strong> 秒后再试
                  </span>
                ) : (
                  <span>限流冷却时间已结束（Retry-After 已到期），现在可以重新发起请求</span>
                )}
              </div>
            )}
            {apiError?.requestId && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-rose-700">
                <span>追踪 ID (request_id)：</span>
                <code
                  className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-rose-900"
                  data-testid="error-request-id"
                >
                  {apiError.requestId}
                </code>
                <button
                  type="button"
                  onClick={handleCopyRequestId}
                  className="btn-interactive inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2 py-0.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={remainingSeconds > 0}
            className="btn-interactive inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 shadow-2xs hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{remainingSeconds > 0 ? `${remainingSeconds}s 后可重试` : '重试请求'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

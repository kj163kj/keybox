import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Info,
  Search,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../api/client';
import {
  normalizeFingerprintInput,
  normalizeSerialInput,
} from '../api/contract';
import { ErrorBanner } from '../components/ErrorBanner';
import { PaginationBar } from '../components/PaginationBar';
import { CrlStatusBadge, StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../utils/format';

type SelectorType = 'serial' | 'fingerprint';

export function CertificateSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlType = searchParams.get('type') === 'fingerprint' ? 'fingerprint' : 'serial';
  const urlQuery = searchParams.get('q') ?? '';
  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(10000, Math.floor(rawPage)) : 1;
  const rawPageSize = Number(searchParams.get('page_size') ?? '20');
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 100
      ? Math.floor(rawPageSize)
      : 20;

  const [selectorType, setSelectorType] = useState<SelectorType>(urlType);
  const [inputValue, setInputValue] = useState<string>(urlQuery);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate the active query from URL if present
  const activeValidation = urlQuery
    ? urlType === 'serial'
      ? normalizeSerialInput(urlQuery)
      : normalizeFingerprintInput(urlQuery)
    : null;

  const canExecuteQuery = Boolean(urlQuery && activeValidation?.valid);

  const certQuery = useQuery({
    queryKey: [
      'certificate-status',
      {
        type: urlType,
        q: activeValidation?.normalized ?? '',
        page,
        page_size: pageSize,
      },
    ],
    queryFn: () =>
      apiClient.getCertificateStatus({
        serial_number: urlType === 'serial' ? activeValidation!.normalized : undefined,
        fingerprint_sha256: urlType === 'fingerprint' ? activeValidation!.normalized : undefined,
        page,
        page_size: pageSize,
      }),
    enabled: canExecuteQuery,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check =
      selectorType === 'serial'
        ? normalizeSerialInput(inputValue)
        : normalizeFingerprintInput(inputValue);

    if (!check.valid) {
      setValidationError(check.error ?? '输入格式不合法');
      return;
    }
    setValidationError(null);
    setSearchParams({
      type: selectorType,
      q: check.normalized,
      page: '1',
      page_size: String(pageSize),
    });
  };

  const applyQuickFill = (type: SelectorType, val: string) => {
    setSelectorType(type);
    setInputValue(val);
    setValidationError(null);
    setSearchParams({
      type,
      q: val,
      page: '1',
      page_size: String(pageSize),
    });
  };

  const resultPage = certQuery.data?.data;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            X.509 证书状态与吊销查询
          </h1>
          <p className="text-xs leading-relaxed text-slate-600">
            调用 <code className="font-mono">GET /api/v1/certificates/status</code>，支持按
            <strong>证书序列号 (serial_number)</strong> 或{' '}
            <strong>SHA-256 指纹 (fingerprint_sha256)</strong> 二选一查询。序列号统一按小写十六进制处理（自动剥离可选{' '}
            <code className="font-mono">0x</code>、冒号及前导零）；共享根或中间证书可能跨多个公开 Keybox 出现，接口返回完整匹配列表。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3" noValidate>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectorType('serial');
                setValidationError(null);
              }}
              data-testid="selector-serial-btn"
              className={`btn-interactive rounded-xl px-3.5 py-2 text-xs font-semibold ${
                selectorType === 'serial'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              按证书序列号查询 (serial_number)
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectorType('fingerprint');
                setValidationError(null);
              }}
              data-testid="selector-fingerprint-btn"
              className={`btn-interactive rounded-xl px-3.5 py-2 text-xs font-semibold ${
                selectorType === 'fingerprint'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              按 SHA-256 指纹查询 (fingerprint_sha256)
            </button>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder={
                selectorType === 'serial'
                  ? '输入十六进制序列号，例如 1a8f09c4e2b17d33 或 0xbadc0ffee0ddf00d'
                  : '输入 64 位 SHA-256 十六进制指纹（支持带冒号格式）'
              }
              aria-label="证书查询输入"
              data-testid="cert-search-input"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            <button
              type="submit"
              data-testid="cert-search-submit-btn"
              className="btn-interactive inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Search className="h-4 w-4" />
              <span>查询状态</span>
            </button>
          </div>

          {(validationError || (urlQuery && activeValidation && !activeValidation.valid)) && (
            <p
              role="alert"
              data-testid="cert-input-error"
              className="text-xs font-medium text-rose-600"
            >
              {validationError ?? activeValidation?.error}
            </p>
          )}

          {/* Quick examples */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
            <span>快速示例：</span>
            <button
              type="button"
              onClick={() => applyQuickFill('serial', '1a8f09c4e2b17d33')}
              className="btn-interactive rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-100"
            >
              有效叶证书序列号 (1a8f09c4e2b17d33)
            </button>
            <button
              type="button"
              onClick={() => applyQuickFill('serial', 'badc0ffee0ddf00d')}
              className="btn-interactive rounded border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-800 hover:bg-rose-100"
            >
              已吊销中间 CA 序列号 (badc0ffee0ddf00d)
            </button>
            <button
              type="button"
              onClick={() => applyQuickFill('serial', '99ef01a2b3c4d5')}
              className="btn-interactive rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-100"
            >
              跨多条链共享 Google 根序列号 (99ef01a2b3c4d5)
            </button>
            <button
              type="button"
              onClick={() => applyQuickFill('serial', 'deadbeef99999999')}
              className="btn-interactive rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-100"
            >
              站内不存在序列号 (deadbeef99999999)
            </button>
          </div>
        </form>
      </section>

      {certQuery.error && (
        <ErrorBanner error={certQuery.error} onRetry={() => void certQuery.refetch()} />
      )}

      {certQuery.isLoading && (
        <div className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white p-6" />
      )}

      {resultPage && (
        <div className="space-y-4">
          {/* Query-level CRL & status summary from CertificatePage.query */}
          <section
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
            data-testid="cert-query-summary"
          >
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3.5 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">查询层 CRL 与状态摘要 (query)</h2>
                <CrlStatusBadge crlStatus={resultPage.query.crl_status} />
                <StatusBadge status={resultPage.query.certificate_status} size="sm" showCode />
              </div>
              <span className="text-xs text-slate-500">
                检查时间 (status_checked_at)：{formatDateTime(resultPage.status_checked_at)}
              </span>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/80 p-3 text-xs text-amber-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>
                <strong>契约安全提示（docs/api.md）：</strong>按序列号查询可直接检索 CRL 状态表，但{' '}
                <code className="font-mono">query</code> 层仅能断定{' '}
                <code className="font-mono">revoked</code>，未命中吊销时{' '}
                <code className="font-mono">query.certificate_status</code> 固定为{' '}
                <code className="font-mono">indeterminate</code>
                ——绝不能把“未查到撤销”直接当成证书有效；完整有效性必须结合下方站内匹配记录的证书链上下文判定。
              </span>
            </div>
          </section>

          {/* Matches list or Empty state */}
          {resultPage.items.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
              data-testid="cert-search-empty"
            >
              <FileSearch className="mx-auto h-8 w-8 text-slate-400" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900">
                未找到站内公开 Keybox 匹配的证书记录 (items = [], total = 0)
              </h3>
              <p className="mx-auto mt-1 max-w-xl text-xs text-slate-500">
                站内公开未删除的 Keybox 中不包含该证书。注意：即使上方 CRL 状态显示为{' '}
                <code className="font-mono">{resultPage.query.crl_status}</code>
                ，缺少完整证书链、签名与信任根上下文时，状态仍为{' '}
                <code className="font-mono">{resultPage.query.certificate_status}</code>（不确定/不可判定为有效）。
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="cert-match-list">
              {resultPage.items.map((match, idx) => {
                const cert = match.certificate;
                return (
                  <div
                    key={`${match.keybox_id}-${match.chain_index}-${cert.position}-${idx}`}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
                    data-testid={`cert-match-card-${idx}`}
                  >
                    <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold text-white">
                          链 #{match.chain_index} · 位置 #{cert.position}
                        </span>
                        <StatusBadge status={cert.certificate_status} showCode />
                        <CrlStatusBadge crlStatus={cert.crl_status} />
                      </div>
                      <Link
                        to={`/keyboxes/${match.keybox_id}`}
                        className="btn-interactive inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100"
                      >
                        <span>所属 Keybox: {match.keybox_id.slice(0, 12)}…</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    <div className="mt-3.5 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <span className="text-slate-500">所属 Keybox ID (keybox_id)</span>
                        <p className="mt-0.5 break-all font-mono font-semibold text-slate-900">
                          {match.keybox_id}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">序列号 (serial_number)</span>
                        <p className="mt-0.5 break-all font-mono text-slate-900">
                          {cert.serial_number}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">SHA-256 指纹 (fingerprint_sha256)</span>
                        <p className="mt-0.5 break-all font-mono text-slate-900">
                          {cert.fingerprint_sha256}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">主体 DN (subject)</span>
                        <p className="mt-0.5 break-all font-mono text-slate-800">{cert.subject}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">颁发者 DN (issuer)</span>
                        <p className="mt-0.5 break-all font-mono text-slate-800">{cert.issuer}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">有效期 (not_before ~ not_after)</span>
                        <p className="mt-0.5 font-mono text-slate-800">
                          {formatDateTime(cert.not_before)} 至 {formatDateTime(cert.not_after)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                          cert.root_trusted
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}
                      >
                        {cert.root_trusted ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        <span>根信任 (root_trusted): {String(cert.root_trusted)}</span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                          cert.chain_signature_valid
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}
                      >
                        {cert.chain_signature_valid ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        <span>链签名有效 (chain_signature_valid): {String(cert.chain_signature_valid)}</span>
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                          cert.time_valid
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}
                      >
                        {cert.time_valid ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        <span>在有效期内 (time_valid): {String(cert.time_valid)}</span>
                      </span>
                    </div>
                  </div>
                );
              })}

              <PaginationBar
                page={resultPage.page}
                pageSize={resultPage.page_size}
                total={resultPage.total}
                onPageChange={(nextPage) =>
                  setSearchParams({
                    type: urlType,
                    q: urlQuery,
                    page: String(nextPage),
                    page_size: String(pageSize),
                  })
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

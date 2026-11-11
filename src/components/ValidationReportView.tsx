import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Shield,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { PROBLEM_CODE_LABELS, STATUS_META } from '../api/contract';
import type { Certificate, Chain, Validation } from '../api/openapi.types';
import { formatDateTime } from '../utils/format';
import { CrlStatusBadge, StatusBadge } from './StatusBadge';

function isCertificateAbnormal(cert: Certificate): boolean {
  return (
    cert.certificate_status !== 'valid' ||
    cert.crl_status !== 'not_revoked' ||
    !cert.root_trusted ||
    !cert.chain_signature_valid ||
    !cert.time_valid
  );
}

function isChainAbnormal(chain: Chain): boolean {
  return (
    chain.chain_status !== 'valid' ||
    !chain.private_key_valid ||
    chain.certificates.some(isCertificateAbnormal)
  );
}

export function ValidationReportView({
  validation,
  title = '校验结果',
  expandAllByDefault = false,
}: {
  validation: Validation;
  title?: string;
  expandAllByDefault?: boolean;
}) {
  const [expandedChains, setExpandedChains] = useState<Record<number, boolean>>(() => {
    const map: Record<number, boolean> = {};
    for (const ch of validation.chains) {
      map[ch.index] = expandAllByDefault || isChainAbnormal(ch) || validation.chains.length <= 2;
    }
    return map;
  });

  const [expandedCerts, setExpandedCerts] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const ch of validation.chains) {
      for (const cert of ch.certificates) {
        const key = `${ch.index}-${cert.position}`;
        map[key] = expandAllByDefault || isCertificateAbnormal(cert);
      }
    }
    return map;
  });

  const toggleChain = (index: number) => {
    setExpandedChains((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleCert = (chainIndex: number, position: number) => {
    const key = `${chainIndex}-${position}`;
    setExpandedCerts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAllExpanded = (open: boolean) => {
    const nextChains: Record<number, boolean> = {};
    const nextCerts: Record<string, boolean> = {};
    for (const ch of validation.chains) {
      nextChains[ch.index] = open;
      for (const cert of ch.certificates) {
        nextCerts[`${ch.index}-${cert.position}`] = open;
      }
    }
    setExpandedChains(nextChains);
    setExpandedCerts(nextCerts);
  };

  const overallMeta = STATUS_META[validation.overall_status];

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <StatusBadge status={validation.overall_status} size="lg" showCode />
          </div>
          <p className="text-xs text-slate-600">{overallMeta?.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAllExpanded(true)}
            className="btn-interactive rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            展开全部
          </button>
          <button
            type="button"
            onClick={() => setAllExpanded(false)}
            className="btn-interactive rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            收起全部
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-slate-500">文件 SHA-256</span>
          <p className="mt-0.5 break-all font-mono text-slate-800">{validation.file_sha256}</p>
        </div>
        <div>
          <span className="text-slate-500">校验时间</span>
          <p className="mt-0.5 font-medium text-slate-800">
            {formatDateTime(validation.validated_at)}
          </p>
        </div>
        <div>
          <span className="text-slate-500">CRL 状态</span>
          <div className="mt-0.5 flex items-center gap-1.5">
            {validation.crl_usable ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                可用
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                不可用
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            获取：{formatDateTime(validation.crl_fetched_at)} / 过期：
            {formatDateTime(validation.crl_expires_at)}
          </p>
        </div>
        <div>
          <span className="text-slate-500">校验版本</span>
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-700" title={validation.root_set_version}>
            Root: {validation.root_set_version.slice(0, 16)}…
          </p>
          <p className="truncate font-mono text-[11px] text-slate-700" title={validation.crl_version}>
            CRL: {validation.crl_version ? `${validation.crl_version.slice(0, 16)}…` : '—'}
          </p>
        </div>
      </div>

      {validation.errors.length > 0 && (
        <div
          className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5"
          data-testid="validation-problems-list"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-900">
            <ShieldAlert className="h-4 w-4 text-rose-600" />
            <span>发现 {validation.errors.length} 项问题</span>
          </div>
          <ul className="mt-2 space-y-1.5 text-xs text-rose-900">
            {validation.errors.map((prob, idx) => (
              <li
                key={`${prob.code}-${prob.chain ?? 'g'}-${prob.position ?? 'g'}-${idx}`}
                className="flex flex-wrap items-center gap-2"
              >
                <code className="rounded bg-rose-100 px-1.5 py-0.5 font-mono font-semibold text-rose-900">
                  {prob.code}
                </code>
                {prob.chain !== undefined && (
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                    链 #{prob.chain}
                  </span>
                )}
                {prob.position !== undefined && (
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                    证书 #{prob.position}
                  </span>
                )}
                <span className="text-rose-800">
                  {PROBLEM_CODE_LABELS[prob.code] ?? '校验异常'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {validation.chains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          未解析出证书链，请检查文件格式。
        </div>
      ) : (
        <div className="space-y-3">
          {validation.chains.map((chain) => {
            const isChainOpen = Boolean(expandedChains[chain.index]);
            const chainAbnormal = isChainAbnormal(chain);
            return (
              <div
                key={chain.index}
                className={`rounded-xl border ${
                  chainAbnormal ? 'border-rose-200 bg-rose-50/20' : 'border-slate-200 bg-white'
                }`}
                data-testid={`chain-card-${chain.index}`}
              >
                <button
                  type="button"
                  onClick={() => toggleChain(chain.index)}
                  aria-expanded={isChainOpen}
                  className="btn-interactive flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    {isChainOpen ? (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    )}
                    <span className="text-sm font-semibold text-slate-900">
                      证书链 #{chain.index}
                    </span>
                    <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-white">
                      {chain.algorithm}
                    </span>
                    <StatusBadge status={chain.chain_status} showCode />
                    <span className="text-xs text-slate-500">
                      {chain.certificates.length} 张证书
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                        chain.private_key_valid
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-rose-200 bg-rose-50 text-rose-800'
                      }`}
                      title="私钥与链首证书的匹配结果"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>
                        密钥匹配：{chain.private_key_valid ? '通过' : '不匹配'}
                      </span>
                    </span>
                  </div>
                </button>

                {isChainOpen && (
                  <div className="space-y-2.5 border-t border-slate-100 px-4 py-3">
                    {chain.certificates.map((cert) => {
                      const certKey = `${chain.index}-${cert.position}`;
                      const isCertOpen = Boolean(expandedCerts[certKey]);
                      const abnormal = isCertificateAbnormal(cert);
                      return (
                        <div
                          key={certKey}
                          className={`rounded-lg border ${
                            abnormal
                              ? 'border-rose-200 bg-rose-50/40'
                              : 'border-slate-200 bg-slate-50/60'
                          }`}
                          data-testid={`cert-item-${chain.index}-${cert.position}`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCert(chain.index, cert.position)}
                            aria-expanded={isCertOpen}
                            className="btn-interactive flex w-full flex-col gap-2 px-3.5 py-2.5 text-left sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              {isCertOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                              )}
                              <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800">
                                #{cert.position}{' '}
                                {cert.is_root
                                  ? '根证书'
                                  : cert.position === 0
                                    ? '叶证书'
                                    : '中间 CA'}
                              </span>
                              <span className="break-all text-xs font-medium text-slate-900">
                                {cert.subject}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <CrlStatusBadge crlStatus={cert.crl_status} />
                              <StatusBadge status={cert.certificate_status} size="sm" showCode />
                            </div>
                          </button>

                          {isCertOpen && (
                            <div className="space-y-3 border-t border-slate-200/70 bg-white px-3.5 py-3 text-xs">
                              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                <div>
                                  <span className="text-slate-500">主体</span>
                                  <p className="mt-0.5 break-all font-mono text-slate-900">
                                    {cert.subject}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-slate-500">颁发者</span>
                                  <p className="mt-0.5 break-all font-mono text-slate-900">
                                    {cert.issuer}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-slate-500">
                                    序列号
                                  </span>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                    <code className="break-all font-mono font-semibold text-slate-900">
                                      {cert.serial_number}
                                    </code>
                                    <Link
                                      to={`/certificates?type=serial&q=${encodeURIComponent(cert.serial_number)}`}
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                                    >
                                      <span>按序列号查状态</span>
                                      <ExternalLink className="h-3 w-3" />
                                    </Link>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-slate-500">
                                    SHA-256 指纹
                                  </span>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                    <code className="break-all font-mono text-slate-900">
                                      {cert.fingerprint_sha256}
                                    </code>
                                    <Link
                                      to={`/certificates?type=fingerprint&q=${encodeURIComponent(cert.fingerprint_sha256)}`}
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                                    >
                                      <span>按指纹查状态</span>
                                      <ExternalLink className="h-3 w-3" />
                                    </Link>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-slate-500">生效时间</span>
                                  <p className="mt-0.5 font-mono text-slate-800">
                                    {formatDateTime(cert.not_before)} ({cert.not_before})
                                  </p>
                                </div>
                                <div>
                                  <span className="text-slate-500">到期时间</span>
                                  <p className="mt-0.5 font-mono text-slate-800">
                                    {formatDateTime(cert.not_after)} ({cert.not_after})
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
                                <BooleanAssertionPill
                                  label="根证书"
                                  value={cert.is_root}
                                  neutralWhenFalse
                                />
                                <BooleanAssertionPill
                                  label="信任根"
                                  value={cert.root_trusted}
                                />
                                <BooleanAssertionPill
                                  label="链签名"
                                  value={cert.chain_signature_valid}
                                />
                                <BooleanAssertionPill
                                  label="有效期"
                                  value={cert.time_valid}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        <Shield className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>
          报告仅展示校验结果，不展示私钥。
        </span>
      </div>
    </section>
  );
}

function BooleanAssertionPill({
  label,
  value,
  neutralWhenFalse = false,
}: {
  label: string;
  value: boolean;
  neutralWhenFalse?: boolean;
}) {
  if (value) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        <span>{label}：{neutralWhenFalse ? '是' : '通过'}</span>
      </span>
    );
  }
  if (neutralWhenFalse) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
        <span>{label}：否</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800">
      <XCircle className="h-3 w-3" />
      <span>{label}：未通过</span>
    </span>
  );
}

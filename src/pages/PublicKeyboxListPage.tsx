import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Database,
  Filter,
  Info,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { ALL_STATUS_VALUES, STATUS_META } from '../api/contract';
import type { Status } from '../api/openapi.types';
import { ErrorBanner } from '../components/ErrorBanner';
import { PaginationBar } from '../components/PaginationBar';
import { EffectiveDownloadBadge, StatusBadge } from '../components/StatusBadge';
import { formatDateTime, shortHex } from '../utils/format';

export function PublicKeyboxListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(10000, Math.floor(rawPage)) : 1;

  const rawPageSize = Number(searchParams.get('page_size') ?? '20');
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 100
      ? Math.floor(rawPageSize)
      : 20;

  const rawStatus = searchParams.get('status') ?? '';
  const statusFilter = ALL_STATUS_VALUES.includes(rawStatus as Status)
    ? (rawStatus as Status)
    : undefined;

  const query = useQuery({
    queryKey: ['public-keyboxes', { page, page_size: pageSize, status: statusFilter }],
    queryFn: () =>
      apiClient.listKeyboxes({
        page,
        page_size: pageSize,
        status: statusFilter,
      }),
  });

  const updateQuery = (next: { page?: number; page_size?: number; status?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (next.page !== undefined) {
      params.set('page', String(next.page));
    }
    if (next.page_size !== undefined) {
      params.set('page_size', String(next.page_size));
    }
    if (next.status !== undefined) {
      if (next.status) {
        params.set('status', next.status);
      } else {
        params.delete('status');
      }
    }
    setSearchParams(params);
  };

  const items = query.data?.data.items ?? [];
  const total = query.data?.data.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Hero banner */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>公开 Keybox 收集摘要 · 严禁返回或展示任何私钥及原始 XML</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              已收集 Keybox 公开状态列表
            </h1>
            <p className="max-w-3xl text-xs leading-relaxed text-slate-600">
              展示全部公开且未软删除的 Keybox 安全投影摘要。列表状态按当前有效期、信任根版本与 CRL
              可用性实时投影计算（当 CRL 不可用或版本变化时历史 valid 会降级为{' '}
              <code className="font-mono text-amber-800">indeterminate</code>）。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
              <span>刷新列表</span>
            </button>
            <Link
              to="/upload"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>上传并校验 Keybox</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Filter bar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <span>按总体投影状态筛选 (status)：</span>
          </span>
          <button
            type="button"
            onClick={() => updateQuery({ status: '', page: 1 })}
            className={`btn-interactive rounded-lg px-2.5 py-1 text-xs font-medium ${
              !statusFilter
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            全部状态
          </button>
          {ALL_STATUS_VALUES.map((st) => {
            const active = statusFilter === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => updateQuery({ status: st, page: 1 })}
                className={`btn-interactive rounded-lg px-2.5 py-1 text-xs font-medium ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {STATUS_META[st].shortLabel} ({st})
              </button>
            );
          })}
        </div>

        {query.data?.requestId && (
          <span className="font-mono text-[11px] text-slate-400">
            request_id: {shortHex(query.data.requestId, 8, 6)}
          </span>
        )}
      </section>

      {/* Contract note regarding chain count */}
      <div className="flex items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-100/70 px-3.5 py-2.5 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>
          契约说明：根据 <code className="font-mono">api/openapi.json#/components/schemas/KeyboxSummary</code>，列表摘要返回{' '}
          <code className="font-mono">id</code>、<code className="font-mono">file_sha256</code>、
          <code className="font-mono">overall_status</code>、<code className="font-mono">last_validation_status</code>、
          <code className="font-mono">created_at</code>、<code className="font-mono">last_validated_at</code> 与{' '}
          <code className="font-mono">guest_downloadable_effective</code>；完整证书链列表与链数请点击条目进入详情页查看。
        </span>
      </div>

      {query.error && <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />}

      {/* Loading skeleton */}
      {query.isLoading ? (
        <div className="space-y-3" data-testid="keybox-list-skeleton">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="h-4 w-64 rounded bg-slate-200" />
              <div className="mt-3 h-3 w-96 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"
          data-testid="keybox-list-empty"
        >
          <Database className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900">暂无匹配的公开 Keybox 记录</h2>
          <p className="mt-1 text-xs text-slate-500">
            {statusFilter
              ? `当前筛选状态 (${statusFilter}) 下没有公开记录，您可以切换筛选条件或上传新的 Keybox。`
              : '尚未收录任何公开 Keybox，可前往上传页进行预检与入库。'}
          </p>
          {statusFilter && (
            <button
              type="button"
              onClick={() => updateQuery({ status: '', page: 1 })}
              className="btn-interactive mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              清除状态筛选
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                  <th className="px-4 py-3 font-semibold">Keybox ID / 文件 SHA-256</th>
                  <th className="px-4 py-3 font-semibold">当前总体状态 (overall_status)</th>
                  <th className="px-4 py-3 font-semibold">上次校验结论 (last_validation_status)</th>
                  <th className="px-4 py-3 font-semibold">上传时间 / 最后校验时间</th>
                  <th className="px-4 py-3 font-semibold">游客下载生效状态</th>
                  <th className="px-4 py-3 text-right font-semibold">证书链与详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-slate-50/80"
                    data-testid={`public-keybox-row-${item.id}`}
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        to={`/keyboxes/${item.id}`}
                        className="font-mono text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                      >
                        {item.id}
                      </Link>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500" title={item.file_sha256}>
                        SHA-256: {shortHex(item.file_sha256, 12, 10)}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={item.overall_status} showCode />
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={item.last_validation_status} size="sm" showCode />
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <div>上传：{formatDateTime(item.created_at)}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        校验：{formatDateTime(item.last_validated_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <EffectiveDownloadBadge effective={item.guest_downloadable_effective} />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        to={`/keyboxes/${item.id}`}
                        className="btn-interactive inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <span>查看证书链与状态</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationBar
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(nextPage) => updateQuery({ page: nextPage })}
        onPageSizeChange={(nextSize) => updateQuery({ page_size: nextSize, page: 1 })}
      />
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FileText, Filter, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';
import { AUDIT_ACTION_OPTIONS } from '../api/contract';
import { ErrorBanner } from '../components/ErrorBanner';
import { PaginationBar } from '../components/PaginationBar';
import { formatDateTime, shortHex } from '../utils/format';

export function AdminAuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') === 'downloads' ? 'downloads' : 'audit';
  const actionFilter = searchParams.get('action') ?? '';

  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(10000, Math.floor(rawPage)) : 1;

  const rawPageSize = Number(searchParams.get('page_size') ?? '20');
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 100
      ? Math.floor(rawPageSize)
      : 20;

  const auditQuery = useQuery({
    queryKey: ['admin-audit-logs', { page, page_size: pageSize, action: actionFilter }],
    queryFn: () =>
      apiClient.adminListAuditLogs({
        page,
        page_size: pageSize,
        action: actionFilter || undefined,
      }),
    enabled: activeTab === 'audit',
  });

  const downloadLogsQuery = useQuery({
    queryKey: ['admin-download-logs', { page, page_size: pageSize }],
    queryFn: () =>
      apiClient.adminListDownloadLogs({
        page,
        page_size: pageSize,
      }),
    enabled: activeTab === 'downloads',
  });

  const updateParams = (next: {
    tab?: 'audit' | 'downloads';
    action?: string;
    page?: number;
    page_size?: number;
  }) => {
    const params = new URLSearchParams(searchParams);
    if (next.tab !== undefined) params.set('tab', next.tab);
    if (next.action !== undefined) {
      if (next.action) params.set('action', next.action);
      else params.delete('action');
    }
    if (next.page !== undefined) params.set('page', String(next.page));
    if (next.page_size !== undefined) params.set('page_size', String(next.page_size));
    setSearchParams(params);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              不可变审计日志与下载流水查询
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              契约提供两个只读追加式日志端点：操作审计日志{' '}
              <code className="font-mono">GET /api/v1/admin/audit-logs</code>（支持按{' '}
              <code className="font-mono">action</code> 筛选策略变更、管理员下载等动作）与下载专项流水{' '}
              <code className="font-mono">GET /api/v1/admin/download-logs</code>（含{' '}
              <code className="font-mono">actor_type: "guest" | "admin"</code>）。应用层与数据库运行账号均无任何修改或删除日志的权限。
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              void (activeTab === 'audit' ? auditQuery.refetch() : downloadLogsQuery.refetch())
            }
            className="btn-interactive inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>刷新日志</span>
          </button>
        </div>

        {/* Tabs for AuditLog vs DownloadLog */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => updateParams({ tab: 'audit', page: 1 })}
              data-testid="tab-audit-logs"
              className={`btn-interactive inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                activeTab === 'audit'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>管理与系统审计日志 (AuditLog)</span>
            </button>
            <button
              type="button"
              onClick={() => updateParams({ tab: 'downloads', page: 1 })}
              data-testid="tab-download-logs"
              className={`btn-interactive inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                activeTab === 'downloads'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>游客与管理员下载日志 (DownloadLog)</span>
            </button>
          </div>

          {activeTab === 'audit' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                <Filter className="h-3.5 w-3.5 text-slate-500" />
                <span>按动作筛选 (action)：</span>
              </span>
              <select
                aria-label="按审计动作筛选"
                data-testid="audit-action-select"
                value={actionFilter}
                onChange={(e) => updateParams({ action: e.target.value, page: 1 })}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
              >
                <option value="">全部动作 (All actions)</option>
                {AUDIT_ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {activeTab === 'audit' ? (
        <>
          {auditQuery.error && (
            <ErrorBanner error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
          )}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                    <th className="px-4 py-3 font-semibold">时间 (created_at)</th>
                    <th className="px-4 py-3 font-semibold">操作人 (admin_id)</th>
                    <th className="px-4 py-3 font-semibold">动作 (action)</th>
                    <th className="px-4 py-3 font-semibold">目标 (target_type / target_id)</th>
                    <th className="px-4 py-3 font-semibold">IP / UA HMAC 摘要</th>
                    <th className="px-4 py-3 font-semibold">结果 (result)</th>
                    <th className="px-4 py-3 font-semibold">追踪 ID (request_id)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(auditQuery.data?.data.items ?? []).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-slate-700">{formatDateTime(log.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-slate-800">
                        {log.admin_id ? shortHex(log.admin_id, 8, 6) : '系统/未认证 (null)'}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-slate-100 px-2 py-0.5 font-mono font-semibold text-slate-900">
                          {log.action}
                        </code>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">
                        <span className="text-slate-500">{log.target_type}:</span>{' '}
                        {log.target_type === 'keybox' && log.target_id ? (
                          <Link
                            to={`/admin/keyboxes/${log.target_id}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {shortHex(log.target_id, 8, 6)}
                          </Link>
                        ) : (
                          log.target_id || '—'
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        <div>IP: {log.ip_hash ? shortHex(log.ip_hash, 10, 6) : '—'}</div>
                        <div>UA: {log.user_agent_hash ? shortHex(log.user_agent_hash, 10, 6) : '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            log.result === 'success' || log.result === 'authorized'
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-rose-50 text-rose-800'
                          }`}
                        >
                          {log.result}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {shortHex(log.request_id, 8, 6)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={auditQuery.data?.data.total ?? 0}
            onPageChange={(nextPage) => updateParams({ page: nextPage })}
            onPageSizeChange={(nextSize) => updateParams({ page_size: nextSize, page: 1 })}
          />
        </>
      ) : (
        <>
          {downloadLogsQuery.error && (
            <ErrorBanner
              error={downloadLogsQuery.error}
              onRetry={() => void downloadLogsQuery.refetch()}
            />
          )}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                    <th className="px-4 py-3 font-semibold">时间 (created_at)</th>
                    <th className="px-4 py-3 font-semibold">调用方类型 (actor_type)</th>
                    <th className="px-4 py-3 font-semibold">管理员 ID (admin_id)</th>
                    <th className="px-4 py-3 font-semibold">目标 Keybox (keybox_id)</th>
                    <th className="px-4 py-3 font-semibold">IP / UA HMAC 摘要</th>
                    <th className="px-4 py-3 font-semibold">下载结果 (result)</th>
                    <th className="px-4 py-3 font-semibold">追踪 ID (request_id)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(downloadLogsQuery.data?.data.items ?? []).map((dl) => (
                    <tr key={dl.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-slate-700">{formatDateTime(dl.created_at)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${
                            dl.actor_type === 'guest'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-indigo-100 text-indigo-900'
                          }`}
                        >
                          {dl.actor_type === 'guest' ? '游客 (guest)' : '管理员 (admin)'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">
                        {dl.admin_id ? shortHex(dl.admin_id, 8, 6) : 'null'}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-800">
                        {dl.keybox_id ? (
                          <Link
                            to={`/admin/keyboxes/${dl.keybox_id}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {shortHex(dl.keybox_id, 10, 6)}
                          </Link>
                        ) : (
                          'null'
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        <div>IP: {shortHex(dl.ip_hash, 10, 6)}</div>
                        <div>UA: {shortHex(dl.user_agent_hash, 10, 6)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            dl.result === 'completed' || dl.result === 'authorized'
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-rose-50 text-rose-800'
                          }`}
                        >
                          {dl.result}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {shortHex(dl.request_id, 8, 6)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={downloadLogsQuery.data?.data.total ?? 0}
            onPageChange={(nextPage) => updateParams({ page: nextPage })}
            onPageSizeChange={(nextSize) => updateParams({ page_size: nextSize, page: 1 })}
          />
        </>
      )}
    </div>
  );
}

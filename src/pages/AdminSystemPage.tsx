import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Info,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import { isApiClientError } from '../api/errors';
import type { Health } from '../api/openapi.types';
import { ErrorBanner } from '../components/ErrorBanner';
import { RiskConfirmModal } from '../components/RiskConfirmModal';
import { formatDateTime, shortHex } from '../utils/format';

export function AdminSystemPage() {
  const queryClient = useQueryClient();
  const [isRefreshingCrl, setIsRefreshingCrl] = useState(false);
  const [isTogglingSwitch, setIsTogglingSwitch] = useState(false);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<boolean | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const healthQuery = useQuery({
    queryKey: ['admin-system-health'],
    queryFn: async (): Promise<{ data: Health; requestId: string; degradedError?: unknown }> => {
      try {
        return await apiClient.adminHealth();
      } catch (err) {
        // Per docs/api.md: "GET /admin/system/health: 依赖退化时 503/50302，data 仍为 Health"
        if (isApiClientError(err) && err.code === 50302 && err.healthData) {
          return {
            data: err.healthData,
            requestId: err.requestId,
            degradedError: err,
          };
        }
        throw err;
      }
    },
  });

  const settingQuery = useQuery({
    queryKey: ['admin-guest-download-setting'],
    queryFn: () => apiClient.adminGetGuestDownloadSetting(),
  });

  // Query latest audit log for guest_download_setting_update to surface last modifier & timestamp
  const latestSettingAuditQuery = useQuery({
    queryKey: ['admin-latest-guest-setting-audit'],
    queryFn: () =>
      apiClient.adminListAuditLogs({
        page: 1,
        page_size: 1,
        action: 'guest_download_setting_update',
      }),
  });

  const health = healthQuery.data?.data;
  const globalEnabled =
    settingQuery.data?.data.enabled ?? health?.guest_download_enabled ?? false;
  const latestAudit = latestSettingAuditQuery.data?.data.items?.[0] ?? null;

  const handleRefreshCrl = async () => {
    if (isRefreshingCrl) return;
    setIsRefreshingCrl(true);
    setActionError(null);
    try {
      const res = await apiClient.adminRefreshCRL();
      toast.success(
        `CRL 已刷新：${res.data.usable ? '可用' : '不可用'}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-system-health'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] }),
      ]);
    } catch (err) {
      setActionError(err);
    } finally {
      setIsRefreshingCrl(false);
    }
  };

  const handleConfirmGlobalSwitch = async () => {
    if (pendingSwitchTarget === null || isTogglingSwitch) return;
    setIsTogglingSwitch(true);
    setActionError(null);
    try {
      const res = await apiClient.adminSetGuestDownloadSetting(pendingSwitchTarget, true);
      toast.success(
        res.data.enabled
          ? '游客下载已开启'
          : '游客下载已关闭',
      );
      setPendingSwitchTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-guest-download-setting'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-system-health'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-latest-guest-setting-audit'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-keyboxes'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-keybox-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['public-keyboxes'] }),
        queryClient.invalidateQueries({ queryKey: ['public-keybox-detail'] }),
      ]);
    } catch (err) {
      setActionError(err);
      setPendingSwitchTarget(null);
    } finally {
      setIsTogglingSwitch(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              系统设置
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              查看服务状态，管理游客下载权限。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void healthQuery.refetch()}
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${healthQuery.isFetching ? 'animate-spin' : ''}`} />
              <span>刷新状态</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRefreshCrl()}
              disabled={isRefreshingCrl}
              data-testid="refresh-crl-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingCrl ? 'animate-spin' : ''}`} />
              <span>{isRefreshingCrl ? '刷新中…' : '刷新 CRL'}</span>
            </button>
          </div>
        </div>
      </section>

      {healthQuery.error && (
        <ErrorBanner error={healthQuery.error} onRetry={() => void healthQuery.refetch()} />
      )}
      {healthQuery.data?.degradedError ? (
        <ErrorBanner error={healthQuery.data.degradedError} />
      ) : null}
      {actionError ? <ErrorBanner error={actionError} /> : null}

      {/* Health metrics grid */}
      {health && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">服务状态</span>
              <Database className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              {health.status === 'healthy' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  正常
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-800">
                  <AlertTriangle className="h-4 w-4" />
                  异常
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-600">
              数据库：<strong className="font-mono">{health.database === 'up' ? '正常' : '不可用'}</strong>
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">CRL 缓存</span>
              <ShieldCheck className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2.5 py-0.5 font-semibold ${
                  health.crl.usable
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-rose-50 text-rose-800'
                }`}
              >
                {health.crl.usable ? '可用' : '不可用'}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-semibold ${
                  health.crl.expired
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {health.crl.expired ? '缓存已过期' : '缓存未过期'}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
              最后更新：{formatDateTime(health.crl.fetched_at)}
            </p>
            <p className="text-[11px] text-slate-600">
              过期时间：{formatDateTime(health.crl.expires_at)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Google 信任根
              </span>
              <ShieldCheck className="h-4 w-4 text-indigo-500" />
            </div>
            <p className="mt-3 text-lg font-bold text-slate-900">
              {health.root_count} <span className="text-xs font-normal text-slate-500">个根证书</span>
            </p>
            <p
              className="mt-1 truncate font-mono text-[11px] text-slate-600"
              title={health.root_set_version}
            >
              版本摘要：{health.root_set_version}
            </p>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">校验失败率</span>
              <Info className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              暂无统计数据。
            </p>
          </div>
        </section>
      )}

      {/* Global Guest Download Master Switch */}
      <section
        className={`rounded-2xl border p-6 shadow-2xs ${
          globalEnabled
            ? 'border-rose-300 bg-rose-50/50'
            : 'border-slate-200 bg-white'
        }`}
        data-testid="global-download-switch-card"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 lg:flex-row lg:items-center">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900">
                游客下载
              </h2>
              {globalEnabled ? (
                <span
                  data-testid="global-switch-status-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-3 py-1 text-xs font-bold text-rose-900"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  已开启
                </span>
              ) : (
                <span
                  data-testid="global-switch-status-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-900"
                >
                  <Lock className="h-3.5 w-3.5" />
                  已关闭
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-slate-700">
              文件含私钥。开启后，允许下载的公开条目将对所有访客开放。
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingSwitchTarget(!globalEnabled)}
              data-testid="toggle-global-download-btn"
              className={`btn-interactive inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white shadow-xs ${
                globalEnabled
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {globalEnabled ? (
                <>
                  <Lock className="h-4 w-4" />
                  <span>关闭游客下载</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4" />
                  <span>开启游客下载</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Latest modification audit record & truth table */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <span className="font-semibold text-slate-900">
              最近变更
            </span>
            <p className="mt-1 text-[11px] text-slate-500">
              以下为最近一次变更记录。
            </p>
            {latestAudit ? (
              <div className="mt-2.5 space-y-1 font-mono text-xs text-slate-800">
                <div>操作人: {latestAudit.admin_id ?? '系统'}</div>
                <div>时间: {formatDateTime(latestAudit.created_at)}</div>
                <div>结果 / 请求 ID: {latestAudit.result} ({shortHex(latestAudit.request_id, 8, 6)})</div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">暂无变更记录。</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <span className="font-semibold text-slate-900">
              下载规则
            </span>
            <table className="mt-2 w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 font-semibold">全局开关</th>
                  <th className="py-1.5 font-semibold">继承全局</th>
                  <th className="py-1.5 font-semibold">允许下载</th>
                  <th className="py-1.5 font-semibold">禁止下载</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-1.5 font-mono font-semibold text-slate-800">关闭</td>
                  <td className="py-1.5 font-semibold text-slate-600">禁止下载</td>
                  <td className="py-1.5 font-semibold text-slate-600">禁止下载</td>
                  <td className="py-1.5 font-semibold text-rose-700">禁止下载</td>
                </tr>
                <tr>
                  <td className="py-1.5 font-mono font-semibold text-rose-700">开启</td>
                  <td className="py-1.5 font-semibold text-amber-800">允许下载</td>
                  <td className="py-1.5 font-semibold text-amber-800">允许下载</td>
                  <td className="py-1.5 font-semibold text-rose-700">仍然禁止</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {pendingSwitchTarget !== null && (
        <RiskConfirmModal
          open
          tone={pendingSwitchTarget ? 'danger' : 'warning'}
          isSubmitting={isTogglingSwitch}
          title={
            pendingSwitchTarget
              ? '开启游客下载？'
              : '关闭游客下载？'
          }
          description={
            pendingSwitchTarget
              ? '开启后，允许下载的公开条目将对所有访客开放。'
              : '关闭后，所有游客都无法获得新的下载授权。'
          }
          warningBullets={
            pendingSwitchTarget
              ? [
                  '文件含私钥，任何访客都可下载和复制。',
                  '关闭下载也无法撤回已流出的私钥副本。',
                  '禁止下载的条目仍不会开放。',
                ]
              : [
                  '单条设为“允许下载”也不能绕过全局关闭。',
                  '已下载的副本无法撤回。',
                ]
          }
          confirmLabel={
            pendingSwitchTarget
              ? '确认公开私钥并开启'
              : '确认关闭'
          }
          onConfirm={() => void handleConfirmGlobalSwitch()}
          onCancel={() => setPendingSwitchTarget(null)}
        />
      )}
    </div>
  );
}

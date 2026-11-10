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
import { GUEST_DOWNLOAD_CONFIRM_HEADER } from '../api/contract';
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
        `CRL 状态表已刷新 (version: ${shortHex(res.data.version, 8, 6)}, usable: ${String(res.data.usable)})`,
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
          ? '已开启全局游客下载总开关（高危敏感模式已激活）'
          : '已关闭全局游客下载总开关（所有游客下载已立即阻断）',
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
              系统健康状态与全局游客下载总开关
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              对应契约端点 <code className="font-mono">GET /api/v1/admin/system/health</code>、
              <code className="font-mono">POST /api/v1/admin/system/crl/refresh</code> 与{' '}
              <code className="font-mono">GET|PATCH /api/v1/admin/settings/guest-download</code>。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void healthQuery.refetch()}
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${healthQuery.isFetching ? 'animate-spin' : ''}`} />
              <span>刷新健康状态</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRefreshCrl()}
              disabled={isRefreshingCrl}
              data-testid="refresh-crl-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingCrl ? 'animate-spin' : ''}`} />
              <span>{isRefreshingCrl ? '正在刷新上游 CRL…' : '手动刷新 CRL 缓存'}</span>
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
              <span className="text-xs font-semibold text-slate-500">系统与数据库健康 (status)</span>
              <Database className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              {health.status === 'healthy' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  正常 (healthy)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-800">
                  <AlertTriangle className="h-4 w-4" />
                  退化 (degraded)
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-600">
              MySQL 8.0 数据库状态：<strong className="font-mono">{health.database}</strong>
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">CRL 缓存与过期状态 (crl)</span>
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
                usable: {String(health.crl.usable)}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 font-semibold ${
                  health.crl.expired
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                expired: {String(health.crl.expired)}
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
                受控 Google 根证书集合 (root_set)
              </span>
              <ShieldCheck className="h-4 w-4 text-indigo-500" />
            </div>
            <p className="mt-3 text-lg font-bold text-slate-900">
              {health.root_count} <span className="text-xs font-normal text-slate-500">个激活根证书</span>
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
              <span className="text-xs font-semibold text-slate-600">最近校验失败率（契约说明）</span>
              <Info className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              <strong>契约缺口标注：</strong>
              <code className="font-mono">api/openapi.json</code> 的{' '}
              <code className="font-mono">Health</code> schema 仅定义{' '}
              <code className="font-mono">
                status / database / root_set_version / root_count / crl / guest_download_enabled
              </code>
              ，未包含“最近校验失败率”字段；遵循不伪造未定义字段原则，此处不展示假指标。
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
                “允许游客下载 Keybox”全局总开关 (guest_download_enabled)
              </h2>
              {globalEnabled ? (
                <span
                  data-testid="global-switch-status-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-3 py-1 text-xs font-bold text-rose-900"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  当前已开启 (enabled = true · 极高风险)
                </span>
              ) : (
                <span
                  data-testid="global-switch-status-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-900"
                >
                  <Lock className="h-3.5 w-3.5" />
                  当前已关闭 (enabled = false · 默认安全态)
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-slate-700">
              Keybox 原始 XML 文件包含硬件私钥。开启全局开关需二次确认并由前端自动附加契约强制确认头{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                {GUEST_DOWNLOAD_CONFIRM_HEADER.name}: {GUEST_DOWNLOAD_CONFIRM_HEADER.value}
              </code>
              （缺失该头将触发 <code className="font-mono">409 / 40903</code> 拒绝）。
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
                  <span>立即关闭全局游客下载</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4" />
                  <span>开启全局游客下载（需二次确认）</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Latest modification audit record & truth table */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <span className="font-semibold text-slate-900">
              开关最近变更记录（源自 AuditLog: guest_download_setting_update）
            </span>
            <p className="mt-1 text-[11px] text-slate-500">
              契约说明：<code className="font-mono">GuestDownloadSetting</code> schema 仅含{' '}
              <code className="font-mono">&#123; enabled: boolean &#125;</code>
              ，此处通过只读查询审计日志展示最近一次修改人与修改时间：
            </p>
            {latestAudit ? (
              <div className="mt-2.5 space-y-1 font-mono text-xs text-slate-800">
                <div>最后修改管理员 ID (admin_id): {latestAudit.admin_id ?? '系统默认/CLI (null)'}</div>
                <div>最后修改时间 (created_at): {formatDateTime(latestAudit.created_at)}</div>
                <div>审计结果与追踪 ID: {latestAudit.result} ({shortHex(latestAudit.request_id, 8, 6)})</div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">尚无全局开关修改审计记录（保持初始迁移默认值 false）。</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <span className="font-semibold text-slate-900">
              游客下载权限合成规则 (effective = global_enabled && policy in &#123;inherit, allowed&#125; && public)
            </span>
            <table className="mt-2 w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 font-semibold">全局总开关</th>
                  <th className="py-1.5 font-semibold">单条 inherit（默认）</th>
                  <th className="py-1.5 font-semibold">单条 allowed</th>
                  <th className="py-1.5 font-semibold">单条 denied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-1.5 font-mono font-semibold text-slate-800">false（关闭）</td>
                  <td className="py-1.5 font-semibold text-slate-600">禁止下载</td>
                  <td className="py-1.5 font-semibold text-slate-600">禁止下载</td>
                  <td className="py-1.5 font-semibold text-rose-700">禁止下载</td>
                </tr>
                <tr>
                  <td className="py-1.5 font-mono font-semibold text-rose-700">true（开启）</td>
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
              ? '高危操作确认：开启“允许游客下载 Keybox”全局总开关'
              : '安全确认：关闭“允许游客下载 Keybox”全局总开关'
          }
          description={
            pendingSwitchTarget
              ? '您即将把全局 guest_download_enabled 设为 true，并附带 X-Confirm-Guest-Download: enable-sensitive-downloads 请求头。'
              : '您即将把全局 guest_download_enabled 设为 false，立即阻断所有匿名游客下载。'
          }
          warningBullets={
            pendingSwitchTarget
              ? [
                  '强风险警示：开启后，任何未登录游客均可直接下载所有可见性为 public 且单条策略为 inherit 或 allowed 的 Keybox 原始 XML 文件（内含 RSA/ECDSA 硬件私钥）！',
                  '不可逆泄密风险：Keybox 一旦允许匿名下载，其私钥即可被任何人复制留存；后续即使再次关闭全局开关，也无法撤回已经流出的私钥副本。',
                  '单条策略为 denied 的 Keybox 仍会保持禁止下载状态。',
                ]
              : [
                  '关闭全局开关后，所有公开 Keybox（即便单条策略设置为 allowed）的 guest_downloadable_effective 均立即变为 false。',
                  '公开详情页将立即隐藏下载按钮，任何直连下载请求均会被服务端以 403 (40301) 拒绝。',
                ]
          }
          confirmLabel={
            pendingSwitchTarget
              ? '我已知晓私钥公开风险，确认开启全局下载'
              : '确认关闭全局游客下载'
          }
          onConfirm={() => void handleConfirmGlobalSwitch()}
          onCancel={() => setPendingSwitchTarget(null)}
        />
      )}
    </div>
  );
}

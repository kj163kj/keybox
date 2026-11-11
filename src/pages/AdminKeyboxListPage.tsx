import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Filter,
  Info,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import {
  ALL_STATUS_VALUES,
  DOWNLOAD_POLICY_META,
  KEYBOX_ID_REGEX,
  STATUS_META,
} from '../api/contract';
import type {
  AdminKeyboxSummary,
  DownloadPolicy,
  Status,
} from '../api/openapi.types';
import { ErrorBanner } from '../components/ErrorBanner';
import { PaginationBar } from '../components/PaginationBar';
import { RiskConfirmModal } from '../components/RiskConfirmModal';
import {
  EffectiveDownloadBadge,
  PolicyBadge,
  StatusBadge,
  VisibilityBadge,
} from '../components/StatusBadge';
import { formatDateTime, shortHex } from '../utils/format';

type PendingAction =
  | {
      type: 'policy';
      item: AdminKeyboxSummary;
      nextPolicy: DownloadPolicy;
    }
  | {
      type: 'visibility';
      item: AdminKeyboxSummary;
      nextVisibility: 'public' | 'hidden';
    }
  | {
      type: 'delete';
      item: AdminKeyboxSummary;
    };

export function AdminKeyboxListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const rawPolicy = searchParams.get('guest_download_policy') ?? '';
  const policyFilter = (['inherit', 'allowed', 'denied'] as const).includes(
    rawPolicy as DownloadPolicy,
  )
    ? (rawPolicy as DownloadPolicy)
    : undefined;

  const [localIdSearch, setLocalIdSearch] = useState(searchParams.get('q') ?? '');
  const [localDateFilter, setLocalDateFilter] = useState(searchParams.get('date') ?? '');
  const [revalidatingId, setRevalidatingId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const listQuery = useQuery({
    queryKey: [
      'admin-keyboxes',
      {
        page,
        page_size: pageSize,
        status: statusFilter,
        guest_download_policy: policyFilter,
      },
    ],
    queryFn: () =>
      apiClient.adminListKeyboxes({
        page,
        page_size: pageSize,
        status: statusFilter,
        guest_download_policy: policyFilter,
      }),
  });

  const updateServerFilter = (next: {
    page?: number;
    page_size?: number;
    status?: string;
    guest_download_policy?: string;
  }) => {
    const params = new URLSearchParams(searchParams);
    if (next.page !== undefined) params.set('page', String(next.page));
    if (next.page_size !== undefined) params.set('page_size', String(next.page_size));
    if (next.status !== undefined) {
      if (next.status) params.set('status', next.status);
      else params.delete('status');
    }
    if (next.guest_download_policy !== undefined) {
      if (next.guest_download_policy) {
        params.set('guest_download_policy', next.guest_download_policy);
      } else {
        params.delete('guest_download_policy');
      }
    }
    setSearchParams(params);
  };

  const invalidateAllKeyboxViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-keyboxes'] }),
      queryClient.invalidateQueries({ queryKey: ['public-keyboxes'] }),
      queryClient.invalidateQueries({ queryKey: ['public-keybox-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-keybox-detail'] }),
    ]);
  };

  const handleRevalidate = async (id: string) => {
    if (revalidatingId) return;
    setRevalidatingId(id);
    setActionError(null);
    try {
      const res = await apiClient.adminRevalidateKeybox(id);
      toast.success(
        `校验完成：${STATUS_META[res.data.overall_status].shortLabel}`,
      );
      await invalidateAllKeyboxViews();
    } catch (err) {
      setActionError(err);
    } finally {
      setRevalidatingId(null);
    }
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingAction || isMutating) return;
    setIsMutating(true);
    setActionError(null);
    try {
      if (pendingAction.type === 'policy') {
        const res = await apiClient.adminPatchKeybox(pendingAction.item.id, {
          guest_download_policy: pendingAction.nextPolicy,
        });
        toast.success(
          `下载权限：${DOWNLOAD_POLICY_META[res.data.guest_download_policy].shortLabel}`,
        );
      } else if (pendingAction.type === 'visibility') {
        const res = await apiClient.adminPatchKeybox(pendingAction.item.id, {
          visibility: pendingAction.nextVisibility,
        });
        toast.success(
          res.data.visibility === 'hidden'
            ? '已下架'
            : '已恢复公开',
        );
      } else if (pendingAction.type === 'delete') {
        await apiClient.adminDeleteKeybox(pendingAction.item.id);
        toast.success(`已删除 Keybox ${shortHex(pendingAction.item.id, 8, 6)}`);
      }
      setPendingAction(null);
      await invalidateAllKeyboxViews();
    } catch (err) {
      setActionError(err);
      setPendingAction(null);
    } finally {
      setIsMutating(false);
    }
  };

  const rawItems = listQuery.data?.data.items ?? [];
  const filteredItems = rawItems.filter((item) => {
    const matchId =
      !localIdSearch.trim() ||
      item.id.toLowerCase().includes(localIdSearch.trim().toLowerCase()) ||
      item.file_sha256.toLowerCase().includes(localIdSearch.trim().toLowerCase());
    const matchDate =
      !localDateFilter || item.created_at.slice(0, 10) === localDateFilter;
    return matchId && matchDate;
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Keybox 管理
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              管理可见性、下载权限与校验状态。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
            className="btn-interactive inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
            <span>刷新列表</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              状态
            </label>
            <select
              value={statusFilter ?? ''}
              onChange={(e) => updateServerFilter({ status: e.target.value, page: 1 })}
              aria-label="筛选状态"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
            >
              <option value="">全部状态</option>
              {ALL_STATUS_VALUES.map((st) => (
                <option key={st} value={st}>
                  {STATUS_META[st].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              下载权限
            </label>
            <select
              value={policyFilter ?? ''}
              onChange={(e) =>
                updateServerFilter({ guest_download_policy: e.target.value, page: 1 })
              }
              aria-label="筛选下载权限"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
            >
              <option value="">全部策略</option>
              {(['inherit', 'allowed', 'denied'] as const).map((pol) => (
                <option key={pol} value={pol}>
                  {DOWNLOAD_POLICY_META[pol].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Keybox ID
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                type="text"
                value={localIdSearch}
                onChange={(e) => setLocalIdSearch(e.target.value)}
                placeholder="输入完整 ID 跳转，或筛选当前页"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900"
              />
              {KEYBOX_ID_REGEX.test(localIdSearch.trim().toLowerCase()) && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/admin/keyboxes/${localIdSearch.trim().toLowerCase()}`)
                  }
                  className="btn-interactive shrink-0 rounded-xl bg-slate-900 px-2.5 py-2 text-xs font-semibold text-white"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              上传日期（当前页）
            </label>
            <input
              type="date"
              value={localDateFilter}
              onChange={(e) => setLocalDateFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <Info className="h-3.5 w-3.5 text-slate-400" />
          <span>
            ID 和日期仅筛选当前页；输入完整 ID 可直接打开详情。
          </span>
        </div>
      </section>

      {listQuery.error && (
        <ErrorBanner error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      )}
      {Boolean(actionError) && <ErrorBanner error={actionError} />}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                <th className="px-4 py-3 font-semibold">Keybox ID / 可见性</th>
                <th className="px-4 py-3 font-semibold">当前 / 上次状态</th>
                <th className="px-4 py-3 font-semibold">上传 / 校验时间</th>
                <th className="px-4 py-3 font-semibold">下载权限</th>
                <th className="px-4 py-3 font-semibold">游客下载</th>
                <th className="px-4 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  data-testid={`admin-keybox-row-${item.id}`}
                  className="transition-colors hover:bg-slate-50/70"
                >
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/admin/keyboxes/${item.id}`}
                        className="font-mono font-semibold text-indigo-600 hover:underline"
                      >
                        {item.id}
                      </Link>
                      <VisibilityBadge visibility={item.visibility} />
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      SHA-256: {shortHex(item.file_sha256, 10, 8)}
                    </p>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={item.overall_status} showCode />
                      <span className="text-[11px] text-slate-500">
                        上次：{STATUS_META[item.last_validation_status].shortLabel}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    <div>创建: {formatDateTime(item.created_at)}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      校验: {formatDateTime(item.last_validated_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col items-start gap-1.5">
                      <PolicyBadge policy={item.guest_download_policy} />
                      <select
                        aria-label={`修改 ${item.id} 下载策略`}
                        data-testid={`policy-select-${item.id}`}
                        value={item.guest_download_policy}
                        onChange={(e) => {
                          const nextPolicy = e.target.value as DownloadPolicy;
                          if (nextPolicy !== item.guest_download_policy) {
                            setPendingAction({
                              type: 'policy',
                              item,
                              nextPolicy,
                            });
                          }
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
                      >
                        <option value="inherit">继承全局</option>
                        <option value="allowed">允许下载</option>
                        <option value="denied">禁止下载</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <EffectiveDownloadBadge effective={item.guest_downloadable_effective} />
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleRevalidate(item.id)}
                        disabled={revalidatingId === item.id}
                        data-testid={`revalidate-btn-${item.id}`}
                        className="btn-interactive inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${revalidatingId === item.id ? 'animate-spin' : ''}`}
                        />
                        <span>重新校验</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({
                            type: 'visibility',
                            item,
                            nextVisibility:
                              item.visibility === 'public' ? 'hidden' : 'public',
                          })
                        }
                        data-testid={`visibility-btn-${item.id}`}
                        className="btn-interactive inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {item.visibility === 'public' ? (
                          <>
                            <EyeOff className="h-3 w-3" />
                            <span>下架</span>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            <span>恢复公开</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPendingAction({ type: 'delete', item })}
                        data-testid={`delete-btn-${item.id}`}
                        className="btn-interactive inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>删除</span>
                      </button>

                      <Link
                        to={`/admin/keyboxes/${item.id}`}
                        className="btn-interactive inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        <span>查看详情</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
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
        total={listQuery.data?.data.total ?? 0}
        onPageChange={(nextPage) => updateServerFilter({ page: nextPage })}
        onPageSizeChange={(nextSize) => updateServerFilter({ page_size: nextSize, page: 1 })}
      />

      {pendingAction?.type === 'policy' && (
        <RiskConfirmModal
          open
          tone="danger"
          isSubmitting={isMutating}
          title="修改下载权限？"
          description={`Keybox ${pendingAction.item.id}：${DOWNLOAD_POLICY_META[pendingAction.item.guest_download_policy].shortLabel} → ${DOWNLOAD_POLICY_META[pendingAction.nextPolicy].shortLabel}。`}
          warningBullets={[
            '文件含私钥，开放下载后任何人都可获取。',
            '已下载的私钥副本无法撤回。',
            '仅在全局开启、条目公开且未禁止下载时生效。',
          ]}
          confirmLabel="确认修改"
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'visibility' && (
        <RiskConfirmModal
          open
          tone="warning"
          isSubmitting={isMutating}
          title={
            pendingAction.nextVisibility === 'hidden'
              ? '下架 Keybox？'
              : '恢复公开？'
          }
          description={`Keybox ${pendingAction.item.id}`}
          warningBullets={
            pendingAction.nextVisibility === 'hidden'
              ? [
                  '下架后，访客无法查看或下载。',
                  '管理员仍可查看、校验和下载。',
                ]
              : [
                  '恢复后，访客可查看该记录。',
                  '若下载权限已开放，访客也可下载含私钥的文件。',
                ]
          }
          confirmLabel={
            pendingAction.nextVisibility === 'hidden' ? '确认下架' : '确认恢复'
          }
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'delete' && (
        <RiskConfirmModal
          open
          tone="danger"
          isSubmitting={isMutating}
          title="删除 Keybox？"
          description={`Keybox ${pendingAction.item.id}`}
          warningBullets={[
            '删除后将从列表移除，任何人都无法下载。',
            '去重记录会保留，相同文件无法再次上传。',
            '操作将记录在审计日志中。',
          ]}
          confirmLabel="确认删除"
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

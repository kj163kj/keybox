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
        `已重新校验 Keybox ${shortHex(id, 6, 4)}：最新状态为 ${res.data.overall_status} (request_id: ${shortHex(res.requestId, 6, 4)})`,
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
          `已更新单条下载策略为 ${res.data.guest_download_policy}（当前生效可下载: ${String(res.data.guest_downloadable_effective)}）`,
        );
      } else if (pendingAction.type === 'visibility') {
        const res = await apiClient.adminPatchKeybox(pendingAction.item.id, {
          visibility: pendingAction.nextVisibility,
        });
        toast.success(
          res.data.visibility === 'hidden'
            ? '已将该 Keybox 下架隐藏（公开列表与公开详情不再可见）'
            : '已恢复该 Keybox 为公开展示',
        );
      } else if (pendingAction.type === 'delete') {
        await apiClient.adminDeleteKeybox(pendingAction.item.id);
        toast.success(`已软删除 Keybox ${shortHex(pendingAction.item.id, 8, 6)}`);
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
              管理员 Keybox 管理与下载策略控制
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              调用 <code className="font-mono">GET /api/v1/admin/keyboxes</code>
              ，包含已下架隐藏 (<code className="font-mono">hidden</code>) 条目，排除已软删除条目。所有写操作均携带{' '}
              <code className="font-mono">X-CSRF-Token</code> 并强制写入不可变审计日志。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
            className="btn-interactive inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
            <span>刷新管理列表</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              服务端状态筛选 (status)
            </label>
            <select
              value={statusFilter ?? ''}
              onChange={(e) => updateServerFilter({ status: e.target.value, page: 1 })}
              aria-label="服务端状态筛选"
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
              服务端单条下载策略筛选 (guest_download_policy)
            </label>
            <select
              value={policyFilter ?? ''}
              onChange={(e) =>
                updateServerFilter({ guest_download_policy: e.target.value, page: 1 })
              }
              aria-label="服务端下载策略筛选"
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
              按 ID 跳转详情或页内检索
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                type="text"
                value={localIdSearch}
                onChange={(e) => setLocalIdSearch(e.target.value)}
                placeholder="输入 32 位 ID 直达或页内过滤"
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
              当前页上传日期辅助过滤
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
            契约说明：<code className="font-mono">GET /api/v1/admin/keyboxes</code> 契约定义的服务端参数为{' '}
            <code className="font-mono">page</code>、<code className="font-mono">page_size</code>、
            <code className="font-mono">status</code>、<code className="font-mono">guest_download_policy</code>；
            ID 与日期输入框提供当前页结果快速过滤及 32 位 ID 详情页精确直达。
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
                <th className="px-4 py-3 font-semibold">投影状态 / 历史校验</th>
                <th className="px-4 py-3 font-semibold">上传与校验时间</th>
                <th className="px-4 py-3 font-semibold">单条游客下载策略</th>
                <th className="px-4 py-3 font-semibold">生效可下载结论</th>
                <th className="px-4 py-3 text-right font-semibold">管理操作</th>
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
                        历史: {item.last_validation_status}
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
                        <option value="inherit">继承全局 (inherit)</option>
                        <option value="allowed">允许游客下载 (allowed)</option>
                        <option value="denied">禁止游客下载 (denied)</option>
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
                        <span>管理详情与历史</span>
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
          title="确认修改单条 Keybox 游客下载策略"
          description={`您正在将 Keybox (${pendingAction.item.id}) 的单条下载策略从 "${pendingAction.item.guest_download_policy}" 修改为 "${pendingAction.nextPolicy}"。`}
          warningBullets={[
            '高危风险警示：Keybox 原始 XML 文件中包含硬件认证私钥（RSA / ECDSA），允许游客下载等于向公网公开私钥！',
            '私钥一旦被匿名游客下载复制，后续即使关闭下载或删除记录也无法撤回已流出的私钥副本。',
            '生效规则：全局总开关关闭时，即使单条设为 allowed 游客仍不可下载；全局开启时，inherit 与 allowed 允许游客下载，denied 强制禁止。',
          ]}
          confirmLabel={`确认修改为 ${pendingAction.nextPolicy}`}
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
              ? '确认下架隐藏该 Keybox'
              : '确认恢复公开该 Keybox'
          }
          description={`目标 Keybox ID: ${pendingAction.item.id}，可见性将变更为 "${pendingAction.nextVisibility}"。`}
          warningBullets={
            pendingAction.nextVisibility === 'hidden'
              ? [
                  '下架设为 hidden 后，公开列表、公开详情、证书状态查询及游客下载对该条目均返回 404。',
                  '管理员仍可在管理后台查看、重新校验或通过管理员专用下载接口下载该条目。',
                ]
              : [
                  '恢复为 public 后，该 Keybox 的公开元数据与证书链将重新出现在公开列表和证书查询结果中。',
                  '若全局下载总开关已开启且该条目策略为 inherit/allowed，游客将立即能够下载该文件。',
                ]
          }
          confirmLabel={
            pendingAction.nextVisibility === 'hidden' ? '确认下架隐藏' : '确认恢复公开'
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
          title="确认软删除该 Keybox"
          description={`您即将调用 DELETE /api/v1/admin/keyboxes/${pendingAction.item.id} 删除该记录。`}
          warningBullets={[
            '软删除后，该条目将从公开列表和管理员常规管理列表中永久移除，公开与管理员下载均返回 404 (40401)。',
            '去重保留机制：软删除仍保留文件 SHA-256 与链首证书指纹去重索引，后续重复上传同一份材料仍会返回 409 (40901)。',
            '删除动作将连同您的管理员 ID 与 request_id 永久写入不可删除的审计日志。',
          ]}
          confirmLabel="确认删除该 Keybox"
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

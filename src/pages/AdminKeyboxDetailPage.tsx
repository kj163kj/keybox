import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  History,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import { DOWNLOAD_POLICY_META } from '../api/contract';
import type { DownloadPolicy, ValidationRun } from '../api/openapi.types';
import { ErrorBanner } from '../components/ErrorBanner';
import { PaginationBar } from '../components/PaginationBar';
import { RiskConfirmModal } from '../components/RiskConfirmModal';
import {
  EffectiveDownloadBadge,
  PolicyBadge,
  StatusBadge,
  VisibilityBadge,
} from '../components/StatusBadge';
import { ValidationReportView } from '../components/ValidationReportView';
import { formatDateTime, shortHex } from '../utils/format';

type PendingDetailAction =
  | { type: 'policy'; nextPolicy: DownloadPolicy }
  | { type: 'visibility'; nextVisibility: 'public' | 'hidden' }
  | { type: 'delete' };

export function AdminKeyboxDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [runsPage, setRunsPage] = useState(1);
  const [selectedRun, setSelectedRun] = useState<ValidationRun | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pendingAction, setPendingAction] = useState<PendingDetailAction | null>(null);

  const detailQuery = useQuery({
    queryKey: ['admin-keybox-detail', id],
    queryFn: () => apiClient.adminGetKeybox(id),
    enabled: Boolean(id),
  });

  const runsQuery = useQuery({
    queryKey: ['admin-keybox-runs', id, runsPage],
    queryFn: () => apiClient.adminListValidationRuns(id, { page: runsPage, page_size: 10 }),
    enabled: Boolean(id),
  });

  const detail = detailQuery.data?.data;

  useEffect(() => {
    if (detail) {
      setNoteInput(detail.admin_note);
    }
  }, [detail?.admin_note, detail?.id]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-keybox-detail', id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-keybox-runs', id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-keyboxes'] }),
      queryClient.invalidateQueries({ queryKey: ['public-keyboxes'] }),
      queryClient.invalidateQueries({ queryKey: ['public-keybox-detail', id] }),
    ]);
  };

  const handleRevalidate = async () => {
    if (!id || isRevalidating) return;
    setIsRevalidating(true);
    setActionError(null);
    try {
      const res = await apiClient.adminRevalidateKeybox(id);
      toast.success(
        `重新校验完成：最新状态为 ${res.data.overall_status} (request_id: ${shortHex(res.requestId, 6, 4)})`,
      );
      await invalidateAll();
    } catch (err) {
      setActionError(err);
    } finally {
      setIsRevalidating(false);
    }
  };

  const handleAdminDownload = async () => {
    if (!id || isDownloading) return;
    setIsDownloading(true);
    setActionError(null);
    try {
      const res = await apiClient.downloadAdminKeybox(id);
      toast.success(
        `管理员受控下载已触发 (${res.filename})，本次下载已写入审计日志与下载日志`,
      );
    } catch (err) {
      setActionError(err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveNote = async () => {
    if (!id || isSavingNote) return;
    const byteLen = new TextEncoder().encode(noteInput).length;
    if (byteLen > 2000) {
      toast.error(`管理员备注超出 2000 UTF-8 字节上限（当前 ${byteLen} 字节）`);
      return;
    }
    setIsSavingNote(true);
    setActionError(null);
    try {
      await apiClient.adminPatchKeybox(id, { admin_note: noteInput });
      toast.success('已保存管理员备注（审计日志仅记录发生变更，不记录备注原文）');
      await invalidateAll();
    } catch (err) {
      setActionError(err);
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingAction || !detail || isMutating) return;
    setIsMutating(true);
    setActionError(null);
    try {
      if (pendingAction.type === 'policy') {
        const res = await apiClient.adminPatchKeybox(detail.id, {
          guest_download_policy: pendingAction.nextPolicy,
        });
        toast.success(
          `单条下载策略已更新为 ${res.data.guest_download_policy}（当前生效可下载: ${String(res.data.guest_downloadable_effective)}）`,
        );
        setPendingAction(null);
        await invalidateAll();
      } else if (pendingAction.type === 'visibility') {
        const res = await apiClient.adminPatchKeybox(detail.id, {
          visibility: pendingAction.nextVisibility,
        });
        toast.success(`可见性已更新为 ${res.data.visibility}`);
        setPendingAction(null);
        await invalidateAll();
      } else if (pendingAction.type === 'delete') {
        await apiClient.adminDeleteKeybox(detail.id);
        toast.success('已软删除该 Keybox');
        setPendingAction(null);
        await invalidateAll();
        navigate('/admin/keyboxes');
      }
    } catch (err) {
      setActionError(err);
      setPendingAction(null);
    } finally {
      setIsMutating(false);
    }
  };

  const noteBytes = new TextEncoder().encode(noteInput).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/keyboxes"
            className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>返回管理员 Keybox 列表</span>
          </Link>
          {detail && detail.visibility === 'public' && (
            <Link
              to={`/keyboxes/${detail.id}`}
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <span>查看公开视角详情页</span>
            </Link>
          )}
        </div>

        {detail && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRevalidate()}
              disabled={isRevalidating}
              data-testid="admin-detail-revalidate-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRevalidating ? 'animate-spin' : ''}`} />
              <span>{isRevalidating ? '正在重新校验…' : '重新校验'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleAdminDownload()}
              disabled={isDownloading}
              data-testid="admin-download-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isDownloading ? '正在下载…' : '管理员审计下载'}</span>
            </button>

            <button
              type="button"
              onClick={() => setPendingAction({ type: 'delete' })}
              data-testid="admin-detail-delete-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>软删除</span>
            </button>
          </div>
        )}
      </div>

      {detailQuery.error && (
        <ErrorBanner error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
      )}
      {Boolean(actionError) && <ErrorBanner error={actionError} />}

      {detail && (
        <>
          {/* Admin metadata & policy control card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold text-white">
                    Admin Keybox Detail
                  </span>
                  <h1 className="break-all font-mono text-base font-bold text-slate-900">
                    {detail.id}
                  </h1>
                  <StatusBadge status={detail.overall_status} size="lg" showCode />
                  <VisibilityBadge visibility={detail.visibility} />
                </div>
                <p className="text-xs text-slate-500">
                  request_id: <code className="font-mono">{detailQuery.data?.requestId}</code> ·
                  管理详情绝不返回或展示私钥内容
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <EffectiveDownloadBadge effective={detail.guest_downloadable_effective} />
                <PolicyBadge policy={detail.guest_download_policy} />
              </div>
            </div>

            {/* Admin Controls Grid */}
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Visibility control */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs">
                <span className="font-semibold text-slate-900">1. 可见性控制 (visibility)</span>
                <p className="mt-1 text-slate-600">
                  当前为 <code className="font-mono font-semibold">{detail.visibility}</code>。设为{' '}
                  <code className="font-mono">hidden</code> 后公开接口与游客下载均返回 404，但管理员仍可查看和下载。
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setPendingAction({
                      type: 'visibility',
                      nextVisibility: detail.visibility === 'public' ? 'hidden' : 'public',
                    })
                  }
                  className="btn-interactive mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-100"
                >
                  {detail.visibility === 'public' ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      <span>下架隐藏 (设为 hidden)</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span>恢复公开 (设为 public)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Guest download policy control */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs">
                <span className="font-semibold text-amber-950">
                  2. 单条游客下载策略 (guest_download_policy)
                </span>
                <p className="mt-1 text-amber-900">
                  当前全局开关:{' '}
                  <strong>{detail.guest_download_enabled ? '开启 (true)' : '关闭 (false)'}</strong> ·
                  单条策略: <strong>{detail.guest_download_policy}</strong> · 最终生效:{' '}
                  <strong data-testid="admin-detail-effective-flag">
                    {detail.guest_downloadable_effective ? '允许游客下载 (true)' : '禁止游客下载 (false)'}
                  </strong>
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(['inherit', 'allowed', 'denied'] as const).map((pol) => {
                    const active = detail.guest_download_policy === pol;
                    return (
                      <button
                        key={pol}
                        type="button"
                        disabled={active}
                        data-testid={`admin-detail-policy-${pol}`}
                        onClick={() => setPendingAction({ type: 'policy', nextPolicy: pol })}
                        className={`btn-interactive rounded-lg px-2.5 py-1.5 font-medium ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'border border-amber-300 bg-white text-amber-950 hover:bg-amber-100'
                        }`}
                      >
                        {DOWNLOAD_POLICY_META[pol].shortLabel} ({pol})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin note editor */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">3. 管理员备注 (admin_note)</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {noteBytes} / 2000 bytes
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="记录来源、复核说明或下架原因（最长 2000 字节）"
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveNote()}
                  disabled={isSavingNote || noteInput === detail.admin_note}
                  className="btn-interactive mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{isSavingNote ? '保存中…' : '保存备注'}</span>
                </button>
              </div>
            </div>
          </section>

          {/* Current Validation Report */}
          <ValidationReportView
            validation={detail}
            title="当前生效证书链与校验快照"
            expandAllByDefault
          />

          {/* Validation Runs History */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  历史校验运行记录 (GET /api/v1/admin/keyboxes/&#123;id&#125;/validation-runs)
                </h2>
              </div>
              {runsQuery.data && (
                <span className="text-xs text-slate-500">
                  共 {runsQuery.data.data.total} 次可复现安全校验快照
                </span>
              )}
            </div>

            {runsQuery.data && runsQuery.data.data.items.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="px-3.5 py-2.5 font-semibold">运行 ID (id)</th>
                        <th className="px-3.5 py-2.5 font-semibold">校验结论 (overall_status)</th>
                        <th className="px-3.5 py-2.5 font-semibold">信任根版本 / CRL 版本</th>
                        <th className="px-3.5 py-2.5 font-semibold">运行时间 (created_at)</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">快照详情</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runsQuery.data.data.items.map((run) => (
                        <tr key={run.id} className="hover:bg-slate-50">
                          <td className="px-3.5 py-2.5 font-mono text-slate-800">{run.id}</td>
                          <td className="px-3.5 py-2.5">
                            <StatusBadge status={run.overall_status} size="sm" showCode />
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-600">
                            <div>Root: {shortHex(run.root_set_version, 10, 6)}</div>
                            <div>CRL: {shortHex(run.crl_version, 10, 6)}</div>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600">
                            {formatDateTime(run.created_at)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedRun((prev) => (prev?.id === run.id ? null : run))
                              }
                              className="btn-interactive rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              {selectedRun?.id === run.id ? '收起快照' : '查看当次快照'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedRun && (
                  <div className="pt-2">
                    <ValidationReportView
                      validation={selectedRun.validation}
                      title={`历史校验快照详情 (Run ID: ${selectedRun.id} · ${formatDateTime(selectedRun.created_at)})`}
                    />
                  </div>
                )}

                <PaginationBar
                  page={runsQuery.data.data.page}
                  pageSize={runsQuery.data.data.page_size}
                  total={runsQuery.data.data.total}
                  onPageChange={setRunsPage}
                />
              </>
            ) : (
              <p className="text-xs text-slate-500">暂无历史校验运行记录。</p>
            )}
          </section>
        </>
      )}

      {pendingAction?.type === 'policy' && detail && (
        <RiskConfirmModal
          open
          tone="danger"
          isSubmitting={isMutating}
          title="确认修改单条 Keybox 游客下载策略"
          description={`Keybox (${detail.id}) 单条策略将从 "${detail.guest_download_policy}" 变更为 "${pendingAction.nextPolicy}"。`}
          warningBullets={[
            '高危风险警示：Keybox 含硬件认证私钥，允许游客下载等于向公网公开私钥！',
            '一旦私钥被游客下载，后续关闭下载也无法撤回已被复制的私钥副本。',
            '生效规则：仅当全局开关开启 (true) 且单条策略为 inherit 或 allowed 且条目为 public 时，guest_downloadable_effective 才为 true。',
          ]}
          confirmLabel={`确认设为 ${pendingAction.nextPolicy}`}
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'visibility' && detail && (
        <RiskConfirmModal
          open
          tone="warning"
          isSubmitting={isMutating}
          title={
            pendingAction.nextVisibility === 'hidden'
              ? '确认下架隐藏该 Keybox'
              : '确认恢复公开该 Keybox'
          }
          description={`Keybox (${detail.id}) 可见性将变更为 "${pendingAction.nextVisibility}"。`}
          warningBullets={[
            '设为 hidden 后公开详情、列表、证书查询与游客下载均返回 404 (40401)。',
            '设为 public 后将立即对匿名访客展示证书链元数据，并按当前下载策略决定是否允许游客下载。',
          ]}
          confirmLabel={`确认设为 ${pendingAction.nextVisibility}`}
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'delete' && detail && (
        <RiskConfirmModal
          open
          tone="danger"
          isSubmitting={isMutating}
          title="确认软删除该 Keybox"
          description={`调用 DELETE /api/v1/admin/keyboxes/${detail.id} 执行软删除。`}
          warningBullets={[
            '删除后该 Keybox 无法恢复，且公开端与管理端常规列表均不再显示。',
            '文件 SHA-256 与链首证书指纹仍保留在去重表中，重复上传同一文件仍返回 409 (40901)。',
          ]}
          confirmLabel="确认永久软删除"
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

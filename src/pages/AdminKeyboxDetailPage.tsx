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
import { DOWNLOAD_POLICY_META, STATUS_META } from '../api/contract';
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
        `校验完成：${STATUS_META[res.data.overall_status].shortLabel}`,
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
        `已开始下载：${res.filename}`,
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
      toast.error(`备注过长：${byteLen} 字节，上限 2000 字节。`);
      return;
    }
    setIsSavingNote(true);
    setActionError(null);
    try {
      await apiClient.adminPatchKeybox(id, { admin_note: noteInput });
      toast.success('备注已保存');
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
          `下载权限：${DOWNLOAD_POLICY_META[res.data.guest_download_policy].shortLabel}`,
        );
        setPendingAction(null);
        await invalidateAll();
      } else if (pendingAction.type === 'visibility') {
        const res = await apiClient.adminPatchKeybox(detail.id, {
          visibility: pendingAction.nextVisibility,
        });
        toast.success(`已${res.data.visibility === 'public' ? '恢复公开' : '下架'}`);
        setPendingAction(null);
        await invalidateAll();
      } else if (pendingAction.type === 'delete') {
        await apiClient.adminDeleteKeybox(detail.id);
        toast.success('已删除');
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
            <span>返回管理列表</span>
          </Link>
          {detail && detail.visibility === 'public' && (
            <Link
              to={`/keyboxes/${detail.id}`}
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <span>查看公开详情</span>
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
              <span>{isDownloading ? '正在下载…' : '下载原文件'}</span>
            </button>

            <button
              type="button"
              onClick={() => setPendingAction({ type: 'delete' })}
              data-testid="admin-detail-delete-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>删除</span>
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
                    Admin Keybox 详情
                  </span>
                  <h1 className="break-all font-mono text-base font-bold text-slate-900">
                    {detail.id}
                  </h1>
                  <StatusBadge status={detail.overall_status} size="lg" showCode />
                  <VisibilityBadge visibility={detail.visibility} />
                </div>
                <p className="text-xs text-slate-500">
                  request_id: <code className="font-mono">{detailQuery.data?.requestId}</code> ·
                  仅展示证书信息
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
                <span className="font-semibold text-slate-900">可见性</span>
                <p className="mt-1 text-slate-600">
                  下架后仅管理员可查看和下载。
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
                      <span>下架</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span>恢复公开</span>
                    </>
                  )}
                </button>
              </div>

              {/* Guest download policy control */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs">
                <span className="font-semibold text-amber-950">
                  游客下载
                </span>
                <p className="mt-1 text-amber-900">
                  全局：{' '}
                  <strong>{detail.guest_download_enabled ? '开启' : '关闭'}</strong> ·
                  策略：<strong>{DOWNLOAD_POLICY_META[detail.guest_download_policy].shortLabel}</strong> · 生效：{' '}
                  <strong data-testid="admin-detail-effective-flag">
                    {detail.guest_downloadable_effective ? '允许下载' : '禁止下载'}
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
                  <span className="font-semibold text-slate-900">管理员备注</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {noteBytes} / 2000 bytes
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="来源或备注，最多 2000 字节"
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
            title="证书链"
            expandAllByDefault
          />

          {/* Validation Runs History */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  校验历史
                </h2>
              </div>
              {runsQuery.data && (
                <span className="text-xs text-slate-500">
                  共 {runsQuery.data.data.total} 次校验
                </span>
              )}
            </div>

            {runsQuery.data && runsQuery.data.data.items.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="px-3.5 py-2.5 font-semibold">记录 ID</th>
                        <th className="px-3.5 py-2.5 font-semibold">校验结果</th>
                        <th className="px-3.5 py-2.5 font-semibold">信任根版本 / CRL 版本</th>
                        <th className="px-3.5 py-2.5 font-semibold">校验时间</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">详情</th>
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
                              {selectedRun?.id === run.id ? '收起' : '查看详情'}
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
                      title={`校验记录 · ${formatDateTime(selectedRun.created_at)}`}
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
              <p className="text-xs text-slate-500">暂无校验记录。</p>
            )}
          </section>
        </>
      )}

      {pendingAction?.type === 'policy' && detail && (
        <RiskConfirmModal
          open
          tone="danger"
          isSubmitting={isMutating}
          title="修改下载权限？"
          description={`Keybox ${detail.id}：${DOWNLOAD_POLICY_META[detail.guest_download_policy].shortLabel} → ${DOWNLOAD_POLICY_META[pendingAction.nextPolicy].shortLabel}。`}
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

      {pendingAction?.type === 'visibility' && detail && (
        <RiskConfirmModal
          open
          tone="warning"
          isSubmitting={isMutating}
          title={
            pendingAction.nextVisibility === 'hidden'
              ? '下架 Keybox？'
              : '恢复公开？'
          }
          description={`Keybox ${detail.id}`}
          warningBullets={[
            '下架后，访客无法查看或下载。',
            '恢复公开后，访客可查看记录；下载仍受当前权限控制。',
          ]}
          confirmLabel={pendingAction.nextVisibility === 'hidden' ? '确认下架' : '确认恢复'}
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'delete' && detail && (
        <RiskConfirmModal
          open
          tone="danger"
          isSubmitting={isMutating}
          title="删除 Keybox？"
          description={`Keybox ${detail.id}`}
          warningBullets={[
            '删除后将从列表移除，任何人都无法下载。',
            '去重记录会保留，相同文件无法再次上传。',
          ]}
          confirmLabel="确认删除"
          onConfirm={() => void handleConfirmPendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

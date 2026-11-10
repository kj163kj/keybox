import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import {
  EffectiveDownloadBadge,
  PolicyBadge,
  StatusBadge,
} from '../components/StatusBadge';
import { ValidationReportView } from '../components/ValidationReportView';
import { formatDateTime } from '../utils/format';

export function PublicKeyboxDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [lastStatusRequestId, setLastStatusRequestId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['public-keybox-detail', id],
    queryFn: () => apiClient.getKeybox(id),
    enabled: Boolean(id),
  });

  const detail = detailQuery.data?.data;

  const handleRefreshStatus = async () => {
    if (!id || isRefreshingStatus) return;
    setIsRefreshingStatus(true);
    setActionError(null);
    try {
      const res = await apiClient.getKeyboxStatus(id);
      setLastStatusRequestId(res.requestId);
      queryClient.setQueryData(['public-keybox-detail', id], (old: typeof detailQuery.data) => {
        if (!old) return old;
        return {
          requestId: res.requestId,
          data: {
            ...old.data,
            ...res.data.validation,
            status_checked_at: res.data.status_checked_at,
          },
        };
      });
      toast.success('已通过 GET /api/v1/keyboxes/{id}/status 重新计算最新状态');
    } catch (err) {
      setActionError(err);
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const handleGuestDownload = async () => {
    if (!detail || !detail.guest_downloadable_effective || isDownloading) return;
    setIsDownloading(true);
    setActionError(null);
    try {
      const res = await apiClient.downloadGuestKeybox(detail.id);
      toast.success(`已触发浏览器直接下载 (${res.filename})，未在页面内缓存或预览内容`);
    } catch (err) {
      setActionError(err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/"
          className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>返回公开 Keybox 列表</span>
        </Link>

        {detail && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefreshStatus()}
              disabled={isRefreshingStatus}
              data-testid="refresh-public-status-btn"
              className="btn-interactive inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
              <span>{isRefreshingStatus ? '正在重新查询状态…' : '重新查询状态'}</span>
            </button>

            {/*
              STRICT CONTRACT RULE:
              "仅当后端返回的可下载生效字段为 true 时显示“下载 Keybox”按钮，点击直接触发文件下载，不在页面内预览文件内容；
               游客下载按钮显示必须依赖后端返回的“生效可下载”字段 (guest_downloadable_effective)，前端不得自行根据全局开关和单条策略推断。"
            */}
            {detail.guest_downloadable_effective === true ? (
              <button
                type="button"
                onClick={() => void handleGuestDownload()}
                disabled={isDownloading}
                data-testid="guest-download-btn"
                className="btn-interactive inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-amber-700 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{isDownloading ? '正在请求下载…' : '下载 Keybox'}</span>
              </button>
            ) : (
              <span
                data-testid="guest-download-disabled-notice"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-600"
              >
                <Lock className="h-3.5 w-3.5 text-slate-500" />
                <span>管理员未开放下载</span>
              </span>
            )}
          </div>
        )}
      </div>

      {detailQuery.error && (
        <ErrorBanner error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
      )}
      {Boolean(actionError) && <ErrorBanner error={actionError} />}

      {detailQuery.isLoading ? (
        <div className="space-y-4" data-testid="public-detail-skeleton">
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white p-6" />
          <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white p-6" />
        </div>
      ) : detail ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                    <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
                    Keybox Detail
                  </span>
                  <h1 className="break-all font-mono text-base font-bold text-slate-900">
                    {detail.id}
                  </h1>
                  <StatusBadge status={detail.overall_status} size="lg" showCode />
                </div>
                <p className="text-xs text-slate-500">
                  公开详情追踪 request_id:{' '}
                  <code className="font-mono">
                    {lastStatusRequestId ?? detailQuery.data?.requestId}
                  </code>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <EffectiveDownloadBadge effective={detail.guest_downloadable_effective} />
                <PolicyBadge policy={detail.guest_download_policy} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-slate-500">上传时间 (created_at)</span>
                <p className="mt-1 font-medium text-slate-900">
                  {formatDateTime(detail.created_at)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-slate-500">最后完整校验时间 (validated_at)</span>
                <p className="mt-1 font-medium text-slate-900">
                  {formatDateTime(detail.validated_at)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-slate-500">状态重算时间 (status_checked_at)</span>
                <p className="mt-1 font-medium text-slate-900">
                  {formatDateTime(detail.status_checked_at)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <span className="text-slate-500">
                  游客下载判定字段 (guest_downloadable_effective)
                </span>
                <p className="mt-1 font-mono font-semibold text-slate-900">
                  {String(detail.guest_downloadable_effective)}{' '}
                  <span className="font-sans font-normal text-slate-500">
                    (全局: {detail.guest_download_enabled ? '开启' : '关闭'} / 单条:{' '}
                    {detail.guest_download_policy})
                  </span>
                </p>
              </div>
            </div>
          </section>

          <ValidationReportView
            validation={detail}
            title={`证书链与逐证书状态详情（共 ${detail.chains.length} 条链）`}
            expandAllByDefault
          />
        </>
      ) : null}
    </div>
  );
}

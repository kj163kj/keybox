import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  Lock,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  CRL_STATUS_META,
  DOWNLOAD_POLICY_META,
  STATUS_META,
  VISIBILITY_META,
  type CrlStatusValue,
  type StatusTone,
} from '../api/contract';
import type { DownloadPolicy, Status } from '../api/openapi.types';

const TONE_CLASSES: Record<StatusTone, string> = {
  emerald: 'bg-[#34c759]/14 text-[#1d7a34] border-[#34c759]/35 shadow-2xs',
  amber: 'bg-[#ff9500]/15 text-[#9e5800] border-[#ff9500]/35 shadow-2xs',
  rose: 'bg-[#ff3b30]/14 text-[#c41e14] border-[#ff3b30]/35 shadow-2xs',
};

export function StatusBadge({
  status,
  size = 'md',
  showCode = false,
}: {
  status: Status;
  size?: 'sm' | 'md' | 'lg';
  showCode?: boolean;
}) {
  const meta = STATUS_META[status] ?? {
    value: status,
    label: `状态未知 (${status})`,
    shortLabel: '未知',
    tone: 'amber' as const,
    priority: 0,
    description: '状态未知，暂无法确认有效性。',
    allowConfirmUpload: false,
  };

  const Icon =
    meta.tone === 'emerald'
      ? CheckCircle2
      : meta.tone === 'amber'
        ? AlertTriangle
        : XCircle;

  const sizeCls =
    size === 'sm'
      ? 'px-2 py-0.5 text-xs gap-1'
      : size === 'lg'
        ? 'px-3.5 py-1.5 text-sm font-semibold gap-2'
        : 'px-2.5 py-1 text-xs font-medium gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border ${TONE_CLASSES[meta.tone]} ${sizeCls}`}
      title={meta.description}
      data-testid={`status-badge-${status}`}
    >
      <Icon className={size === 'lg' ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'} />
      <span>{showCode ? meta.label : meta.shortLabel}</span>
    </span>
  );
}

export function CrlStatusBadge({ crlStatus }: { crlStatus: CrlStatusValue }) {
  const meta = CRL_STATUS_META[crlStatus] ?? CRL_STATUS_META.unknown;
  const Icon =
    meta.tone === 'emerald'
      ? CheckCircle2
      : meta.tone === 'amber'
        ? HelpCircle
        : ShieldAlert;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[meta.tone]}`}
      title={meta.description}
      data-testid={`crl-badge-${crlStatus}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{meta.label}</span>
    </span>
  );
}

export function EffectiveDownloadBadge({ effective }: { effective: boolean }) {
  if (effective) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900"
        title="可下载原文件，文件含私钥"
      >
        <Download className="h-3.5 w-3.5 shrink-0 text-amber-700" />
        <span>允许游客下载</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
      title="暂未开放游客下载"
    >
      <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      <span>不可下载</span>
    </span>
  );
}

export function PolicyBadge({ policy }: { policy: DownloadPolicy }) {
  const meta = DOWNLOAD_POLICY_META[policy];
  const color =
    policy === 'allowed'
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : policy === 'denied'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-slate-200 bg-slate-100 text-slate-700';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${color}`}
      title={meta.description}
    >
      <span>{meta.shortLabel}</span>
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: 'public' | 'hidden' }) {
  const meta = VISIBILITY_META[visibility];
  const Icon = visibility === 'public' ? Eye : EyeOff;
  const color =
    visibility === 'public'
      ? 'border-sky-200 bg-sky-50 text-sky-800'
      : 'border-slate-300 bg-slate-100 text-slate-700';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${color}`}
      title={meta.description}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{meta.shortLabel}</span>
    </span>
  );
}

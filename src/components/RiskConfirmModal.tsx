import { AlertTriangle, ShieldAlert, X } from 'lucide-react';

export interface RiskConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  warningBullets: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RiskConfirmModal({
  open,
  title,
  description,
  warningBullets,
  confirmLabel,
  cancelLabel = '取消',
  tone = 'danger',
  isSubmitting = false,
  onConfirm,
  onCancel,
}: RiskConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risk-modal-title"
      data-testid="risk-confirm-modal"
    >
      <div className="modal-panel-enter scroll-contain w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                tone === 'danger'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {tone === 'danger' ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 id="risk-modal-title" className="text-base font-semibold text-slate-900">
                {title}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">操作将记入审计日志</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="关闭确认弹窗"
            className="btn-interactive rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-700">{description}</p>

        <div
          className={`mt-4 rounded-xl border p-3.5 text-xs ${
            tone === 'danger'
              ? 'border-rose-200 bg-rose-50/90 text-rose-900'
              : 'border-amber-200 bg-amber-50/90 text-amber-900'
          }`}
        >
          <p className="font-semibold">请确认</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4">
            {warningBullets.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="btn-interactive rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            data-testid="risk-modal-confirm-btn"
            className={`btn-interactive rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs disabled:opacity-50 ${
              tone === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {isSubmitting ? '正在提交…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

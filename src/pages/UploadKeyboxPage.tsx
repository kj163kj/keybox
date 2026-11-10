import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, isMockMode } from '../api/client';
import { MAX_UPLOAD_BYTES, STATUS_META } from '../api/contract';
import { isApiClientError } from '../api/errors';
import type { Validation } from '../api/openapi.types';
import { ErrorBanner } from '../components/ErrorBanner';
import { StatusBadge } from '../components/StatusBadge';
import { ValidationReportView } from '../components/ValidationReportView';
import { formatBytes } from '../utils/format';

export function UploadKeyboxPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientFileError, setClientFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isValidating, setIsValidating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [validationResult, setValidationResult] = useState<Validation | null>(null);
  const [validateRequestId, setValidateRequestId] = useState<string | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    requestId: string;
    fileSha256?: string;
  } | null>(null);

  const cancelActiveRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsValidating(false);
    setIsUploading(false);
    toast.info('已取消当前正在进行的请求');
  };

  const handleSelectAndValidateFile = async (file: File) => {
    // Cancel any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setSelectedFile(file);
    setClientFileError(null);
    setValidationResult(null);
    setValidateRequestId(null);
    setApiError(null);
    setDuplicateConflict(null);

    // Frontend baseline validation: .xml extension and <= MAX_UPLOAD_BYTES (1 MiB)
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setClientFileError(
        `文件扩展名不合法（${file.name}）：仅支持未压缩的 .xml Android Keybox 文件。`,
      );
      return;
    }

    if (file.size === 0) {
      setClientFileError('所选文件为空（0 字节），请选择有效的 .xml Keybox 文件。');
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setClientFileError(
        `文件体积超出限制：当前文件为 ${formatBytes(file.size)}，最大允许 ${formatBytes(MAX_UPLOAD_BYTES)} (1 MiB)。`,
      );
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsValidating(true);

    try {
      const res = await apiClient.validateKeybox(file, { signal: controller.signal });
      setValidationResult(res.data);
      setValidateRequestId(res.requestId);
      if (res.data.overall_status === 'valid') {
        toast.success('上传前预检通过 (overall_status = valid)，可确认上传入库');
      } else {
        toast.warning(`预检完成：总体状态为 ${res.data.overall_status}，禁止正式入库`);
      }
    } catch (err) {
      setApiError(err);
      if (isApiClientError(err) && err.validationData) {
        setValidationResult(err.validationData);
        setValidateRequestId(err.requestId);
      }
    } finally {
      setIsValidating(false);
      abortControllerRef.current = null;
    }
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile || !validationResult || validationResult.overall_status !== 'valid') {
      return;
    }
    if (isUploading || isValidating) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsUploading(true);
    setApiError(null);
    setDuplicateConflict(null);

    try {
      const res = await apiClient.uploadKeybox(selectedFile, { signal: controller.signal });
      toast.success(`Keybox 上传入库成功 (ID: ${res.data.id})`);
      navigate(`/keyboxes/${res.data.id}`);
    } catch (err) {
      setApiError(err);
      if (isApiClientError(err)) {
        if (err.httpStatus === 409 || err.code === 40901) {
          setDuplicateConflict({
            requestId: err.requestId,
            fileSha256: validationResult.file_sha256,
          });
        }
        if (err.validationData) {
          setValidationResult(err.validationData);
        }
      }
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleSelectAndValidateFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleSelectAndValidateFile(file);
    }
  };

  const createSampleFile = (filename: string, sizeBytes = 2048) => {
    const content = '<AndroidAttestation><NumberOfKeyboxes>1</NumberOfKeyboxes></AndroidAttestation>';
    const padded = content.padEnd(sizeBytes, ' ');
    const file = new File([padded], filename, { type: 'application/xml' });
    void handleSelectAndValidateFile(file);
  };

  const canConfirmUpload =
    Boolean(selectedFile) &&
    !clientFileError &&
    !isValidating &&
    !isUploading &&
    validationResult?.overall_status === 'valid';

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            上传 Keybox 与入库前密码学预检
          </h1>
          <p className="text-xs leading-relaxed text-slate-600">
            上传无需登录。选择或拖拽 <code className="font-mono">.xml</code> Keybox 文件后，系统将首先调用{' '}
            <code className="font-mono">POST /api/v1/keyboxes/validate</code>{' '}
            执行封闭 XML 解析、私钥公私钥配对、证书链签名、Google 信任根及 CRL 吊销状态检查。仅当{' '}
            <code className="font-mono">overall_status === "valid"</code> 时才允许正式调用{' '}
            <code className="font-mono">POST /api/v1/keyboxes</code> 入库。
          </p>
        </div>

        {/* Drag and drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (!isValidating && !isUploading) {
              fileInputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          data-testid="upload-dropzone"
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/60'
              : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-100/60'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="upload-file-input"
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-xs">
            <Upload className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            点击选择或拖拽 Android Keybox <code className="font-mono">.xml</code> 文件至此
          </p>
          <p className="mt-1 text-xs text-slate-500">
            仅接受 UTF-8 未压缩 <code className="font-mono">.xml</code> 文件 · 单文件上限{' '}
            <strong className="font-semibold text-slate-700">{formatBytes(MAX_UPLOAD_BYTES)}</strong>{' '}
            (1,048,576 字节) · 前端绝不读取或展示私钥原文
          </p>
          {selectedFile && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 shadow-2xs">
              <FileCode2 className="h-4 w-4 text-indigo-600" />
              <span>{selectedFile.name}</span>
              <span className="text-slate-400">({formatBytes(selectedFile.size)})</span>
            </div>
          )}
        </div>

        {/* Quick scenario presets in Mock mode for rapid verification */}
        {isMockMode() && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              <span>开发期契约场景快速模拟（点击自动构造对应测试文件并触发预检）：</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => createSampleFile('pixel9-valid-keybox.xml')}
                className="btn-interactive rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 hover:bg-emerald-100"
              >
                1. 有效 Keybox (valid)
              </button>
              <button
                type="button"
                onClick={() => createSampleFile('oem-revoked-chain.xml')}
                className="btn-interactive rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-900 hover:bg-rose-100"
              >
                2. 含已吊销与根不受信链 (revoked)
              </button>
              <button
                type="button"
                onClick={() => createSampleFile('crl-unknown-indeterminate.xml')}
                className="btn-interactive rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100"
              >
                3. CRL 不可用/不确定 (indeterminate)
              </button>
              <button
                type="button"
                onClick={() => createSampleFile('duplicate-keybox.xml')}
                className="btn-interactive rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
              >
                4. 预检有效但入库重复 (409 / 40901)
              </button>
              <button
                type="button"
                onClick={() => createSampleFile('malformed-422.xml')}
                className="btn-interactive rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
              >
                5. XML/密钥解析失败 (422 / 42201)
              </button>
              <button
                type="button"
                onClick={() => createSampleFile('rate-limit-429.xml')}
                className="btn-interactive rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
              >
                6. 触发配额限流 (429 + Retry-After)
              </button>
              <button
                type="button"
                onClick={() => createSampleFile('service-unavailable-503.xml')}
                className="btn-interactive rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
              >
                7. 依赖服务不可用 (503 / 50301)
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Client-side file validation error */}
      {clientFileError && (
        <div
          role="alert"
          data-testid="client-file-error"
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div>
            <p className="font-semibold">前端文件前置校验未通过（已拦截上传请求）</p>
            <p className="mt-1 text-rose-800">{clientFileError}</p>
          </div>
        </div>
      )}

      {/* In-flight progress with Cancel button */}
      {(isValidating || isUploading) && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/80 p-4 text-xs text-indigo-950"
          data-testid="upload-progress-bar"
        >
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            <span className="font-medium">
              {isValidating
                ? '正在调用 POST /api/v1/keyboxes/validate 执行密码学与证书链预检…'
                : '正在调用 POST /api/v1/keyboxes 执行完整重验与加密入库…'}
            </span>
          </div>
          <button
            type="button"
            onClick={cancelActiveRequest}
            data-testid="cancel-request-btn"
            className="btn-interactive rounded-lg border border-indigo-300 bg-white px-3 py-1 font-medium text-indigo-900 hover:bg-indigo-100"
          >
            取消请求
          </button>
        </div>
      )}

      {/* 409 Duplicate conflict notice */}
      {duplicateConflict && (
        <div
          role="alert"
          data-testid="duplicate-conflict-banner"
          className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-xs text-amber-950 shadow-2xs"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-amber-950">
                  该 Keybox 或证书链材料已存在 (HTTP 409 · code 40901)
                </h2>
                <code className="rounded bg-white/80 px-2 py-0.5 font-mono text-[11px] text-amber-900">
                  request_id: {duplicateConflict.requestId}
                </code>
              </div>
              <p className="leading-relaxed text-amber-900">
                服务端对文件 SHA-256、证书指纹集合摘要及链首叶证书指纹同时执行去重检查。
                <strong>契约说明：</strong>根据 <code className="font-mono">api/openapi.json</code> 中{' '}
                <code className="font-mono">Error409</code> 契约定义，409 响应的{' '}
                <code className="font-mono">data</code> 固定为 <code className="font-mono">null</code>
                （因去重范围包含管理员隐藏或软删除记录，服务端不直接回传已有记录 ID 以防枚举）。
              </p>
              {duplicateConflict.fileSha256 && (
                <p className="font-mono text-[11px] text-amber-800">
                  当前文件 SHA-256：{duplicateConflict.fileSha256}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {validationResult?.chains?.[0]?.certificates?.[0]?.fingerprint_sha256 && (
                  <Link
                    to={`/certificates?type=fingerprint&q=${encodeURIComponent(
                      validationResult.chains[0].certificates[0].fingerprint_sha256,
                    )}`}
                    className="btn-interactive inline-flex items-center gap-1.5 rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white hover:bg-amber-800"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>按链首证书指纹查询已有 Keybox ID</span>
                  </Link>
                )}
                <Link
                  to="/"
                  className="btn-interactive inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
                >
                  <span>返回公开 Keybox 列表</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Error Banner */}
      {Boolean(apiError) && (
        <ErrorBanner
          error={apiError}
          onRetry={
            selectedFile
              ? () => {
                  void handleSelectAndValidateFile(selectedFile);
                }
              : undefined
          }
        />
      )}

      {/* Validation result + Confirm Upload decision gate */}
      {validationResult && (
        <div className="space-y-4">
          <div
            className={`rounded-2xl border p-5 shadow-2xs ${
              canConfirmUpload
                ? 'border-emerald-200 bg-emerald-50/70'
                : 'border-rose-200 bg-rose-50/60'
            }`}
            data-testid="upload-decision-box"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {canConfirmUpload ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-rose-600" />
                  )}
                  <span className="text-sm font-bold text-slate-900">
                    {canConfirmUpload
                      ? '预检全部通过：允许正式上传入库'
                      : '预检未通过或状态不确定：已禁止正式上传'}
                  </span>
                  <StatusBadge status={validationResult.overall_status} showCode />
                </div>
                <p className="text-xs text-slate-700">
                  {STATUS_META[validationResult.overall_status]?.description}
                </p>
                {validateRequestId && (
                  <p className="font-mono text-[11px] text-slate-500">
                    预检 request_id: {validateRequestId}
                  </p>
                )}
              </div>

              {/* Rule: 只有总体有效时才显示“确认上传”按钮；无效/不确定时禁用上传并给出原因 */}
              {canConfirmUpload ? (
                <button
                  type="button"
                  onClick={() => void handleConfirmUpload()}
                  disabled={isUploading || isValidating}
                  data-testid="confirm-upload-btn"
                  className="btn-interactive inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  <span>{isUploading ? '正在上传入库…' : '确认上传'}</span>
                </button>
              ) : (
                <div
                  className="rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-xs font-medium text-rose-800"
                  data-testid="upload-disabled-reason"
                >
                  原因：总体结论为{' '}
                  <code className="font-mono font-semibold">{validationResult.overall_status}</code>
                  （非 <code className="font-mono">valid</code>），服务端{' '}
                  <code className="font-mono">POST /api/v1/keyboxes</code> 将以 42202 拒绝入库
                </div>
              )}
            </div>
          </div>

          <ValidationReportView
            validation={validationResult}
            title="上传前预检详细报告（已默认展开异常链与异常证书）"
          />
        </div>
      )}
    </div>
  );
}

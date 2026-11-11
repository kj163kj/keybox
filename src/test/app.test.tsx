import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes, createAppQueryClient } from '../App';
import { AuthProvider } from '../context/AuthContext';
import {
  resetMockState,
  setMockGlobalGuestDownload,
  setMockRecordPolicy,
} from '../api/mock';
import { setCsrfToken } from '../api/client';
import { getPreviewCredentials } from '../api/preview-config';

function renderWithRouter(initialEntries: string[] = ['/']) {
  const queryClient = createAppQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Keybox Frontend Contract-Driven Suite', () => {
  it('local preview credentials can be filled and used to enter the admin pages', async () => {
    const user = userEvent.setup();
    resetMockState({ authenticated: false });
    renderWithRouter(['/admin/login']);
    await user.click(await screen.findByTestId('preview-login-fill-btn'));
    expect(screen.getByTestId('login-username-input')).toHaveValue(getPreviewCredentials()!.username);
    expect(screen.getByTestId('login-password-input')).toHaveValue(getPreviewCredentials()!.password);
    await user.click(screen.getByTestId('login-submit-btn'));
    expect(await screen.findByRole('heading', { name: 'Keybox 管理' })).toBeInTheDocument();
  });
  it('1. 预检上传完整流程：选择有效 XML -> 调用上传前校验展示逐链逐证书 -> 显示确认上传按钮 -> 成功后跳转详情页', async () => {
    const user = userEvent.setup();
    renderWithRouter(['/upload']);

    const fileInput = screen.getByTestId('upload-file-input') as HTMLInputElement;
    const validXmlFile = new File(
      ['<?xml version="1.0"?><AndroidAttestation><Keybox/></AndroidAttestation>'],
      'pixel9-valid-keybox.xml',
      { type: 'application/xml' },
    );

    await user.upload(fileInput, validXmlFile);

    // Wait for pre-upload validation report
    await waitFor(() => {
      expect(screen.getByTestId('chain-card-1')).toBeInTheDocument();
    });

    // Chains and certificates are displayed without exposing private key material
    expect(screen.getByTestId('cert-item-1-0')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-upload-btn')).toBeEnabled();
    expect(document.body.textContent).not.toContain('BEGIN EC PRIVATE KEY');
    expect(document.body.textContent).not.toContain('BEGIN RSA PRIVATE KEY');

    // Click confirm upload -> navigates to /keyboxes/:id
    await user.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('refresh-public-status-btn')).toBeInTheDocument();
    });
  });

  it('2. 无效文件与 CRL 未知状态：前端拦截非 .xml/超大文件；吊销或 CRL 未知(indeterminate)时禁用上传且不展示为有效', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithRouter(['/upload']);

    const fileInput = screen.getByTestId('upload-file-input') as HTMLInputElement;

    // Client-side extension check
    const invalidExtFile = new File(['not xml'], 'bad.txt', { type: 'text/plain' });
    await user.upload(fileInput, invalidExtFile);

    expect(await screen.findByTestId('client-file-error')).toHaveTextContent(
      '请选择未压缩的 .xml 文件',
    );

    // Server-side CRL unknown -> indeterminate must NOT be shown as valid and must disable upload
    const crlUnknownFile = new File(['<AndroidAttestation/>'], 'crl-unknown-indeterminate.xml', {
      type: 'application/xml',
    });
    await user.upload(fileInput, crlUnknownFile);

    await waitFor(() => {
      expect(screen.getByTestId('upload-disabled-reason')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('confirm-upload-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('upload-decision-box')).toHaveTextContent(
      '校验未通过，暂不能上传',
    );
    expect(screen.getAllByTestId('crl-badge-unknown')[0]).toHaveTextContent(
      '状态未知',
    );
  });

  it('3. 重复上传处理：返回 HTTP 409 (code 40901, data: null) 时提示已存在并提供按链首证书指纹检索入口', async () => {
    const user = userEvent.setup();
    renderWithRouter(['/upload']);

    const fileInput = screen.getByTestId('upload-file-input') as HTMLInputElement;
    const duplicateFile = new File(['<AndroidAttestation/>'], 'duplicate-keybox.xml', {
      type: 'application/xml',
    });

    await user.upload(fileInput, duplicateFile);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-upload-btn')).toBeEnabled();
    });

    await user.click(screen.getByTestId('confirm-upload-btn'));

    const conflictBanner = await screen.findByTestId('duplicate-conflict-banner');
    expect(conflictBanner).toHaveTextContent('40901');
    expect(conflictBanner).toHaveTextContent('查找已有记录');
  });

  it('4. 证书查询页：前端校验非法十六进制输入，空结果展示明确空状态且状态为 indeterminate（绝不判定为有效）', async () => {
    const user = userEvent.setup();
    renderWithRouter(['/certificates']);

    const searchInput = screen.getByTestId('cert-search-input');
    const submitBtn = screen.getByTestId('cert-search-submit-btn');

    // Invalid hex input
    await user.type(searchInput, 'not-a-hex-serial!!');
    await user.click(submitBtn);
    expect(await screen.findByTestId('cert-input-error')).toHaveTextContent(
      '序列号仅支持十六进制字符',
    );

    // Valid hex serial that does not exist in DB -> empty result + indeterminate status
    await user.clear(searchInput);
    await user.type(searchInput, 'deadbeef99999999');
    await user.click(submitBtn);

    const emptyState = await screen.findByTestId('cert-search-empty');
    expect(emptyState).toHaveTextContent('未找到匹配证书');
    expect(screen.getByTestId('cert-query-summary')).toHaveTextContent('不确定');
  });

  it('5. 管理员未登录跳转：未登录访问 /admin/keyboxes 自动跳转至 /admin/login', async () => {
    const user = userEvent.setup();
    resetMockState({ authenticated: false });
    renderWithRouter(['/']);

    // Top header merges admin links into a single "后台管理" entry
    const adminEntry = screen.getByTestId('nav-admin-entry');
    expect(adminEntry).toHaveTextContent('后台管理');
    expect(screen.queryByRole('link', { name: 'Keybox 管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '审计日志' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '系统设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理员登录' })).not.toBeInTheDocument();

    await user.click(adminEntry);

    await waitFor(() => {
      expect(screen.getByTestId('login-submit-btn')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: '管理员登录' })).toBeInTheDocument();
  });

  it('6. 游客下载按钮显示逻辑：严格依赖后端 guest_downloadable_effective，全局关闭时即使单条为 allowed 也不可下载，全局开启但单条为 denied 也不可下载', async () => {
    // Case A: Global OFF (default), record 1f2e... has guest_download_policy = 'allowed'
    // Backend returns guest_downloadable_effective = false
    resetMockState({ globalGuestDownloadEnabled: false });
    setMockRecordPolicy('1f2e3d4c5b6a79880123456789abcdef', 'allowed');

    const { unmount } = renderWithRouter(['/keyboxes/1f2e3d4c5b6a79880123456789abcdef']);

    await waitFor(() => {
      expect(screen.getByTestId('guest-download-disabled-notice')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('guest-download-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('guest-download-disabled-notice')).toHaveTextContent('暂未开放下载');
    unmount();

    // Case B: Global ON, record 4d5e... has guest_download_policy = 'denied'
    // Backend returns guest_downloadable_effective = false
    resetMockState({ globalGuestDownloadEnabled: true });
    setMockRecordPolicy('4d5e6f708192a3b4c5d6e7f8091a2b3c', 'denied');

    const { unmount: unmountB } = renderWithRouter(['/keyboxes/4d5e6f708192a3b4c5d6e7f8091a2b3c']);

    await waitFor(() => {
      expect(screen.getByTestId('guest-download-disabled-notice')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('guest-download-btn')).not.toBeInTheDocument();
    unmountB();

    // Case C: Global ON, record 1f2e... has guest_download_policy = 'allowed'
    // Backend returns guest_downloadable_effective = true -> Download button IS shown
    resetMockState({ globalGuestDownloadEnabled: true });
    setMockRecordPolicy('1f2e3d4c5b6a79880123456789abcdef', 'allowed');

    renderWithRouter(['/keyboxes/1f2e3d4c5b6a79880123456789abcdef']);

    const downloadBtn = await screen.findByTestId('guest-download-btn');
    expect(downloadBtn).toBeInTheDocument();
    expect(downloadBtn).toHaveTextContent('下载 Keybox');
  });

  it('7. 403 下载未开放与 429 限流 Retry-After 倒计时处理', async () => {
    const user = userEvent.setup();

    // First: render detail when global download is enabled, then flip global switch OFF before clicking download to simulate race 403 (40301)
    resetMockState({ globalGuestDownloadEnabled: true });
    const { unmount } = renderWithRouter(['/keyboxes/1f2e3d4c5b6a79880123456789abcdef']);

    const downloadBtn = await screen.findByTestId('guest-download-btn');
    // Admin closes global switch right before guest clicks download
    setMockGlobalGuestDownload(false);

    await user.click(downloadBtn);

    const errorBanner = await screen.findByTestId('api-error-banner');
    expect(errorBanner).toHaveTextContent('40301');
    expect(errorBanner).toHaveTextContent('下载未开放');
    unmount();

    // Second: test 429 rate limit with Retry-After countdown on Upload page
    renderWithRouter(['/upload']);
    const fileInput = screen.getByTestId('upload-file-input') as HTMLInputElement;
    const rateLimitFile = new File(['<AndroidAttestation/>'], 'rate-limit-429.xml', {
      type: 'application/xml',
    });
    await user.upload(fileInput, rateLimitFile);

    const countdown = await screen.findByTestId('retry-after-countdown');
    expect(countdown).toHaveTextContent('秒后再试');
    expect(screen.getByTestId('api-error-banner')).toHaveTextContent('42901');
  });

  it('8. 管理员系统设置页：开启全局游客下载开关必须弹出高危私钥暴露确认框，确认后更新状态', async () => {
    const user = userEvent.setup();
    resetMockState({ globalGuestDownloadEnabled: false, authenticated: true });
    setCsrfToken('c5f0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab');

    renderWithRouter(['/admin/system']);

    await waitFor(() => {
      expect(screen.getByTestId('global-switch-status-badge')).toHaveTextContent('已关闭');
    });

    await user.click(screen.getByTestId('toggle-global-download-btn'));

    // RiskConfirmModal must appear with strong warning about private keys
    const modal = await screen.findByTestId('risk-confirm-modal');
    expect(modal).toHaveTextContent('私钥');

    const confirmBtn = screen.getByTestId('risk-modal-confirm-btn');
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('global-switch-status-badge')).toHaveTextContent('已开启');
    });
  });
});

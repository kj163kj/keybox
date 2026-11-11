import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes, createAppQueryClient } from '../App';
import { AuthProvider } from '../context/AuthContext';
import { apiClient, setApiMockMode } from '../api/client';
import { ApiClientError } from '../api/errors';
import { resetMockState } from '../api/mock';
import type { AdminSetupStatus } from '../api/openapi.types';
import { utf8ByteLength } from '../utils/credentials';

const requestId = 'a'.repeat(32);
const reply = (data: AdminSetupStatus) => ({ data, requestId });
const fresh = { initialized: false, setup_available: true };
const complete = { initialized: true, setup_available: false };

function renderSetup(path = '/admin/setup') {
  resetMockState({ authenticated: false });
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, confirmMatches = true) {
  // Random per test; never a deployable default.
  const token = crypto.randomUUID();
  const password = crypto.randomUUID().slice(0, 8);
  await user.type(await screen.findByLabelText('初始化令牌'), token);
  await user.type(screen.getByLabelText('用户名'), 'operator');
  await user.type(screen.getByLabelText('密码', { exact: true }), password);
  await user.type(screen.getByLabelText('确认密码'), confirmMatches ? password : password + 'x');
  return { setup_token: token, username: 'operator', password };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('First administrator Web setup', () => {
  it('redirects a fresh installation from login to setup', async () => {
    vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply(fresh));
    renderSetup('/admin/login');
    expect(await screen.findByRole('heading', { name: '初始化管理员' })).toBeInTheDocument();
    expect(await screen.findByLabelText('初始化令牌')).toHaveAttribute('type', 'password');
    expect(screen.queryByTestId('admin-login-form')).not.toBeInTheDocument();
  });

  it('shows deployment guidance with no form when a setup token is not configured', async () => {
    const status = vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply({ ...fresh, setup_available: false }));
    renderSetup();
    expect(await screen.findByText('请先在服务端配置初始化令牌，再刷新此页。')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-setup-form')).not.toBeInTheDocument();
    status.mockResolvedValue(reply(fresh));
    await userEvent.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByTestId('admin-setup-form')).toBeInTheDocument();
  });

  it('fails closed on a status error and supports retry', async () => {
    const status = vi.spyOn(apiClient, 'adminSetupStatus').mockRejectedValue(new ApiClientError({
      httpStatus: 503, code: 50301, serverMessage: 'service unavailable', requestId,
    }));
    renderSetup('/admin/login');
    expect(await screen.findByTestId('api-error-banner')).toHaveTextContent('50301');
    expect(screen.queryByTestId('admin-login-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-setup-form')).not.toBeInTheDocument();
    status.mockResolvedValue(reply(fresh));
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('admin-setup-form')).toBeInTheDocument();
  });

  it('creates an account with eight bytes after confirming the password, then clears secrets before login', async () => {
    const user = userEvent.setup();
    const status = vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply(fresh));
    const create = vi.spyOn(apiClient, 'adminSetup').mockImplementation(async (input) => {
      status.mockResolvedValue(reply(complete));
      return { data: { initialized: true, admin: { id: 'b'.repeat(32), username: input.username } }, requestId };
    });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    renderSetup();
    const input = await fillForm(user, false);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    expect(await screen.findByText('两次密码不一致')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('确认密码'));
    await user.type(screen.getByLabelText('确认密码'), input.password);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    expect(create).toHaveBeenCalledExactlyOnceWith(input);
    expect(await screen.findByTestId('admin-login-form')).toBeInTheDocument();
    expect(screen.getByTestId('login-username-input')).toHaveValue(input.username);
    expect(screen.getByTestId('login-password-input')).toHaveValue('');
    expect(screen.getByText('管理员已创建，请登录。')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-setup-form')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(input.setup_token);
    expect(document.body.textContent).not.toContain(input.password);
    expect(storage).not.toHaveBeenCalled();
  });

  it('enforces UTF-8 byte limits and disables resubmission while creating', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply(fresh));
    const create = vi.spyOn(apiClient, 'adminSetup').mockReturnValue(new Promise(() => {}));
    renderSetup();
    await fillForm(user);
    const password = screen.getByLabelText('密码', { exact: true });
    const confirm = screen.getByLabelText('确认密码');
    const tooLong = '密'.repeat(25);
    expect(utf8ByteLength(tooLong)).toBe(75);
    await user.clear(password);
    await user.clear(confirm);
    await user.type(password, tooLong);
    await user.type(confirm, tooLong);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    expect(await screen.findByText('密码须为 8–72 字节')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    const valid = '密'.repeat(24);
    await user.clear(password);
    await user.clear(confirm);
    await user.type(password, valid);
    await user.type(confirm, valid);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled();
    expect(password).toBeDisabled();
  });

  it.each([
    ['ASCII', 'a'.repeat(7), 'a'.repeat(8)],
    ['UTF-8', '密钥a', '密钥ab'],
  ])('rejects seven bytes and accepts eight bytes for %s passwords', async (_label, shortPassword, validPassword) => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply(fresh));
    const create = vi.spyOn(apiClient, 'adminSetup').mockReturnValue(new Promise(() => {}));
    renderSetup();
    await fillForm(user);
    const password = screen.getByLabelText('密码', { exact: true });
    const confirm = screen.getByLabelText('确认密码');
    expect(utf8ByteLength(shortPassword)).toBe(7);
    expect(utf8ByteLength(validPassword)).toBe(8);
    await user.clear(password);
    await user.clear(confirm);
    await user.type(password, shortPassword);
    await user.type(confirm, shortPassword);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    expect(await screen.findByText('密码须为 8–72 字节')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.clear(password);
    await user.clear(confirm);
    await user.type(password, validPassword);
    await user.type(confirm, validPassword);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    await waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ password: validPassword })));
  });

  it('keeps the form on an invalid token and resolves a concurrent initialization', async () => {
    const user = userEvent.setup();
    const status = vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply(fresh));
    const create = vi.spyOn(apiClient, 'adminSetup').mockRejectedValue(new ApiClientError({
      httpStatus: 401, code: 40102, serverMessage: 'invalid setup token', requestId,
    }));
    renderSetup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    expect(await screen.findByTestId('api-error-banner')).toHaveTextContent('初始化令牌错误');
    expect(screen.getByTestId('admin-setup-form')).toBeInTheDocument();
    status.mockResolvedValue(reply(complete));
    create.mockRejectedValue(new ApiClientError({
      httpStatus: 409, code: 40904, serverMessage: 'admin setup already completed', requestId,
    }));
    await user.click(screen.getByRole('button', { name: '创建管理员' }));
    expect(await screen.findByTestId('admin-login-form')).toBeInTheDocument();
    expect(screen.getByTestId('login-password-input')).toHaveValue('');
  });

  it('redirects an initialized deployment to login without offering setup', async () => {
    vi.spyOn(apiClient, 'adminSetupStatus').mockResolvedValue(reply(complete));
    renderSetup();
    expect(await screen.findByTestId('admin-login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-setup-form')).not.toBeInTheDocument();
  });

  it('uses real setup endpoints with JSON, no-store and no credentials in URLs', async () => {
    setApiMockMode(false);
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      code: 0, message: 'ok', request_id: requestId, data: fresh,
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const input = { setup_token: crypto.randomUUID(), username: 'operator', password: crypto.randomUUID() };
    await apiClient.adminSetupStatus();
    await apiClient.adminSetup(input);
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/admin/setup', expect.objectContaining({
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/admin/setup', expect.objectContaining({
      method: 'POST', cache: 'no-store', credentials: 'same-origin', body: JSON.stringify(input),
    }));
    const headers = fetch.mock.calls[1][1].headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-CSRF-Token')).toBeNull();
  });
});

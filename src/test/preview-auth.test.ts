import { describe, expect, it, vi } from 'vitest';
import { apiClient, isMockMode, setApiMockMode } from '../api/client';
import { mockApi } from '../api/mock';
import { getPreviewCredentials, isPreviewAvailable } from '../api/preview-config';
import { mockApi as disabledMockApi } from '../api/mock-disabled';

describe('Local preview authentication isolation', () => {
  it('accepts the configured preview credentials and rejects arbitrary passwords or usernames', async () => {
    const credentials = getPreviewCredentials()!;
    expect(credentials.password.length).toBeGreaterThanOrEqual(16);
    await expect(mockApi.adminLogin({ ...credentials, password: credentials.password + 'wrong' }))
      .rejects.toMatchObject({ code: 40101 });
    await expect(mockApi.adminLogin({ ...credentials, username: 'someone_else' }))
      .rejects.toMatchObject({ code: 40101 });
    const result = await mockApi.adminLogin(credentials);
    expect(result.data.admin.username).toBe(credentials.username);
  });

  it('cannot enable preview on a non-loopback host and sends login to the real API', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, message: 'ok', request_id: 'a'.repeat(32),
      data: {
        admin: { id: 'b'.repeat(32), username: 'real_admin' },
        csrf_token: 'c'.repeat(64), expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('location', { hostname: 'keybox.example.com' });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      setApiMockMode(true);
      expect(isPreviewAvailable()).toBe(false);
      expect(isMockMode()).toBe(false);
      expect(getPreviewCredentials()).toBeNull();
      await apiClient.adminLogin({ username: 'real_admin', password: 'submitted-password' });
      expect(fetchSpy).toHaveBeenCalledWith('/api/v1/admin/login', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'real_admin', password: 'submitted-password' }),
      }));
    } finally {
      vi.unstubAllGlobals();
      setApiMockMode(true);
    }
  });

  it('the production substitute cannot provide any mock login implementation', () => {
    expect(() => disabledMockApi.adminLogin).toThrow('Preview API is unavailable');
  });
});

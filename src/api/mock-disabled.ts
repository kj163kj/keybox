import type { mockApi as previewApi } from './mock';

// The real mock implementation is not part of the production module graph.
export const mockApi = new Proxy({} as typeof previewApi, {
  get() {
    throw new Error('Preview API is unavailable in this build.');
  },
});

export function nextRequestId(): string {
  return globalThis.crypto.randomUUID().replaceAll('-', '');
}

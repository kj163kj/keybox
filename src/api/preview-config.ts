import type { LoginInput } from './openapi.types';

export function isPreviewAvailable(): boolean {
  return __KEYBOX_PREVIEW__ &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(globalThis.location?.hostname ?? '');
}

// These constants are empty in every non-preview build. The local preview is
// only a mock account and never creates a backend administrator or session.
export function getPreviewCredentials(): LoginInput | null {
  if (!isPreviewAvailable()) return null;
  return {
    username: __KEYBOX_PREVIEW_USERNAME__,
    password: __KEYBOX_PREVIEW_PASSWORD__,
  };
}

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetMockState } from '../api/mock';
import { setApiMockMode, setCsrfToken } from '../api/client';

// Mock HTMLAnchorElement.prototype.click in jsdom so anchor downloads don't trigger navigation warnings
if (typeof HTMLAnchorElement !== 'undefined') {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
}

afterEach(() => {
  cleanup();
  setApiMockMode(true);
  setCsrfToken(null);
  resetMockState();
});

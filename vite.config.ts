import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode, command }) => {
  const preview = mode === 'preview';
  const testing = mode === 'test' && command === 'serve';
  const allowMock = preview || testing;
  const env = preview ? loadEnv(mode, process.cwd(), 'KEYBOX_PREVIEW_') : {};
  const username = testing ? 'test_preview_admin' : preview ? env.KEYBOX_PREVIEW_USERNAME : '';
  const password = testing ? randomBytes(24).toString('base64url') : preview ? env.KEYBOX_PREVIEW_PASSWORD : '';
  if (preview && (!username || !password || password.length < 16 || Buffer.byteLength(password) > 72)) {
    throw new Error('Run npm run setup:preview first; preview credentials must be configured locally.');
  }

  const isolation: Plugin = {
    name: 'keybox-preview-isolation',
    generateBundle(_options, bundle) {
      if (!preview) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue;
          const forbidden = Object.keys(output.modules).find((id) =>
            /\/src\/(?:api\/mock\.ts|test\/)/.test(id.replaceAll('\\', '/')),
          );
          if (forbidden) this.error('Production build must not contain mock or test modules.');
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'keybox-build.json',
        source: JSON.stringify({ mode: preview ? 'preview' : 'production', apiMode: preview ? 'mock' : 'live' }),
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), isolation],
    define: {
      __KEYBOX_PREVIEW__: JSON.stringify(allowMock),
      __KEYBOX_PREVIEW_USERNAME__: JSON.stringify(username || ''),
      __KEYBOX_PREVIEW_PASSWORD__: JSON.stringify(password || ''),
    },
    resolve: {
      alias: {
        '@keybox-preview-api': fileURLToPath(new URL(
          allowMock ? './src/api/mock.ts' : './src/api/mock-disabled.ts', import.meta.url,
        )),
      },
    },
    build: {
      outDir: preview ? 'dist-preview' : 'dist',
      sourcemap: false,
    },
    preview: {
      host: '127.0.0.1',
      proxy: {},
      strictPort: true,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: false,
        },
        '/healthz': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: false,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});

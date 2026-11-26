import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error Development-only local receiver is plain JavaScript.
import {localPlaygroundReceiver} from './playground-local.mjs';

const backend = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.QUOTACELL_BACKEND_URL || 'http://127.0.0.1:4173';
export default defineConfig({
  plugins: [localPlaygroundReceiver(), react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
        configure(proxy) {
          // The existing backend binds its browser API to its own exact local origin.
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', backend));
        },
      },
      '/wallet.js': { target: backend, changeOrigin: true },
      '/legacy': { target: backend, changeOrigin: true, rewrite: () => '/' },
    },
  },
});

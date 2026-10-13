import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
    license: { fileName: 'THIRD_PARTY_LICENSES.md' },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(?:@firebase|firebase)\//.test(id)) return 'firebase';
        },
      },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./client/src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/oauth': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
});

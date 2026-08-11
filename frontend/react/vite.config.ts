import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build constraints (see plans/react-frontend-migration.md):
// - base './' so the file also opens from disk (file://), like the old
//   dashboard_final.html single-file export.
// - vite-plugin-singlefile inlines ALL JS + CSS into index.html.
// - inlineDynamicImports so there are no code-split chunks (they'd be relative
//   asset URLs that don't exist beside the served file).
// - sourcemap false: source never ships with the bundle.
// - Dev server proxies /api to the running backend container (:8000) so the
//   browser never makes a cross-origin request (backend has no CORS headers).
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100000000, // inline fonts/svg as data: URIs
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

export default defineConfig(({ mode }) => {
  // Environment lives in the repo root .env so API and web stay in sync.
  const env = loadEnv(mode, repoRoot, '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:4000';

  return {
    envDir: repoRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(dirname, './src'),
        '@saarthi/shared': path.resolve(repoRoot, 'packages/shared/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true },
        '/ws': { target: apiUrl, ws: true, changeOrigin: true },
      },
    },
    preview: { port: 4173 },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            map: ['maplibre-gl'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});

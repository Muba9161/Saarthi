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

  // Reaching the dev server through a tunnel — VS Code dev tunnels, ngrok,
  // cloudflared — needs the tunnel hostname on Vite's allow-list, or every
  // request comes back "Blocked request. This host is not allowed." A leading
  // dot matches the domain and its subdomains, which is what these providers
  // hand out: the host changes each time the tunnel is recreated, so pinning
  // one exact name would break on the next restart.
  //
  // This only relaxes Vite's DNS-rebinding guard for hosts already pointed at
  // this machine on purpose; it exposes nothing by itself. DEV_ALLOWED_HOSTS
  // adds any others. DEV_HOST=true binds past localhost, which a tunnel run
  // from another machine (or a phone on the LAN) needs.
  const allowedHosts = [
    '.devtunnels.ms',
    '.ngrok-free.app',
    '.ngrok.io',
    '.trycloudflare.com',
    '.loca.lt',
    ...(env.DEV_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ];
  const devHost = env.DEV_HOST === 'true' ? true : (env.DEV_HOST ?? false);

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
      ...(devHost === false ? {} : { host: devHost }),
      allowedHosts,
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true },
        '/ws': { target: apiUrl, ws: true, changeOrigin: true },
      },
    },
    preview: { port: 4173 },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      css: false,
    },
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

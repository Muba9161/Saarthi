import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

/*
 * Keep the repo-root .env from deciding whether this is a production build.
 *
 * The root .env is the API's, and it carries NODE_ENV — `development` on every
 * developer machine. Because `envDir` points Vite at that same file, Vite read
 * it, copied it into VITE_USER_NODE_ENV, and forced `vite build` back into
 * development mode. The result was a "production" bundle that shipped
 * react-dom.development.js (2x the bytes and far slower rendering), left
 * `import.meta.env.DEV` true so dev-only UI rendered for real customers, and
 * skipped the production paths of every library that branches on NODE_ENV.
 *
 * Vite only consults VITE_USER_NODE_ENV when it is unset, and only acts on it
 * when it is truthy. Claiming it with an empty string, at module scope so this
 * runs before Vite loads the env files, leaves NODE_ENV at the default for the
 * command being run: production for `build`, development for `dev`. That is
 * the intent, and it no longer depends on what any .env happens to say.
 *
 * The assertion below is the backstop: if a future Vite renames this, the
 * build fails loudly instead of silently shipping a development bundle again.
 */
process.env.VITE_USER_NODE_ENV ??= '';

export default defineConfig(({ mode, command }) => {
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
  // loadEnv hands back raw strings, so DEV_HOST=false arrives as the string
  // 'false' — truthy, which made Vite treat it as a hostname and fail the
  // dev server with `getaddrinfo ENOTFOUND false`. Normalise the boolean
  // spellings first; anything else is a real host/IP and passes through.
  const rawDevHost = (env.DEV_HOST ?? '').trim().toLowerCase();
  const devHost =
    rawDevHost === '' || rawDevHost === 'false'
      ? false
      : rawDevHost === 'true'
        ? true
        : (env.DEV_HOST ?? '').trim();

  /*
   * A production build that is not in production mode is worth failing over.
   * It is invisible in the output — the bundle builds, deploys and runs — but
   * it ships development React, so every render pays for prop validation and
   * warning machinery the user gets nothing from. Better a red build than a
   * slow one nobody notices. `WEB_ALLOW_DEV_BUILD=true` is the escape hatch
   * for deliberately building a debuggable bundle.
   */
  if (command === 'build' && process.env.NODE_ENV !== 'production') {
    if (env.WEB_ALLOW_DEV_BUILD !== 'true') {
      throw new Error(
        `Refusing to build the web app with NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}. ` +
          'A production build must run in production mode, or it ships development React. ' +
          'Set WEB_ALLOW_DEV_BUILD=true if a development build is genuinely what you want.',
      );
    }
  }

  /*
   * Source maps are a deploy-time cost, not a runtime one — browsers fetch
   * them only when devtools is open — but they quadrupled `dist` to 21 MB and
   * roughly doubled build time, and they publish the full source of a private
   * codebase to anyone who looks. Off by default for a release; set
   * WEB_SOURCEMAP=true to get them back, or `hidden` to emit them for an error
   * tracker without advertising them to browsers.
   */
  const sourcemapSetting = env.WEB_SOURCEMAP;
  const sourcemap =
    sourcemapSetting === 'hidden' ? ('hidden' as const) : sourcemapSetting === 'true';

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
      sourcemap,
      rollupOptions: {
        output: {
          /*
           * Split by package, not by entry point.
           *
           * The object form of `manualChunks` looked equivalent and was not:
           * naming `recharts` pulls its whole dependency tree into that chunk,
           * including anything it merely happens to share with the rest of the
           * app. clsx is 400 bytes and is used by `cn()` on almost every
           * component, so it was swept into the charts chunk and the entry
           * then had to import it from there — putting all 432 kB of recharts,
           * lodash and d3 on the critical path of every page load, including
           * the marketing site and the sign-in screen, neither of which draws
           * a chart.
           *
           * Matching ids keeps each rule to the library's own files. Shared
           * utilities stay where Rollup would have put them, and a library
           * reached only from a lazy route stays lazy.
           */
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // Rollup ids arrive with Windows separators on Windows.
            const normalized = id.split('\\').join('/');

            /*
             * The always-loaded base, claimed first.
             *
             * clsx and tailwind-merge back `cn()`, so the entry needs them on
             * every page — but recharts uses clsx too, and Rollup resolves a
             * dependency shared with a named chunk by moving it *into* that
             * chunk. Leaving them unassigned is what put 400 bytes of clsx
             * inside the charts chunk and made the entry import 432 kB of
             * charting code it never renders. Naming them here settles the
             * question before the recharts rule can.
             */
            if (
              /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router|clsx|tailwind-merge|class-variance-authority)\//.test(
                normalized,
              )
            ) {
              return 'react';
            }

            if (normalized.includes('/node_modules/maplibre-gl/')) return 'map';
            if (normalized.includes('/node_modules/recharts/')) return 'charts';

            /*
             * framer-motion is needed on every entry path — the app shell, the
             * sign-in layout and the marketing pages all animate — so this is
             * not about loading less of it. It is about not re-downloading it:
             * inside the entry chunk, one line of app code changed its hash
             * and every returning user fetched 400 kB of animation library
             * again. On its own it survives a deploy in cache.
             */
            if (/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(normalized)) {
              return 'motion';
            }
            return undefined;
          },
        },
      },
    },
  };
});

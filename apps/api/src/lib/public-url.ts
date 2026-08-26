import type { FastifyRequest } from 'fastify';
import { config } from '../config/env';

/**
 * Where the web app actually lives, from the API's point of view.
 *
 * This exists for QR codes. A code encodes an absolute URL, so something has to
 * decide the host — and `FRONTEND_URL` is pinned to localhost in every checkout,
 * which meant a code generated while developing through a dev tunnel or from a
 * phone on the LAN encoded `http://localhost:5173` and was unscannable anywhere
 * but the machine that made it.
 *
 * The rule is split by environment, because the two cases want opposite things:
 *
 *   * In production the configured URL always wins. Stickers get printed and
 *     glued to vehicles, so the host has to be the canonical one and has to stay
 *     correct for years. Deriving it from the request would also be a genuine
 *     vulnerability — anyone who could reach the API with a forged `Host` or
 *     `Origin` could mint stickers pointing at a domain they control, and the
 *     resulting artefact looks completely legitimate.
 *
 *   * Outside production the request wins, because "wherever I am reaching this
 *     from" is exactly what a developer means. Only recognisably local or
 *     tunnelled origins are accepted; anything else falls back to the config.
 */

/**
 * Hostnames the dev-tunnel providers hand out.
 *
 * The subdomain changes every time a tunnel is recreated, so the domain is what
 * can be matched. Shared with the CORS policy so the two cannot drift: an origin
 * good enough to call the API is good enough to put in a development QR code.
 */
export const DEV_TUNNEL_ORIGIN =
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(devtunnels\.ms|ngrok-free\.app|ngrok\.io|trycloudflare\.com|loca\.lt)$/i;

/**
 * Loopback and private-range origins.
 *
 * The private ranges matter as much as localhost: testing a QR code means
 * scanning it with a phone, and the phone reaches the dev server on the
 * machine's LAN address, never on `localhost`.
 */
const LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/i;

/** Origins a development QR code is allowed to point at. */
function isUsableOrigin(origin: string): boolean {
  if (config.server.corsOrigins.includes(origin)) return true;
  return LOCAL_ORIGIN.test(origin) || DEV_TUNNEL_ORIGIN.test(origin);
}

/** The origin of a URL, or null if it is not one. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The origin the browser is on, if we can tell.
 *
 * Two headers, in order of trustworthiness. `Origin` is set on cross-origin
 * requests and on same-origin writes, and Vite's proxy forwards it unchanged.
 * `Referer` covers the rest: the app calls the API same-origin through that
 * proxy, so a plain GET — which is what fetching a QR image is — carries no
 * `Origin` at all, and the referring page URL is the only remaining signal.
 *
 * `Host` is deliberately not consulted. Vite proxies with `changeOrigin`, which
 * rewrites it to the API's own address, so it describes the proxy rather than
 * the browser.
 */
function requestOrigin(request: FastifyRequest): string | null {
  for (const candidate of [header(request, 'origin'), header(request, 'referer')]) {
    const origin = originOf(candidate);
    if (origin && isUsableOrigin(origin)) return origin;
  }
  return null;
}

/**
 * The base URL to build user-facing links on for this request.
 *
 * Returns the configured `FRONTEND_URL` in production, or whenever the request
 * gives us nothing better to go on.
 */
export function publicAppUrl(request: FastifyRequest): string {
  if (config.isProduction) return config.server.frontendUrl;
  return requestOrigin(request) ?? config.server.frontendUrl;
}

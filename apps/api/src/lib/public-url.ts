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
 *
 * Exported and used by the CORS policy for the same reason `DEV_TUNNEL_ORIGIN`
 * is — an origin good enough to put in a development QR code is an origin good
 * enough to call the API from. Keeping two lists in step by hand is how a
 * developer ends up with a code that encodes an address the browser that made
 * it is not allowed to talk to.
 */
export const LOCAL_ORIGIN =
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
 * Three signals, in this order, and the order is the whole point.
 *
 * 1. **`X-Forwarded-Host` + `X-Forwarded-Proto`.** What a reverse proxy states
 *    the client actually asked for. This has to come first because a dev tunnel
 *    *rewrites* `Origin` to the local address it forwards to — a VS Code tunnel
 *    turns `https://xyz.devtunnels.ms` into `http://localhost:5173` — and a
 *    loopback origin is indistinguishable from a developer genuinely working on
 *    localhost. Trusting `Origin` first meant every QR code generated through a
 *    tunnel encoded `localhost`, which is the one address a phone can never
 *    reach.
 * 2. **`Origin`.** Correct when there is no proxy in the way, and set on
 *    cross-origin requests and same-origin writes.
 * 3. **`Referer`.** The fallback for a plain GET — fetching a QR image carries
 *    no `Origin` at all — and, as it happens, the one header dev tunnels leave
 *    alone.
 *
 * `Host` is still not consulted: Vite proxies with `changeOrigin`, which
 * rewrites it to the API's own address, so it describes the proxy rather than
 * the browser.
 *
 * None of this is reachable in production, where the caller of both public
 * helpers returns the configured URL before asking. That matters, because
 * `X-Forwarded-Host` is attacker-controlled on a server that does not sit
 * behind a proxy it trusts.
 */
function forwardedOrigin(request: FastifyRequest): string | null {
  const host = header(request, 'x-forwarded-host');
  if (!host) return null;

  // A chain of proxies appends, so the first entry is the client's own view.
  const first = host.split(',')[0]?.trim();
  if (!first) return null;

  const proto = header(request, 'x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https';
  return originOf(`${proto}://${first}`);
}

function requestOrigin(request: FastifyRequest): string | null {
  const candidates = [
    forwardedOrigin(request),
    originOf(header(request, 'origin')),
    originOf(header(request, 'referer')),
  ];

  for (const origin of candidates) {
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

/**
 * The base URL to point a *device* at for this request.
 *
 * The same problem as `publicAppUrl` and the same rule. A device pairing QR
 * encodes where the phone should send its telemetry, and `API_URL` is pinned to
 * `http://localhost:4000` in every checkout — the one address a phone can never
 * reach, because on a phone `localhost` is the phone.
 *
 * ## Why this returns the browser's own origin
 *
 * The dev server proxies `/api` and `/ws` straight through to the API, so
 * whatever address reached the dashboard also reaches the API. That makes the
 * browser's origin the *right* answer rather than merely a convenient one, and
 * it is the only answer that holds for both ways of developing:
 *
 *   * **On a LAN** — `http://192.168.1.20:5173` proxies to :4000. Pointing the
 *     phone at :4000 directly would also work, but only if that second port is
 *     open through the firewall, and there is no reason to require two.
 *   * **Through a tunnel** — `https://abc-5173.devtunnels.ms` is a single host
 *     on 443 with no port to speak of. Swapping in the API's port would produce
 *     `https://abc-5173.devtunnels.ms:4000`, which nothing is listening on;
 *     tunnel providers hand out one hostname per forwarded port, and the API's
 *     is a different name this request cannot know.
 *
 * One rule covers both because the proxy is what makes them the same case.
 *
 * Production returns the configured URL unchanged, for the same reason the app
 * URL does: a pairing code minted from a forged `Origin` would point a fleet's
 * devices at somebody else's server, and the QR would look entirely legitimate.
 */
export function publicApiUrl(request: FastifyRequest): string {
  if (config.isProduction) return config.server.apiUrl;

  const origin = requestOrigin(request);
  if (!origin) return config.server.apiUrl;

  // Loopback is reachable from this machine and nowhere else, so it says
  // nothing about where a phone should connect. Fall back and let the developer
  // set API_URL if they genuinely meant an address only they can reach.
  if (/^https?:\/\/(localhost|127\.|\[::1\])/i.test(origin)) {
    return config.server.apiUrl;
  }

  return origin;
}

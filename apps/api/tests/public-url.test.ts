import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

/**
 * Which host a QR code points at.
 *
 * The stakes are lopsided, which is why this is tested rather than assumed. In
 * development the cost of getting it wrong is a code that cannot be scanned
 * from a phone; in production it is a printed sticker, glued to a vehicle,
 * pointing at a domain someone else controls. So the production half of these
 * tests is a security boundary, not a convenience.
 */

const CONFIGURED = 'http://localhost:5173';

async function loadWith(isProduction: boolean, corsOrigins: string[] = [CONFIGURED]) {
  vi.resetModules();
  vi.doMock('../src/config/env', () => ({
    config: {
      isProduction,
      server: { frontendUrl: CONFIGURED, corsOrigins },
    },
  }));
  return import('../src/lib/public-url');
}

function request(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

afterEach(() => {
  vi.doUnmock('../src/config/env');
  vi.resetModules();
});

describe('publicAppUrl in development', () => {
  let publicAppUrl: (request: FastifyRequest) => string;

  beforeEach(async () => {
    ({ publicAppUrl } = await loadWith(false));
  });

  it('falls back to the configured URL when the request says nothing', () => {
    expect(publicAppUrl(request({}))).toBe(CONFIGURED);
  });

  it('follows the Origin header, so a LAN or tunnel session is scannable', () => {
    expect(publicAppUrl(request({ origin: 'https://abc123-5173.inc1.devtunnels.ms' }))).toBe(
      'https://abc123-5173.inc1.devtunnels.ms',
    );
    expect(publicAppUrl(request({ origin: 'http://192.168.1.14:5173' }))).toBe(
      'http://192.168.1.14:5173',
    );
  });

  /*
   * The app calls the API same-origin through Vite's proxy, so a plain GET —
   * which is what fetching a QR image is — carries no Origin at all. Without
   * the Referer fallback the image endpoints would keep encoding localhost
   * while the JSON endpoints had already moved on, which is worse than either
   * being wrong on its own.
   */
  it('falls back to Referer, which is all a same-origin GET carries', () => {
    expect(
      publicAppUrl(request({ referer: 'https://abc123-5173.inc1.devtunnels.ms/fleet/trucks/9' })),
    ).toBe('https://abc123-5173.inc1.devtunnels.ms');
  });

  it('prefers Origin over Referer', () => {
    expect(
      publicAppUrl(
        request({ origin: 'http://192.168.1.14:5173', referer: 'http://localhost:5173/qr' }),
      ),
    ).toBe('http://192.168.1.14:5173');
  });

  it('ignores hosts that are neither local, tunnelled, nor allowed by CORS', () => {
    expect(publicAppUrl(request({ origin: 'https://evil.example.com' }))).toBe(CONFIGURED);
    expect(publicAppUrl(request({ referer: 'https://evil.example.com/x' }))).toBe(CONFIGURED);
  });

  it('ignores a public host that merely contains a tunnel domain', () => {
    expect(publicAppUrl(request({ origin: 'https://devtunnels.ms.evil.example.com' }))).toBe(
      CONFIGURED,
    );
  });

  it('ignores junk and non-http schemes rather than throwing', () => {
    expect(publicAppUrl(request({ origin: 'not a url' }))).toBe(CONFIGURED);
    expect(publicAppUrl(request({ origin: 'javascript:alert(1)' }))).toBe(CONFIGURED);
    expect(publicAppUrl(request({ referer: '' }))).toBe(CONFIGURED);
  });

  it('accepts anything explicitly listed in CORS_ORIGINS', async () => {
    ({ publicAppUrl } = await loadWith(false, ['https://staging.vorldxsaarthi.com']));
    expect(publicAppUrl(request({ origin: 'https://staging.vorldxsaarthi.com' }))).toBe(
      'https://staging.vorldxsaarthi.com',
    );
  });
});

describe('publicAppUrl in production', () => {
  let publicAppUrl: (request: FastifyRequest) => string;

  beforeEach(async () => {
    ({ publicAppUrl } = await loadWith(true));
  });

  /*
   * A printed sticker outlives the request that made it. If the host could be
   * steered by a header, anyone able to reach the API could mint stickers that
   * look entirely legitimate and send every scan to a site they control.
   */
  it('never lets a request header choose the host', () => {
    for (const headers of [
      { origin: 'https://evil.example.com' },
      { referer: 'https://evil.example.com/x' },
      { host: 'evil.example.com' },
      { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-proto': 'https' },
      { origin: 'http://localhost:5173' },
      { origin: 'https://abc123-5173.inc1.devtunnels.ms' },
    ] as Record<string, string>[]) {
      expect(publicAppUrl(request(headers))).toBe(CONFIGURED);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { qrTargetUrl, readScannedQr } from './qr';

/**
 * What a camera pointed at a yard is allowed to conclude.
 *
 * The cases that matter are the refusals. A driver holding a phone at a
 * windscreen has no way to tell "that code is not ours" from "the camera is
 * broken" unless the two are told apart here, so every input that is not a
 * Saarthi identity code has to come back as something the UI can explain.
 */
describe('readScannedQr', () => {
  const token = 'a'.repeat(43);

  it('reads the URL a printed sticker actually encodes', () => {
    expect(readScannedQr(qrTargetUrl('https://fleet.saarthi.in', token))).toEqual({
      kind: 'IDENTITY',
      token,
    });
  });

  it('accepts a code printed against a different host', () => {
    // A sticker printed last year carries last year's domain, and the same
    // sticker is scanned through a dev tunnel and through production. The
    // token identifies the code; the host it was printed to point at does not.
    expect(readScannedQr(`https://04k5qd5v-5173.inc1.devtunnels.ms/q/${token}`)).toEqual({
      kind: 'IDENTITY',
      token,
    });
  });

  it('ignores a query string and surrounding whitespace', () => {
    expect(readScannedQr(`  https://fleet.saarthi.in/q/${token}?utm=print \n`)).toEqual({
      kind: 'IDENTITY',
      token,
    });
  });

  it('accepts a bare token, for a link pasted without its host', () => {
    expect(readScannedQr(token)).toEqual({ kind: 'IDENTITY', token });
  });

  it('names a terminal pairing code rather than staying silent', () => {
    // The exact mix-up this exists for: the tablet's setup code and the
    // vehicle's identity code are both QRs on a screen in the same cab.
    const payload = JSON.stringify({
      v: 1,
      kind: 'saarthi.terminal.pair',
      api: 'https://api.saarthi.in',
      token: 'irrelevant',
    });
    expect(readScannedQr(payload)).toEqual({ kind: 'PAIRING', target: 'TERMINAL' });
  });

  it('names a device pairing code too', () => {
    const payload = JSON.stringify({ v: 1, kind: 'saarthi.device.pair', token: 'x' });
    expect(readScannedQr(payload)).toEqual({ kind: 'PAIRING', target: 'DEVICE' });
  });

  it('reports somebody else’s QR as foreign, not as a bad read', () => {
    expect(readScannedQr('https://example.com/track/12345')).toEqual({
      kind: 'FOREIGN',
      value: 'https://example.com/track/12345',
    });
  });

  it('refuses a short code as an identity token', () => {
    // The eight-character label under a sticker finds a record; it is not the
    // credential, and treating it as one would send a request that always 404s.
    expect(readScannedQr('ABCD-EFGH').kind).toBe('FOREIGN');
  });

  it('refuses an empty scan', () => {
    expect(readScannedQr('   ').kind).toBe('FOREIGN');
  });

  it('does not throw on malformed JSON', () => {
    expect(readScannedQr('{not json').kind).toBe('FOREIGN');
  });
});

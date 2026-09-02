import QRCode from 'qrcode';
import { qrTargetUrl } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';

/**
 * QR rendering.
 *
 * The bare code, with no branding around it — used for on-screen display and
 * for sharing over messaging apps. The branded, print-ready artefact lives in
 * `sticker.renderer.ts`.
 *
 * Error correction defaults to level Q rather than the usual M, because these
 * end up on windscreens and driver cards where they get dirty, creased and
 * partly obscured. Level Q restores up to ~25% of codewords, which measured on
 * a typical Saarthi payload means a contiguous blot of roughly 14% of the
 * symbol area — not 25% of the area, a distinction worth keeping straight.
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface RenderOptions {
  size?: number;
  errorCorrection?: ErrorCorrectionLevel;
  margin?: number;
  /**
   * Where the code should point. Defaults to the configured frontend, which is
   * right in production; callers holding a request pass `publicAppUrl(request)`
   * so a code made through a dev tunnel is scannable off this machine.
   */
  baseUrl?: string;
}

function targetFor(token: string, baseUrl?: string): string {
  return qrTargetUrl(baseUrl ?? config.server.frontendUrl, token);
}

/**
 * Render an arbitrary payload, with no URL wrapping.
 *
 * `renderSvg` below encodes a *link* — a Saarthi identity code points a phone's
 * default camera app at a web page. A device pairing code is not that: it is a
 * bearer credential read by one specific app, and turning it into a URL would
 * mean any passer-by's camera offered to open it.
 *
 * Error correction stays at the same level for the same reason: this is read
 * off a screen at arm's length, sometimes through a cracked one.
 */
export async function renderPayloadSvg(
  payload: string,
  options: Omit<RenderOptions, 'baseUrl'> = {},
): Promise<string> {
  const size = Math.min(options.size ?? 512, config.qr.maxImageSize);
  try {
    return await QRCode.toString(payload, {
      type: 'svg',
      width: size,
      margin: options.margin ?? 4,
      errorCorrectionLevel: options.errorCorrection ?? 'Q',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch (error) {
    throw errors.internal('The QR image could not be generated.', error);
  }
}

/**
 * The same, as a data URI ready for an `<img src>`.
 *
 * Returned inline with the pairing code so the dashboard renders it without a
 * second round trip and without a QR library of its own — and, because it is an
 * image rather than markup, without any component having to inject HTML.
 */
export async function renderPayloadDataUri(
  payload: string,
  options: Omit<RenderOptions, 'baseUrl'> = {},
): Promise<string> {
  const svg = await renderPayloadSvg(payload, options);
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * The same payload as a PNG data URI.
 *
 * For native clients. The SVG variant above is right for a browser and useless
 * to an Android `BitmapFactory`, which decodes PNG, JPEG and WebP and has never
 * decoded SVG — so a terminal handed the SVG form renders nothing at all, with
 * no error, which is exactly the bug this exists to prevent.
 *
 * Rendered at the size the caller asks for rather than scaled on the device: a
 * QR upscaled from a small bitmap loses the crisp module edges a camera needs to
 * read it at arm's length.
 */
export async function renderPayloadPngDataUri(
  payload: string,
  options: Omit<RenderOptions, 'baseUrl'> = {},
): Promise<string> {
  const size = Math.min(options.size ?? 512, config.qr.maxImageSize);
  try {
    const buffer = await QRCode.toBuffer(payload, {
      type: 'png',
      width: size,
      margin: options.margin ?? 4,
      errorCorrectionLevel: options.errorCorrection ?? 'Q',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    throw errors.internal('The QR image could not be generated.', error);
  }
}

export async function renderSvg(token: string, options: RenderOptions = {}): Promise<string> {
  const size = Math.min(options.size ?? 512, config.qr.maxImageSize);
  try {
    return await QRCode.toString(targetFor(token, options.baseUrl), {
      type: 'svg',
      width: size,
      margin: options.margin ?? 4,
      errorCorrectionLevel: options.errorCorrection ?? 'Q',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch (error) {
    throw errors.internal('The QR image could not be generated.', error);
  }
}

export async function renderPng(token: string, options: RenderOptions = {}): Promise<Buffer> {
  const size = Math.min(options.size ?? 512, config.qr.maxImageSize);
  try {
    return await QRCode.toBuffer(targetFor(token, options.baseUrl), {
      type: 'png',
      width: size,
      margin: options.margin ?? 4,
      errorCorrectionLevel: options.errorCorrection ?? 'Q',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch (error) {
    throw errors.internal('The QR image could not be generated.', error);
  }
}

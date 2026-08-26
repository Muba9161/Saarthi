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

import QRCode from 'qrcode';
import { badgePreset, qrTargetUrl, shortTokenLabel } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';

/**
 * QR rendering.
 *
 * SVG for screen and print, PNG for messaging apps. Error correction defaults
 * to level Q (25%) rather than the usual M, because these end up on windscreens
 * and driver cards where they get dirty, creased and partly obscured — a code
 * that stops scanning after a month of road grime is not a working feature.
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface RenderOptions {
  size?: number;
  errorCorrection?: ErrorCorrectionLevel;
  margin?: number;
}

function targetFor(token: string): string {
  return qrTargetUrl(config.server.frontendUrl, token);
}

export async function renderSvg(token: string, options: RenderOptions = {}): Promise<string> {
  const size = Math.min(options.size ?? 512, config.qr.maxImageSize);
  try {
    return await QRCode.toString(targetFor(token), {
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
    return await QRCode.toBuffer(targetFor(token), {
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

/** Escape text for inclusion in SVG markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Truncate to fit the badge without overflowing its box. */
function fit(value: string, maxChars: number): string {
  const clean = value.trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
}

export interface BadgeInput {
  token: string;
  presetKey: string;
  title: string;
  subtitle: string | null;
  /** Third line: fleet or organization name. */
  organizationName: string | null;
  verified: boolean;
}

/**
 * A print-ready badge.
 *
 * Sized in millimetres with a matching viewBox so it prints at true physical
 * size rather than whatever the browser guesses. The short token is printed
 * beneath the code so a gate operator has a fallback when the sticker will not
 * scan — it identifies the record, and the API still requires the full token, so
 * it is a lookup aid rather than a credential.
 */
export async function renderBadgeSvg(input: BadgeInput): Promise<string> {
  const preset = badgePreset(input.presetKey);
  const isCard = preset.key === 'driver-card';

  // Render the code itself without a quiet zone; the badge layout provides it.
  const codeSvg = await QRCode.toString(targetFor(input.token), {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'Q',
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  // Strip the wrapper so the code can be positioned inside the badge.
  const inner = codeSvg
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();

  const width = preset.widthMm;
  const height = preset.heightMm;

  // Card: code on the left, text to the right. Sticker: code above, text below.
  const codeSize = isCard ? height - 16 : width - 24;
  const codeX = isCard ? 8 : (width - codeSize) / 2;
  const codeY = isCard ? 8 : 10;

  const textX = isCard ? codeX + codeSize + 6 : width / 2;
  const textAnchor = isCard ? 'start' : 'middle';
  const textTop = isCard ? 16 : codeY + codeSize + 8;

  const titleSize = isCard ? 4.6 : 5.2;
  const bodySize = isCard ? 3 : 3.4;

  const verifiedMark = input.verified
    ? `<text x="${textX}" y="${textTop + bodySize * 4.2}" font-size="${bodySize * 0.9}" fill="#15803d" text-anchor="${textAnchor}" font-family="Helvetica, Arial, sans-serif">✓ Verified on Saarthi</text>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="3" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.4"/>
  <g transform="translate(${codeX} ${codeY}) scale(${codeSize / 100})">
    <g transform="scale(${100 / 100})">${inner}</g>
  </g>
  <text x="${textX}" y="${textTop}" font-size="${titleSize}" font-weight="700" fill="#0f172a" text-anchor="${textAnchor}" font-family="Helvetica, Arial, sans-serif">${escapeXml(fit(input.title, isCard ? 20 : 24))}</text>
  ${
    input.subtitle
      ? `<text x="${textX}" y="${textTop + bodySize * 1.8}" font-size="${bodySize}" fill="#475569" text-anchor="${textAnchor}" font-family="Helvetica, Arial, sans-serif">${escapeXml(fit(input.subtitle, isCard ? 26 : 32))}</text>`
      : ''
  }
  ${
    input.organizationName
      ? `<text x="${textX}" y="${textTop + bodySize * 3}" font-size="${bodySize}" fill="#475569" text-anchor="${textAnchor}" font-family="Helvetica, Arial, sans-serif">${escapeXml(fit(input.organizationName, isCard ? 26 : 32))}</text>`
      : ''
  }
  ${verifiedMark}
  <text x="${textX}" y="${height - 4}" font-size="${bodySize * 0.95}" fill="#94a3b8" text-anchor="${textAnchor}" font-family="ui-monospace, Menlo, monospace" letter-spacing="0.3">${escapeXml(shortTokenLabel(input.token))}</text>
</svg>`;
}

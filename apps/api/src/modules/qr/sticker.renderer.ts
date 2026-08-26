import QRCode from 'qrcode';
import { shortTokenLabel } from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { BRAND, PRINT, stickerPreset, type StickerPreset } from './sticker.theme';
import { LOGO_MARK_DATA_URI, LOGO_MARK_HEIGHT, LOGO_MARK_WIDTH } from './assets/logo-mark';

/**
 * Printable Saarthi QR stickers.
 *
 * Output is SVG rather than a raster, for two reasons. It is vector, so it
 * prints at whatever DPI the printer has instead of whatever DPI we guessed;
 * and it needs no native image library, which keeps the API free of a build
 * dependency. The document is sized in millimetres with a matching viewBox, so
 * "print at 100%" produces a physically correct 100 mm sticker.
 *
 * The design constraints come from where these end up. A cab door is dirty,
 * lit badly, and read from a couple of metres by someone holding a phone at an
 * angle — so the QR is oversized, sits on pure white with a generous quiet
 * zone, and the registration is set large enough to read without scanning at
 * all. Colour is used for identity and hierarchy, never behind the code.
 */

export interface StickerInput {
  token: string;
  presetKey: string;
  /** Registration number, or the driver's name. The line people read. */
  title: string;
  /** Make, model, licence class — the supporting line. */
  subtitle: string | null;
  /** Operating fleet or business. */
  organizationName: string | null;
  verified: boolean;
  /** DRIVER stickers get a different call to action from VEHICLE ones. */
  subjectKind: 'VEHICLE' | 'DRIVER' | 'OTHER';
  /** Draw bleed and crop marks for a commercial print run. */
  printMarks?: boolean;
  /**
   * Reverse the artwork left-to-right, for a windscreen sticker fitted to the
   * *inside* of the glass with the printed face against it. Verified that a
   * mirrored code still decodes — the QR specification allows for mirrored
   * symbols and scanners detect the orientation from the finder patterns.
   */
  mirror?: boolean;
}

/**
 * Escape for XML, and force the output to pure ASCII.
 *
 * The declaration says UTF-8, but these files are downloaded, re-saved, emailed
 * to print shops and opened in whatever a signwriter has installed — and
 * somewhere in that chain a byte stream gets read as Windows-1252. An em-dash
 * then arrives as "â€"", or worse loses its tail and shows as a bare "â".
 *
 * Numeric character references are 7-bit ASCII and survive that intact, so
 * every character above U+007F is emitted as one. This is what keeps a
 * Devanagari or Tamil driver name legible on a printed card rather than turning
 * it into rubble.
 */
function escapeXml(value: string): string {
  let out = '';
  for (const character of value) {
    switch (character) {
      case '&':
        out += '&amp;';
        continue;
      case '<':
        out += '&lt;';
        continue;
      case '>':
        out += '&gt;';
        continue;
      case '"':
        out += '&quot;';
        continue;
      case "'":
        out += '&apos;';
        continue;
      default:
        break;
    }
    const point = character.codePointAt(0)!;
    out += point > 0x7f ? `&#${point};` : character;
  }
  return out;
}

/** Em-dash as a reference, so the separator itself cannot be mangled. */
const EM_DASH = '&#8212;';

// ---------------------------------------------------------------------------
// Text measurement
//
// SVG has no text layout: a `<text>` element runs straight past its box rather
// than wrapping, and there is no way to ask the renderer how wide a string came
// out. Fitting by character count is the usual shortcut and it is wrong in both
// directions — "MMMMMMMMMM" and "iiiiiiiiii" are the same ten characters and
// nearly triple the width apart. These estimate width from the actual glyphs,
// which is close enough to lay out a name field that must not overflow into the
// QR panel beside it.
// ---------------------------------------------------------------------------

/** Glyphs materially narrower than the average, as a fraction of the average. */
const NARROW_GLYPHS = new Set([...`iljtfrI.,:;'\`|!()[]{}- `]);
const WIDE_GLYPHS = new Set([...'mwMW@%']);

interface TextMetrics {
  bold?: boolean;
  mono?: boolean;
  /** Extra tracking, in the same units as the font size. */
  letterSpacing?: number;
}

/**
 * Approximate rendered width, in the same units as `fontSize`.
 *
 * Tuned for the Helvetica/Arial stack these artefacts specify. It is an
 * estimate, so every caller leaves a margin rather than laying out to the
 * millimetre against it.
 */
function estimateTextWidth(text: string, fontSize: number, metrics: TextMetrics = {}): number {
  if (metrics.mono) {
    // Monospace is exact: every advance is the same, ~0.6 em for Menlo/Plex.
    return (
      text.length * fontSize * 0.6 + Math.max(0, text.length - 1) * (metrics.letterSpacing ?? 0)
    );
  }

  const base = metrics.bold ? 0.56 : 0.52;
  let units = 0;
  for (const character of text) {
    if (NARROW_GLYPHS.has(character)) units += base * 0.45;
    else if (WIDE_GLYPHS.has(character)) units += base * 1.5;
    else if (character >= 'A' && character <= 'Z') units += base * 1.16;
    else units += base;
  }
  return units * fontSize + Math.max(0, text.length - 1) * (metrics.letterSpacing ?? 0);
}

/** Shorten until it fits, appending an ellipsis. */
function ellipsize(
  text: string,
  maxWidth: number,
  fontSize: number,
  metrics: TextMetrics = {},
): string {
  if (estimateTextWidth(text, fontSize, metrics) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && estimateTextWidth(`${out}…`, fontSize, metrics) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

/**
 * Break text onto at most `maxLines`, ellipsising whatever still does not fit.
 *
 * A person's name is the one field on a card that must not be cut: "Venkataraman
 * Subramanian" truncated to "Venkataraman Subr…" is worse than useless on an ID.
 */
function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  metrics: TextMetrics = {},
): string[] {
  const words = text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || estimateTextWidth(candidate, fontSize, metrics) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) {
      current = '';
      break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Words that never made it on signal the loss on the final line.
  const placed = lines.join(' ').split(' ').filter(Boolean).length;
  const overflowed = placed < words.length;

  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const needsMark = isLast && overflowed;
    const rendered = needsMark ? `${line}…` : line;
    return ellipsize(rendered, maxWidth, fontSize, metrics);
  });
}

/**
 * The QR, as a self-contained `<svg>` ready to be positioned.
 *
 * Returned as a nested SVG with its own viewBox rather than a scaled group.
 * The generator's viewBox is the module count — 41×41 for this payload length,
 * but it changes with the data — so any fixed scale factor is wrong the moment
 * the token length changes. A nested viewBox scales exactly, whatever the
 * module count turns out to be.
 */
async function qrBlock(targetUrl: string, x: number, y: number, size: number): Promise<string> {
  let raw: string;
  try {
    raw = await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 0,
      // Level Q restores up to ~25% of *codewords* — which is not the same as
      // 25% of the sticker's area, and the difference matters here. Measured on
      // this payload (41x41): a contiguous blot survives to about 14% of the
      // symbol, while scattered speckle fails around 10%, because each isolated
      // flipped module ruins a whole codeword rather than sharing one. Damage
      // over a finder pattern defeats any level, since the decoder can no longer
      // locate the grid.
      errorCorrectionLevel: 'Q',
      color: { dark: BRAND.ink, light: '#ffffff00' },
    });
  } catch (error) {
    throw errors.internal('The QR sticker could not be generated.', error);
  }

  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 41 41';
  const inner = raw
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();

  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${viewBox}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

/** Aspect ratio of the VX mark, so callers can size a box that fits it. */
export const LOGO_MARK_RATIO = LOGO_MARK_WIDTH / LOGO_MARK_HEIGHT;

/** Helvetica's ink extent above and below the baseline, as fractions of the em. */
const ASCENT = 0.75;
const DESCENT = 0.28;

/**
 * The strip's brand panel, shared with `markHeightFor`.
 *
 * The mark sizing has to know the panel's geometry, because on the strip it is
 * the panel that bounds the artwork rather than a band.
 */
const STRIP_PANEL_X = 0.74;
const STRIP_PANEL_PAD = 0.14;

/**
 * Height of the brand band, per artefact.
 *
 * The band exists to hold the lockup and nothing else, so the two are defined
 * together — see `markHeightFor`, which derives from this rather than from the
 * artefact. That coupling is deliberate: the bands were originally tuned for a
 * small monogram, and when they were later asked to carry the whole logo the
 * mark outgrew them and pushed everything below it off the sticker.
 */
function headerHeightFor(preset: StickerPreset): number {
  switch (preset.key) {
    case 'vehicle-windscreen':
      return preset.heightMm * 0.235;
    case 'driver-card':
      return preset.heightMm * 0.23;
    default:
      return preset.heightMm * 0.19;
  }
}

/**
 * How tall the mark is drawn on a given artefact.
 *
 * Relative rather than a fixed millimetre value, so the lockup keeps the same
 * optical weight on a 100 mm door sticker and an 85 mm card.
 */
function markHeightFor(preset: StickerPreset): number {
  // The strip has no band: its lockup sits in a side panel, where the binding
  // constraint is the panel's *width*. The artwork is landscape, so it reaches
  // the accent rule and the trim long before it runs out of height.
  if (preset.key === 'vehicle-strip') {
    const panelWidth = preset.widthMm * (1 - STRIP_PANEL_X) - preset.heightMm * STRIP_PANEL_PAD;
    return Math.min(preset.heightMm * 0.6, panelWidth / LOGO_MARK_RATIO);
  }
  // Filling about three-quarters of the band leaves the lockup air above and
  // below without letting it read as a stripe.
  return headerHeightFor(preset) * 0.76;
}

/** The mark's definition, hoisted into `<defs>` and referenced per use. */
function logoMarkDef(id: string, height: number): string {
  return `<image id="${id}" width="${(height * LOGO_MARK_RATIO).toFixed(3)}" height="${height.toFixed(3)}"
      preserveAspectRatio="xMidYMid meet" href="${LOGO_MARK_DATA_URI}"/>`;
}

/**
 * Place the VX mark.
 *
 * Referenced through `<use>` rather than inlined, because the image is a
 * base64 payload of roughly 70 KB: inlining it would put a copy in every cell
 * of an A4 sheet, turning a 40-up page into a multi-megabyte file for forty
 * copies of the same picture.
 */
function logoMark(id: string, x: number, y: number): string {
  return `<use href="#${id}" x="${x.toFixed(3)}" y="${y.toFixed(3)}"/>`;
}

/**
 * The tricolour rule that separates the header from the face.
 *
 * Saffron into navy into green — the logo's own X, laid flat. Proportioned so
 * the navy centre reads as the join rather than a third stripe.
 */
function tricolourRule(y: number, width: number, height: number): string {
  const saffron = width * 0.38;
  const navy = width * 0.24;
  return `<rect x="0" y="${y}" width="${saffron}" height="${height}" fill="${BRAND.accent}"/>
  <rect x="${saffron}" y="${y}" width="${navy}" height="${height}" fill="${BRAND.primary}"/>
  <rect x="${saffron + navy}" y="${y}" width="${width - saffron - navy}" height="${height}" fill="${BRAND.green}"/>`;
}

/**
 * Corner brackets around the code, like a scanner viewfinder.
 *
 * Does the job "SCAN ME" would do, without spending a line of type on it, and
 * gives the code a deliberate frame instead of leaving it floating on white.
 * Drawn outside the quiet zone so it can never interfere with decoding.
 */
function scanBrackets(
  x: number,
  y: number,
  size: number,
  arm: number,
  stroke: number,
  colour: string,
): string {
  const path = (d: string) =>
    `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return [
    path(`M${x} ${y + arm}V${y}H${x + arm}`),
    path(`M${x + size - arm} ${y}H${x + size}V${y + arm}`),
    path(`M${x + size} ${y + size - arm}V${y + size}H${x + size - arm}`),
    path(`M${x + arm} ${y + size}H${x}V${y + size - arm}`),
  ].join('\n  ');
}

/**
 * Largest size from a ladder at which the text still fits.
 *
 * Registration numbers vary a lot in width — "KA 01 AB 1234" against
 * "UP16GH7788" — and a hardcoded size that suits one overflows the other. Every
 * headline on these artefacts is sized through here instead.
 */
function fitTextSize(
  text: string,
  maxWidth: number,
  sizes: number[],
  metrics: TextMetrics = {},
): number {
  for (const size of sizes) {
    const tracking = metrics.letterSpacing ?? 0;
    if (estimateTextWidth(text, size, { ...metrics, letterSpacing: tracking * size }) <= maxWidth) {
      return size;
    }
  }
  return sizes[sizes.length - 1]!;
}

/**
 * Fit a call to action into a column, shortening the wording before the type.
 *
 * The long form needs 61 mm in the bumper strip's 44 mm column, and shrinking
 * type far enough to fit would leave it unreadable at arm's length. Dropping
 * the trailing qualifier is the better trade: the artefact is stuck to the
 * thing it describes, so the noun is often telling the reader what they can
 * already see.
 */
function fitCallToAction(
  ladder: readonly string[],
  maxWidth: number,
  sizes: number[],
  tracking: number,
): { text: string; size: number } {
  for (const candidate of ladder) {
    for (const size of sizes) {
      if (
        estimateTextWidth(candidate, size, { bold: true, letterSpacing: tracking * size }) <=
        maxWidth
      ) {
        return { text: candidate, size };
      }
    }
  }
  const last = ladder[ladder.length - 1] ?? 'SCAN';
  return { text: last, size: sizes[sizes.length - 1]! };
}

/** A rounded "verified" pill. */
function verifiedPill(x: number, y: number, height: number, label: string): string {
  const padding = height * 0.55;
  const textSize = height * 0.62;
  const width = padding * 2 + label.length * textSize * 0.52 + height * 0.7;

  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${BRAND.verified}" fill-opacity="0.12"/>
    <path d="M${x + padding * 0.7} ${y + height / 2} l${height * 0.2} ${height * 0.22} l${height * 0.36} -${height * 0.44}"
      fill="none" stroke="${BRAND.verified}" stroke-width="${height * 0.12}" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${x + padding * 0.7 + height * 0.75}" y="${y + height / 2 + textSize * 0.36}"
      font-size="${textSize}" font-weight="700" fill="${BRAND.verified}"
      font-family="Helvetica Neue, Helvetica, Arial, sans-serif" letter-spacing="${textSize * 0.02}">${escapeXml(label)}</text>
  </g>`;
}

/** Bleed area and crop marks for a commercial print run. */
function printMarks(preset: StickerPreset): { offset: number; markup: string } {
  const bleed = PRINT.bleedMm;
  const { widthMm: w, heightMm: h } = preset;
  const len = PRINT.markLengthMm;
  const stroke = PRINT.markStroke;

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${BRAND.ink}" stroke-width="${stroke}"/>`;

  // Marks sit in the bleed, pointing at each trim corner.
  const marks = [
    line(0, bleed, len * 0.6, bleed),
    line(bleed, 0, bleed, len * 0.6),
    line(bleed + w + len * 0.4, bleed, bleed * 2 + w, bleed),
    line(bleed + w, 0, bleed + w, len * 0.6),
    line(0, bleed + h, len * 0.6, bleed + h),
    line(bleed, bleed + h + len * 0.4, bleed, bleed * 2 + h),
    line(bleed + w + len * 0.4, bleed + h, bleed * 2 + w, bleed + h),
    line(bleed + w, bleed + h + len * 0.4, bleed + w, bleed * 2 + h),
  ].join('');

  return { offset: bleed, markup: marks };
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

interface LayoutContext extends StickerInput {
  preset: StickerPreset;
  targetUrl: string;
  callToAction: readonly string[];
  /** Unique per rendered sticker — see `gradientId`. */
  fadeId: string;
  /** Id of the hoisted logo definition. */
  markId: string;
  /** Height the mark is defined at, in millimetres. */
  markHeight: number;
}

/**
 * A document-unique id for the header gradient.
 *
 * SVG ids share one namespace per document, and these stickers are routinely
 * rendered several to a page — a sheet nests the same artwork forty times, and
 * a fleet screen shows a row of them. A fixed id would collide, leaving every
 * copy pointing at the first definition: harmless today because they are
 * identical, invalid markup regardless, and quietly wrong the moment a preset
 * gets its own palette.
 */
function gradientId(token: string, presetKey: string): string {
  const seed = `${presetKey}-${token}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `saarthiFade${hash.toString(36)}`;
}

/**
 * Square door sticker.
 *
 * One thing is loud: the registration. Everything else steps down a weight so
 * the eye lands on the plate first, the code second, and the supporting detail
 * only when someone is close enough to care. An earlier pass set almost every
 * line at weight 800, which is the same as setting none of them — with nothing
 * quiet, nothing reads as important.
 */
async function squareLayout(context: LayoutContext): Promise<string> {
  const { preset } = context;
  const w = preset.widthMm;
  const h = preset.heightMm;
  const margin = w * 0.06;

  const headerH = headerHeightFor(preset);
  const rule = h * 0.007;
  const footerH = h * 0.088;
  const footerTop = h - footerH;

  // Registration widths vary a lot, so the plate is sized to its own content.
  const plateSize = fitTextSize(
    context.title,
    w - margin * 2,
    [h * 0.088, h * 0.078, h * 0.068, h * 0.058],
    { bold: true, letterSpacing: 0.06 },
  );
  const plateTracking = plateSize * 0.06;

  // The identity block is laid out *upward* from the footer rather than
  // downward from the code.
  //
  // Stacking it downward is what slid the fleet name underneath the footer bar
  // when the header grew to hold the full lockup: every line inherited the
  // code's position, so the block had no idea where the bottom of the sticker
  // was and simply walked off it. Anchored to the footer it cannot overrun, and
  // the code takes whatever vertical space is left over instead of claiming it
  // first.
  const identity = [
    { text: context.title, size: plateSize, weight: 700, fill: BRAND.ink, tracking: plateTracking },
    context.subtitle
      ? { text: context.subtitle, size: h * 0.034, weight: 500, fill: BRAND.muted, tracking: 0 }
      : null,
    context.organizationName
      ? {
          text: context.organizationName,
          size: h * 0.031,
          weight: 400,
          fill: BRAND.muted,
          tracking: 0,
        }
      : null,
  ].filter((line): line is NonNullable<typeof line> => line !== null);

  // Space each pair by the ink that actually sits between them — the upper
  // line's descenders and the lower line's ascenders — rather than by a flat
  // multiple, which is too loose under small type and too tight under the plate.
  const placed: Array<(typeof identity)[number] & { baseline: number }> = [];
  let baseline = footerTop - h * 0.03;
  for (let index = identity.length - 1; index >= 0; index -= 1) {
    const line = identity[index]!;
    placed.unshift({ ...line, baseline });
    const above = identity[index - 1];
    if (above) baseline -= line.size * ASCENT + above.size * DESCENT + h * 0.008;
  }
  const identityTop = placed[0]!.baseline - placed[0]!.size * ASCENT;

  // The code is the only element that has to work from three metres away, so it
  // takes every millimetre the identity block did not need.
  const quiet = w * 0.026;
  const codeTop = headerH + rule + h * 0.035;
  const codeRoom = identityTop - h * 0.025 - codeTop - quiet * 2;
  const qrSize = Math.max(w * 0.3, Math.min(w * 0.48, codeRoom));
  const qrX = (w - qrSize) / 2;
  const qrY = codeTop + quiet + Math.max(0, codeRoom - qrSize) / 2;

  // The footer is one line shared by the call to action and the short code, so
  // the action gets whatever the code does not need, less a gap between them.
  const shortCodeSize = footerH * 0.31;
  const shortCodeWidth = estimateTextWidth(shortTokenLabel(context.token), shortCodeSize, {
    mono: true,
    letterSpacing: shortCodeSize * 0.09,
  });
  const footerCta = fitCallToAction(
    context.callToAction,
    w - margin * 2 - shortCodeWidth - w * 0.05,
    [footerH * 0.33, footerH * 0.29, footerH * 0.26],
    0.13,
  );

  return `
  <rect x="0" y="0" width="${w}" height="${h}" rx="${preset.radiusMm}" fill="${BRAND.paper}"/>

  <!-- Brand header. Light, because the logo is navy on transparency. -->
  ${logoMark(
    context.markId,
    (w - context.markHeight * LOGO_MARK_RATIO) / 2,
    (headerH - context.markHeight) / 2,
  )}
  ${tricolourRule(headerH, w, rule)}

  <!-- Code, on white with its own quiet zone and a viewfinder frame -->
  <rect x="${qrX - quiet}" y="${qrY - quiet}" width="${qrSize + quiet * 2}" height="${qrSize + quiet * 2}"
    rx="${w * 0.018}" fill="#ffffff"/>
  ${scanBrackets(qrX - quiet, qrY - quiet, qrSize + quiet * 2, w * 0.055, w * 0.007, BRAND.primary)}
  ${await qrBlock(context.targetUrl, qrX, qrY, qrSize)}

  <!-- Identity -->
  ${placed
    .map(
      (line) =>
        `<text x="${w / 2}" y="${line.baseline}" text-anchor="middle" font-size="${line.size}"
    font-weight="${line.weight}" fill="${line.fill}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${line.tracking}">${escapeXml(
      ellipsize(line.text, w - margin * 2, line.size, {
        bold: line.weight >= 600,
        letterSpacing: line.tracking,
      }),
    )}</text>`,
    )
    .join('\n  ')}

  <!-- Call to action -->
  <rect x="0" y="${h - footerH}" width="${w}" height="${footerH}" fill="${BRAND.wash}"/>
  <rect x="0" y="${h - footerH}" width="${w}" height="${h * 0.004}" fill="${BRAND.hairline}"/>
  <text x="${margin}" y="${h - footerH * 0.35}" font-size="${footerCta.size}" font-weight="600"
    fill="${BRAND.primary}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${footerCta.size * 0.13}">${escapeXml(footerCta.text)}</text>
  <text x="${w - margin}" y="${h - footerH * 0.35}" text-anchor="end" font-size="${shortCodeSize}"
    font-weight="500" fill="${BRAND.muted}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
    letter-spacing="${shortCodeSize * 0.09}">${escapeXml(shortTokenLabel(context.token))}</text>
  `;
}

/**
 * Landscape bumper strip.
 *
 * Code on the left, identity in the middle, brand on the right. Read side-on as
 * someone walks past the back of the vehicle, so the code sits low enough to
 * reach without crouching.
 */
async function stripLayout(context: LayoutContext): Promise<string> {
  const { preset } = context;
  const w = preset.widthMm;
  const h = preset.heightMm;
  const margin = h * 0.1;

  const qrSize = h * 0.7;
  const qrX = margin;
  const qrY = (h - qrSize) / 2;
  const quiet = h * 0.05;

  // The brand panel takes a fixed slice of the right; everything between it and
  // the code belongs to the identity.
  const panelX = w * STRIP_PANEL_X;
  const accentW = w * 0.0055;
  const textX = qrX + qrSize + quiet + h * 0.13;
  const textW = panelX - accentW - h * 0.12 - textX;

  const plateSize = fitTextSize(
    context.title,
    textW,
    [h * 0.155, h * 0.135, h * 0.115, h * 0.098],
    {
      bold: true,
      letterSpacing: 0.05,
    },
  );

  // The brand panel is a narrow column, so its two lines are sized against it
  // rather than against the strip. "VERIFIED FLEET" at a fixed size overran the
  // artefact by 1.7 mm; "FLEET" was also redundant beside a truck mark.
  const panelW = w - panelX;
  const panelCentre = panelX + panelW * 0.5;
  const panelInner = panelW - h * STRIP_PANEL_PAD;
  const verifiedSize = fitTextSize('VERIFIED', panelInner, [h * 0.05, h * 0.044, h * 0.038], {
    bold: true,
    letterSpacing: 0.16,
  });

  // The call to action shares the identity column with the plate, and the blue
  // brand panel is its hard right edge — running into it is what the earlier
  // fixed size did.
  const cta = fitCallToAction(context.callToAction, textW, [h * 0.068, h * 0.06, h * 0.053], 0.13);

  return `
  <rect x="0" y="0" width="${w}" height="${h}" rx="${preset.radiusMm}" fill="${BRAND.paper}"/>
  <path d="M${panelX} 0 h${w - panelX - preset.radiusMm}
           a${preset.radiusMm} ${preset.radiusMm} 0 0 1 ${preset.radiusMm} ${preset.radiusMm}
           v${h - preset.radiusMm * 2}
           a${preset.radiusMm} ${preset.radiusMm} 0 0 1 -${preset.radiusMm} ${preset.radiusMm}
           h-${w - panelX - preset.radiusMm} Z" fill="${BRAND.wash}"/>
  <rect x="${panelX - accentW}" y="0" width="${accentW}" height="${h * 0.4}" fill="${BRAND.accent}"/>
  <rect x="${panelX - accentW}" y="${h * 0.4}" width="${accentW}" height="${h * 0.2}" fill="${BRAND.primary}"/>
  <rect x="${panelX - accentW}" y="${h * 0.6}" width="${accentW}" height="${h * 0.4}" fill="${BRAND.green}"/>

  <!-- Code -->
  <rect x="${qrX - quiet}" y="${qrY - quiet}" width="${qrSize + quiet * 2}" height="${qrSize + quiet * 2}"
    rx="${h * 0.05}" fill="#ffffff"/>
  ${scanBrackets(qrX - quiet, qrY - quiet, qrSize + quiet * 2, h * 0.1, h * 0.014, BRAND.primary)}
  ${await qrBlock(context.targetUrl, qrX, qrY, qrSize)}

  <!-- Identity -->
  <text x="${textX}" y="${h * 0.33}" font-size="${plateSize}" font-weight="700" fill="${BRAND.ink}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${plateSize * 0.05}">${escapeXml(
      ellipsize(context.title, textW, plateSize, { bold: true, letterSpacing: plateSize * 0.05 }),
    )}</text>
  ${
    context.subtitle
      ? `<text x="${textX}" y="${h * 0.46}" font-size="${h * 0.072}" font-weight="500" fill="${BRAND.muted}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    >${escapeXml(ellipsize(context.subtitle, textW, h * 0.072))}</text>`
      : ''
  }
  <text x="${textX}" y="${h * 0.66}" font-size="${cta.size}" font-weight="600" fill="${BRAND.primary}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${cta.size * 0.13}">${escapeXml(cta.text)}</text>
  <text x="${textX}" y="${h * 0.79}" font-size="${h * 0.062}" font-weight="500" fill="${BRAND.muted}"
    font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
    letter-spacing="${h * 0.006}">${escapeXml(shortTokenLabel(context.token))}</text>

  <!-- Brand panel -->
  ${logoMark(
    context.markId,
    panelCentre - (context.markHeight * LOGO_MARK_RATIO) / 2,
    (h - context.markHeight) / 2 - (context.verified ? h * 0.05 : 0),
  )}
  ${
    context.verified
      ? `<text x="${panelCentre}" y="${h * 0.91}" text-anchor="middle" font-size="${verifiedSize}"
    font-weight="600" fill="${BRAND.green}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${verifiedSize * 0.16}">VERIFIED</text>`
      : ''
  }
  `;
}

/**
 * Windscreen sticker.
 *
 * Read through glass, close up, by someone standing at the front of the
 * vehicle — an officer at a checkpoint or a customer at a gate. That changes
 * three things from the door sticker.
 *
 * It is small, because a windscreen sticker has to sit in a corner without
 * obstructing the driver's view; a large one is a roadworthiness defect, not
 * just bad manners. It carries a fitting instruction, because getting this on
 * the wrong face of the glass is the obvious mistake. And it can be reversed
 * for inside-glass fitting, where the printed face goes against the glass.
 */
async function windscreenLayout(context: LayoutContext): Promise<string> {
  const { preset } = context;
  const w = preset.widthMm;
  const h = preset.heightMm;
  const margin = h * 0.075;

  const headerH = headerHeightFor(preset);
  const rule = h * 0.011;

  const quiet = h * 0.042;
  const qrSize = h * 0.6;
  const qrX = margin;
  const qrY = headerH + rule + (h - headerH - rule - qrSize) * 0.42;

  const textX = qrX + qrSize + quiet + h * 0.09;
  const textW = w - margin - textX;

  const plateSize = fitTextSize(context.title, textW, [h * 0.14, h * 0.122, h * 0.105, h * 0.09], {
    bold: true,
    letterSpacing: 0.05,
  });
  const cta = fitCallToAction(context.callToAction, textW, [h * 0.062, h * 0.055, h * 0.049], 0.11);

  // The fitting note is the practical half of this artefact: a reversed sticker
  // goes print-side to the glass, a normal one goes on the outside.
  const fitting = context.mirror ? 'AFFIX INSIDE GLASS' : 'AFFIX OUTSIDE GLASS';

  return `
  <rect x="0" y="0" width="${w}" height="${h}" rx="${preset.radiusMm}" fill="${BRAND.paper}"/>

  ${logoMark(context.markId, margin, (headerH - context.markHeight) / 2)}
  <text x="${w - margin}" y="${headerH * 0.56}" text-anchor="end" font-size="${h * 0.048}"
    font-weight="600" fill="${BRAND.accent}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${h * 0.011}">${escapeXml(fitting)}</text>
  ${tricolourRule(headerH, w, rule)}

  <rect x="${qrX - quiet}" y="${qrY - quiet}" width="${qrSize + quiet * 2}" height="${qrSize + quiet * 2}"
    rx="${h * 0.035}" fill="#ffffff"/>
  ${scanBrackets(qrX - quiet, qrY - quiet, qrSize + quiet * 2, h * 0.075, h * 0.012, BRAND.primary)}
  ${await qrBlock(context.targetUrl, qrX, qrY, qrSize)}

  <text x="${textX}" y="${headerH + h * 0.2}" font-size="${plateSize}" font-weight="700" fill="${BRAND.ink}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${plateSize * 0.05}">${escapeXml(
      ellipsize(context.title, textW, plateSize, { bold: true, letterSpacing: plateSize * 0.05 }),
    )}</text>
  ${
    context.subtitle
      ? `<text x="${textX}" y="${headerH + h * 0.33}" font-size="${h * 0.068}" font-weight="500"
    fill="${BRAND.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    >${escapeXml(ellipsize(context.subtitle, textW, h * 0.068))}</text>`
      : ''
  }
  ${
    context.organizationName
      ? `<text x="${textX}" y="${headerH + h * 0.44}" font-size="${h * 0.06}" font-weight="400"
    fill="${BRAND.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    >${escapeXml(ellipsize(context.organizationName, textW, h * 0.06))}</text>`
      : ''
  }
  <text x="${textX}" y="${headerH + h * 0.6}" font-size="${cta.size}" font-weight="600"
    fill="${BRAND.primary}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${cta.size * 0.11}">${escapeXml(cta.text)}</text>
  <text x="${textX}" y="${headerH + h * 0.72}" font-size="${h * 0.058}" font-weight="500"
    fill="${BRAND.muted}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
    letter-spacing="${h * 0.005}">${escapeXml(shortTokenLabel(context.token))}</text>
  `;
}

/**
 * CR80 driver card.
 *
 * A person holds this, so the name leads and the code is secondary — the
 * opposite weighting from a vehicle sticker.
 */
async function cardLayout(context: LayoutContext): Promise<string> {
  const { preset } = context;
  const w = preset.widthMm;
  const h = preset.heightMm;
  const pad = w * 0.05;

  const headerH = headerHeightFor(preset);
  const rule = h * 0.011;

  // The code is the only part a machine reads, so it gets the space it needs
  // and the text column takes what is left. At 41 modules this is about
  // 0.81 mm per module — comfortably above the ~0.5 mm floor for reliable
  // scanning, where an earlier 24.8 mm code sat at a tight 0.61 mm.
  const qrSize = h * 0.6;
  const quiet = pad * 0.28;
  const qrX = w - pad - qrSize;
  const qrY = headerH + rule + h * 0.05;

  const textX = pad;
  const textW = qrX - quiet - h * 0.04 - textX;

  // Size the name against the column, in a fixed order of preference.
  //
  // 1. One line, as large as possible — a two-word name broken across two lines
  //    reads worse than the same name a step smaller on one.
  // 2. Failing that, two whole lines as large as possible. A person's name is
  //    the one field that must never be cut, and a long single word cannot be
  //    wrapped out of trouble: "Lakshminarayanan" is simply wider than the
  //    column, so the type steps down until it is not.
  // 3. Only a name too long for even the smallest step is truncated.
  const nameSteps = [h * 0.112, h * 0.098, h * 0.086, h * 0.076];
  const nameLayout = (() => {
    const measure = (size: number) => wrapText(context.title, textW, size, 2, { bold: true });
    const whole = (lines: string[]) => lines.length > 0 && !lines.some((l) => l.includes('…'));

    for (const size of nameSteps.slice(0, 2)) {
      const lines = measure(size);
      if (lines.length === 1 && whole(lines)) return { size, lines };
    }
    for (const size of nameSteps) {
      const lines = measure(size);
      if (whole(lines)) return { size, lines };
    }
    const smallest = nameSteps[nameSteps.length - 1]!;
    return { size: smallest, lines: measure(smallest) };
  })();
  const nameSize = nameLayout.size;
  const nameLines = nameLayout.lines;

  const nameLead = nameSize * 1.1;
  const nameTop = headerH + h * 0.16;
  const nameBottom = nameTop + Math.max(0, nameLines.length - 1) * nameLead;

  const licenceSize = h * 0.052;
  const orgSize = h * 0.05;
  const licenceY = nameBottom + h * 0.085;
  const orgY = licenceY + h * 0.072;
  const pillY = orgY + h * 0.038;

  // The header already says DRIVER ID, so the ladder's shorter forms read
  // better here than repeating "DRIVER" on the card's tightest line.
  const cta = fitCallToAction(context.callToAction, textW, [h * 0.048, h * 0.043, h * 0.039], 0.13);

  return `
  <rect x="0" y="0" width="${w}" height="${h}" rx="${preset.radiusMm}" fill="${BRAND.paper}"/>

  ${logoMark(context.markId, pad, (headerH - context.markHeight) / 2)}
  <text x="${w - pad}" y="${headerH * 0.56}" text-anchor="end" font-size="${h * 0.048}" font-weight="600"
    fill="${BRAND.muted}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${h * 0.013}">DRIVER ID</text>
  ${tricolourRule(headerH, w, rule)}

  ${nameLines
    .map(
      (line, index) =>
        `<text x="${textX}" y="${nameTop + index * nameLead}" font-size="${nameSize}" font-weight="700"
    fill="${BRAND.ink}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  ${
    context.subtitle
      ? `<text x="${textX}" y="${licenceY}" font-size="${licenceSize}" font-weight="500" fill="${BRAND.muted}"
    font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(
      ellipsize(context.subtitle, textW, licenceSize, { mono: true }),
    )}</text>`
      : ''
  }
  ${
    context.organizationName
      ? `<text x="${textX}" y="${orgY}" font-size="${orgSize}" font-weight="400" fill="${BRAND.muted}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif">${escapeXml(
      ellipsize(context.organizationName, textW, orgSize),
    )}</text>`
      : ''
  }
  ${context.verified ? verifiedPill(textX, pillY, h * 0.1, 'VERIFIED') : ''}

  <rect x="${qrX - quiet}" y="${qrY - quiet}" width="${qrSize + quiet * 2}" height="${qrSize + quiet * 2}"
    rx="${w * 0.014}" fill="#ffffff"/>
  ${scanBrackets(qrX - quiet, qrY - quiet, qrSize + quiet * 2, h * 0.055, h * 0.011, BRAND.primary)}
  ${await qrBlock(context.targetUrl, qrX, qrY, qrSize)}
  <text x="${qrX + qrSize / 2}" y="${qrY + qrSize + quiet + h * 0.055}" text-anchor="middle"
    font-size="${h * 0.046}" font-weight="500" fill="${BRAND.muted}"
    font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
    letter-spacing="${h * 0.004}">${escapeXml(shortTokenLabel(context.token))}</text>

  <text x="${textX}" y="${h - h * 0.05}" font-size="${cta.size}" font-weight="600" fill="${BRAND.primary}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
    letter-spacing="${cta.size * 0.13}">${escapeXml(cta.text)}</text>
  `;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * What the scan actually does, longest wording first.
 *
 * Not "verify". A scan returns the registration particulars, the assigned
 * driver and their licence, and the validity of the documents behind both —
 * a lookup, of which verification is only one part. Telling a roadside officer
 * to "verify" undersells it and misdescribes it: they are being offered the
 * vehicle's papers, not a yes/no answer.
 *
 * Each layout takes the longest form its column can hold; the ladder degrades
 * to shorter phrasings rather than to smaller type.
 */
const CALL_TO_ACTION: Record<StickerInput['subjectKind'], readonly string[]> = {
  VEHICLE: ['SCAN FOR RC & DRIVER DETAILS', 'SCAN FOR VEHICLE DETAILS', 'SCAN FOR DETAILS', 'SCAN'],
  DRIVER: ['SCAN FOR LICENCE DETAILS', 'SCAN FOR DRIVER DETAILS', 'SCAN FOR DETAILS', 'SCAN'],
  OTHER: ['SCAN FOR DETAILS', 'SCAN'],
};

function callToActionFor(kind: StickerInput['subjectKind']): readonly string[] {
  return CALL_TO_ACTION[kind] ?? CALL_TO_ACTION.OTHER;
}

export async function renderStickerSvg(input: StickerInput, targetUrl: string): Promise<string> {
  const preset = stickerPreset(input.presetKey);
  const context: LayoutContext = {
    ...input,
    preset,
    targetUrl,
    callToAction: callToActionFor(input.subjectKind),
    fadeId: gradientId(input.token, preset.key),
    markId: `${gradientId(input.token, preset.key)}Mark`,
    // Defined once per artefact and referenced by `<use>`, so an A4 sheet
    // carries one copy of the image rather than one per cell.
    markHeight: markHeightFor(preset),
  };

  const body =
    preset.key === 'driver-card'
      ? await cardLayout(context)
      : preset.key === 'vehicle-strip'
        ? await stripLayout(context)
        : preset.key === 'vehicle-windscreen'
          ? await windscreenLayout(context)
          : await squareLayout(context);

  const marks = input.printMarks ? printMarks(preset) : null;
  const offset = marks?.offset ?? 0;
  const totalW = preset.widthMm + offset * 2;
  const totalH = preset.heightMm + offset * 2;

  // Width and height in millimetres with a matching viewBox: printing at 100%
  // then produces a physically correct artefact rather than a browser guess.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}mm" height="${totalH}mm"
  viewBox="0 0 ${totalW} ${totalH}" role="img"
  aria-label="Saarthi ${escapeXml(preset.label)} for ${escapeXml(input.title)}">
  <title>Saarthi ${escapeXml(preset.label)} ${EM_DASH} ${escapeXml(input.title)}</title>
  <defs>
    <linearGradient id="${context.fadeId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.primary}"/>
      <stop offset="100%" stop-color="${BRAND.primaryDeep}"/>
    </linearGradient>
    ${logoMarkDef(context.markId, context.markHeight)}
  </defs>
  ${marks ? `<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>${marks.markup}` : ''}
  <g transform="translate(${offset} ${offset})${
    input.mirror ? ` translate(${preset.widthMm} 0) scale(-1 1)` : ''
  }">
    ${body}
    <rect x="0" y="0" width="${preset.widthMm}" height="${preset.heightMm}" rx="${preset.radiusMm}"
      fill="none" stroke="${BRAND.hairline}" stroke-width="0.3"/>
  </g>
</svg>`;
}

/**
 * A printable sheet of identical stickers.
 *
 * A fleet fitting forty trucks wants one A4 page per batch, not forty
 * downloads. Laid out on A4 portrait with the preset's own trim size, so the
 * sheet can go straight to a die cutter.
 */
export async function renderStickerSheetSvg(
  input: StickerInput,
  targetUrl: string,
  options: { columns?: number; rows?: number } = {},
): Promise<string> {
  const preset = stickerPreset(input.presetKey);
  const A4_W = 210;
  const A4_H = 297;
  const gutter = 5;
  const margin = 10;

  const maxColumns = Math.max(
    1,
    Math.floor((A4_W - margin * 2 + gutter) / (preset.widthMm + gutter)),
  );
  const maxRows = Math.max(
    1,
    Math.floor((A4_H - margin * 2 + gutter) / (preset.heightMm + gutter)),
  );

  const columns = Math.min(options.columns ?? maxColumns, maxColumns);
  const rows = Math.min(options.rows ?? maxRows, maxRows);

  // Render once and reuse: the QR is identical on every copy, so generating it
  // per cell would be the same picture computed forty times.
  const single = await renderStickerSvg({ ...input, printMarks: false }, targetUrl);
  const stripped = single
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();

  // Lift the gradient out of the repeated artwork and define it once at the
  // sheet root. Nesting it per cell would put N copies of the same id in one
  // document — invalid, and it only renders correctly by the browser's
  // first-definition-wins fallback.
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(stripped)?.[0] ?? '';
  const inner = stripped.replace(/<defs>[\s\S]*?<\/defs>/, '').trim();

  const cells: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = margin + column * (preset.widthMm + gutter);
      const y = margin + row * (preset.heightMm + gutter);
      cells.push(
        `<svg x="${x}" y="${y}" width="${preset.widthMm}" height="${preset.heightMm}" viewBox="0 0 ${preset.widthMm} ${preset.heightMm}">${inner}</svg>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img"
  aria-label="Saarthi sticker sheet">
  <title>Saarthi ${escapeXml(preset.label)} sheet ${EM_DASH} ${rows * columns} up</title>
  ${defs}
  <rect x="0" y="0" width="210" height="297" fill="#ffffff"/>
  ${cells.join('\n  ')}
  <text x="${margin}" y="${A4_H - 4}" font-size="2.6" fill="${BRAND.muted}"
    font-family="Helvetica Neue, Helvetica, Arial, sans-serif">Saarthi ${EM_DASH} ${escapeXml(preset.label)} &#183; ${rows * columns} per sheet &#183; print at 100%, do not scale to fit</text>
</svg>`;
}

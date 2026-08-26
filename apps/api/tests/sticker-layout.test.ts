import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import {
  LOGO_MARK_RATIO,
  renderStickerSheetSvg,
  renderStickerSvg,
  type StickerInput,
} from '../src/modules/qr/sticker.renderer';
import { STICKER_PRESETS } from '../src/modules/qr/sticker.theme';

/**
 * Geometry tests for the printable stickers.
 *
 * These exist because the layouts are hand-placed millimetre arithmetic, and
 * the failure mode is silent: SVG has no layout engine, so a `<text>` that runs
 * off the trim or a footer bar painted over the line above it renders happily
 * and only shows up on paper. Two such regressions shipped — a call to action
 * running 9 mm into the brand panel, and, when the header grew to hold the full
 * logo, an identity block sliding underneath the footer.
 *
 * So the checks below are deliberately about the artefact rather than the code:
 * nothing may leave the trim, nothing opaque may be painted over type, and the
 * code must still decode to the exact URL it encodes.
 */

// --- Text measurement -------------------------------------------------------
//
// Mirrors `estimateTextWidth` in the renderer. Duplicated rather than exported
// on purpose: a test that reuses the implementation's own estimator agrees with
// it by construction and proves nothing.

const NARROW = new Set([...`iljtfrI.,:;'\`|!()[]{}- `]);
const WIDE = new Set([...'mwMW@%']);

function textWidth(text: string, size: number, bold: boolean, mono: boolean, tracking: number) {
  if (mono) return text.length * size * 0.6 + Math.max(0, text.length - 1) * tracking;
  const base = bold ? 0.56 : 0.52;
  let units = 0;
  for (const character of text) {
    if (NARROW.has(character)) units += base * 0.45;
    else if (WIDE.has(character)) units += base * 1.5;
    else if (character >= 'A' && character <= 'Z') units += base * 1.16;
    else units += base;
  }
  return units * size + Math.max(0, text.length - 1) * tracking;
}

/** Helvetica ascent/descent as fractions of the em, for the ink box. */
const ASCENT = 0.75;
const DESCENT = 0.22;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

const overlaps = (a: Box, b: Box, slack = 0) =>
  a.x + a.w > b.x + slack &&
  b.x + b.w > a.x + slack &&
  a.y + a.h > b.y + slack &&
  b.y + b.h > a.y + slack;

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? undefined;
const num = (tag: string, name: string, fallback = 0) => Number(attr(tag, name) ?? fallback);
const unescape = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/** Every drawable, in paint order, as a box on the artefact. */
function boxes(svg: string) {
  const texts: Array<Box & { order: number }> = [];
  const opaqueRects: Array<Box & { order: number }> = [];
  const images: Array<Box & { order: number }> = [];
  const codes: Array<Box & { order: number }> = [];

  // The mark is defined once in <defs> and positioned by <use>.
  const markHeight = Number(
    /<image id="[^"]*"\s+width="([\d.]+)"\s+height="([\d.]+)"/.exec(svg)?.[2] ?? 0,
  );

  let order = 0;
  const body = svg.slice(svg.indexOf('</defs>') + 1 || 0);

  for (const match of body.matchAll(/<(text|rect|use|svg)\b([^>]*)>([^<]*)/g)) {
    const [, tag, rawAttrs, inner] = match;
    const attrs = rawAttrs!;
    order += 1;

    if (tag === 'text') {
      const content = unescape(inner ?? '').trim();
      if (!content) continue;
      const size = num(attrs, 'font-size');
      const tracking = num(attrs, 'letter-spacing');
      const bold = num(attrs, 'font-weight', 400) >= 600;
      const mono = /monospace/.test(attrs);
      const width = textWidth(content, size, bold, mono, tracking);
      const anchor = attr(attrs, 'text-anchor') ?? 'start';
      const x = num(attrs, 'x');
      const y = num(attrs, 'y');
      const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
      texts.push({
        x: left,
        y: y - size * ASCENT,
        w: width,
        h: size * (ASCENT + DESCENT),
        label: `"${content}"`,
        order,
      });
      continue;
    }

    if (tag === 'rect') {
      const fill = attr(attrs, 'fill');
      // Only fully opaque fills can hide type beneath them.
      if (!fill || fill === 'none' || num(attrs, 'opacity', 1) < 1) continue;
      opaqueRects.push({
        x: num(attrs, 'x'),
        y: num(attrs, 'y'),
        w: num(attrs, 'width'),
        h: num(attrs, 'height'),
        label: `rect ${fill}`,
        order,
      });
      continue;
    }

    if (tag === 'use') {
      images.push({
        x: num(attrs, 'x'),
        y: num(attrs, 'y'),
        w: markHeight * LOGO_MARK_RATIO,
        h: markHeight,
        label: 'logo lockup',
        order,
      });
      continue;
    }

    // The nested <svg> carrying the QR modules.
    if (tag === 'svg' && /shape-rendering/.test(attrs)) {
      codes.push({
        x: num(attrs, 'x'),
        y: num(attrs, 'y'),
        w: num(attrs, 'width'),
        h: num(attrs, 'height'),
        label: 'qr',
        order,
      });
    }
  }

  return { texts, opaqueRects, images, codes };
}

/** Pull the modules back out of the rendered path and decode them. */
function decode(svg: string, url: string, mirror: boolean) {
  const nested =
    /<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0 0 (\d+) \1"[^>]*shape-rendering[^>]*>([\s\S]*?)<\/svg>/.exec(
      svg,
    );
  if (!nested) return false;
  const size = Number(nested[1]);
  const path = /<path stroke="[^"]*" d="([^"]+)"/.exec(nested[2]!)?.[1];
  if (!path) return false;

  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  let x = 0;
  let y = 0;
  for (const token of path.match(/[Mmh][-\d.\s]*/g) ?? []) {
    const args = (
      token
        .slice(1)
        .trim()
        .match(/-?[\d.]+/g) ?? []
    ).map(Number);
    if (token[0] === 'M') {
      x = args[0]!;
      y = Math.floor(args[1]!);
    } else if (token[0] === 'm') {
      x += args[0]!;
      y += Math.floor(args[1]!);
    } else {
      for (let i = Math.round(x); i < Math.round(x + args[0]!); i += 1) {
        if (grid[y] && i < size) grid[y]![i] = true;
      }
      x += args[0]!;
    }
  }

  const quiet = 4;
  const scale = 8;
  const side = (size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!grid[row]![column]) continue;
      const target = mirror ? size - 1 - column : column;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = (((row + quiet) * scale + dy) * side + (target + quiet) * scale + dx) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, side, side)?.data === url;
}

// --- Fixtures ---------------------------------------------------------------

const TOKEN = 'kQ7bZ2mR9xT4vL8nP1sW3yG6hJ0dF5aC2eU7iO4rK9M';
const URL = `https://app.saarthi.in/q/${TOKEN}`;

const base: StickerInput = {
  token: TOKEN,
  presetKey: 'vehicle-sticker',
  title: 'UP16GH7788',
  subtitle: 'Mahindra Blazo X 35 Tipper',
  organizationName: 'Sharma Transport Company',
  verified: true,
  subjectKind: 'VEHICLE',
};

/**
 * The awkward cases, not the flattering ones.
 *
 * A long South Indian name, a long fleet name and an absent subtitle each break
 * a different assumption, and all three occur in real data.
 */
const CONTENT_CASES: Array<{ name: string; patch: Partial<StickerInput> }> = [
  { name: 'typical', patch: {} },
  { name: 'long name', patch: { title: 'Venkataraman Subramanian', subjectKind: 'DRIVER' } },
  { name: 'single long word', patch: { title: 'Lakshminarayanan', subjectKind: 'DRIVER' } },
  { name: 'no subtitle', patch: { subtitle: null } },
  { name: 'no organization', patch: { organizationName: null } },
  { name: 'bare', patch: { subtitle: null, organizationName: null, verified: false } },
  {
    name: 'long everything',
    patch: {
      title: 'MH12DE1433',
      subtitle: 'Ashok Leyland Captain Haulage 4923 XPS',
      organizationName: 'Brihanmumbai Goods Transport Cooperative Society Limited',
    },
  },
];

const PRESETS = Object.values(STICKER_PRESETS);

describe('sticker layout', () => {
  for (const preset of PRESETS) {
    describe(preset.key, () => {
      for (const scenario of CONTENT_CASES) {
        it(`keeps every element inside the trim — ${scenario.name}`, async () => {
          const svg = await renderStickerSvg(
            { ...base, ...scenario.patch, presetKey: preset.key },
            URL,
          );
          const { texts, images, codes } = boxes(svg);
          const slack = 0.25; // the width estimate is approximate; don't chase noise

          for (const box of [...texts, ...images, ...codes]) {
            expect(
              {
                element: box.label,
                left: Number(box.x.toFixed(2)),
                right: Number((box.x + box.w).toFixed(2)),
                top: Number(box.y.toFixed(2)),
                bottom: Number((box.y + box.h).toFixed(2)),
                trim: `${preset.widthMm}x${preset.heightMm}`,
              },
              `${box.label} escapes the trim`,
            ).toSatisfy(
              () =>
                box.x >= -slack &&
                box.y >= -slack &&
                box.x + box.w <= preset.widthMm + slack &&
                box.y + box.h <= preset.heightMm + slack,
            );
          }
        });

        it(`never paints an opaque fill over type — ${scenario.name}`, async () => {
          const svg = await renderStickerSvg(
            { ...base, ...scenario.patch, presetKey: preset.key },
            URL,
          );
          const { texts, opaqueRects } = boxes(svg);

          for (const text of texts) {
            const covering = opaqueRects.filter(
              (rect) => rect.order > text.order && overlaps(rect, text, 0.2),
            );
            expect(
              covering.map((rect) => rect.label),
              `${text.label} is painted over`,
            ).toEqual([]);
          }
        });

        it(`keeps type clear of the code — ${scenario.name}`, async () => {
          const svg = await renderStickerSvg(
            { ...base, ...scenario.patch, presetKey: preset.key },
            URL,
          );
          const { texts, codes, images } = boxes(svg);

          for (const code of codes) {
            for (const box of [...texts, ...images]) {
              expect(overlaps(box, code, 0.2), `${box.label} overlaps the code`).toBe(false);
            }
          }
        });
      }

      it('renders a code that decodes to the exact target URL', async () => {
        const svg = await renderStickerSvg({ ...base, presetKey: preset.key }, URL);
        expect(decode(svg, URL, false)).toBe(true);
      });

      it('holds at least 0.5 mm per module, the floor for phone cameras', async () => {
        const svg = await renderStickerSvg({ ...base, presetKey: preset.key }, URL);
        const match =
          /<svg x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="[\d.]+" viewBox="0 0 (\d+) \2"/.exec(
            svg,
          )!;
        expect(Number(match[1]) / Number(match[2])).toBeGreaterThanOrEqual(0.5);
      });

      it('emits pure ASCII, so no chain of re-encoding can mangle it', async () => {
        const svg = await renderStickerSvg({ ...base, presetKey: preset.key }, URL);
        expect([...svg].filter((character) => character.codePointAt(0)! > 127)).toEqual([]);
      });

      it('typesets no brand wording — the lockup is the whole brand block', async () => {
        const svg = await renderStickerSvg({ ...base, presetKey: preset.key }, URL);
        const wording = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) =>
          unescape(m[1]!).toUpperCase(),
        );
        expect(wording.filter((line) => /SAARTHI|VORLDX/.test(line))).toEqual([]);
        expect(svg).toContain('<use href=');
      });
    });
  }

  it('mirrored windscreen artwork still decodes, for inside-glass fitting', async () => {
    const svg = await renderStickerSvg(
      { ...base, presetKey: 'vehicle-windscreen', mirror: true },
      URL,
    );
    expect(decode(svg, URL, true)).toBe(true);
  });

  it('embeds the logo once per sheet rather than once per cell', async () => {
    const svg = await renderStickerSheetSvg({ ...base, presetKey: 'driver-card' }, URL);
    expect(svg.match(/data:image\/png;base64,/g)).toHaveLength(1);
    expect((svg.match(/<use /g) ?? []).length).toBeGreaterThan(1);
  });

  it('gives every id in a sheet a unique name', async () => {
    const svg = await renderStickerSheetSvg({ ...base, presetKey: 'driver-card' }, URL);
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});

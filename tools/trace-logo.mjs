#!/usr/bin/env node
/**
 * Trace the lockup into the line art the splash screen draws.
 *
 *   node tools/trace-logo.mjs
 *
 * The splash draws the logo in by hand before its colour floods in. A browser
 * can only draw a line it has as path data, and the lockup is a raster, so the
 * outlines are traced here, once, from `apps/web/public/vorldx-saarthi.png`:
 * every pixel is sorted into one of the brand's inks (navy, saffron, green),
 * each ink's regions are outlined, and the outlines are simplified and smoothed
 * into curves in the PNG's own pixel space — so the drawing sits exactly on
 * the artwork it becomes.
 *
 * Writes two copies of the same art, because the splash exists twice:
 *
 *  * `apps/web/src/components/common/splash-logo/logo-trace.generated.ts`, for
 *    the React splash;
 *  * the block between the `logo-trace` markers in `apps/web/index.html`, for
 *    the boot splash, which runs before any bundle exists.
 *
 * Run it again whenever the lockup PNG changes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');
const SOURCE = path.join(WEB, 'public', 'vorldx-saarthi.png');
const TS_OUT = path.join(WEB, 'src', 'components', 'common', 'splash-logo', 'logo-trace.generated.ts');
const HTML_OUT = path.join(WEB, 'index.html');
const HTML_START = '<!-- logo-trace:start -->';
const HTML_END = '<!-- logo-trace:end -->';

/** Below this alpha a pixel is anti-aliasing, not ink. */
const ALPHA_FLOOR = 140;
/** Outlines shorter than this (in source pixels) are specks, not drawing. */
const MIN_LENGTH = 70;
/** How far a simplified outline may stray from the traced one, in pixels. */
const TOLERANCE = 1.6;

/**
 * Which ink a pixel belongs to, by hue. White and pale grey — the truck's body,
 * the road's lane marks — are not an ink: they are paper the outlines leave
 * behind, and they appear when the colour floods in.
 */
function inkOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  if (s < 0.28 && v > 0.55) return -1;
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
  }
  if (v < 0.42 || (h >= 190 && h <= 260)) return 0; // navy
  if (h < 50 || h >= 330) return 1; // saffron
  if (h >= 80 && h < 190) return 2; // green
  return -1;
}

const INKS = ['navy', 'saffron', 'green'];

const png = pngjs.PNG.sync.read(readFileSync(SOURCE));
const { width: W, height: H, data } = png;

/** One mask per ink, 1 where the pixel carries it. */
const masks = INKS.map(() => new Uint8Array(W * H));
for (let i = 0; i < W * H; i += 1) {
  if (data[i * 4 + 3] < ALPHA_FLOOR) continue;
  const ink = inkOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  if (ink >= 0) masks[ink][i] = 1;
}

/**
 * Majority filter: a pixel takes whatever most of its 3×3 neighbourhood is.
 * Knocks out the single-pixel fringes where two inks anti-alias into each
 * other, which would otherwise trace as hundreds of tiny loops.
 */
function smoothMask(mask) {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) n += mask[(y + dy) * W + x + dx];
      }
      out[y * W + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Every closed boundary of a mask, as loops of pixel-corner points.
 *
 * Walks the cracks between inked and bare pixels, each oriented with the ink
 * on its right, then links them end to start. Where two loops touch at a
 * corner the walk keeps turning the same way, so the loops stay separate.
 */
function traceLoops(mask) {
  const inked = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const key = (x, y) => y * (W + 1) + x;
  /** start corner → end corners of cracks leaving it */
  const out = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    const list = out.get(k);
    if (list) list.push([x1, y1]);
    else out.set(k, [[x1, y1]]);
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!inked(x, y)) continue;
      if (!inked(x, y - 1)) add(x, y, x + 1, y);
      if (!inked(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inked(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inked(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const loops = [];
  for (const [startKey, ends] of out) {
    while (ends.length > 0) {
      const sx = startKey % (W + 1);
      const sy = Math.floor(startKey / (W + 1));
      const loop = [[sx, sy]];
      let [px, py] = [sx, sy];
      let [cx, cy] = ends.pop();
      while (!(cx === sx && cy === sy)) {
        loop.push([cx, cy]);
        const next = out.get(key(cx, cy));
        if (!next || next.length === 0) break;
        // At a shared corner, prefer the right turn relative to travel.
        let pick = next.length - 1;
        if (next.length > 1) {
          const dx = cx - px;
          const dy = cy - py;
          const right = next.findIndex(([nx, ny]) => nx - cx === -dy && ny - cy === dx);
          if (right >= 0) pick = right;
        }
        const [nx, ny] = next.splice(pick, 1)[0];
        [px, py, cx, cy] = [cx, cy, nx, ny];
      }
      loops.push(loop);
    }
  }
  return loops;
}

function perimeter(points) {
  let len = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    len += Math.hypot(x1 - x0, y1 - y0);
  }
  return len;
}

/** Ramer–Douglas–Peucker, iterative so long outlines cannot blow the stack. */
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const norm = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let worstDist = 0;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / norm;
      if (dist > worstDist) {
        worstDist = dist;
        worst = i;
      }
    }
    if (worst >= 0 && worstDist > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const fmt = (n) => String(Math.round(n * 2) / 2);

/**
 * A closed curve through the midpoints of each edge, with the original
 * corners as control points. The staircase of a pixel outline becomes a line
 * a pen could have drawn.
 */
function toPath(points) {
  const mid = (i) => {
    const [x0, y0] = points[i % points.length];
    const [x1, y1] = points[(i + 1) % points.length];
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };
  const [mx, my] = mid(0);
  let d = `M${fmt(mx)} ${fmt(my)}`;
  for (let i = 1; i <= points.length; i += 1) {
    const [cx, cy] = points[i % points.length];
    const [ex, ey] = mid(i);
    d += `Q${fmt(cx)} ${fmt(cy)} ${fmt(ex)} ${fmt(ey)}`;
  }
  return `${d}Z`;
}

/**
 * Where the tagline starts: the last blank row above the bottom band of ink.
 * The tagline is left out of the drawing — at splash size its letters are a
 * few pixels tall, and traced they read as broken fragments. It arrives with
 * the colour instead.
 */
function taglineTop() {
  const inkedRow = (y) => {
    for (let x = 0; x < W; x += 1) if (data[(y * W + x) * 4 + 3] >= ALPHA_FLOOR) return true;
    return false;
  };
  let y = H - 1;
  while (y > 0 && !inkedRow(y)) y -= 1;
  while (y > 0 && inkedRow(y)) y -= 1;
  return y;
}
const TAGLINE_TOP = taglineTop();

const strokes = [];
masks.forEach((mask, ink) => {
  for (const loop of traceLoops(smoothMask(mask))) {
    const len = perimeter(loop);
    if (len < MIN_LENGTH) continue;
    const points = simplify(loop, TOLERANCE);
    if (points.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (const [x, y] of points) {
      cx += x;
      cy += y;
    }
    cx /= points.length;
    cy /= points.length;
    if (cy > TAGLINE_TOP) continue;
    strokes.push({ ink, d: toPath(points), len, cx, cy });
  }
});

/**
 * When each outline starts, as a fraction of the drawing's spread: a diagonal
 * sweep from the top-left — the location pin, where the road begins — to the
 * bottom-right, so the pen follows the road into the X and on into the name.
 */
const order = (s) => 0.7 * (s.cx / W) + 0.3 * (s.cy / H);
strokes.sort((a, b) => order(a) - order(b));
const lo = order(strokes[0]);
const hi = order(strokes[strokes.length - 1]);
const art = strokes.map((s) => ({
  ink: INKS[s.ink],
  at: Math.round(((order(s) - lo) / (hi - lo || 1)) * 1000) / 1000,
  d: s.d,
}));

const header = `Generated by tools/trace-logo.mjs from apps/web/public/vorldx-saarthi.png.
 * Do not edit by hand — change the PNG and run the script again.`;

writeFileSync(
  TS_OUT,
  `/*
 * ${header}
 */
import type { LogoTrace } from './logo-trace.types';

export const LOGO_TRACE: LogoTrace = ${JSON.stringify({ box: [W, H], strokes: art })};
`,
);

const svg = [
  `<svg class="splash-logo__trace" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`,
  ...art.map(
    (s) =>
      `<path class="splash-logo__stroke splash-logo__stroke--${s.ink}" style="--at:${s.at}" pathLength="1" d="${s.d}"/>`,
  ),
  '</svg>',
].join('');

const html = readFileSync(HTML_OUT, 'utf8');
const start = html.indexOf(HTML_START);
const end = html.indexOf(HTML_END);
if (start < 0 || end < start) throw new Error(`index.html is missing the ${HTML_START} markers`);
writeFileSync(
  HTML_OUT,
  `${html.slice(0, start + HTML_START.length)}${svg}${html.slice(end)}`,
);

const bytes = Buffer.byteLength(svg);
console.log(`Traced ${art.length} outlines (${(bytes / 1024).toFixed(1)} KB of SVG).`);

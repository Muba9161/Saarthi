/**
 * Derive the logo assets the app and the print artefacts need.
 *
 * The source lockup is a 1254px square holding four things stacked: the VX
 * mark, the "VorldX" wordmark, "Saarthi", and a tagline. That is right for a
 * website header and wrong for a 12mm sticker band, where the tagline would
 * render around half a millimetre tall — ink, not type.
 *
 * So this cuts the lockup into the pieces each surface can actually use, and
 * downscales them: a 650KB source embedded per sticker would put nearly a
 * megabyte into every print file, and multiply it across an A4 sheet.
 *
 * Run: node tools/prepare-logo.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'saarthiLogo.png');

const png = PNG.sync.read(fs.readFileSync(SOURCE));
const { width: W, height: H, data } = png;

/** Tight alpha bounding box within a horizontal band of the source. */
function boundsWithin(y0, y1, alphaFloor = 24) {
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (data[(y * W + x) * 4 + 3] < alphaFloor) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/** Rows that carry ink, used to find the gaps between stacked elements. */
function inkRows(alphaFloor = 24) {
  const rows = [];
  for (let y = 0; y < H; y += 1) {
    let count = 0;
    for (let x = 0; x < W; x += 1) {
      if (data[(y * W + x) * 4 + 3] >= alphaFloor) count += 1;
    }
    rows.push(count);
  }
  return rows;
}

/** Box-filter downscale. Good enough for a logo and needs no dependency. */
function resize(src, targetW) {
  const scale = src.width / targetW;
  const targetH = Math.max(1, Math.round(src.height / scale));
  const out = new PNG({ width: targetW, height: targetH });

  for (let y = 0; y < targetH; y += 1) {
    for (let x = 0; x < targetW; x += 1) {
      const sx0 = Math.floor(x * scale);
      const sx1 = Math.min(src.width, Math.ceil((x + 1) * scale));
      const sy0 = Math.floor(y * scale);
      const sy1 = Math.min(src.height, Math.ceil((y + 1) * scale));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * src.width + sx) * 4;
          const alpha = src.data[i + 3] / 255;
          // Premultiply, or semi-transparent edges darken toward black.
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += src.data[i + 3];
          n += 1;
        }
      }
      if (n === 0) n = 1;
      const outA = a / n;
      const unpremul = outA > 0 ? 255 / outA : 0;
      const o = (y * targetW + x) * 4;
      out.data[o] = Math.min(255, Math.round((r / n) * unpremul));
      out.data[o + 1] = Math.min(255, Math.round((g / n) * unpremul));
      out.data[o + 2] = Math.min(255, Math.round((b / n) * unpremul));
      out.data[o + 3] = Math.round(outA);
    }
  }
  return out;
}

function crop(x0, y0, x1, y1) {
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = ((y + y0) * W + (x + x0)) * 4;
      const d = (y * w + x) * 4;
      out.data[d] = data[s];
      out.data[d + 1] = data[s + 1];
      out.data[d + 2] = data[s + 2];
      out.data[d + 3] = data[s + 3];
    }
  }
  return out;
}

// --- Find the horizontal gap between the VX mark and the wordmark ----------
const rows = inkRows();
const midpoint = Math.floor(H * 0.5);
let split = midpoint;
let quietest = Infinity;
// The gap sits somewhere in the middle third; take the emptiest row there.
for (let y = Math.floor(H * 0.45); y < Math.floor(H * 0.62); y += 1) {
  if (rows[y] < quietest) {
    quietest = rows[y];
    split = y;
  }
}

const markBox = boundsWithin(0, split);
const lockupBox = boundsWithin(0, H);

console.log(`source            ${W}x${H}`);
console.log(`mark/word split   y=${split} (${quietest} ink pixels on that row)`);
console.log(`mark bounds       x ${markBox.minX}-${markBox.maxX}, y ${markBox.minY}-${markBox.maxY}`);
console.log(`lockup bounds     x ${lockupBox.minX}-${lockupBox.maxX}, y ${lockupBox.minY}-${lockupBox.maxY}`);

const PAD = 6;
const mark = crop(
  Math.max(0, markBox.minX - PAD),
  Math.max(0, markBox.minY - PAD),
  Math.min(W, markBox.maxX + PAD),
  Math.min(H, markBox.maxY + PAD),
);
const lockup = crop(
  Math.max(0, lockupBox.minX - PAD),
  Math.max(0, lockupBox.minY - PAD),
  Math.min(W, lockupBox.maxX + PAD),
  Math.min(H, lockupBox.maxY + PAD),
);

const outputs = [
  // Print: the complete lockup, used as the sticker's brand block. Sized so a
  // 30mm-tall placement still resolves past 300 dpi.
  {
    png: resize(lockup, 420),
    file: path.join(ROOT, 'apps/api/src/modules/qr/assets/logo-lockup.png'),
  },
  // Print: embedded in every sticker, so size matters. 360px across a 14mm
  // band is about 650 dpi — well beyond what a vinyl printer resolves.
  { png: resize(mark, 360), file: path.join(ROOT, 'apps/api/src/modules/qr/assets/logo-mark.png') },
  // Web: served once and cached.
  { png: resize(mark, 512), file: path.join(ROOT, 'apps/web/public/vorldx-mark.png') },
  { png: resize(lockup, 900), file: path.join(ROOT, 'apps/web/public/vorldx-saarthi.png') },
];

for (const { png: image, file } of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = PNG.sync.write(image, { deflateLevel: 9 });
  fs.writeFileSync(file, buffer);
  console.log(
    `wrote ${path.relative(ROOT, file).padEnd(48)} ${image.width}x${image.height}  ${(buffer.length / 1024).toFixed(0)} KB`,
  );
}

// The API embeds the mark as a data URI, so ship it as a module rather than
// reading a binary at runtime — keeps the build a plain tsc with no asset step.
const markBuffer = fs.readFileSync(
  path.join(ROOT, 'apps/api/src/modules/qr/assets/logo-lockup.png'),
);
const markPng = PNG.sync.read(markBuffer);
const moduleSource = `/**
 * The complete VorldX Saarthi lockup, embedded for print.
 *
 * Generated by \`tools/prepare-logo.cjs\` from \`saarthiLogo.png\` — do not edit
 * by hand. This is the whole logo, mark and wordmark and tagline, used as the
 * brand block on every sticker so nothing has to be typeset beside it.
 *
 * Downscaled because the 650 KB source would otherwise land in every print file
 * and in every cell of an A4 sheet.
 */
export const LOGO_MARK_WIDTH = ${markPng.width};
export const LOGO_MARK_HEIGHT = ${markPng.height};
export const LOGO_MARK_DATA_URI =
  'data:image/png;base64,${markBuffer.toString('base64')}';
`;
const modulePath = path.join(ROOT, 'apps/api/src/modules/qr/assets/logo-mark.ts');
fs.writeFileSync(modulePath, moduleSource);
console.log(
  `wrote ${path.relative(ROOT, modulePath).padEnd(48)} ${(moduleSource.length / 1024).toFixed(0)} KB module`,
);

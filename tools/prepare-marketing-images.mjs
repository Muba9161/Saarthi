#!/usr/bin/env node
/**
 * Cut the marketing photography down to what the site actually ships.
 *
 *   node tools/prepare-marketing-images.mjs
 *   node tools/prepare-marketing-images.mjs --only hero-highway
 *   node tools/prepare-marketing-images.mjs --quality 88
 *
 * Reads whatever you dropped in `design/marketing/` and writes WebP into
 * `apps/web/public/marketing/` at the exact dimensions the page expects. Match
 * a source to its slot by filename: `hero-highway.png` becomes
 * `hero-highway.webp`. Any of .png .jpg .jpeg .webp .tif .tiff will do, and
 * the extension does not have to match what the manifest is called.
 *
 * Nothing here is destructive to your originals — sources are read only, and
 * the full-resolution files stay in `design/marketing/` so a frame can always
 * be re-cut at a different size or quality.
 *
 * Encoding is ffmpeg's libwebp rather than sharp, because ffmpeg is already on
 * this machine and sharp would pull a native toolchain into the repo for nine
 * files that change once a quarter.
 *
 * Two fitting rules, and the difference matters:
 *
 *  * Photographs are fitted with **cover** — scaled until they fill the box,
 *    then centre-cropped. The brief composes each frame with its subject off
 *    centre precisely so this crop lands where it should.
 *  * `fleet-lineup` is fitted with **contain** and padded with transparency,
 *    because it is a cut-out. Cropping it would cut a vehicle in half, and it
 *    is the one frame that carries an alpha channel — that band follows the
 *    visitor's theme, so an opaque rectangle there would be a lit slab in the
 *    middle of the dark page.
 *
 * The brief that produced these frames is docs/MARKETING_VISUAL_DIRECTION.md.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'design', 'marketing');
const OUT_DIR = path.join(ROOT, 'apps', 'web', 'public', 'marketing');

/**
 * Every slot the page reads, and the box it is cut to.
 *
 * `budgetKb` is advisory — it prints a warning rather than failing, because a
 * frame that is genuinely worth the bytes is a judgement call and not one a
 * build script should be making. The hero gets the largest allowance because
 * it is the page's largest contentful paint.
 */
const MANIFEST = [
  { name: 'hero-highway', width: 2560, height: 1440, budgetKb: 260 },
  { name: 'hero-highway-portrait', width: 1350, height: 1800, budgetKb: 200 },
  { name: 'safety-night', width: 1400, height: 1750, budgetKb: 140 },
  { name: 'cta-dusk', width: 2400, height: 1200, budgetKb: 200 },
  { name: 'brand-yard', width: 2400, height: 1350, budgetKb: 200 },
  { name: 'fleet-lineup', width: 2400, height: 800, budgetKb: 180, alpha: true },
  { name: 'edge-truck', width: 1600, height: 1200, budgetKb: 140, alpha: true },
  { name: 'edge-suv', width: 1600, height: 1200, budgetKb: 140, alpha: true },
  { name: 'step-01-post', width: 1600, height: 900, budgetKb: 140 },
  { name: 'step-02-quote', width: 1600, height: 900, budgetKb: 140 },
  { name: 'step-03-assign', width: 1600, height: 900, budgetKb: 140 },
  { name: 'step-04-track', width: 1600, height: 900, budgetKb: 140 },
];

const SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'];

function parseArgs(argv) {
  const options = { quality: 82, only: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--quality') options.quality = Number(argv[++index]);
    else if (flag === '--only') options.only = argv[++index];
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!Number.isFinite(options.quality) || options.quality < 1 || options.quality > 100) {
    throw new Error('--quality must be a number between 1 and 100');
  }
  return options;
}

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A source's pixel dimensions, via ffprobe so every input format works. */
function probeSize(sourcePath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      sourcePath,
    ],
    { encoding: 'utf8' },
  );
  const [width, height] = out.trim().split(',').map(Number);
  return { width, height };
}

/**
 * The box to actually cut to — the manifest's shape, never larger than the
 * source.
 *
 * Generators do not always return the size that was asked for, and scaling a
 * 1672px frame up to the manifest's 2560 invents no detail: it ships a bigger,
 * softer, slower file that looks worse than the original. So the aspect ratio
 * is held exactly and the scale is capped at 1. A frame that comes back small
 * is delivered small, which is the honest outcome and the one the eye
 * prefers.
 *
 * Rounded to even numbers because yuv420p chroma subsampling requires it.
 */
function fitToSource(entry, source) {
  const scale = Math.min(1, source.width / entry.width, source.height / entry.height);
  if (scale >= 1) return { width: entry.width, height: entry.height };
  return {
    width: Math.max(2, Math.round((entry.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((entry.height * scale) / 2) * 2),
  };
}

/** The source for a slot, matched on the stem and ignoring case. */
function findSource(name, entries) {
  for (const extension of SOURCE_EXTENSIONS) {
    const wanted = `${name}${extension}`.toLowerCase();
    const found = entries.find((entry) => entry.toLowerCase() === wanted);
    if (found) return path.join(SOURCE_DIR, found);
  }
  return null;
}

function convert(entry, sourcePath, quality) {
  const { alpha } = entry;
  const { width, height } = fitToSource(entry, probeSize(sourcePath));
  const outputPath = path.join(OUT_DIR, `${entry.name}.webp`);

  // Lanczos on the way down: these are large photographic reductions, and
  // ffmpeg's default bicubic leaves them visibly soft at this ratio.
  const filter = alpha
    ? `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
    : `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${width}:${height}`;

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-vf',
      filter,
      '-c:v',
      'libwebp',
      // yuva420p is the only lossy pixel format libwebp offers with an alpha
      // channel; the cut-out's edges sit against transparency, so the chroma
      // subsampling has nothing to fringe against.
      '-pix_fmt',
      alpha ? 'yuva420p' : 'yuv420p',
      '-preset',
      'photo',
      '-quality',
      String(quality),
      '-frames:v',
      '1',
      outputPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  return outputPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      [
        'Usage: node tools/prepare-marketing-images.mjs [--only <name>] [--quality <1-100>]',
        '',
        `Sources: ${path.relative(ROOT, SOURCE_DIR)}`,
        `Output:  ${path.relative(ROOT, OUT_DIR)}`,
        '',
        'Slots:',
        ...MANIFEST.map(
          (entry) =>
            `  ${entry.name.padEnd(24)} ${String(entry.width).padStart(4)}x${String(entry.height).padEnd(5)}` +
            `${entry.alpha ? ' (keeps alpha)' : ''}`,
        ),
      ].join('\n'),
    );
    return;
  }

  if (!hasFfmpeg()) {
    console.error('ffmpeg is not on PATH. Install it, or add its bin directory to PATH.');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(SOURCE_DIR)) mkdirSync(SOURCE_DIR, { recursive: true });
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const entries = readdirSync(SOURCE_DIR);
  const slots = options.only
    ? MANIFEST.filter((entry) => entry.name === options.only)
    : MANIFEST;

  if (slots.length === 0) {
    console.error(`No slot named "${options.only}". Run with --help to list them.`);
    process.exitCode = 1;
    return;
  }

  let written = 0;
  const missing = [];
  const over = [];

  for (const entry of slots) {
    const sourcePath = findSource(entry.name, entries);
    if (!sourcePath) {
      missing.push(entry.name);
      continue;
    }

    let outputPath;
    try {
      outputPath = convert(entry, sourcePath, options.quality);
    } catch (error) {
      const detail = error.stderr ? String(error.stderr).trim() : error.message;
      console.error(`  FAILED  ${entry.name}: ${detail}`);
      process.exitCode = 1;
      continue;
    }

    const kb = Math.round(statSync(outputPath).size / 1024);
    const cut = fitToSource(entry, probeSize(sourcePath));
    const flag = kb > entry.budgetKb ? ` OVER BUDGET (${entry.budgetKb} KB)` : '';
    if (flag) over.push(entry.name);
    console.log(
      `  ${entry.name.padEnd(24)} ${String(`${cut.width}x${cut.height}`).padEnd(11)} ${String(kb).padStart(4)} KB${flag}`,
    );
    written += 1;
  }

  console.log(`\n${written} of ${slots.length} written to ${path.relative(ROOT, OUT_DIR)}`);

  if (missing.length > 0) {
    console.log(
      `\nNo source found for: ${missing.join(', ')}` +
        `\nDrop them in ${path.relative(ROOT, SOURCE_DIR)} named after the slot, e.g. hero-highway.png.` +
        `\nThe page renders correctly without them, so this is a note and not an error.`,
    );
  }

  if (over.length > 0) {
    console.log(
      `\nOver budget: ${over.join(', ')}. Re-run those with a lower --quality,` +
        ` or accept it if the frame needs the detail.`,
    );
  }
}

main();

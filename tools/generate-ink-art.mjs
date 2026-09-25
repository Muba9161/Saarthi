#!/usr/bin/env node
/**
 * Turn words in every script into the outlines the brush draws.
 *
 *   node tools/generate-ink-art.mjs
 *
 * Two places write text as if with a brush — each letter's outline traced in
 * writing order, then flooded with ink (`components/ink/ink-word.tsx`):
 *
 *  * the marketing band, which writes "Saarthi" in each language, from
 *    `features/marketing/brush-name/saarthi-in-script.json`;
 *  * the language-switch splash, which writes the greeting of the language
 *    just chosen, from `LANGUAGE_CATALOGUE` in `packages/shared`.
 *
 * The browser can only trace a shape it has as path data, and it will not
 * hand over the outlines of a system font. So the shapes are made here, once,
 * from Inter and the Noto faces, and written beside each consumer as a
 * `*.generated.ts` module.
 *
 * Shaping goes through HarfBuzz rather than a plain character-to-glyph lookup,
 * because that lookup is wrong for almost every entry: Devanagari reorders and
 * joins vowel signs, Tamil and Bengali have split vowels, and Nastaliq changes
 * each letter's form by its neighbours. HarfBuzz is what the browser itself
 * would use to lay the word out.
 *
 * Run it again whenever a spelling or a greeting changes. `marketing.test.tsx`
 * and `locale.test.tsx` fail when a word has no art, so a new language cannot
 * quietly ship without it.
 *
 * Fonts are downloaded on first run into `node_modules/.cache/ink-art` and
 * reused after. They are only needed here — the site ships the path data, not
 * the fonts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hb from 'harfbuzzjs';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(ROOT, 'apps', 'web', 'src');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'ink-art');

/**
 * The shared language catalogue, read straight from its TypeScript source so
 * the greetings never depend on `packages/shared` having been rebuilt. The
 * module has no imports, which is what lets it be transpiled on its own; if it
 * ever gains one, this fails loudly on the import rather than drifting.
 */
async function readLanguageCatalogue() {
  const file = path.join(ROOT, 'packages', 'shared', 'src', 'domain', 'languages.ts');
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  const { LANGUAGE_CATALOGUE } = await import(url);
  return LANGUAGE_CATALOGUE;
}

/** Each set of words, where it comes from, and the module it becomes. */
const SETS = [
  {
    name: 'brand name',
    out: path.join(WEB_SRC, 'features', 'marketing', 'brush-name', 'ink-art.generated.ts'),
    exportName: 'INK_ART',
    source: 'saarthi-in-script.json',
    words: async () => {
      const file = path.join(
        WEB_SRC,
        'features',
        'marketing',
        'brush-name',
        'saarthi-in-script.json',
      );
      return Object.values(JSON.parse(readFileSync(file, 'utf8')));
    },
  },
  {
    name: 'greetings',
    out: path.join(WEB_SRC, 'features', 'i18n', 'greeting-ink.generated.ts'),
    exportName: 'GREETING_INK',
    source: 'the greetings in LANGUAGE_CATALOGUE',
    words: async () => (await readLanguageCatalogue()).map((language) => language.greeting),
  },
];

/** Every coordinate is written in thousandths of an em, as whole numbers. */
const EM = 1000;

/**
 * Room around the tightest box, in the same units. The trace is a stroke, so
 * half its width sits outside the outline, and the ink filter pushes edges a
 * little further still. The component's stroke width must stay under this.
 */
const PAD = 60;

const NOTO = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts';
const noto = (family, style) => ({
  file: `${family}-${style}.ttf`,
  url: `${NOTO}/${family}/hinted/ttf/${family}-${style}.ttf`,
});

/**
 * Medium wherever a face has it, to match the weight the band set the live
 * text in. Odia and Nastaliq Urdu are published without a Medium cut, so they
 * take Regular. Inter carries Latin because it is the face of the lockup
 * directly above.
 */
const FONTS = {
  inter: {
    file: 'Inter-Variable.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
    variations: ['wght=500', 'opsz=32'],
  },
  devanagari: noto('NotoSansDevanagari', 'Medium'),
  bengali: noto('NotoSansBengali', 'Medium'),
  gurmukhi: noto('NotoSansGurmukhi', 'Medium'),
  gujarati: noto('NotoSansGujarati', 'Medium'),
  oriya: noto('NotoSansOriya', 'Regular'),
  tamil: noto('NotoSansTamil', 'Medium'),
  telugu: noto('NotoSansTelugu', 'Medium'),
  kannada: noto('NotoSansKannada', 'Medium'),
  malayalam: noto('NotoSansMalayalam', 'Medium'),
  nastaliq: noto('NotoNastaliqUrdu', 'Regular'),
  naskh: noto('NotoNaskhArabic', 'Medium'),
  meetei: noto('NotoSansMeeteiMayek', 'Medium'),
  olChiki: noto('NotoSansOlChiki', 'Medium'),
};

/**
 * Which faces may set a word, by the Unicode block of its first letter, in
 * order of preference. The first face that has a glyph for every character
 * wins. Arabic-script words prefer Nastaliq — the hand Urdu and Kashmiri are
 * actually written in — and fall back to Naskh for letters Nastaliq Urdu does
 * not carry, such as Sindhi's ٿ.
 */
const SCRIPTS = [
  { from: 0x0000, to: 0x024f, fonts: ['inter'] },
  { from: 0x0600, to: 0x06ff, fonts: ['nastaliq', 'naskh'] },
  { from: 0x0900, to: 0x097f, fonts: ['devanagari'] },
  { from: 0x0980, to: 0x09ff, fonts: ['bengali'] },
  { from: 0x0a00, to: 0x0a7f, fonts: ['gurmukhi'] },
  { from: 0x0a80, to: 0x0aff, fonts: ['gujarati'] },
  { from: 0x0b00, to: 0x0b7f, fonts: ['oriya'] },
  { from: 0x0b80, to: 0x0bff, fonts: ['tamil'] },
  { from: 0x0c00, to: 0x0c7f, fonts: ['telugu'] },
  { from: 0x0c80, to: 0x0cff, fonts: ['kannada'] },
  { from: 0x0d00, to: 0x0d7f, fonts: ['malayalam'] },
  { from: 0x1c50, to: 0x1c7f, fonts: ['olChiki'] },
  { from: 0xabc0, to: 0xabff, fonts: ['meetei'] },
];

async function loadFont(key) {
  const spec = FONTS[key];
  const cached = path.join(CACHE_DIR, spec.file);
  if (!existsSync(cached)) {
    process.stdout.write(`  downloading ${spec.file}\n`);
    const response = await fetch(spec.url);
    if (!response.ok) throw new Error(`${spec.url} answered ${response.status}`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }

  const face = new hb.Face(new hb.Blob(readFileSync(cached)));
  const font = new hb.Font(face);
  if (spec.variations) {
    font.setVariations(spec.variations.map((setting) => hb.Variation.fromString(setting)));
  }
  return { key, face, font };
}

const fontCache = new Map();
function fontFor(key) {
  if (!fontCache.has(key)) fontCache.set(key, loadFont(key));
  return fontCache.get(key);
}

async function pickFont(word) {
  const first = word.codePointAt(0);
  const script = SCRIPTS.find((entry) => first >= entry.from && first <= entry.to);
  if (!script) throw new Error(`No face is configured for "${word}" (U+${first.toString(16)})`);

  // Joiners and marks with no glyph of their own are fine to be missing.
  const letters = Array.from(word).filter((char) => !/[‌‍]/.test(char));
  for (const key of script.fonts) {
    const loaded = await fontFor(key);
    if (letters.every((char) => loaded.font.nominalGlyph(char.codePointAt(0)) !== undefined)) {
      return loaded;
    }
  }
  throw new Error(`None of ${script.fonts.join(', ')} can set every letter of "${word}"`);
}

/** Approximate the length of a cubic or quadratic by walking it in chords. */
function curveLength(points, steps) {
  const at = (t) => {
    if (points.length === 3) {
      const [p0, p1, p2] = points;
      const u = 1 - t;
      return [
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      ];
    }
    const [p0, p1, p2, p3] = points;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  };
  let length = 0;
  let previous = points[0];
  for (let step = 1; step <= steps; step += 1) {
    const next = at(step / steps);
    length += Math.hypot(next[0] - previous[0], next[1] - previous[1]);
    previous = next;
  }
  return length;
}

/**
 * Shape a word and return its glyphs, each split into contours.
 *
 * Each contour becomes one stroke of the brush, which is why they are kept
 * apart rather than returned as one path per glyph: the trace draws them one
 * after another, and a contour's length decides how long its stroke takes.
 */
function shapeWord(word, { face, font }) {
  const buffer = new hb.Buffer();
  buffer.addText(word);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer);

  const scale = EM / face.upem;
  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const glyphs = [];
  let penX = 0;
  let penY = 0;

  infos.forEach((info, index) => {
    const position = positions[index];
    const originX = penX + position.xOffset;
    const originY = penY + position.yOffset;
    penX += position.xAdvance;
    penY += position.yAdvance;

    const map = (x, y) => {
      const point = [Math.round((originX + x) * scale), Math.round(-(originY + y) * scale)];
      bounds.minX = Math.min(bounds.minX, point[0]);
      bounds.maxX = Math.max(bounds.maxX, point[0]);
      bounds.minY = Math.min(bounds.minY, point[1]);
      bounds.maxY = Math.max(bounds.maxY, point[1]);
      return point;
    };

    const strokes = [];
    let d = '';
    let length = 0;
    let start = null;
    let cursor = null;
    const close = () => {
      if (!d) return;
      if (start && cursor) length += Math.hypot(start[0] - cursor[0], start[1] - cursor[1]);
      strokes.push({ d: `${d}Z`, len: Math.round(length) });
      d = '';
      length = 0;
    };

    for (const command of font.glyphToJson(info.codepoint)) {
      const v = command.values;
      if (command.type === 'M') {
        close();
        start = cursor = map(v[0], v[1]);
        d = `M${cursor.join(' ')}`;
      } else if (command.type === 'L') {
        const next = map(v[0], v[1]);
        length += Math.hypot(next[0] - cursor[0], next[1] - cursor[1]);
        d += `L${next.join(' ')}`;
        cursor = next;
      } else if (command.type === 'Q') {
        const control = map(v[0], v[1]);
        const next = map(v[2], v[3]);
        length += curveLength([cursor, control, next], 8);
        d += `Q${control.join(' ')} ${next.join(' ')}`;
        cursor = next;
      } else if (command.type === 'C') {
        const c1 = map(v[0], v[1]);
        const c2 = map(v[2], v[3]);
        const next = map(v[4], v[5]);
        length += curveLength([cursor, c1, c2, next], 12);
        d += `C${c1.join(' ')} ${c2.join(' ')} ${next.join(' ')}`;
        cursor = next;
      } else if (command.type === 'Z') {
        close();
      }
    }
    close();

    if (strokes.length > 0) glyphs.push({ cluster: info.cluster, visual: index, strokes });
  });

  buffer.destroy?.();

  // HarfBuzz returns glyphs in visual order. The brush writes in logical
  // order — the order of the clusters — which is right to left for Urdu,
  // Kashmiri and Sindhi and left to right for everything else.
  const rtl = infos.length > 1 && infos[0].cluster > infos[infos.length - 1].cluster;
  glyphs.sort((a, b) => a.cluster - b.cluster || (rtl ? b.visual - a.visual : a.visual - b.visual));

  return {
    box: [
      bounds.minX - PAD,
      bounds.minY - PAD,
      bounds.maxX - bounds.minX + PAD * 2,
      bounds.maxY - bounds.minY + PAD * 2,
    ],
    glyphs: glyphs.map(({ strokes }) => ({ strokes })),
  };
}

async function writeSet(set) {
  // Several locales share a spelling — सारथी, नमस्ते — and each is drawn once.
  const words = [...new Set(await set.words())].sort();
  process.stdout.write(`\n${set.name}\n`);

  const art = {};
  for (const word of words) {
    const loaded = await pickFont(word);
    art[word] = shapeWord(word, loaded);
    const strokeCount = art[word].glyphs.reduce((sum, glyph) => sum + glyph.strokes.length, 0);
    process.stdout.write(`  ${loaded.key.padEnd(10)} ${word}  ${strokeCount} strokes\n`);
  }

  const body = words
    .map((word) => `  ${JSON.stringify(word)}: ${JSON.stringify(art[word])},`)
    .join('\n');
  const source = `/*
 * Generated by tools/generate-ink-art.mjs from ${set.source}.
 * Do not edit by hand — change the words and run the script again.
 *
 * Glyph outlines from Inter and the Noto families, SIL Open Font License 1.1.
 */
import type { InkArt } from '@/components/ink/ink-art.types';

export const ${set.exportName}: Readonly<Record<string, InkArt>> = {
${body}
};
`;

  writeFileSync(set.out, source);
  const size = (Buffer.byteLength(source) / 1024).toFixed(1);
  process.stdout.write(
    `Wrote ${path.relative(ROOT, set.out)} — ${words.length} words, ${size} KB\n`,
  );
}

async function main() {
  for (const set of SETS) await writeSet(set);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

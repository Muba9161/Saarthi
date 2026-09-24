/*
 * Assembles the Saarthi Marketing Playbook and renders it to PDF.
 *
 *   node docs/marketing-playbook/build.mjs            build + PDF
 *   node docs/marketing-playbook/build.mjs --check    build + report overflow
 *   node docs/marketing-playbook/build.mjs --shot 1 7 build + PNG of pages 1, 7
 *
 * Page partials are plain HTML fragments in ./pages, concatenated in filename
 * order. Assets are copied next to the generated HTML so nothing depends on an
 * absolute path containing a space.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(HERE, '.build');
const PDF = join(ROOT, 'docs', 'Saarthi_Marketing_Playbook.pdf');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => {
  try {
    readFileSync(p, { flag: 'r' });
    return true;
  } catch {
    return false;
  }
});

if (!CHROME) throw new Error('Chrome not found — cannot render the PDF.');

/** Marketing imagery, copied in from the places that already own it. */
const ASSETS = {
  'hero-highway.webp': 'apps/web/public/marketing/hero-highway.webp',
  'coverage-india.webp': 'apps/web/public/marketing/coverage-india.webp',
  'cta-dusk.webp': 'apps/web/public/marketing/cta-dusk.webp',
  'safety-night.webp': 'apps/web/public/marketing/safety-night.webp',
  'fleet-lineup.webp': 'apps/web/public/marketing/fleet-lineup.webp',
  'brand-yard.webp': 'apps/web/public/marketing/brand-yard.webp',
  'step-01-post.webp': 'apps/web/public/marketing/step-01-post.webp',
  'step-02-quote.webp': 'apps/web/public/marketing/step-02-quote.webp',
  'step-04-track.webp': 'apps/web/public/marketing/step-04-track.webp',
  'edge-truck.webp': 'apps/web/public/marketing/edge-truck.webp',
  'logo.png': 'apps/web/public/vorldx-saarthi.png',
  'mark.png': 'apps/web/public/vorldx-mark.png',
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });

for (const [name, from] of Object.entries(ASSETS)) {
  copyFileSync(join(ROOT, from), join(OUT, 'assets', name));
}
copyFileSync(join(HERE, 'styles.css'), join(OUT, 'styles.css'));

/*
 * Inter, fetched once and cached in ./fonts as a single self-contained
 * stylesheet with every face inlined as a data: URI.
 *
 * Two problems forced this. Loading the webfont over the network at render time
 * is not reliable — headless Chrome printed one build before the font arrived
 * and silently fell back to Segoe UI. Serving the files from disk does not work
 * either: a file:// page is an opaque origin, so Chrome refuses the font fetch
 * on CORS grounds and falls back just as quietly. Data URIs sidestep both, and
 * let the build run offline after the first run.
 */
const FONT_DIR = join(HERE, 'fonts');
const FONT_CSS = join(FONT_DIR, 'inter.css');
const GOOGLE_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap';
/*
 * A deliberately plain user agent. Google serves woff2 to a modern Chrome UA,
 * and this Chrome refuses a woff2 delivered as a data: URI — it falls back
 * without warning. The same request from a plain UA returns unsubsetted TTF,
 * which loads from a data: URI correctly.
 */
const PLAIN_UA = 'Mozilla/5.0';

if (!existsSync(FONT_CSS)) {
  mkdirSync(FONT_DIR, { recursive: true });
  const res = await fetch(GOOGLE_CSS, { headers: { 'User-Agent': PLAIN_UA } });
  if (!res.ok) throw new Error(`Could not fetch the Inter stylesheet (${res.status}).`);
  let css = await res.text();

  const remote = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) ?? [])];
  for (const href of remote) {
    const font = await fetch(href, { headers: { 'User-Agent': PLAIN_UA } });
    if (!font.ok) throw new Error(`Could not fetch ${href} (${font.status}).`);
    const type = href.endsWith('.ttf') ? 'font/ttf' : 'font/woff2';
    const data = Buffer.from(await font.arrayBuffer()).toString('base64');
    css = css.split(href).join(`data:${type};base64,${data}`);
  }
  writeFileSync(FONT_CSS, css);
  console.log(`cached ${remote.length} Inter faces in ${FONT_CSS}`);
}

mkdirSync(join(OUT, 'fonts'), { recursive: true });
copyFileSync(FONT_CSS, join(OUT, 'fonts', 'inter.css'));

const partials = readdirSync(join(HERE, 'pages'))
  .filter((f) => f.endsWith('.html'))
  .sort();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Saarthi — Marketing Playbook</title>
<link rel="stylesheet" href="fonts/inter.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${partials.map((f) => readFileSync(join(HERE, 'pages', f), 'utf8')).join('\n')}
<script>
/* Flags any page whose content spills out of the page box in either axis, so a
   layout overflow is caught at build time rather than in the printed PDF. The
   page clips silently, so without this a clipped column looks fine here and
   wrong on paper. */
document.querySelectorAll('.page').forEach((p, i) => {
  const over = [];
  if (p.scrollHeight > p.clientHeight + 1) over.push((p.scrollHeight - p.clientHeight) + 'px tall');
  if (p.scrollWidth > p.clientWidth + 1) over.push((p.scrollWidth - p.clientWidth) + 'px wide');
  if (over.length) p.dataset.overflow = 'PAGE_OVERFLOW ' + (i + 1) + ' by ' + over.join(' and ');

  /* Cards clip their own contents too — a table wider than its card loses a
     column just as silently as a page losing a card. */
  p.querySelectorAll('.card, .tbl-card').forEach((c) => {
    if (c.scrollWidth > c.clientWidth + 1) {
      c.dataset.overflow =
        'CARD_OVERFLOW page ' + (i + 1) + ' by ' + (c.scrollWidth - c.clientWidth) + 'px wide';
    }
  });
});
</script>
</body>
</html>`;

writeFileSync(join(OUT, 'index.html'), html);

const url = 'file:///' + join(OUT, 'index.html').replace(/\\/g, '/').replace(/ /g, '%20');
const base = ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--virtual-time-budget=20000'];

const run = (args) => execFileSync(CHROME, [...base, ...args, url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const args = process.argv.slice(2);

if (args.includes('--check')) {
  const dom = run(['--dump-dom']);
  // Read the attribute, not the marker text — the inline script's own source
  // is present in the dumped DOM and matches a bare marker search.
  const hits = (dom.match(/data-overflow="[^"]+"/g) ?? []).map((a) => a.slice(15, -1));
  const count = (dom.match(/class="page/g) ?? []).length;
  console.log(`pages: ${count}`);
  console.log(hits.length ? hits.join('\n') : 'no overflow');
  process.exit(0);
}

const shotIndex = args.indexOf('--shot');
if (shotIndex !== -1) {
  const wanted = args.slice(shotIndex + 1).filter((a) => /^\d+$/.test(a));
  for (const n of wanted) {
    const single = join(OUT, `p${n}.html`);
    const pages = html.split(/(?=<section class="page)/).filter((s) => s.startsWith('<section class="page'));
    writeFileSync(
      single,
      html.slice(0, html.indexOf('<section class="page')) + pages[Number(n) - 1] + '</body></html>',
    );
    const u = 'file:///' + single.replace(/\\/g, '/').replace(/ /g, '%20');
    execFileSync(CHROME, [...base, '--window-size=1123,794', `--screenshot=${join(OUT, `page-${n}.png`)}`, u], {
      stdio: 'ignore',
    });
    console.log(`page-${n}.png`);
  }
  process.exit(0);
}

run([`--print-to-pdf=${PDF}`, '--no-pdf-header-footer']);
console.log(`PDF written: ${PDF}`);

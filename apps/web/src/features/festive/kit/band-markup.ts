import { FESTIVE_KITS, type FestivalKey, type FestiveKit } from '@saarthi/shared';

/**
 * The garland strip as SVG markup: one repeating tile per motif, so it fills
 * any width without stretching. Built as a string because two places draw it:
 * React (`FestiveBandArt`) and the boot splash, which is plain DOM painted
 * before React exists. Every value comes from `FESTIVE_KITS` (validated
 * `#RRGGBB` colours) and fixed geometry, never from user input.
 *
 * Geometry follows the approved "Festive band" artboard (52 px tall).
 */

export const BAND_HEIGHT = 52;

type Band = FestiveKit['band'];

function fill(colour: string, extra = ''): string {
  return `style="fill:${colour};${extra}"`;
}

function stroke(colour: string, width: number, extra = ''): string {
  return `style="fill:none;stroke:${colour};stroke-width:${width};${extra}"`;
}

function drop(kit: FestiveKit, b: Band): string {
  switch (kit.drop) {
    case 'diya':
      return (
        `<circle cx="48" cy="34" r="7" ${fill('#FFD166', 'opacity:.25')}/>` +
        `<ellipse cx="48" cy="33.5" rx="2.4" ry="4.4" ${fill('#FFD166')}/>` +
        `<path d="M39.5 37.5 Q48 47 56.5 37.5 Z" ${fill(b.c)}/>`
      );
    case 'rakhi':
      return (
        `<circle cx="48" cy="36" r="6.5" ${fill(b.c)}/>` +
        [
          [48, 29.8],
          [54.2, 36],
          [48, 42.2],
          [41.8, 36],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" ${fill(b.a)}/>`)
          .join('') +
        `<circle cx="48" cy="36" r="2.6" ${fill(b.b)}/>`
      );
    case 'feather':
      return (
        `<ellipse cx="48" cy="38" rx="4.6" ry="9" ${fill(b.leaf)}/>` +
        `<ellipse cx="48" cy="37" rx="3" ry="4.6" ${fill(b.c)}/>` +
        `<circle cx="48" cy="37" r="1.7" ${fill('#1E3A8A')}/>`
      );
    case 'leaf':
      return (
        `<ellipse cx="45" cy="37" rx="3" ry="8.5" transform="rotate(10 45 37)" ${fill(b.leaf)}/>` +
        `<ellipse cx="51" cy="37" rx="3" ry="8.5" transform="rotate(-10 51 37)" ${fill(b.c)}/>`
      );
    case 'flower':
      return (
        [
          [48, 31.5],
          [52.8, 35],
          [51, 40.5],
          [45, 40.5],
          [43.2, 35],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" ${fill(b.c)}/>`)
          .join('') + `<circle cx="48" cy="36.5" r="2.4" ${fill(b.a)}/>`
      );
    default:
      return '';
  }
}

function toranTile(kit: FestiveKit, b: Band): string {
  const blooms = [
    [0, 5],
    [24, 13.3],
    [48, 16],
    [72, 13.3],
    [96, 5],
  ]
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="5.5" ${fill(b.a)}/><circle cx="${x}" cy="${y}" r="2.2" ${fill(b.b)}/>`,
    )
    .join('');
  return (
    `<path d="M0 5 Q48 27 96 5" ${stroke(b.rope, 2)}/>` +
    `<ellipse cx="13" cy="18" rx="3" ry="8" transform="rotate(-16 13 18)" ${fill(b.leaf)}/>` +
    `<ellipse cx="83" cy="18" rx="3" ry="8" transform="rotate(16 83 18)" ${fill(b.leaf)}/>` +
    blooms +
    `<path d="M48 21 V29" ${stroke(b.rope, 1.2)}/>` +
    drop(kit, b)
  );
}

function lightsTile(b: Band): string {
  const bulb = (x: number, cy: number, colour: string) =>
    `<circle cx="${x}" cy="${cy}" r="9" ${fill(colour, 'opacity:.22')}/>` +
    `<rect x="${x - 2}" y="${cy - 9}" width="4" height="4" rx="1" ${fill('#374151')}/>` +
    `<ellipse cx="${x}" cy="${cy}" rx="4.2" ry="6" ${fill(colour)}/>`;
  const flake = (x: number, y: number, r: number, o: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" ${fill('#FFFFFF', `opacity:${o}`)}/>`;
  return (
    `<path d="M0 6 Q40 24 80 6" ${stroke(b.rope, 1.6)}/>` +
    bulb(12, 19, b.a) +
    bulb(40, 23, b.b) +
    bulb(68, 19, b.c) +
    flake(26, 38, 1.5, 0.8) +
    flake(56, 44, 1.3, 0.7) +
    flake(6, 46, 1.1, 0.6) +
    flake(74, 36, 1.2, 0.7)
  );
}

function sparkleTile(b: Band): string {
  return (
    `<path d="M0 4 C 18 14, 30 -2, 48 8 S 66 14, 72 4" ${stroke(b.a, 2.5)}/>` +
    `<path d="M0 12 C 20 22, 34 6, 52 16 S 68 20, 72 12" ${stroke(b.b, 1.5, 'opacity:.85')}/>` +
    `<path d="M20 25 L21.7 30.3 L27 32 L21.7 33.7 L20 39 L18.3 33.7 L13 32 L18.3 30.3 Z" ${fill(b.a)}/>` +
    `<path d="M54 34 L55 37 L58 38 L55 39 L54 42 L53 39 L50 38 L53 37 Z" ${fill(b.c)}/>` +
    `<circle cx="38" cy="30" r="1.6" ${fill(b.b)}/>` +
    `<circle cx="66" cy="26" r="1.3" ${fill(b.a)}/>`
  );
}

function kitesTile(b: Band): string {
  return (
    `<path d="M0 3 Q55 13 110 3" ${stroke(b.rope, 1)}/>` +
    `<path d="M28 7 V12" ${stroke(b.rope, 1)}/>` +
    `<path d="M28 12 L37 24 L28 38 L19 24 Z" ${fill(b.a)}/>` +
    `<path d="M28 12 V38 M19 24 H37" ${stroke('rgba(0,0,0,.18)', 1)}/>` +
    `<path d="M28 38 q-3 4 0 7 q3 3 0 6" ${stroke(b.a, 1.4)}/>` +
    `<path d="M82 7 V17" ${stroke(b.rope, 1)}/>` +
    `<path d="M82 17 L90 28 L82 40 L74 28 Z" ${fill(b.b)}/>` +
    `<path d="M74 28 L90 28 L82 40 Z" ${fill(b.c)}/>` +
    `<path d="M82 40 q3 3 0 6" ${stroke(b.d, 1.4)}/>`
  );
}

function buntingTile(b: Band): string {
  return (
    `<path d="M0 3 Q36 11 72 3" ${stroke(b.rope, 1.2)}/>` +
    `<path d="M2 3.4 L22 5.6 L12 28 Z" ${fill(b.a)}/>` +
    `<path d="M26 6.3 L46 6.3 L36 30 Z" ${fill(b.b, 'stroke:rgba(0,0,0,.1);stroke-width:.6')}/>` +
    `<path d="M50 5.6 L70 3.4 L60 28 Z" ${fill(b.c)}/>`
  );
}

function lanternsTile(b: Band): string {
  return (
    `<path d="M0 2 H96" ${stroke(b.rope, 1)}/>` +
    `<path d="M20 2 V14" ${stroke(b.rope, 1)}/>` +
    `<circle cx="20" cy="26" r="13" ${fill(b.a, 'opacity:.18')}/>` +
    `<rect x="16" y="14" width="8" height="4" rx="1" ${fill(b.rope)}/>` +
    `<path d="M14 18 L26 18 L28 25 L26 34 L14 34 L12 25 Z" ${fill(b.a)}/>` +
    `<path d="M16 21 L24 21 L25 25 L24 31 L16 31 L15 25 Z" ${fill(b.b, 'opacity:.92')}/>` +
    `<path d="M58 2 V11" ${stroke(b.rope, 1)}/>` +
    `<path d="M58 11 A10 10 0 1 0 58 31 A8 8 0 1 1 58 11 Z" ${fill(b.a)}/>` +
    `<path d="M82 2 V8" ${stroke(b.rope, 1)}/>` +
    `<rect x="79" y="8" width="6" height="3" rx="1" ${fill(b.rope)}/>` +
    `<path d="M77 11 L87 11 L88.5 17 L87 24 L77 24 L75.5 17 Z" ${fill(b.c)}/>` +
    `<path d="M79 13.5 L85 13.5 L86 17 L85 21.5 L79 21.5 L78 17 Z" ${fill(b.b, 'opacity:.9')}/>` +
    `<path d="M40 36 L41 39 L44 40 L41 41 L40 44 L39 41 L36 40 L39 39 Z" ${fill(b.b)}/>` +
    `<path d="M70 40 L70.8 42.2 L73 43 L70.8 43.8 L70 46 L69.2 43.8 L67 43 L69.2 42.2 Z" ${fill(b.a)}/>`
  );
}

function dripTile(b: Band): string {
  const segment = (x: number, colour: string, drips: [number, number, number][]) =>
    `<rect x="${x}" y="0" width="30" height="9" ${fill(colour)}/>` +
    drips
      .map(
        ([dx, w, h]) =>
          `<rect x="${x + dx}" y="4" width="${w}" height="${h}" rx="${w / 2}" ${fill(colour)}/>`,
      )
      .join('');
  return (
    segment(0, b.a, [
      [7, 6, 20],
      [20, 5, 11],
    ]) +
    segment(30, b.b, [
      [6, 5, 13],
      [18, 6, 25],
    ]) +
    segment(60, b.c, [
      [5, 6, 17],
      [20, 5, 9],
    ]) +
    segment(90, b.d, [
      [6, 5, 12],
      [18, 6, 22],
    ]) +
    `<circle cx="24" cy="40" r="5" ${fill(b.c, 'opacity:.35')}/>` +
    `<circle cx="84" cy="38" r="4" ${fill(b.a, 'opacity:.35')}/>`
  );
}

const TILE_WIDTH: Record<FestiveKit['motif'], number> = {
  toran: 96,
  lights: 80,
  sparkle: 72,
  kites: 110,
  bunting: 72,
  lanterns: 96,
  drip: 120,
};

function tile(kit: FestiveKit): string {
  const b = kit.band;
  switch (kit.motif) {
    case 'toran':
      return toranTile(kit, b);
    case 'lights':
      return lightsTile(b);
    case 'sparkle':
      return sparkleTile(b);
    case 'kites':
      return kitesTile(b);
    case 'bunting':
      return buntingTile(b);
    case 'lanterns':
      return lanternsTile(b);
    case 'drip':
      return dripTile(b);
  }
}

/**
 * The garland for `key` as an `<svg>` string. `uid` keeps the pattern id
 * unique when several garlands share a page (the header and the modal).
 */
export function festiveBandMarkup(key: FestivalKey, uid: string): string {
  const kit = FESTIVE_KITS[key];
  const id = `festive-band-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    `<svg width="100%" height="${BAND_HEIGHT}" aria-hidden="true" focusable="false" style="display:block">` +
    `<defs><pattern id="${id}" width="${TILE_WIDTH[kit.motif]}" height="${BAND_HEIGHT}" patternUnits="userSpaceOnUse">` +
    tile(kit) +
    `</pattern></defs><rect width="100%" height="${BAND_HEIGHT}" fill="url(#${id})"/></svg>`
  );
}

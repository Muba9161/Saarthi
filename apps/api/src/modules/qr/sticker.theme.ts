/**
 * VorldX Saarthi print identity.
 *
 * Sampled from `saarthiLogo.png` rather than approximated, so a printed sticker
 * and the logo sitting on it are the same navy, the same saffron and the same
 * green. Guessing "close enough" is how a brand ends up with four blues.
 *
 * The tricolour is the logo's own device — its X is saffron into green — so
 * the accent rule under each header repeats it rather than inventing a stripe.
 */
export const BRAND = {
  /** The wordmark navy. Deep enough to read as near-black at small sizes. */
  primary: '#011c45',
  /** A lift on the navy, for gradients and secondary marks. */
  primaryDeep: '#00306e',
  /** The logo's saffron. */
  accent: '#fe5d09',
  /** The logo's green, the third band of the tricolour. */
  green: '#02783f',
  /** Body text and QR modules — the navy, warmed very slightly. */
  ink: '#0b1a33',
  muted: '#5a6b85',
  paper: '#ffffff',
  /** Very light navy wash for footer panels. */
  wash: '#eef2f8',
  hairline: '#d5dee9',
  verified: '#02783f',
} as const;

/**
 * Print geometry, in millimetres.
 *
 * `bleed` is the extra area a commercial printer trims off; `safe` is the
 * margin inside which nothing important may sit, because guillotine tolerance
 * on a die-cut sticker is roughly ±1 mm.
 */
export const PRINT = {
  bleedMm: 3,
  safeMm: 4,
  /** Stroke width for crop marks. */
  markStroke: 0.25,
  markLengthMm: 4,
} as const;

export interface StickerPreset {
  key: string;
  label: string;
  /** Trimmed size, excluding bleed. */
  widthMm: number;
  heightMm: number;
  /** Corner radius of the die cut. 0 = square cut. */
  radiusMm: number;
  description: string;
}

/**
 * The three artefacts Saarthi prints.
 *
 * Sizes are not arbitrary. The ID card is CR80, the same as every bank and
 * access card, so it fits an existing lanyard holder. The door sticker is
 * 100 mm because that is the smallest square whose QR still scans reliably
 * from about three metres with a phone. The bumper strip is sized to sit above
 * a tailgate registration plate without covering it.
 */
export const STICKER_PRESETS: Record<string, StickerPreset> = {
  'vehicle-sticker': {
    key: 'vehicle-sticker',
    label: 'Vehicle door sticker',
    widthMm: 100,
    heightMm: 100,
    radiusMm: 8,
    description: 'Square sticker for the cab door or body panel.',
  },
  'vehicle-windscreen': {
    key: 'vehicle-windscreen',
    label: 'Windscreen sticker',
    // Deliberately small. A windscreen sticker has to sit in a corner without
    // obstructing the driver's view, which is both a safety matter and a
    // roadworthiness one — a large sticker on the glass is a defect.
    widthMm: 90,
    heightMm: 55,
    radiusMm: 5,
    description:
      'Compact sticker for a corner of the windscreen. Supports reverse printing for inside-glass fitting.',
  },
  'vehicle-strip': {
    key: 'vehicle-strip',
    label: 'Vehicle bumper strip',
    widthMm: 150,
    heightMm: 60,
    radiusMm: 6,
    description: 'Landscape strip for the tailgate, above the number plate.',
  },
  'driver-card': {
    key: 'driver-card',
    label: 'Driver ID card',
    widthMm: 85.6,
    heightMm: 54,
    radiusMm: 3.5,
    description: 'CR80 card that fits a standard lanyard holder.',
  },
};

export function stickerPreset(key: string): StickerPreset {
  return STICKER_PRESETS[key] ?? STICKER_PRESETS['vehicle-sticker']!;
}

export const STICKER_PRESET_LIST: StickerPreset[] = Object.values(STICKER_PRESETS);

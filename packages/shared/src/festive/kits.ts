import type { FestivalKey } from './calendar';

/**
 * How each festival looks, as plain data every client draws from: the web
 * renders the garland as an SVG pattern, the Android apps draw the same shapes
 * on a Compose canvas. One table, so a colour changed here changes everywhere.
 *
 * Values follow the approved design canvas "Saarthi Auth Modal and Festive
 * Layer" (2026-11-20). Colours are `#RRGGBB`; a glow carries its alpha
 * separately so CSS and Android can both use it without re-encoding.
 */

/** The shape of the garland strip. */
export type FestiveMotif =
  'toran' | 'lights' | 'sparkle' | 'kites' | 'bunting' | 'lanterns' | 'drip';

/** What hangs from the middle of a toran (marigold garland). */
export type FestiveDrop = 'diya' | 'rakhi' | 'feather' | 'leaf' | 'flower';

/** What drifts across a festive panel. `embers` rise; everything else falls. */
export type FestiveFx = 'petals' | 'snow' | 'confetti' | 'stars' | 'kites' | 'embers';

export interface FestiveGlow {
  color: string;
  alpha: number;
}

export interface FestiveKit {
  motif: FestiveMotif;
  /** Only for `toran`. */
  drop?: FestiveDrop;
  /** Garland colours: a = main bloom, b = bloom centre, c = accent, d = second accent. */
  band: { a: string; b: string; c: string; d: string; rope: string; leaf: string };
  /** The festival's call-to-action gradient and the ink on it (4.5:1 or better). */
  cta: { from: string; to: string; ink: string };
  /** Two washes of light behind dark festive surfaces. */
  glow: [FestiveGlow, FestiveGlow];
  /** The wish's colour on a dark surface. */
  wishOnDark: string;
  /** The wish's colour on a light surface (4.5:1 or better on white). */
  wishOnLight: string;
  fx: FestiveFx;
  fxColors: readonly string[];
}

export const FESTIVE_KITS: Readonly<Record<FestivalKey, FestiveKit>> = {
  diwali: {
    motif: 'toran',
    drop: 'diya',
    band: {
      a: '#F59E0B',
      b: '#FDE68A',
      c: '#B45309',
      d: '#B45309',
      rope: '#7C2D12',
      leaf: '#15803D',
    },
    cta: { from: '#F9BD3B', to: '#E8891C', ink: '#241300' },
    glow: [
      { color: '#E8891C', alpha: 0.4 },
      { color: '#7C2D12', alpha: 0.5 },
    ],
    wishOnDark: '#FFD98A',
    wishOnLight: '#9A4A07',
    fx: 'embers',
    fxColors: ['#FFD27A', '#FFB347'],
  },
  'guru-nanak-jayanti': {
    motif: 'toran',
    drop: 'diya',
    band: {
      a: '#F59E0B',
      b: '#FFE7A3',
      c: '#1E3A8A',
      d: '#1E3A8A',
      rope: '#1E3A8A',
      leaf: '#2F855A',
    },
    cta: { from: '#F9B949', to: '#EE8A1A', ink: '#2B1600' },
    glow: [
      { color: '#EE8A1A', alpha: 0.36 },
      { color: '#2547A0', alpha: 0.5 },
    ],
    wishOnDark: '#FFD58A',
    wishOnLight: '#9A4A07',
    fx: 'petals',
    fxColors: ['#F9B949', '#FFE7A3', '#FFFFFF'],
  },
  christmas: {
    motif: 'lights',
    band: {
      a: '#E23B3B',
      b: '#F5C451',
      c: '#2FA36B',
      d: '#4F7BF0',
      rope: '#4B5563',
      leaf: '#2FA36B',
    },
    cta: { from: '#C62F3B', to: '#9E1F2B', ink: '#FFFFFF' },
    glow: [
      { color: '#C62F3B', alpha: 0.38 },
      { color: '#1F7A4D', alpha: 0.42 },
    ],
    wishOnDark: '#FFE2E2',
    wishOnLight: '#A3202C',
    fx: 'snow',
    fxColors: ['#FFFFFF', '#E5ECF5'],
  },
  'new-year': {
    motif: 'sparkle',
    band: {
      a: '#F5C451',
      b: '#E5E7EB',
      c: '#8E99F5',
      d: '#8E99F5',
      rope: '#F5C451',
      leaf: '#F5C451',
    },
    cta: { from: '#F6CD62', to: '#E0A526', ink: '#1F1600' },
    glow: [
      { color: '#F5C451', alpha: 0.3 },
      { color: '#505CDC', alpha: 0.45 },
    ],
    wishOnDark: '#FFE6A6',
    wishOnLight: '#7A5600',
    fx: 'confetti',
    fxColors: ['#F6CD62', '#E5E7EB', '#8E99F5'],
  },
  'makar-sankranti': {
    motif: 'kites',
    band: {
      a: '#FF8A3D',
      b: '#2BB3E8',
      c: '#FFD23F',
      d: '#E2336B',
      rope: '#94A3B8',
      leaf: '#94A3B8',
    },
    cta: { from: '#FF9A4D', to: '#F2761F', ink: '#2A1000' },
    glow: [
      { color: '#2BB3E8', alpha: 0.4 },
      { color: '#FF8A3D', alpha: 0.34 },
    ],
    wishOnDark: '#FFD9B8',
    wishOnLight: '#9A3F05',
    fx: 'kites',
    fxColors: ['#FF8A3D', '#2BB3E8', '#FFD23F', '#E2336B'],
  },
  'republic-day': {
    motif: 'bunting',
    band: {
      a: '#FF9933',
      b: '#FFFFFF',
      c: '#138808',
      d: '#1E3A8A',
      rope: '#CBD5E1',
      leaf: '#138808',
    },
    cta: { from: '#FFA647', to: '#F08A26', ink: '#1F1000' },
    glow: [
      { color: '#FF9933', alpha: 0.36 },
      { color: '#138808', alpha: 0.38 },
    ],
    wishOnDark: '#FFD9A8',
    wishOnLight: '#9A4A07',
    fx: 'confetti',
    fxColors: ['#FF9933', '#FFFFFF', '#2FA84F'],
  },
  'eid-al-fitr': {
    motif: 'lanterns',
    band: {
      a: '#E9C46A',
      b: '#FFF3C4',
      c: '#2A9D8F',
      d: '#2A9D8F',
      rope: '#CBB26A',
      leaf: '#2A9D8F',
    },
    cta: { from: '#17785A', to: '#0F5E46', ink: '#FFFFFF' },
    glow: [
      { color: '#2A9D8F', alpha: 0.42 },
      { color: '#E9C46A', alpha: 0.26 },
    ],
    wishOnDark: '#F3DFA2',
    wishOnLight: '#0F5E46',
    fx: 'stars',
    fxColors: ['#E9C46A', '#FFF3C4'],
  },
  holi: {
    motif: 'drip',
    band: {
      a: '#FF4F9A',
      b: '#FFD23F',
      c: '#29C7AC',
      d: '#6C63FF',
      rope: '#FF4F9A',
      leaf: '#29C7AC',
    },
    cta: { from: '#D42A74', to: '#5B52E6', ink: '#FFFFFF' },
    glow: [
      { color: '#FF4F9A', alpha: 0.4 },
      { color: '#29C7AC', alpha: 0.34 },
    ],
    wishOnDark: '#FFC4DE',
    wishOnLight: '#A61E5A',
    fx: 'confetti',
    fxColors: ['#FF4F9A', '#FFD23F', '#29C7AC', '#8C85FF'],
  },
  'eid-al-adha': {
    motif: 'lanterns',
    band: {
      a: '#E9C46A',
      b: '#FFF3C4',
      c: '#1F7A6B',
      d: '#1F7A6B',
      rope: '#CBB26A',
      leaf: '#1F7A6B',
    },
    cta: { from: '#0F6B5C', to: '#0B5247', ink: '#FFFFFF' },
    glow: [
      { color: '#1F7A6B', alpha: 0.46 },
      { color: '#E9C46A', alpha: 0.26 },
    ],
    wishOnDark: '#F3DFA2',
    wishOnLight: '#0B5247',
    fx: 'stars',
    fxColors: ['#E9C46A', '#FFF3C4'],
  },
  'independence-day': {
    motif: 'kites',
    band: {
      a: '#FF9933',
      b: '#FFFFFF',
      c: '#138808',
      d: '#1E3A8A',
      rope: '#CBD5E1',
      leaf: '#138808',
    },
    cta: { from: '#FFA647', to: '#F08A26', ink: '#1F1000' },
    glow: [
      { color: '#FF9933', alpha: 0.34 },
      { color: '#138808', alpha: 0.36 },
    ],
    wishOnDark: '#FFD9A8',
    wishOnLight: '#9A4A07',
    fx: 'kites',
    fxColors: ['#FF9933', '#FFFFFF', '#2FA84F'],
  },
  'raksha-bandhan': {
    motif: 'toran',
    drop: 'rakhi',
    band: {
      a: '#F472B6',
      b: '#FDE68A',
      c: '#F59E0B',
      d: '#F59E0B',
      rope: '#BE185D',
      leaf: '#16A34A',
    },
    cta: { from: '#C8326A', to: '#9E2A8C', ink: '#FFFFFF' },
    glow: [
      { color: '#F472B6', alpha: 0.38 },
      { color: '#F59E0B', alpha: 0.26 },
    ],
    wishOnDark: '#FFD1E4',
    wishOnLight: '#A3285F',
    fx: 'petals',
    fxColors: ['#F472B6', '#FBCB5C', '#FFFFFF'],
  },
  janmashtami: {
    motif: 'toran',
    drop: 'feather',
    band: {
      a: '#FBBF24',
      b: '#FEF3C7',
      c: '#0E7490',
      d: '#0E7490',
      rope: '#1E40AF',
      leaf: '#15803D',
    },
    cta: { from: '#1E5BB8', to: '#164A99', ink: '#FFFFFF' },
    glow: [
      { color: '#0E7490', alpha: 0.44 },
      { color: '#FBBF24', alpha: 0.26 },
    ],
    wishOnDark: '#FFE59A',
    wishOnLight: '#164A99',
    fx: 'petals',
    fxColors: ['#FBBF24', '#22A3B8', '#FFFFFF'],
  },
  'ganesh-chaturthi': {
    motif: 'toran',
    drop: 'leaf',
    band: {
      a: '#F97316',
      b: '#FDE047',
      c: '#DC2626',
      d: '#DC2626',
      rope: '#9A3412',
      leaf: '#15803D',
    },
    cta: { from: '#C8441E', to: '#A93714', ink: '#FFFFFF' },
    glow: [
      { color: '#F97316', alpha: 0.38 },
      { color: '#DC2626', alpha: 0.3 },
    ],
    wishOnDark: '#FFD7A0',
    wishOnLight: '#A93714',
    fx: 'petals',
    fxColors: ['#F97316', '#FDE047', '#EF4444'],
  },
  onam: {
    motif: 'toran',
    drop: 'flower',
    band: {
      a: '#FACC15',
      b: '#FFFFFF',
      c: '#F97316',
      d: '#F97316',
      rope: '#65A30D',
      leaf: '#4D7C0F',
    },
    cta: { from: '#F5C21B', to: '#E39B00', ink: '#241A00' },
    glow: [
      { color: '#FACC15', alpha: 0.32 },
      { color: '#65A30D', alpha: 0.36 },
    ],
    wishOnDark: '#FFF0B3',
    wishOnLight: '#7A5600',
    fx: 'petals',
    fxColors: ['#FACC15', '#F97316', '#FFFFFF', '#C084FC'],
  },
  dussehra: {
    motif: 'toran',
    drop: 'leaf',
    band: {
      a: '#F59E0B',
      b: '#FDE68A',
      c: '#B91C1C',
      d: '#B91C1C',
      rope: '#7F1D1D',
      leaf: '#15803D',
    },
    cta: { from: '#F7A928', to: '#E07A0B', ink: '#241000' },
    glow: [
      { color: '#B91C1C', alpha: 0.4 },
      { color: '#F59E0B', alpha: 0.3 },
    ],
    wishOnDark: '#FFD9A0',
    wishOnLight: '#9A4A07',
    fx: 'embers',
    fxColors: ['#FFC861', '#FF9F43'],
  },
};

/** `#RRGGBB` plus an alpha as a CSS `rgba()` string. */
export function festiveRgba(hex: string, alpha: number): string {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const channel = (offset: number) => parseInt(value.slice(offset, offset + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}

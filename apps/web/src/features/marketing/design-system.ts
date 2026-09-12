/**
 * The public site's design tokens.
 *
 * Colour, radius, shadow and type scale already live in `tailwind.config.ts`
 * and `globals.css`, and nothing here duplicates them — the marketing page is
 * the same product, so it must not invent a second palette that drifts from
 * the one the app ships.
 *
 * What this module owns is the layer Tailwind has no opinion about: the
 * page's *motion* language, and the handful of geometric constants that more
 * than one section has to agree on. Before this file, the same cubic-bezier
 * was re-declared in five section modules, each with its own duration, and
 * "the page's easing" was a thing you had to grep for rather than read.
 *
 * The rule these tokens encode: one easing curve for entrances, one for
 * scroll-linked movement, three durations, and a single scale of scroll
 * distances. Everything on the page is built from that set, which is most of
 * why sections separated by a thousand pixels still feel like one object.
 */

/* -------------------------------------------------------------------------
 * Easing
 * ---------------------------------------------------------------------- */

/**
 * The entrance curve. Fast out of the gate, long settled finish, no overshoot.
 *
 * Exported in both the shapes the page needs, because the two animation
 * systems disagree about the type: Framer Motion wants a four-number tuple,
 * GSAP wants a string it can parse. Deriving the second from the first is what
 * stops them drifting apart.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** The same curve, spelled the way GSAP's parser wants it. */
export const EASE_OUT_CSS = `cubic-bezier(${EASE_OUT.join(',')})`;

/**
 * Scroll-linked movement, where the value is driven by the scrollbar rather
 * than by a clock.
 *
 * Deliberately near-linear: a scroll-linked property with an aggressive ease
 * on it lags the input, and the reader reads that lag as the page being slow
 * rather than as the animation being smooth. Weight comes from the Lenis
 * inertia and the springs in `useSectionProgress`, not from this curve.
 */
export const EASE_SCROLL = 'none' as const;

/* -------------------------------------------------------------------------
 * Duration
 * ---------------------------------------------------------------------- */

/**
 * Three steps, in seconds.
 *
 * `quick` is for something the pointer caused and must acknowledge inside one
 * frame budget of human tolerance. `base` is the page's default entrance.
 * `slow` is reserved for the hero and for section transitions, where the
 * element is large enough that a `base` move reads as a twitch.
 */
export const DURATION = {
  quick: 0.24,
  base: 0.6,
  slow: 0.9,
} as const;

/** The gap between consecutive children of a staggered group, in seconds. */
export const STAGGER = {
  tight: 0.045,
  base: 0.08,
  loose: 0.12,
} as const;

/* -------------------------------------------------------------------------
 * Scroll choreography
 * ---------------------------------------------------------------------- */

/**
 * How far a pinned scene holds the page, as a multiple of viewport height.
 *
 * A pinned section is the one place on a website where the designer takes the
 * scrollbar away from the reader, so the number is a budget rather than a
 * taste: past roughly 3.5 screens of scrolling with the view held still,
 * people stop believing the page is responding and start looking for the
 * close button.
 */
export const PIN_LENGTH = {
  /** A single beat — one idea, held. */
  short: 1.6,
  /** The signature scene: four beats, TRACK → MANAGE → ANALYZE → ACT. */
  scene: 3.2,
} as const;

/**
 * Parallax travel in pixels, from one end of a section's pass to the other.
 *
 * Signed by the caller. Kept small on purpose — the effect is a depth cue,
 * and past about 60px it stops reading as distance and starts reading as the
 * layer being loose.
 */
export const PARALLAX = {
  near: 24,
  mid: 40,
  far: 64,
} as const;

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

/**
 * The sticky header's height in pixels.
 *
 * Load-bearing in four places that must agree or the page shows a seam: the
 * `h-[4.5rem]` row in the header itself, the hero's negative top margin that
 * slides the first band underneath it, the `rootMargin` that decides which
 * nav link is lit, and the stage test that decides whether the chrome renders
 * in light or dark ink. 4.5rem at the root's 16px.
 */
export const HEADER_HEIGHT = 72;

/**
 * The near-black every photographic band sits on, as raw HSL channels.
 *
 * The site is token-driven and flips with the visitor's theme; a photograph is
 * one fixed exposure. Rather than shipping a light and a dark cut of every
 * frame, the photographic bands are a fixed near-black in *both* themes — so
 * this one value is quoted by the stage class, by every scrim gradient, and by
 * the fleet canvas, and it cannot be a theme token without all three moving
 * when the theme does. See the long note in `imagery.tsx`.
 */
export const STAGE_INK = '240 6% 7%';

/** The same, ready to drop into a CSS colour position. */
export const STAGE_INK_CSS = `hsl(${STAGE_INK})`;

/* -------------------------------------------------------------------------
 * Instrument palette
 *
 * The fleet visualisation draws to a canvas, which cannot read a Tailwind
 * class or resolve a CSS variable mid-frame without a `getComputedStyle` call
 * per paint. These are the four inks it draws with, sampled from the tokens
 * they correspond to and fixed here because the surface they land on is fixed.
 * ---------------------------------------------------------------------- */

export const INSTRUMENT = {
  /** The graticule. Barely there — it is a sense of place, not a grid. */
  grid: 'rgba(255,255,255,0.045)',
  /** A road that exists but carries nothing right now. */
  routeIdle: 'rgba(255,255,255,0.13)',
  /** A vehicle under way. The brand's indigo, lifted for a dark ground. */
  routeLive: 'rgba(124,141,255,0.85)',
  /** The selected vehicle, and anything the reader is meant to look at. */
  focus: 'rgba(255,150,60,0.95)',
  /** Healthy status. Matches `--success` in the dark theme. */
  ok: 'rgba(74,203,143,0.9)',
} as const;

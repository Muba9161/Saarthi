import * as React from 'react';
import { motion, useReducedMotion } from '@/components/motion';
import { useParallax, useSectionProgress } from './motion-extras';
import { cn } from '@/lib/utils';

/**
 * The public site's photography.
 *
 * One module owns the filenames, the shape each image is cut to, and the
 * behaviour when a file is not there yet. Three reasons it is not just an
 * `<img>` at each call site:
 *
 *  1. **Nothing may break while the shoot is outstanding.** Every band below
 *     is designed to look finished with no photograph at all — the section
 *     keeps its own near-black ground and its ambient gradient, and the image
 *     is an enhancement layered on top. `Backdrop` removes itself on the first
 *     error, so a missing file costs a 404 in the network tab and nothing
 *     else. That is what lets the layout ship before the assets do.
 *
 *  2. **A photograph does not follow the theme.** The site is token-driven and
 *     flips light/dark; a photograph is one fixed exposure. Rather than
 *     shipping two of every image, the photographic bands are fixed near-black
 *     stages in *both* themes — see `STAGE`. Every other band on the page
 *     stays token-driven exactly as it was.
 *
 *  3. **The ratios are load-bearing.** Each frame is composed with its copy in
 *     mind — the hero's headline sits in the empty left of a 16:9 that would
 *     put the truck off-screen if it were centre-cropped on a phone. So the
 *     hero ships an art-directed portrait cut rather than one file squeezed
 *     into every viewport.
 *
 * Assets live in `public/marketing/`, deliberately *not* in `public/vehicles/`:
 * that folder is a contract with the running app — one transparent cut-out per
 * vehicle class on a shared 900x450 canvas, read by `PHOTO_BY_SILHOUETTE` and
 * cropped to `VEHICLE_ART_ASPECT` — and a 16:9 hero shot in there would break
 * every vehicle card. The brief that produced these files, including the ratio
 * and the composition each one has to hit, is in
 * `docs/MARKETING_VISUAL_DIRECTION.md`.
 */

const BASE = '/marketing';

export const MARKETING_IMAGE = {
  /** 16:9. Copy occupies the left two-thirds, so the truck sits right. */
  hero: `${BASE}/hero-highway.webp`,
  /** 3:4. The same scene reframed — truck low, sky above for the headline. */
  heroPortrait: `${BASE}/hero-highway-portrait.webp`,
  /**
   * 16:9. The country, and one truck on it.
   *
   * A relief India lit by the same two sources as every other frame here — a
   * cold navy rim along the coast, the highway ribbon warm saffron. The map
   * and the truck are held in the RIGHT HALF; the left half is empty haze,
   * because the band's copy lives there.
   *
   * Deliberately carries **no pins, no arcs, no labels and no numerals**. Every
   * claim the band makes is live DOM on top, for the same reason the rest of
   * the page is: the site writes itself in 23 scripts, and a figure baked into
   * a WebP is an English figure forever that no catalogue can keep honest.
   *
   * Nothing is registered to the map either. This is a full-bleed `Backdrop`,
   * so it is cropped differently at every viewport width, and a pin positioned
   * against it would slide off Gujarat on a laptop. Anything that has to point
   * at a place belongs in a framed image with a known box, not here.
   */
  coverage: `${BASE}/coverage-india.webp`,
  /** 3:4. The same scene reframed — map low, empty sky above for the headline. */
  coveragePortrait: `${BASE}/coverage-india-portrait.webp`,
  /**
   * 16:9. The ground under the brand band.
   *
   * Not seen through the letterforms — that was the original plan, and the
   * wordmark carries the logo's own gradient instead. This sits behind the
   * whole band, which does two things the knockout never would: it breaks the
   * long token-driven stretch in the middle of the page, and a night yard of
   * mixed vehicles is the right thing to put the name on.
   */
  brandYard: `${BASE}/brand-yard.webp`,
  /** 4:5. Near-black; sits on the band that is already dark. */
  safety: `${BASE}/safety-night.webp`,
  /** 2:1. The closing band. */
  cta: `${BASE}/cta-dusk.webp`,
  /** 4:3 with alpha. Front of a goods truck facing right, cut at the left. */
  edgeTruck: `${BASE}/edge-truck.webp`,
  /** 4:3 with alpha. Front of an SUV facing left, cut at the right. */
  edgeSuv: `${BASE}/edge-suv.webp`,
  /**
   * 3:1 with a real alpha channel — it sits on a band that flips theme.
   *
   * Carries all six vehicle classes the product models, passenger and goods
   * both, mirroring `/vehicles/`. It is the page's only statement that Saarthi
   * is not a trucking-only platform, so it is the one frame where the subject
   * list is a requirement rather than art direction.
   */
  fleetLineup: `${BASE}/fleet-lineup.webp`,
} as const;

/** 16:9, one per lifecycle step, in the order `STEPS` declares them. */
export const STEP_IMAGES = [
  `${BASE}/step-01-post.webp`,
  `${BASE}/step-02-quote.webp`,
  `${BASE}/step-03-assign.webp`,
  `${BASE}/step-04-track.webp`,
] as const;

/**
 * A band that stays near-black whichever theme the visitor is in.
 *
 * Hard-coded rather than `bg-sidebar`, because the sidebar token is *nearly*
 * this colour in dark mode and exactly this colour in light mode — close
 * enough to look like a bug when the two bands meet, and the whole point of a
 * photographic band is that it does not move when the theme does.
 */
export const STAGE = 'bg-[hsl(240_6%_7%)] text-white';

/* -------------------------------------------------------------------------
 * Full-bleed photography
 * ---------------------------------------------------------------------- */

type Scrim = 'left' | 'bottom' | 'both' | 'full' | 'none';

/** The band's ground, as a colour a gradient can be written against. */
const INK = 'hsl(240 6% 7%)';

/**
 * The gradients that put text back in charge.
 *
 * Even a frame composed with empty space where the copy goes needs help: the
 * image is cropped differently at every viewport width, so the "empty" third
 * is only empty at the width it was composed for. The scrim guarantees the
 * contrast ratio regardless of how the frame lands.
 *
 * `left` darkens the reading column, `bottom` hands the band off to whatever
 * follows without a hard seam, `both` does the two together, and `full` is a
 * vignette for a band whose copy is centred and therefore has no safe side.
 *
 * These are CSS strings applied through `style`, not Tailwind classes, and
 * that is deliberate. The previous version assembled the `both` class from two
 * string literals with `.join('')`; Tailwind's scanner only ever sees source
 * text, so the joined class name existed at runtime and the rule for it was
 * never generated. The scrim silently did not exist — a whole layer of
 * contrast protection missing with nothing to show for it in the markup. An
 * inline gradient cannot fail that way.
 */
const SCRIM: Record<Scrim, string | undefined> = {
  left: `linear-gradient(to right, ${INK} 0%, hsl(240 6% 7% / 0.82) 42%, transparent 78%)`,
  bottom: `linear-gradient(to top, ${INK} 0%, transparent 45%)`,
  both:
    `linear-gradient(to right, ${INK} 0%, hsl(240 6% 7% / 0.76) 40%, transparent 76%), ` +
    `linear-gradient(to top, ${INK} 0%, transparent 42%)`,
  full:
    `radial-gradient(120% 80% at 50% 50%, hsl(240 6% 7% / 0.42) 0%, hsl(240 6% 7% / 0.9) 100%), ` +
    `linear-gradient(to top, ${INK} 0%, transparent 30%, transparent 70%, ${INK} 100%)`,
  none: undefined,
};

/**
 * The photographic layer of a dark band.
 *
 * Renders nothing at all if the file cannot be loaded — see the note at the
 * top of this module. It drifts slowly against the scroll, which is the same
 * parallax the hero's ambient washes already use, and is skipped outright for
 * a visitor who has asked for reduced motion.
 */
export function Backdrop({
  src,
  portraitSrc,
  scrim = 'both',
  /** The hero's image is the page's LCP; everything below it is lazy. */
  priority = false,
  /**
   * Full strength by default.
   *
   * These frames are already lit for a near-black page — they are night
   * scenes whose brightest pixel is a marker lamp. Dimming them on top of
   * that was what made the hero look like an empty gradient: the photograph
   * was loading and painting, and there was simply nothing left of it. The
   * scrim, not the opacity, is what protects the copy.
   */
  opacity = 1,
  className,
  objectPosition = 'center',
}: {
  src: string;
  portraitSrc?: string;
  scrim?: Scrim;
  priority?: boolean;
  opacity?: number;
  className?: string;
  objectPosition?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const reduced = useReducedMotion();
  const { ref, progress } = useSectionProgress();
  const y = useParallax(progress, 36);

  if (failed) return null;

  return (
    <div
      ref={ref}
      /*
       * Clips its own overscan.
       *
       * The parallax layer below is inset by -3rem top and bottom so the
       * translation never exposes an edge, and something has to cut that off.
       * It used to be the section's own `overflow-hidden` — which also
       * guillotined anything meant to hang across the band's boundary. Owning
       * the clip here is what lets a section let an object cross its edge.
       */
      className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}
      aria-hidden
    >
      {/* Overscanned so the parallax translation cannot pull the frame's edge
          into view at either end of the travel. */}
      <motion.div className="absolute -inset-y-12 inset-x-0" style={reduced ? undefined : { y }}>
        <picture>
          {portraitSrc ? <source media="(max-width: 639px)" srcSet={portraitSrc} /> : null}
          <img
            src={src}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            onError={() => setFailed(true)}
            className="size-full object-cover"
            style={{ opacity, objectPosition }}
          />
        </picture>
      </motion.div>

      {SCRIM[scrim] ? (
        <div className="absolute inset-0" style={{ backgroundImage: SCRIM[scrim] }} />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Framed photography
 * ---------------------------------------------------------------------- */

/**
 * A photograph inside a frame, rather than behind the content.
 *
 * Used where the picture is a supporting illustration and not the band's
 * ground — the lifecycle steps, the safety portrait. Collapses to nothing if
 * the file is absent, so the surrounding layout has to hold up without it;
 * every caller here is built that way.
 *
 * `aspect` is required rather than defaulted: an image whose container wants a
 * different shape than the file was cut to is the failure this whole module
 * exists to avoid, and a default would let a call site forget to think about
 * it.
 */
export function PlateImage({
  src,
  alt,
  aspect,
  className,
  imageClassName,
}: {
  src: string;
  /** Empty string marks it decorative — correct when adjacent copy says the same thing. */
  alt: string;
  /** A Tailwind aspect utility, e.g. `aspect-video`, matching the file's ratio. */
  aspect: string;
  className?: string;
  imageClassName?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  if (failed) return null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-[hsl(240_6%_7%)] ring-1 ring-white/10',
        aspect,
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', imageClassName)}
        aria-hidden={alt === '' ? true : undefined}
      />
      {/* A hairline of the brand's own light along the top edge, so a
          photograph sits in the page's material language rather than looking
          like a pasted screenshot. */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        aria-hidden
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Cut-out photography
 * ---------------------------------------------------------------------- */

/**
 * A transparent cut-out on the theme-aware stage.
 *
 * The one photographic treatment that survives both themes untouched, which is
 * why the fleet lineup on the stats band uses it rather than a scene: that
 * band keeps its token-driven ground, and a rectangular photograph would put a
 * hard white slab in the middle of the dark theme.
 */
export function CutOut({
  src,
  alt,
  aspect,
  className,
}: {
  src: string;
  alt: string;
  aspect: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  if (failed) return null;

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      aria-hidden={alt === '' ? true : undefined}
      className={cn('w-full object-contain', aspect, className)}
    />
  );
}

/**
 * A vehicle driving into the band from off the page.
 *
 * Only its front is in the file — the body runs off the frame's cut edge —
 * and it is positioned so that cut sits outside the section, which clips it.
 * The vehicle therefore has no visible end: it reads as continuing past the
 * screen rather than as a picture that stops. That is the whole effect, and
 * it is why the section must own `relative isolate overflow-hidden`, and why
 * this is a cut-out with real alpha rather than a framed photograph.
 *
 * It drifts a little further in as the band scrolls past, so the vehicle is
 * arriving rather than parked.
 *
 * Desktop only. Below `lg` there is no room beside the content for a vehicle
 * to emerge into, and laying one behind a single narrow column turns it from
 * an accent into a texture the text has to compete with.
 */
export function EdgeVehicle({
  src,
  /** Which edge it enters from. The artwork must face into the page. */
  side,
  /** Held low: this sits behind live content and must never fight it. */
  opacity = 0.35,
  className,
}: {
  src: string;
  side: 'left' | 'right';
  opacity?: number;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const reduced = useReducedMotion();
  const { ref, progress } = useSectionProgress();
  // Signed so both sides travel *into* the page as the band rises.
  const x = useParallax(progress, side === 'left' ? -30 : 30);

  if (failed) return null;

  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-none absolute inset-y-0 -z-10 hidden w-[46%] max-w-[36rem] lg:block',
        // Hangs off the side by an eighth of its own width, so the artwork's
        // cut edge is outside the section and the overflow clips it.
        side === 'left' ? '-left-[13%]' : '-right-[13%]',
        className,
      )}
      aria-hidden
    >
      {/*
       * Sat on the band's bottom edge, not centred.
       *
       * The artwork is cropped on three sides — the body runs off one side,
       * and the roof and wheels are cut by the frame. Centring it vertically
       * would hang all three of those slices in mid-band, which reads as a
       * broken image rather than a vehicle. Anchored to the bottom, the wheel
       * cut lands on the section's own edge and looks like ground; the mask
       * dissolves the roof cut; the body cut is off-screen. Nothing is left
       * ending in mid-air.
       */}
      <motion.img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="absolute bottom-0 w-full"
        style={{
          ...(reduced ? {} : { x }),
          opacity,
          maskImage: 'linear-gradient(to bottom, transparent 0%, #000 32%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 32%)',
        }}
      />
    </div>
  );
}

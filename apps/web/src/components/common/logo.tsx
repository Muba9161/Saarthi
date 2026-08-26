import { cn } from '@/lib/utils';

/**
 * VorldX Saarthi brand marks.
 *
 * Two assets, cut from one source lockup by `tools/prepare-logo.cjs`:
 *
 *  * `vorldx-mark.png` — the VX monogram alone, for anywhere the brand appears
 *    beside other chrome at 40px or so. The full lockup's tagline is illegible
 *    at that size, so using it there would render type as texture.
 *  * `vorldx-saarthi.png` — the whole lockup, for the places with room to give
 *    it: the sign-in panel and the landing hero.
 *
 * Both are raster, because the source is. They carry an empty `alt` where a
 * visible wordmark sits beside them, so a screen reader hears the name once
 * rather than twice.
 */

export const BRAND_NAME = 'VorldX Saarthi';
export const BRAND_TAGLINE = 'Manage. Track. Move. Together.';

/**
 * The VX monogram on its own.
 *
 * `decorative` empties the alt text, for the case where a visible wordmark sits
 * beside the mark — otherwise a screen reader announces the brand twice.
 */
export function SaarthiLogo({
  className,
  decorative = false,
  onDark = false,
}: {
  className?: string;
  decorative?: boolean;
  /**
   * Back the mark with a light chip.
   *
   * The logo is drawn in navy on transparency, so on a dark surface — the
   * sidebar, the sign-in panel, dark mode — the V simply disappears and only
   * the saffron and green survive. A white chip is the usual answer for a
   * single-colour mark and keeps the real artwork rather than inventing a
   * knockout variant of someone else's logo.
   */
  onDark?: boolean;
}) {
  const image = (
    <img
      src="/vorldx-mark.png"
      alt={decorative ? '' : BRAND_NAME}
      aria-hidden={decorative || undefined}
      className={cn('h-9 w-auto select-none object-contain', className)}
      draggable={false}
    />
  );

  if (!onDark) return image;

  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-1.5 py-1 shadow-sm">
      {image}
    </span>
  );
}

/** The full stacked lockup, for panels with room for it. */
export function SaarthiLockup({ className }: { className?: string }) {
  return (
    <img
      src="/vorldx-saarthi.png"
      alt={BRAND_NAME}
      className={cn('h-auto w-40 select-none object-contain', className)}
      draggable={false}
    />
  );
}

/** Mark plus typeset name, for headers and navigation rails. */
export function SaarthiWordmark({
  className,
  onDark = false,
}: {
  className?: string;
  onDark?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <SaarthiLogo className="h-9" decorative onDark={onDark} />
      <div className="leading-tight">
        <p className="text-lg font-semibold tracking-tight">{BRAND_NAME}</p>
        <p className="text-2xs uppercase tracking-widest text-muted-foreground">
          Fleet Operations
        </p>
      </div>
    </div>
  );
}

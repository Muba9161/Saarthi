import { cn } from '@/lib/utils';

/**
 * The hero's instrument frame.
 *
 * Registration marks at the corners, a graduated scale down the right edge,
 * a caption in the top corner and a film grain over the lot. None of it says
 * anything the copy does not — it is all `aria-hidden` — but together it is
 * the difference between "text on a photograph" and "a view through something
 * that was engineered". The photograph becomes a reading on an instrument.
 *
 * Everything here is static. The grain is a tiled SVG noise painted once, not
 * an animated overlay: a moving grain over a canvas that already draws every
 * frame would be paying twice for texture nobody consciously sees.
 */

const CORNER_MARKS = [
  'left-0 top-0 border-l border-t',
  'right-0 top-0 border-r border-t',
  'bottom-0 left-0 border-b border-l',
  'bottom-0 right-0 border-b border-r',
] as const;

/** 1px ticks every 8px, with a longer one every fifth. */
const MINOR_TICKS =
  'repeating-linear-gradient(to bottom, rgba(255,255,255,0.2) 0 1px, transparent 1px 8px)';
const MAJOR_TICKS =
  'repeating-linear-gradient(to bottom, rgba(255,255,255,0.34) 0 1px, transparent 1px 40px)';
const SCALE_FADE = 'linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent)';

export function SceneFrame() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="film-grain absolute inset-0 opacity-60" />

      {/* Held clear of the sticky header at the top. */}
      <div className="absolute inset-x-6 bottom-6 top-[6rem] hidden md:block">
        {CORNER_MARKS.map((position) => (
          <span key={position} className={cn('absolute size-4 border-white/25', position)} />
        ))}

        <p className="absolute right-8 top-0 font-mono text-[10px] uppercase leading-4 tracking-[0.22em] text-white/35">
          Live view · Sample fleet
        </p>
      </div>

      <div
        className="absolute right-6 top-1/2 hidden h-72 w-3 -translate-y-1/2 lg:block"
        style={{ maskImage: SCALE_FADE, WebkitMaskImage: SCALE_FADE }}
      >
        <span
          className="absolute inset-y-0 right-0 w-1.5"
          style={{ backgroundImage: MINOR_TICKS }}
        />
        <span className="absolute inset-y-0 right-0 w-3" style={{ backgroundImage: MAJOR_TICKS }} />
      </div>
    </div>
  );
}

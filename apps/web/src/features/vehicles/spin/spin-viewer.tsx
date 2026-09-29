import * as React from 'react';
import { Rotate3d } from 'lucide-react';
import { useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

/** How long the opening turn takes to show that the picture can be rotated. */
const INTRO_FRAME_MS = 70;

/**
 * A vehicle you can turn with a finger.
 *
 * Frames are stacked and cross-switched by opacity rather than swapped through
 * one `<img src>`: every frame is decoded once, up front, so dragging never
 * waits on the decoder and never flashes an empty frame. One drag across the
 * full width is one turn of the vehicle, whatever the frame count — a spin
 * made from four photos turns in quarter steps, one from a video turns smoothly.
 *
 * It is a slider to assistive technology, and the arrow keys step it, because
 * a drag is not the only way anybody should be able to look at the rear.
 */
export function SpinViewer({
  frames,
  label,
  className,
}: {
  frames: readonly string[];
  /** What is being turned, e.g. "UP32AB1234" — used for the accessible name. */
  label: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const count = frames.length;
  const [index, setIndex] = React.useState(0);
  const [touched, setTouched] = React.useState(false);
  const drag = React.useRef<{ pointerId: number; startX: number; startIndex: number } | null>(null);

  // One slow turn on arrival, stopped the moment anybody takes over.
  React.useEffect(() => {
    if (reduced || touched || count < 2) return undefined;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      setIndex(step % count);
      if (step >= count) window.clearInterval(timer);
    }, INTRO_FRAME_MS);
    return () => window.clearInterval(timer);
  }, [reduced, touched, count]);

  const wrap = (value: number): number => ((value % count) + count) % count;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (count < 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startIndex: index };
    setTouched(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const width = event.currentTarget.clientWidth || 1;
    const offset = Math.round(((event.clientX - active.startX) / width) * count);
    // Dragging right brings the vehicle's right-hand side round towards you.
    setIndex(wrap(active.startIndex - offset));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, number> = {
      ArrowLeft: 1,
      ArrowRight: -1,
      ArrowUp: -1,
      ArrowDown: 1,
    };
    let next: number | null = null;
    if (event.key in moves) next = wrap(index + (moves[event.key] ?? 0));
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    setTouched(true);
    setIndex(next);
  };

  const angle = count > 0 ? Math.round((index / count) * 360) : 0;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`360° view of ${label}`}
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={index + 1}
      aria-valuetext={`${angle}° around the vehicle`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        // pan-y keeps the page scrollable on a phone; only sideways drags turn it.
        'group relative aspect-[4/3] touch-pan-y select-none overflow-hidden rounded-xl border border-border bg-muted',
        'cursor-grab outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {frames.map((src, frameIndex) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className={cn(
            'pointer-events-none absolute inset-0 size-full object-cover',
            frameIndex === index ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}

      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 font-mono text-2xs font-medium tracking-wide text-white backdrop-blur-sm">
        360°
      </span>

      <span
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm',
          'transition-opacity duration-300',
          touched ? 'opacity-0' : 'opacity-100',
        )}
        aria-hidden
      >
        <Rotate3d className="size-3.5" />
        Drag to rotate
      </span>

      {/* Where you are around the vehicle — one tick per frame. */}
      <div
        className="pointer-events-none absolute inset-x-3 bottom-2.5 flex items-end gap-[3px]"
        aria-hidden
      >
        {frames.map((src, frameIndex) => (
          <span
            key={src}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-150',
              frameIndex === index ? 'bg-white' : 'bg-white/35',
            )}
          />
        ))}
      </div>
    </div>
  );
}

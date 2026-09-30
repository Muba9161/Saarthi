import * as React from 'react';
import {
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Rotate3d,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useReducedMotion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { useElementFullscreen } from '@/hooks/use-element-fullscreen';
import { cn } from '@/lib/utils';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, useSpinGestures } from './use-spin-gestures';

/** Resting this long on an angle is what earns it a full-size frame. */
const HI_RES_DELAY_MS = 180;

/** The closest frame to `index` that has arrived, walking both ways round. */
function nearestLoaded(frames: readonly (string | null)[], index: number): number {
  const count = frames.length;
  if (frames[index]) return index;
  for (let step = 1; step <= count / 2; step += 1) {
    const ahead = (index + step) % count;
    const behind = (index - step + count) % count;
    if (frames[ahead]) return ahead;
    if (frames[behind]) return behind;
  }
  return -1;
}

/**
 * A vehicle you can turn, zoom into and take full screen.
 *
 * Frames are stacked and cross-switched by opacity rather than swapped through
 * one `<img src>`, so every frame is decoded once and turning never waits on
 * the decoder. The stack is of small frames; when the turning stops, the
 * full-size frame for that one angle is laid over it (`resolveHiRes`), so the
 * picture sharpens where somebody is actually looking and nowhere else.
 *
 * It can be shown before every frame has arrived: an angle still on its way
 * shows its nearest neighbour, and the tick bar says which are missing.
 *
 * It is a slider to assistive technology and fully usable from the keyboard —
 * arrows turn, + and − zoom, 0 resets, Space plays, F goes full screen.
 */
export function SpinViewer({
  frames,
  resolveHiRes,
  label,
  index: controlledIndex,
  onIndexChange,
  intro = true,
  className,
}: {
  /** Small frames in display order; `null` for one still loading. */
  frames: readonly (string | null)[];
  resolveHiRes?: (index: number) => Promise<string>;
  /** What is being turned, e.g. "UP32AB1234" — used for the accessible name. */
  label: string;
  /** Controlled position, for a caller that shows it elsewhere (a filmstrip). */
  index?: number;
  onIndexChange?: (index: number) => void;
  /** One turn on arrival, to show that the picture can be turned. */
  intro?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const count = frames.length;
  const [ownIndex, setOwnIndex] = React.useState(0);
  const index = Math.min(controlledIndex ?? ownIndex, Math.max(0, count - 1));

  const setIndex = React.useCallback(
    (next: number): void => {
      setOwnIndex(next);
      onIndexChange?.(next);
    },
    [onIndexChange],
  );

  const gestures = useSpinGestures({ count, index, onIndex: setIndex, reduced, intro });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fullscreen = useElementFullscreen(containerRef);

  const [hiRes, setHiRes] = React.useState<{ index: number; src: string } | null>(null);
  // A re-ordered draft puts different pictures behind the same indexes.
  React.useEffect(() => setHiRes(null), [frames]);
  React.useEffect(() => {
    if (!resolveHiRes || gestures.moving || gestures.playing) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      resolveHiRes(index).then(
        (src) => {
          if (!cancelled) setHiRes({ index, src });
        },
        // Nothing to report: the small frame is still showing, and the next
        // stop on this angle asks again.
        () => undefined,
      );
    }, HI_RES_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resolveHiRes, index, gestures.moving, gestures.playing]);

  const shown = nearestLoaded(frames, index);
  const loadedCount = frames.filter(Boolean).length;
  const angle = count > 0 ? Math.round((index / count) * 360) : 0;
  const zoomed = gestures.zoom > MIN_ZOOM;
  const fit = fullscreen.active ? 'object-contain' : 'object-cover';

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      fullscreen.toggle();
      return;
    }
    gestures.handlers.onKeyDown(event);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'group relative select-none overflow-hidden rounded-xl border border-border',
        fullscreen.active ? 'bg-black' : 'aspect-[4/3] bg-muted',
        fullscreen.mode === 'window' && 'fixed inset-0 z-[100] rounded-none border-0',
        className,
      )}
    >
      <div
        ref={gestures.surfaceRef}
        role="slider"
        tabIndex={0}
        aria-label={`360° view of ${label}`}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        aria-valuetext={`${angle}° around the vehicle`}
        aria-keyshortcuts="ArrowLeft ArrowRight + - 0 Space F"
        {...gestures.handlers}
        onKeyDown={onKeyDown}
        // Zoomed in, a drag pans the picture; otherwise the page keeps its
        // vertical scroll and only sideways drags turn the vehicle.
        style={{ touchAction: zoomed ? 'none' : 'pan-y' }}
        className={cn(
          'absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          zoomed ? 'cursor-move' : 'cursor-grab active:cursor-grabbing',
        )}
      >
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translate3d(${gestures.pan.x}px, ${gestures.pan.y}px, 0) scale(${gestures.zoom})`,
            transition: gestures.moving || reduced ? 'none' : 'transform 160ms ease-out',
          }}
        >
          {frames.map((src, frameIndex) =>
            src ? (
              <img
                key={frameIndex}
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                className={cn(
                  'pointer-events-none absolute inset-0 size-full',
                  fit,
                  frameIndex === shown ? 'opacity-100' : 'opacity-0',
                )}
              />
            ) : null,
          )}
          {hiRes && hiRes.index === index && shown === index ? (
            <img
              src={hiRes.src}
              alt=""
              draggable={false}
              className={cn('pointer-events-none absolute inset-0 size-full', fit)}
            />
          ) : null}
        </div>
      </div>

      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 font-mono text-2xs font-medium tracking-wide text-white backdrop-blur-sm">
        360°
      </span>

      {loadedCount < count ? (
        <span
          className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-2xs font-medium text-white backdrop-blur-sm"
          role="status"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {loadedCount}/{count}
        </span>
      ) : null}

      <span
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm',
          'transition-opacity duration-300',
          gestures.touched ? 'opacity-0' : 'opacity-100',
        )}
        aria-hidden
      >
        <Rotate3d className="size-3.5" />
        Drag to rotate
      </span>

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 via-black/25 to-transparent px-2.5 pb-2.5 pt-8">
        <Button
          type="button"
          variant="glass"
          size="icon-sm"
          shape="pill"
          className="size-8 shrink-0"
          onClick={gestures.togglePlay}
          disabled={count < 2}
          aria-label={gestures.playing ? 'Stop turning' : 'Turn on its own'}
          title={gestures.playing ? 'Stop (Space)' : 'Play (Space)'}
        >
          {gestures.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>

        <span className="w-9 shrink-0 text-right font-mono text-2xs font-medium tabular-nums text-white">
          {String(angle).padStart(3, '0')}°
        </span>

        {/* Where you are around the vehicle — one tick per frame, dim until loaded. */}
        <div className="flex min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
          {frames.map((src, frameIndex) => (
            <span
              key={frameIndex}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-150',
                frameIndex === index ? 'bg-white' : src ? 'bg-white/40' : 'bg-white/15',
              )}
            />
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {zoomed ? (
            <>
              <span className="font-mono text-2xs font-medium tabular-nums text-white">
                {gestures.zoom.toFixed(1)}×
              </span>
              <Button
                type="button"
                variant="glass"
                size="icon-sm"
                shape="pill"
                className="size-8"
                onClick={() => gestures.zoomBy(-ZOOM_STEP)}
                aria-label="Zoom out"
                title="Zoom out (−) · 0 resets"
              >
                <ZoomOut className="size-3.5" />
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="glass"
            size="icon-sm"
            shape="pill"
            className="size-8"
            onClick={() => gestures.zoomBy(ZOOM_STEP)}
            disabled={gestures.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            title="Zoom in (+) · pinch or double-tap works too"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="glass"
            size="icon-sm"
            shape="pill"
            className="size-8"
            onClick={fullscreen.toggle}
            aria-label={fullscreen.active ? 'Exit full screen' : 'Full screen'}
            title={fullscreen.active ? 'Exit full screen (F)' : 'Full screen (F)'}
          >
            {fullscreen.active ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

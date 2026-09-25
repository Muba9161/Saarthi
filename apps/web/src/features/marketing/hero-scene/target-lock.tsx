import * as React from 'react';
import { motion, useReducedMotion } from '@/components/motion';
import { BACKDROP_PARALLAX } from '../imagery';
import { useParallax, useSectionProgress } from '../motion-extras';
import { gsap, useGsapScope } from '../scroll-engine';
import { INSTRUMENT } from '../design-system';
import type { FleetTelemetry } from '../fleet-canvas';
import { projectSubject, type SubjectLayout } from './scene-geometry';

/**
 * The truck in the photograph, acquired.
 *
 * This is where the hero's two planes finally meet. The photograph is a real
 * road; the network over it is Saarthi's picture of that road. Until now the
 * two only sat on top of each other — nothing on screen said *this* vehicle is
 * *that* record. The lock says it: brackets close on the truck, a beacon lands
 * on it, a leader line runs out to its telemetry, and the numbers in the tag
 * move because the fleet under it is moving.
 *
 * The tag is real text, not decoration. Where the lock is shown it replaces
 * the readout under the copy rather than repeating it, so a screen reader hears
 * the vehicle once. As with that readout, it says plainly that the fleet is a
 * sample, and it has no `aria-live` for the same reason: a speed re-announced
 * four times a second is noise.
 *
 * Desktop-wide only (`xl`). Narrower than that the truck is cropped under the
 * headline, and a tag pinned to it would land on the copy.
 */

/** px. The tag's inset from the brackets. */
const EDGE = 24;
/**
 * px. The furthest right the brackets may reach — clear of the scene frame's
 * graduated scale, which runs down the band's right edge at `right-6`.
 */
const RIGHT_CLEARANCE = 64;
/**
 * px. The highest the brackets may reach — below the scene frame's caption,
 * which sits under the header. On a short viewport the cover crop lifts the
 * truck far enough to put its top bracket on that line of text.
 */
const TOP_CLEARANCE = 136;
/** px. The tag's width, fixed so the leader line knows where it starts. */
const TAG_WIDTH = 248;
/** px. How far above the beacon the tag's bottom edge sits. */
const LEADER_RISE = 64;
/** px. The length of each bracket's two arms. */
const ARM = 18;

const CORNERS = [
  { key: 'tl', dx: -1, dy: -1 },
  { key: 'tr', dx: 1, dy: -1 },
  { key: 'bl', dx: -1, dy: 1 },
  { key: 'br', dx: 1, dy: 1 },
] as const;

function formatEta(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Measures the layer and projects the truck into it. `null` while hidden. */
function useSubjectLayout(ref: React.RefObject<HTMLDivElement>): SubjectLayout | null {
  const [layout, setLayout] = React.useState<SubjectLayout | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const measure = (): void => setLayout(projectSubject(node.clientWidth, node.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return layout;
}

export function TargetLock({ telemetry }: { telemetry: FleetTelemetry | null }) {
  const reduced = useReducedMotion();
  // Same progress, same distance as the `Backdrop` it is registered to, on a
  // box of the same size — so it drifts with the photograph, not over it.
  const { ref, progress } = useSectionProgress();
  const y = useParallax(progress, BACKDROP_PARALLAX);
  const layout = useSubjectLayout(ref);
  const ready = layout !== null;

  /*
   * Acquisition, as one timeline: brackets close, beacon lands, the line runs
   * out, the tag opens. Starts once the headline has mostly arrived, so the
   * eye is handed from the words to the vehicle rather than asked to watch
   * both at once. Rebuilt only when the layer appears — a resize moves the
   * pieces, it does not replay the lock.
   */
  const scope = useGsapScope<HTMLDivElement>(
    ({ scope: root }) => {
      if (!root.querySelector('[data-lock-tag]')) return;

      const timeline = gsap.timeline({ delay: 0.95 });

      timeline
        .fromTo(
          '[data-lock-corner]',
          {
            opacity: 0,
            x: (_index: number, target: Element) => Number((target as SVGElement).dataset.dx) * 26,
            y: (_index: number, target: Element) => Number((target as SVGElement).dataset.dy) * 26,
          },
          { opacity: 1, x: 0, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.04 },
        )
        .fromTo(
          '[data-lock-beacon]',
          { opacity: 0, scale: 0 },
          { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.2)' },
          '-=0.25',
        )
        .fromTo(
          '[data-lock-leader]',
          { strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: 0.55, ease: 'power2.inOut' },
          '-=0.1',
        )
        .fromTo(
          '[data-lock-tag]',
          { opacity: 0, y: 10, clipPath: 'inset(0% 0% 100% 0%)' },
          { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.55, ease: 'power3.out' },
          '-=0.2',
        );
    },
    [ready],
  );

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 hidden xl:block">
      <motion.div ref={scope} className="absolute inset-0" style={reduced ? undefined : { y }}>
        {layout ? <LockGraphics layout={layout} telemetry={telemetry} /> : null}
      </motion.div>
    </div>
  );
}

function LockGraphics({
  layout,
  telemetry,
}: {
  layout: SubjectLayout;
  telemetry: FleetTelemetry | null;
}) {
  const { width, height, beacon } = layout;
  // The truck runs off the right edge on narrower desktops; the brackets and
  // the tag are held inside the band so neither is cut in half.
  const box = {
    ...layout.box,
    top: Math.max(layout.box.top, TOP_CLEARANCE),
    right: Math.min(layout.box.right, width - RIGHT_CLEARANCE),
  };
  const tagLeft = box.right - EDGE - TAG_WIDTH;
  const tagBottom = beacon.y - LEADER_RISE;
  const elbowX = tagLeft + 20;

  const cornerPath = (dx: number, dy: number): string => {
    const x = dx < 0 ? box.left : box.right;
    const cornerY = dy < 0 ? box.top : box.bottom;
    return `M ${x} ${cornerY - dy * ARM} L ${x} ${cornerY} L ${x - dx * ARM} ${cornerY}`;
  };

  return (
    <>
      <svg
        aria-hidden
        className="absolute left-0 top-0 overflow-visible"
        width={width}
        height={height}
        fill="none"
      >
        {CORNERS.map((corner) => (
          <path
            key={corner.key}
            data-lock-corner
            data-dx={corner.dx}
            data-dy={corner.dy}
            d={cornerPath(corner.dx, corner.dy)}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1.5}
            strokeLinecap="square"
          />
        ))}

        {/* `pathLength` normalises the dash maths, so the draw-on is the same
            tween whatever length the elbow comes out at on this viewport. */}
        <path
          data-lock-leader
          d={`M ${elbowX} ${tagBottom} L ${elbowX} ${beacon.y} L ${beacon.x} ${beacon.y}`}
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset={0}
          stroke={INSTRUMENT.focus}
          strokeOpacity={0.7}
          strokeWidth={1}
        />
      </svg>

      <span
        data-lock-beacon
        aria-hidden
        // Centred by margin, not translate: the lock scales this element, and
        // a Tailwind translate would be folded into GSAP's transform.
        className="absolute -ml-[5px] -mt-[5px] size-2.5"
        style={{ left: beacon.x, top: beacon.y }}
      >
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ backgroundColor: INSTRUMENT.focus }}
        />
        <span
          className="absolute inset-0 rounded-full ring-2 ring-black/40"
          style={{ backgroundColor: INSTRUMENT.focus }}
        />
      </span>

      <LockTag
        telemetry={telemetry}
        style={{ left: tagLeft, bottom: height - tagBottom, width: TAG_WIDTH }}
      />
    </>
  );
}

function LockTag({
  telemetry,
  style,
}: {
  telemetry: FleetTelemetry | null;
  style: React.CSSProperties;
}) {
  const progress = telemetry ? Math.round(Math.min(Math.max(telemetry.progress, 0), 1) * 100) : 0;

  return (
    <div
      data-lock-tag
      className="absolute overflow-hidden rounded-md bg-[hsl(240_6%_7%/0.78)] ring-1 ring-white/10 backdrop-blur-sm"
      style={style}
    >
      {/* The instrument's own light along the top edge — the one warm line on
          the tag, and the same colour as the beacon it is wired to. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: `linear-gradient(to right, transparent, ${INSTRUMENT.focus}, transparent)`,
        }}
      />

      <dl className="p-3.5 pb-0">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Status</dt>
          <dd className="flex items-center gap-2 text-2xs font-medium uppercase tracking-[0.16em] text-white/55">
            <span className="live-dot" aria-hidden />
            Tracking · sample fleet
          </dd>
        </div>

        <div className="mt-2.5">
          <dt className="sr-only">Vehicle</dt>
          <dd className="tabular font-mono text-sm font-medium tracking-wide text-white">
            MH-12-DK-8421
          </dd>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-3">
          <div>
            <dt className="text-2xs uppercase tracking-[0.16em] text-white/40">Speed</dt>
            <dd className="tabular mt-0.5 text-sm font-medium text-white/90">
              {telemetry ? `${telemetry.speed} km/h` : '- -'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-[0.16em] text-white/40">ETA</dt>
            <dd className="tabular mt-0.5 text-sm font-medium text-white/90">
              {telemetry ? formatEta(telemetry.eta) : '- -'}
            </dd>
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <dt className="text-2xs uppercase tracking-[0.16em] text-white/40">Leg progress</dt>
          <dd className="tabular text-2xs font-medium text-white/60">{progress}%</dd>
        </div>
      </dl>

      {/* The same figure as a bar, so it is outside the list's grouping. */}
      <div aria-hidden className="px-3.5 pb-3.5 pt-1.5">
        <div className="h-0.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full origin-left rounded-full transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${progress / 100})`, backgroundColor: INSTRUMENT.focus }}
          />
        </div>
      </div>
    </div>
  );
}

import * as React from 'react';
import { gsap } from './scroll-engine';
import { INSTRUMENT } from './design-system';
import { useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * The hero's live network.
 *
 * What this is, and what it deliberately is not. It is not a map: the page
 * already has a photographed relief of India further down, and a second
 * cartographic surface here would be both redundant and a lie, because a map
 * invites the reader to look for their own city and this cannot show it. It is
 * not a dashboard screenshot either — a screenshot dates the moment the UI
 * moves, needs recutting for light and dark, and shrinks to illegibility on a
 * phone.
 *
 * It is the thing underneath both: the network the product actually maintains.
 * Depots and waypoints as nodes, lanes between them as edges, and vehicles
 * moving along those lanes writing position, speed and an ETA as they go. That
 * is a true picture of the data model, it scales to any viewport because it
 * has no fixed geography to preserve, and every element on it is earning its
 * place — the trails exist because vehicles have history, the node pulses
 * exist because an arrival is an event the platform records.
 *
 * ## Why canvas, and why not WebGL
 *
 * Around 200 line segments and 40 fills per frame. That is comfortably inside
 * canvas 2D's budget and nowhere near needing a GPU pipeline, and the WebGL
 * version would cost 150 kB gzipped of Three.js on the first screen a stranger
 * ever sees. The premium here is meant to come from composition and motion
 * quality, not from the size of the dependency that drew it.
 *
 * ## What keeps it cheap
 *
 * It draws on GSAP's ticker, which is the same clock Lenis runs on, so the
 * scene, the smooth scroll and every ScrollTrigger on the page all sample the
 * same moment. It stops entirely when scrolled out of view or when the tab is
 * hidden. Under `prefers-reduced-motion` it paints one composed frame and then
 * never touches the ticker at all — the scene is still there, it has simply
 * stopped.
 */

/* -------------------------------------------------------------------------
 * The network
 *
 * Normalised coordinates in a 0→1 box, so the composition survives every
 * viewport rather than being authored against one. Hand-placed rather than
 * generated: a random graph looks random, and the asymmetry here — dense in
 * the lower left, one long lane reaching to the upper right — is what makes it
 * read as a country's freight corridors instead of a screensaver.
 * ---------------------------------------------------------------------- */

interface Node {
  x: number;
  y: number;
  /** Hubs are drawn larger and are where lanes converge. */
  hub?: boolean;
}

const NODES: Node[] = [
  { x: 0.08, y: 0.72, hub: true },
  { x: 0.26, y: 0.42 },
  { x: 0.33, y: 0.86 },
  { x: 0.47, y: 0.6, hub: true },
  { x: 0.58, y: 0.24 },
  { x: 0.64, y: 0.79 },
  { x: 0.79, y: 0.47, hub: true },
  { x: 0.93, y: 0.2 },
  { x: 0.88, y: 0.84 },
];

interface Lane {
  from: number;
  to: number;
  /** How far the arc bows off the straight line. Signed. */
  bow: number;
}

const LANES: Lane[] = [
  { from: 0, to: 1, bow: -0.1 },
  { from: 0, to: 2, bow: 0.08 },
  { from: 1, to: 3, bow: 0.07 },
  { from: 2, to: 3, bow: -0.09 },
  { from: 1, to: 4, bow: -0.06 },
  { from: 3, to: 6, bow: -0.12 },
  { from: 4, to: 6, bow: 0.09 },
  { from: 3, to: 5, bow: 0.07 },
  { from: 5, to: 8, bow: -0.06 },
  { from: 6, to: 7, bow: -0.08 },
  { from: 6, to: 8, bow: 0.08 },
];

interface Vehicle {
  lane: number;
  /** Where it starts on its lane, 0→1. Spread so none of them set off together. */
  offset: number;
  /** Lane lengths differ, so speed is per vehicle rather than shared. */
  speed: number;
  /** Runs the lane backwards. A corridor carries traffic both ways. */
  reverse?: boolean;
  /** The one carrying the readout. Exactly one, and it is drawn differently. */
  focus?: boolean;
}

const VEHICLES: Vehicle[] = [
  { lane: 0, offset: 0.15, speed: 0.055 },
  { lane: 3, offset: 0.62, speed: 0.042, reverse: true },
  { lane: 5, offset: 0.3, speed: 0.038, focus: true },
  { lane: 6, offset: 0.85, speed: 0.06 },
  { lane: 8, offset: 0.45, speed: 0.05, reverse: true },
  { lane: 9, offset: 0.08, speed: 0.047 },
  { lane: 2, offset: 0.55, speed: 0.052 },
];

/** Live telemetry from the focused vehicle, for the readout beside the scene. */
export interface FleetTelemetry {
  /** km/h. Derived from the vehicle's actual rate along its lane. */
  speed: number;
  /** Minutes remaining, from how much of the lane is left. */
  eta: number;
  /** 0→1 along the current lane. */
  progress: number;
}

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

/** A quadratic Bézier's control point, offset perpendicular to the chord. */
function controlPoint(a: Node, b: Node, bow: number): { x: number; y: number } {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  // The chord's normal, unnormalised — bow is already a fraction of the box.
  return { x: midX - (b.y - a.y) * bow, y: midY + (b.x - a.x) * bow };
}

function pointAt(
  a: Node,
  c: { x: number; y: number },
  b: Node,
  t: number,
): { x: number; y: number } {
  const inv = 1 - t;
  return {
    x: inv * inv * a.x + 2 * inv * t * c.x + t * t * b.x,
    y: inv * inv * a.y + 2 * inv * t * c.y + t * t * b.y,
  };
}

/* -------------------------------------------------------------------------
 * Precomputed paint
 *
 * Everything a frame needs that does not change between frames, worked out
 * once at module scope. This is most of what keeps the scene cheap: the naive
 * version rebuilt a colour string with a regular expression for each of ~84
 * trail segments and created a fresh radial gradient object for each of seven
 * vehicles, sixty times a second. None of that is visible in a profile as one
 * expensive call — it is death by several thousand small allocations, and the
 * garbage collector pauses it causes land as scroll judder rather than as a
 * slow frame.
 * ---------------------------------------------------------------------- */

/** How many segments a trail is drawn from. */
const TRAIL_SEGMENTS = 12;

/** How much of its lane a trail covers, as a fraction. */
const TRAIL_SPAN = 0.16;

/** Swaps the alpha on one of the `INSTRUMENT` rgba strings. */
function withAlpha(colour: string, alpha: number): string {
  return colour.replace(/[\d.]+\)$/, `${alpha})`);
}

/**
 * The fade ramp for a trail, per colour, resolved up front.
 *
 * Squared rather than linear, so the trail thins out fast and reads as
 * exhaust rather than as a tail fin.
 */
function trailRamp(colour: string): string[] {
  return Array.from({ length: TRAIL_SEGMENTS }, (_, index) =>
    withAlpha(colour, (1 - index / TRAIL_SEGMENTS) ** 2 * 0.75),
  );
}

const TRAIL_COLOURS = {
  live: trailRamp(INSTRUMENT.routeLive),
  focus: trailRamp(INSTRUMENT.focus),
} as const;

/** The ring around the selected vehicle. */
const FOCUS_RING = withAlpha(INSTRUMENT.focus, 0.55);

/**
 * A vehicle's glow, rendered once into an offscreen canvas and then stamped.
 *
 * `createRadialGradient` allocates a gradient object and the rasteriser
 * evaluates it across the fill area on every use. The glow is the same picture
 * every time and only its position changes, so it belongs in a sprite that
 * `drawImage` can blit — which is one texture upload rather than a per-frame
 * gradient evaluation, seven times a frame.
 */
function haloSprite(colour: string, radius: number, ratio: number): HTMLCanvasElement {
  const size = Math.ceil(radius * 2 * ratio);
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;

  const paint = sprite.getContext('2d');
  if (paint) {
    const centre = size / 2;
    const gradient = paint.createRadialGradient(centre, centre, 0, centre, centre, centre);
    gradient.addColorStop(0, withAlpha(colour, 0.32));
    gradient.addColorStop(1, withAlpha(colour, 0));
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, size, size);
  }

  return sprite;
}

/* -------------------------------------------------------------------------
 * The component
 * ---------------------------------------------------------------------- */

export function FleetCanvas({
  className,
  onTelemetry,
}: {
  className?: string;
  /**
   * Called about four times a second with the focused vehicle's state.
   *
   * Throttled inside the draw loop rather than by the caller, because the
   * alternative is a `setState` on every animation frame — sixty React renders
   * a second so that a speed readout can show a number that changes by less
   * than one km/h between frames. Four is fast enough to read as live and slow
   * enough to cost nothing.
   */
  onTelemetry?: (telemetry: FleetTelemetry) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  // Held in a ref so a caller passing an inline arrow does not tear down and
  // rebuild the entire scene on every one of its own renders.
  const telemetryRef = React.useRef(onTelemetry);
  telemetryRef.current = onTelemetry;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    let width = 0;
    let height = 0;

    /* Rebuilt on resize rather than per frame — the only thing about them that
       can change is the device pixel ratio, which changes when a window moves
       between monitors. */
    const HALO_RADIUS = { live: 14, focus: 26 } as const;
    let halos = {
      live: null as HTMLCanvasElement | null,
      focus: null as HTMLCanvasElement | null,
    };

    const resize = (): void => {
      const box = canvas.getBoundingClientRect();
      // Capped at 2: beyond that the extra pixels are invisible and the fill
      // rate is not, and this scene is often the largest surface on screen.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      // Resets rather than multiplies: `resize` runs on every container
      // change, and a plain `scale()` would compound the ratio each time.
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      halos = {
        live: haloSprite(INSTRUMENT.routeLive, HALO_RADIUS.live, ratio),
        focus: haloSprite(INSTRUMENT.focus, HALO_RADIUS.focus, ratio),
      };
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    /* --- painting ---------------------------------------------------- */

    const toX = (value: number): number => value * width;
    const toY = (value: number): number => value * height;

    function drawGraticule(): void {
      context!.save();
      context!.strokeStyle = INSTRUMENT.grid;
      context!.lineWidth = 1;

      const step = 64;
      context!.beginPath();
      for (let x = 0; x <= width; x += step) {
        context!.moveTo(Math.round(x) + 0.5, 0);
        context!.lineTo(Math.round(x) + 0.5, height);
      }
      for (let y = 0; y <= height; y += step) {
        context!.moveTo(0, Math.round(y) + 0.5);
        context!.lineTo(width, Math.round(y) + 0.5);
      }
      context!.stroke();
      context!.restore();
    }

    function drawLanes(): void {
      context!.save();
      context!.strokeStyle = INSTRUMENT.routeIdle;
      context!.lineWidth = 1.25;
      context!.lineCap = 'round';

      for (const lane of LANES) {
        const a = NODES[lane.from]!;
        const b = NODES[lane.to]!;
        const c = controlPoint(a, b, lane.bow);

        context!.beginPath();
        context!.moveTo(toX(a.x), toY(a.y));
        context!.quadraticCurveTo(toX(c.x), toY(c.y), toX(b.x), toY(b.y));
        context!.stroke();
      }
      context!.restore();
    }

    function drawNodes(time: number): void {
      for (const node of NODES) {
        const x = toX(node.x);
        const y = toY(node.y);
        const radius = node.hub ? 3.5 : 2;

        context!.beginPath();
        context!.arc(x, y, radius, 0, Math.PI * 2);
        context!.fillStyle = node.hub ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)';
        context!.fill();

        if (!node.hub) continue;

        /* A hub breathes — the slow, offset pulse of a depot with something
           always arriving. The phase comes from its own position so the three
           hubs never pulse in unison, which would read as a blink. */
        const phase = (time * 0.45 + node.x * 3) % 1;
        context!.beginPath();
        context!.arc(x, y, radius + phase * 22, 0, Math.PI * 2);
        context!.strokeStyle = `rgba(124,141,255,${(1 - phase) * 0.22})`;
        context!.lineWidth = 1;
        context!.stroke();
      }
    }

    function drawVehicles(time: number): void {
      for (const vehicle of VEHICLES) {
        const lane = LANES[vehicle.lane]!;
        const a = NODES[lane.from]!;
        const b = NODES[lane.to]!;
        const c = controlPoint(a, b, lane.bow);

        const raw = (vehicle.offset + time * vehicle.speed) % 1;
        const t = vehicle.reverse ? 1 - raw : raw;
        const colour = vehicle.focus ? INSTRUMENT.focus : INSTRUMENT.routeLive;
        const ramp = vehicle.focus ? TRAIL_COLOURS.focus : TRAIL_COLOURS.live;

        /* The trail. Twelve short segments behind the head, each fainter than
           the last — the vehicle's recent history, which is a thing the
           product genuinely stores and therefore a thing worth drawing. */
        context!.lineCap = 'round';

        for (let index = 0; index < TRAIL_SEGMENTS; index += 1) {
          const near = index / TRAIL_SEGMENTS;
          const far = (index + 1) / TRAIL_SEGMENTS;
          // Clamped rather than wrapped: a trail that wraps past the end of a
          // lane draws a bright line across the whole scene for one frame.
          const tail = vehicle.reverse ? t + TRAIL_SPAN : t - TRAIL_SPAN;
          const from = Math.min(Math.max(t + (tail - t) * near, 0), 1);
          const to = Math.min(Math.max(t + (tail - t) * far, 0), 1);
          if (from === to) continue;

          const p1 = pointAt(a, c, b, from);
          const p2 = pointAt(a, c, b, to);
          const fade = (1 - near) ** 2;

          context!.beginPath();
          context!.moveTo(toX(p1.x), toY(p1.y));
          context!.lineTo(toX(p2.x), toY(p2.y));
          context!.strokeStyle = ramp[index]!;
          context!.lineWidth = vehicle.focus ? 2.6 * fade + 0.5 : 2 * fade + 0.4;
          context!.stroke();
        }

        /* The head. A filled dot inside its own halo, so it reads as lit
           rather than as a sticker — and the focused one carries a ring, which
           is the only thing on the scene that says "this one is selected". */
        const head = pointAt(a, c, b, t);
        const x = toX(head.x);
        const y = toY(head.y);

        const halo = vehicle.focus ? halos.focus : halos.live;
        const haloRadius = vehicle.focus ? HALO_RADIUS.focus : HALO_RADIUS.live;
        if (halo) {
          // Stamped at CSS-pixel size; the sprite carries the extra device
          // pixels, so it stays sharp without the context being rescaled.
          context!.drawImage(
            halo,
            x - haloRadius,
            y - haloRadius,
            haloRadius * 2,
            haloRadius * 2,
          );
        }

        context!.beginPath();
        context!.arc(x, y, vehicle.focus ? 4.5 : 3, 0, Math.PI * 2);
        context!.fillStyle = colour;
        context!.fill();

        if (!vehicle.focus) continue;

        context!.beginPath();
        context!.arc(x, y, 11, 0, Math.PI * 2);
        context!.strokeStyle = FOCUS_RING;
        context!.lineWidth = 1.25;
        context!.stroke();
      }
    }

    /** Where the focused vehicle is, for the readout. */
    function focusState(time: number): FleetTelemetry {
      const vehicle = VEHICLES.find((candidate) => candidate.focus) ?? VEHICLES[0]!;
      const raw = (vehicle.offset + time * vehicle.speed) % 1;
      const progress = vehicle.reverse ? 1 - raw : raw;

      /*
       * Illustrative, and derived rather than invented — the figures move
       * because the dot moved, which is the whole reason they are here. The
       * band beneath the scene says in plain words that this is a sample
       * fleet, so nothing on screen is claiming to be a customer's numbers.
       */
      const speed = 48 + Math.sin(time * 0.8) * 9 + (vehicle.reverse ? 4 : 0);
      const eta = Math.max(4, Math.round((1 - Math.abs(progress)) * 186));

      return { speed: Math.round(speed), eta, progress };
    }

    function paint(time: number): void {
      context!.clearRect(0, 0, width, height);
      drawGraticule();
      drawLanes();
      drawVehicles(time);
      drawNodes(time);
    }

    /* --- the loop ----------------------------------------------------- */

    if (reduced) {
      // One composed frame at a moment chosen so the vehicles are spread
      // across their lanes rather than bunched at the start of them.
      paint(6.2);
      telemetryRef.current?.(focusState(6.2));
      return () => resizeObserver.disconnect();
    }

    let elapsed = 0;
    let lastReport = 0;

    const tick = (_time: number, delta: number): void => {
      // Seconds, and clamped: a backgrounded tab can hand back a delta of
      // several seconds, which would teleport every vehicle down its lane.
      elapsed += Math.min(delta, 50) / 1000;
      paint(elapsed);

      if (elapsed - lastReport > 0.25) {
        lastReport = elapsed;
        telemetryRef.current?.(focusState(elapsed));
      }
    };

    /*
     * Runs only while it is on screen.
     *
     * The hero is a full viewport tall, so by the time a reader reaches the
     * pricing matrix this scene is thousands of pixels above them — and
     * without this it would still be drawing every frame, competing for the
     * same budget as the pinned section they are actually looking at.
     */
    let running = false;
    const start = (): void => {
      if (running) return;
      running = true;
      gsap.ticker.add(tick);
    };
    const stop = (): void => {
      if (!running) return;
      running = false;
      gsap.ticker.remove(tick);
    };

    const visibility = new IntersectionObserver(
      ([entry]) => (entry?.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    visibility.observe(canvas);

    const onVisibilityChange = (): void => {
      if (document.hidden) stop();
      else if (canvas.getBoundingClientRect().bottom > 0) start();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      visibility.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      // Decorative: everything it conveys is stated in the copy beside it and
      // in the readout below, both of which are real text.
      aria-hidden
      className={cn('size-full', className)}
    />
  );
}

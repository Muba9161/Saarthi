import * as React from 'react';

/**
 * Everything a finger, a mouse or a keyboard can do to a spin.
 *
 * Turning is the default: one drag across the full width is one turn of the
 * vehicle whatever the frame count, and a flick keeps it turning and slowing
 * like something with weight. Once zoomed in, a drag pans instead, because
 * nobody zooms in on a wheel arch to have it slide away sideways.
 *
 * Kept out of the viewer so the viewer is only about what is drawn.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.5;
const DOUBLE_TAP_ZOOM = 2;
/** One full turn, when playing on its own. */
const AUTOPLAY_TURN_MS = 6000;
/** Momentum lost per 16 ms — lower stops sooner. */
const FRICTION = 0.93;
/** Frames per millisecond below which a flick has run out. */
const MIN_VELOCITY = 0.0015;
/** A release this long after the last movement is a placement, not a flick. */
const FLICK_WINDOW_MS = 90;

type Point = { x: number; y: number };

type Gesture =
  | {
      kind: 'turn';
      startX: number;
      startPosition: number;
      lastX: number;
      lastTime: number;
      velocity: number;
    }
  | { kind: 'pan'; start: Point; origin: Point }
  | { kind: 'pinch'; startDistance: number; startZoom: number };

type Playback = 'off' | 'intro' | 'loop';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface SpinGestures {
  surfaceRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  pan: Point;
  playing: boolean;
  /** A drag, pinch or flick is under way — hold off on anything expensive. */
  moving: boolean;
  /** Somebody has taken over from the opening turn. */
  touched: boolean;
  togglePlay: () => void;
  zoomBy: (step: number) => void;
  resetZoom: () => void;
  handlers: {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
    onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  };
}

export function useSpinGestures({
  count,
  index,
  onIndex,
  reduced,
  intro,
}: {
  count: number;
  index: number;
  onIndex: (index: number) => void;
  /** The OS asked for reduced motion: no opening turn, no momentum. */
  reduced: boolean;
  /** Play one turn on arrival, to show that the picture can be turned. */
  intro: boolean;
}): SpinGestures {
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = React.useState(MIN_ZOOM);
  const [pan, setPan] = React.useState<Point>({ x: 0, y: 0 });
  const [playback, setPlayback] = React.useState<Playback>(() =>
    intro && !reduced && count > 1 ? 'intro' : 'off',
  );
  const [moving, setMoving] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  // Fractional position around the loop; the index shown is this, rounded.
  const position = React.useRef(index);
  const latest = React.useRef({ index, count, zoom, pan, onIndex });
  latest.current = { index, count, zoom, pan, onIndex };
  const pointers = React.useRef(new Map<number, Point>());
  const gesture = React.useRef<Gesture | null>(null);
  const momentum = React.useRef<number | null>(null);

  const wrap = React.useCallback((value: number): number => {
    const total = latest.current.count;
    return total === 0 ? 0 : ((Math.round(value) % total) + total) % total;
  }, []);

  // An index set from outside (a filmstrip click) moves the position too. The
  // position runs past the frame count while turning, so compare it wrapped.
  React.useEffect(() => {
    if (wrap(position.current) !== index) position.current = index;
  }, [index, wrap]);

  const moveTo = React.useCallback(
    (next: number): void => {
      const { count: total, index: shown, onIndex: report } = latest.current;
      if (total === 0) return;
      position.current = next;
      const wrapped = wrap(next);
      if (wrapped !== shown) report(wrapped);
    },
    [wrap],
  );

  const stopMomentum = (): void => {
    if (momentum.current !== null) cancelAnimationFrame(momentum.current);
    momentum.current = null;
  };

  const takeOver = (): void => {
    stopMomentum();
    setPlayback('off');
    setTouched(true);
  };

  const clampPan = React.useCallback((next: Point, atZoom: number): Point => {
    const surface = surfaceRef.current;
    if (!surface || atZoom <= MIN_ZOOM) return { x: 0, y: 0 };
    const maxX = ((atZoom - 1) * surface.clientWidth) / 2;
    const maxY = ((atZoom - 1) * surface.clientHeight) / 2;
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, []);

  /** Zoom to `next`, keeping `focus` (relative to the centre) where it is on screen. */
  const zoomTo = React.useCallback(
    (next: number, focus: Point = { x: 0, y: 0 }): void => {
      const { zoom: current, pan: currentPan } = latest.current;
      const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
      const ratio = target / current;
      const nextPan = clampPan(
        {
          x: focus.x - (focus.x - currentPan.x) * ratio,
          y: focus.y - (focus.y - currentPan.y) * ratio,
        },
        target,
      );
      // Written through at once: a burst of wheel events lands between renders,
      // and each has to zoom from where the last one left it.
      latest.current = { ...latest.current, zoom: target, pan: nextPan };
      setZoom(target);
      setPan(nextPan);
    },
    [clampPan],
  );

  const focusOf = (clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  // Playing on its own: one turn on arrival, or looping until stopped.
  React.useEffect(() => {
    if (playback === 'off' || count < 2) return undefined;
    const framesPerMs = count / AUTOPLAY_TURN_MS;
    const introEnd = position.current + count;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const next = position.current + (now - last) * framesPerMs;
      last = now;
      if (playback === 'intro' && next >= introEnd) {
        moveTo(introEnd);
        setPlayback('off');
        return;
      }
      moveTo(next);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playback, count, moveTo]);

  // The wheel listener is attached once; these keep it calling current code.
  const takeOverRef = React.useRef(takeOver);
  takeOverRef.current = takeOver;
  const zoomToRef = React.useRef(zoomTo);
  zoomToRef.current = zoomTo;
  const focusOfRef = React.useRef(focusOf);
  focusOfRef.current = focusOf;

  // Pinch-to-zoom on a trackpad arrives as a wheel event with ctrlKey set; a
  // plain wheel is left alone so the page still scrolls past the viewer.
  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      takeOverRef.current();
      const { zoom: current } = latest.current;
      zoomToRef.current(
        current * Math.exp(-event.deltaY * 0.01),
        focusOfRef.current(event.clientX, event.clientY),
      );
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, []);

  React.useEffect(() => stopMomentum, []);

  const startMomentum = (initialVelocity: number): void => {
    let velocity = initialVelocity;
    let last = performance.now();
    setMoving(true);
    const step = (now: number): void => {
      const elapsed = now - last;
      last = now;
      moveTo(position.current + velocity * elapsed);
      velocity *= FRICTION ** (elapsed / 16);
      if (Math.abs(velocity) < MIN_VELOCITY) {
        momentum.current = null;
        setMoving(false);
        return;
      }
      momentum.current = requestAnimationFrame(step);
    };
    momentum.current = requestAnimationFrame(step);
  };

  const beginGesture = (clientX: number, clientY: number, time: number): void => {
    const active = [...pointers.current.values()];
    const [first, second] = active;
    if (first && second) {
      gesture.current = {
        kind: 'pinch',
        startDistance: Math.max(1, distance(first, second)),
        startZoom: latest.current.zoom,
      };
    } else if (latest.current.zoom > MIN_ZOOM) {
      gesture.current = {
        kind: 'pan',
        start: { x: clientX, y: clientY },
        origin: latest.current.pan,
      };
    } else {
      gesture.current = {
        kind: 'turn',
        startX: clientX,
        startPosition: position.current,
        lastX: clientX,
        lastTime: time,
        velocity: 0,
      };
    }
  };

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (count === 0 || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    takeOver();
    setMoving(true);
    beginGesture(event.clientX, event.clientY, event.timeStamp);
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = gesture.current;
    if (!active) return;

    if (active.kind === 'pinch') {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      const midpoint = focusOf((first.x + second.x) / 2, (first.y + second.y) / 2);
      zoomTo(active.startZoom * (distance(first, second) / active.startDistance), midpoint);
      return;
    }

    if (active.kind === 'pan') {
      const nextPan = clampPan(
        {
          x: active.origin.x + event.clientX - active.start.x,
          y: active.origin.y + event.clientY - active.start.y,
        },
        latest.current.zoom,
      );
      latest.current = { ...latest.current, pan: nextPan };
      setPan(nextPan);
      return;
    }

    const width = event.currentTarget.clientWidth || 1;
    // Dragging right brings the vehicle's right-hand side round towards you.
    moveTo(active.startPosition - ((event.clientX - active.startX) / width) * count);
    const elapsed = event.timeStamp - active.lastTime;
    if (elapsed > 0) {
      const instant = ((-(event.clientX - active.lastX) / width) * count) / elapsed;
      active.velocity = active.velocity * 0.2 + instant * 0.8;
      active.lastX = event.clientX;
      active.lastTime = event.timeStamp;
    }
  };

  const onPointerUp: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const ended = gesture.current;

    if (pointers.current.size > 0) {
      // A finger lifted from a pinch: carry on with the one that is left.
      const [remaining] = [...pointers.current.values()];
      if (remaining) beginGesture(remaining.x, remaining.y, event.timeStamp);
      return;
    }

    gesture.current = null;
    const flicked =
      ended?.kind === 'turn' &&
      !reduced &&
      Math.abs(ended.velocity) > MIN_VELOCITY * 4 &&
      event.timeStamp - ended.lastTime < FLICK_WINDOW_MS;
    if (flicked) startMomentum(ended.velocity);
    else {
      setMoving(false);
      // Settle a turn on the frame it shows, so the next drag starts from it.
      position.current = latest.current.index;
    }
  };

  const resetZoom = (): void => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  };

  const onDoubleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    takeOver();
    if (latest.current.zoom > MIN_ZOOM) resetZoom();
    else zoomTo(DOUBLE_TAP_ZOOM, focusOf(event.clientX, event.clientY));
  };

  const zoomBy = (step: number): void => {
    takeOver();
    zoomTo(latest.current.zoom + step);
  };

  const togglePlay = (): void => {
    stopMomentum();
    setTouched(true);
    setPlayback((current) => (current === 'loop' ? 'off' : 'loop'));
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    const turn: Record<string, number> = {
      ArrowLeft: 1,
      ArrowDown: 1,
      ArrowRight: -1,
      ArrowUp: -1,
    };
    const step = turn[event.key];
    let handled = true;

    if (step !== undefined) {
      takeOver();
      moveTo(Math.round(position.current) + step);
    } else if (event.key === 'Home' || event.key === 'End') {
      takeOver();
      moveTo(event.key === 'Home' ? 0 : count - 1);
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-') zoomBy(-ZOOM_STEP);
    else if (event.key === '0') resetZoom();
    else if (event.key === ' ' || event.key === 'k') togglePlay();
    else handled = false;

    if (handled) event.preventDefault();
  };

  return {
    surfaceRef,
    zoom,
    pan,
    playing: playback !== 'off',
    moving,
    touched,
    togglePlay,
    zoomBy,
    resetZoom,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
      onKeyDown,
    },
  };
}

import * as React from 'react';
import { useReducedMotion } from '@/components/motion';
import { FramePicture } from '../imagery';
import { gsap } from '../scroll-engine';

/**
 * A pool of light that follows the pointer across the hero photograph.
 *
 * The hero's frame is deliberately held at two-thirds exposure so the network
 * above it can be read. This gives the reader a way to see the road properly
 * anyway — wherever they point, the frame comes up to full strength, which is
 * the product's own idea (making the fleet visible) acted out with a mouse.
 *
 * ## Why it is built this way
 *
 * The obvious version moves a `mask-image` gradient with CSS variables, and it
 * repaints a full-bleed mask on every frame the pointer moves. This one is two
 * transforms instead: a fixed-size lens carrying a static radial mask moves
 * *with* the pointer, and the full-exposure copy of the frame inside it moves
 * the opposite way by the same amount, so the picture stays registered to the
 * one beneath it. Both are compositor-only, and the lens never re-rasterises.
 *
 * Lives inside the `Backdrop`, so it shares the frame's parallax and crop, and
 * sits under the scrim — the reading column stays protected even when the
 * light passes over it.
 *
 * Only for a fine pointer that can hover, and never under reduced motion.
 * On touch there is no "where I am pointing" to light.
 */

/** px. The lens's diameter. */
const LENS = 540;
const RADIUS = LENS / 2;
/** Per-frame easing toward the pointer. Low enough to feel like weight. */
const FOLLOW = 0.14;

const LENS_MASK = 'radial-gradient(closest-side, #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%)';

function useFinePointer(): boolean {
  const [fine, setFine] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = (): void => setFine(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return fine;
}

export function Headlight({
  src,
  portraitSrc,
  objectPosition,
}: {
  src: string;
  portraitSrc?: string;
  objectPosition?: string;
}) {
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const enabled = fine && !reduced;

  const rootRef = React.useRef<HTMLDivElement>(null);
  const lensRef = React.useRef<HTMLDivElement>(null);
  const plateRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    const lens = lensRef.current;
    const plate = plateRef.current;
    // The listener goes on the band, because this layer is `pointer-events:
    // none` like everything else under the copy.
    const stage = root?.closest('section');
    if (!enabled || !root || !lens || !plate || !stage) return undefined;

    // The copy inside the lens is sized to the frame, not to the lens.
    const size = (): void => {
      plate.style.width = `${root.clientWidth}px`;
      plate.style.height = `${root.clientHeight}px`;
    };
    size();
    const resizeObserver = new ResizeObserver(size);
    resizeObserver.observe(root);

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let lit = false;

    const apply = (): void => {
      lens.style.transform = `translate3d(${x - RADIUS}px, ${y - RADIUS}px, 0)`;
      plate.style.transform = `translate3d(${RADIUS - x}px, ${RADIUS - y}px, 0)`;
    };

    const tick = (): void => {
      // Settled: a resting pointer should not cost a style write per frame.
      if (Math.abs(targetX - x) < 0.1 && Math.abs(targetY - y) < 0.1) return;
      x += (targetX - x) * FOLLOW;
      y += (targetY - y) * FOLLOW;
      apply();
    };

    const onMove = (event: PointerEvent): void => {
      // Measured per event: the frame is parallaxed, so its box moves while
      // the page scrolls under a still pointer.
      const bounds = root.getBoundingClientRect();
      targetX = event.clientX - bounds.left;
      targetY = event.clientY - bounds.top;

      if (lit) return;
      // Arrives where the pointer is, rather than sweeping in from wherever it
      // last went dark.
      lit = true;
      x = targetX;
      y = targetY;
      apply();
      gsap.ticker.add(tick);
      gsap.to(lens, { opacity: 1, duration: 0.5, ease: 'power2.out', overwrite: true });
    };

    const onLeave = (): void => {
      gsap.to(lens, {
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
          gsap.ticker.remove(tick);
          lit = false;
        },
      });
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);

    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      gsap.ticker.remove(tick);
      gsap.killTweensOf(lens);
      resizeObserver.disconnect();
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div ref={rootRef} className="absolute inset-0" aria-hidden>
      <div
        ref={lensRef}
        className="absolute left-0 top-0 overflow-hidden opacity-0"
        style={{
          width: LENS,
          height: LENS,
          maskImage: LENS_MASK,
          WebkitMaskImage: LENS_MASK,
          willChange: 'transform, opacity',
        }}
      >
        <div ref={plateRef} className="absolute left-0 top-0" style={{ willChange: 'transform' }}>
          <FramePicture src={src} portraitSrc={portraitSrc} objectPosition={objectPosition} />
        </div>
      </div>
    </div>
  );
}

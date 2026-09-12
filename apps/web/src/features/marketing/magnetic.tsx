import * as React from 'react';
import { gsap } from './scroll-engine';
import { useMediaQuery } from './motion-extras';
import { useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Pointer micro-interactions for the public site.
 *
 * Two of them, and the restraint is the design. A fleet platform is bought by
 * someone comparing it against the tracker they already pay for, and a page
 * that chases their cursor with confetti reads as a studio piece rather than
 * as software that will still be running their trucks in three years. So the
 * pointer does exactly two things here: important actions lean toward it, and
 * a faint halo follows it across the dark bands.
 *
 * Both are desktop-only, both are off under reduced motion, and neither ever
 * hides the real cursor — see `PointerHalo`.
 */

/** Coarse pointers get none of this: there is no cursor to be magnetic to. */
function useFinePointer(): boolean {
  return useMediaQuery('(pointer: fine)');
}

/* -------------------------------------------------------------------------
 * Magnetic
 * ---------------------------------------------------------------------- */

/**
 * Makes an element lean toward the pointer while the pointer is near it.
 *
 * Why this and not a hover scale: a scale says "you are over me", which the
 * pointer already knew. Leaning says "you are *near* me, and I am reachable",
 * which is a different and more useful signal — it is the page conceding that
 * the primary action is the thing you probably came for. That is why it is
 * applied to two buttons on the whole site and nothing else.
 *
 * Driven with `gsap.quickTo` rather than React state. A pointer move is sixty
 * events a second; putting a `setState` on that path re-renders a button and
 * everything under it for the sake of a two-pixel offset, and on a page with a
 * canvas already drawing every frame that is the difference between smooth and
 * not. `quickTo` writes straight to the transform with a preallocated tween.
 */
export function useMagnetic<T extends HTMLElement>(
  /** How far the element travels, as a fraction of the pointer's offset. */
  strength = 0.32,
  /** How far outside its own box the element starts to notice the pointer. */
  padding = 28,
): React.RefObject<T> {
  const ref = React.useRef<T>(null);
  const reduced = useReducedMotion();
  const fine = useFinePointer();

  React.useEffect(() => {
    const node = ref.current;
    if (!node || reduced || !fine) return undefined;

    const moveX = gsap.quickTo(node, 'x', { duration: 0.5, ease: 'power3.out' });
    const moveY = gsap.quickTo(node, 'y', { duration: 0.5, ease: 'power3.out' });

    const onMove = (event: PointerEvent): void => {
      const box = node.getBoundingClientRect();
      const centreX = box.left + box.width / 2;
      const centreY = box.top + box.height / 2;

      const withinX = Math.abs(event.clientX - centreX) < box.width / 2 + padding;
      const withinY = Math.abs(event.clientY - centreY) < box.height / 2 + padding;

      if (withinX && withinY) {
        moveX((event.clientX - centreX) * strength);
        moveY((event.clientY - centreY) * strength);
      } else {
        moveX(0);
        moveY(0);
      }
    };

    /*
     * Listened for on the window, not on the element.
     *
     * The whole effect is about the region *around* the button, and an
     * element only receives pointer events inside its own box — so a
     * `pointermove` handler on the button itself can never see the approach
     * it is supposed to be reacting to. It would also never fire the release:
     * leaving quickly enough can skip the final in-bounds event, and the
     * button would stay stuck at its last offset.
     */
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      gsap.set(node, { x: 0, y: 0 });
    };
  }, [reduced, fine, strength, padding]);

  return ref;
}

/**
 * A magnetic wrapper around any control.
 *
 * A wrapper rather than a prop on `Button`, on purpose: `Button` is the
 * product's component, used on hundreds of operational screens where a control
 * that moves when you approach it is an accuracy problem rather than a
 * flourish. The behaviour stays on the marketing side of the line.
 *
 * `inline-flex` so the wrapper takes the button's own shape and the transform
 * has something to move that is not a full-width block.
 */
export function Magnetic({
  children,
  className,
  strength,
}: {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useMagnetic<HTMLSpanElement>(strength);

  return (
    <span ref={ref} className={cn('inline-flex', className)}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Pointer halo
 * ---------------------------------------------------------------------- */

/**
 * A soft light that follows the pointer across the dark bands.
 *
 * Explicitly *not* a cursor replacement. The common version of this effect
 * hides the system cursor and draws a dot in its place, and that breaks two
 * things at once: the pointer stops changing shape over text and links, so a
 * reader loses the only affordance telling them what is clickable, and anyone
 * whose OS is running a large or high-contrast cursor gets it silently
 * overridden. Here the real cursor is untouched and this is a lighting layer
 * behind it — no shape to read, nothing to lose if it never renders.
 *
 * Mounted once, at the page root, rather than per section: one window listener
 * and one composited element for the whole document.
 */
export function PointerHalo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const fine = useFinePointer();

  React.useEffect(() => {
    const node = ref.current;
    if (!node || reduced || !fine) return undefined;

    const moveX = gsap.quickTo(node, 'x', { duration: 0.65, ease: 'power3.out' });
    const moveY = gsap.quickTo(node, 'y', { duration: 0.65, ease: 'power3.out' });

    /*
     * Faded in on the first move rather than shown on mount.
     *
     * Until the pointer moves, the browser has not told anyone where it is,
     * and a halo parked at the origin is a glow in the top-left corner of the
     * hero for every visitor who arrives by keyboard and never touches a
     * mouse.
     */
    let revealed = false;

    const onMove = (event: PointerEvent): void => {
      if (!revealed) {
        revealed = true;
        gsap.to(node, { opacity: 1, duration: 0.6 });
      }
      moveX(event.clientX);
      moveY(event.clientY);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduced, fine]);

  if (reduced || !fine) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      /*
       * No blend mode, and that is a performance decision rather than an
       * aesthetic one.
       *
       * `mix-blend-plus-lighter` is the obvious way to make a halo only ever
       * *add* light, and it looks marginally better on the dark bands. It also
       * takes the element off the fast compositing path: the browser can no
       * longer promote it to its own layer, so every pointer move repaints the
       * page content underneath it. On a page already running a canvas and a
       * scrubbed scroll scene that is the difference between smooth and not,
       * and it is not worth it for a gradient nobody consciously notices.
       *
       * Held low enough that it adds nothing visible on the light working
       * bands, so it does not need switching off per section.
       */
      className="pointer-events-none fixed left-0 top-0 z-[60] hidden opacity-0 will-change-transform lg:block"
      style={{
        width: 460,
        height: 460,
        marginLeft: -230,
        marginTop: -230,
        background:
          'radial-gradient(circle, hsl(234 84% 70% / 0.09) 0%, hsl(234 84% 70% / 0.035) 38%, transparent 66%)',
      }}
    />
  );
}

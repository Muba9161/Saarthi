import * as React from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import 'lenis/dist/lenis.css';
import { useReducedMotion } from '@/components/motion';

/**
 * The public site's scroll spine.
 *
 * Three systems want to know where the page is: Lenis, which is moving it;
 * GSAP's ScrollTrigger, which pins and choreographs against it; and Framer
 * Motion's `useScroll`, which every existing band already reads. Left alone
 * they each run their own loop and sample at their own moment, and the result
 * is the failure this module exists to prevent — a pinned section that arrives
 * a frame late, parallax that judders against the content it is meant to sit
 * behind, and a progress bar that lags the thing it reports.
 *
 * So there is exactly one clock. GSAP's ticker drives Lenis, Lenis pushes its
 * scroll position into ScrollTrigger, and `lagSmoothing` is switched off so a
 * long frame does not make GSAP skip ahead of a Lenis that cannot. Framer
 * Motion reads `window.scrollY`, which Lenis writes natively rather than by
 * transforming a wrapper — which is the whole reason Lenis was chosen over a
 * transform-based smooth-scroll library, and why the existing bands needed no
 * changes to keep working.
 *
 * It is also why none of this is in the app shell. The signed-in product is an
 * operational tool where a manager drags a map and scans a table, and inertial
 * scrolling there is an obstacle between a person and a number they need. This
 * belongs to the marketing route alone.
 */

/* Registered once, at module scope: `registerPlugin` is idempotent, but this
   module is only ever reached from the lazy marketing chunk, so doing it here
   keeps the plugin and its registration in the same place. */
gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

const LenisContext = React.createContext<Lenis | null>(null);

/** The running Lenis instance, or `null` when smooth scrolling is off. */
export function useLenis(): Lenis | null {
  return React.useContext(LenisContext);
}

/**
 * Scrolls to an element, through whichever mechanism is actually driving the
 * page.
 *
 * A bare `scrollIntoView` while Lenis is running sets the scroll position out
 * from under it: Lenis notices on its next native scroll event and resets to
 * wherever the browser jumped, so the reader gets an instant cut in the middle
 * of a page whose entire premise is that it moves smoothly. Routed through
 * Lenis it is the same eased movement as everything else.
 *
 * Falls back to the native call when Lenis is absent — which is the reduced
 * motion path, where an instant jump is the correct behaviour anyway.
 */
export function useScrollToSection(): (id: string) => void {
  const lenis = useLenis();

  return React.useCallback(
    (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;

      if (lenis) {
        lenis.scrollTo(target, { offset: -HEADER_OFFSET });
        return;
      }
      target.scrollIntoView({ block: 'start' });
    },
    [lenis],
  );
}

/** Clears the sticky header, plus a little air. Tracks `HEADER_HEIGHT`. */
const HEADER_OFFSET = 88;

/**
 * Installs smooth scrolling for the subtree, and keeps GSAP in step with it.
 *
 * Renders nothing of its own. Under `prefers-reduced-motion` it installs
 * nothing at all and the page scrolls natively, which is the point: inertial
 * scrolling is precisely the class of movement that reduced motion is asking
 * to be spared, and every ScrollTrigger below still works because ScrollTrigger
 * reads native scroll perfectly well on its own.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [lenis, setLenis] = React.useState<Lenis | null>(null);

  React.useEffect(() => {
    if (reduced) return undefined;

    const instance = new Lenis({
      /*
       * Long enough to feel weighted, short enough that a reader who flicks
       * the wheel twice does not watch the second flick queue behind the
       * first. The exponential easing is Lenis's own recommended curve; it
       * decelerates hard at the end, which is what keeps a long page from
       * feeling like it is sliding on ice.
       */
      duration: 1.05,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      /*
       * Touch devices keep their native scrolling untouched. A phone's
       * scroll is already inertial, implemented by the compositor, and
       * running a JavaScript approximation on top of it costs a frame budget
       * to make the page feel worse than the OS does for free.
       */
      smoothWheel: true,
      syncTouch: false,
      /* This module owns the loop; see the ticker wiring below. */
      autoRaf: false,
      /*
       * Anything that scrolls inside the page keeps its own scrolling — a
       * `[data-lenis-prevent]` opt-out for the capability explorer's rail and
       * the pricing matrix's horizontal overflow, and every dialog, so the
       * mobile menu's own list is not fighting the page behind it.
       */
      prevent: (node) =>
        node.hasAttribute('data-lenis-prevent') || node.closest('[role="dialog"]') !== null,
    });

    // `passive: false`, because ScrollTrigger has to see the new position
    // before it decides what to paint this frame.
    instance.on('scroll', ScrollTrigger.update);

    const tick = (time: number): void => {
      // GSAP's ticker reports seconds; Lenis expects milliseconds.
      instance.raf(time * 1000);
    };

    gsap.ticker.add(tick);
    /*
     * Off, deliberately.
     *
     * `lagSmoothing` exists to stop long-running GSAP tweens jumping after a
     * blocked frame, by lying to them about how much time passed. Here the
     * animation *is* the scroll position, and a scroll position that quietly
     * skips a chunk of travel after a stutter tears every pinned section off
     * its trigger. Better a dropped frame than a scene that loses its place.
     */
    gsap.ticker.lagSmoothing(0);

    /*
     * Hands the page back whenever something else has locked it.
     *
     * Radix locks scrolling by setting `overflow: hidden` on the body while a
     * dialog or the mobile menu is open. Lenis does not know that: it goes on
     * consuming wheel events and writing scroll positions the body is
     * refusing, so the page silently teleports to wherever Lenis thought it
     * was the moment the sheet closes. Watching the attribute rather than
     * hooking each dialog keeps this correct for every overlay in the app,
     * including ones added later.
     */
    const syncLock = (): void => {
      if (document.body.style.overflow === 'hidden') instance.stop();
      else instance.start();
    };
    const lockObserver = new MutationObserver(syncLock);
    lockObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });

    setLenis(instance);

    return () => {
      lockObserver.disconnect();
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      instance.destroy();
      setLenis(null);
    };
  }, [reduced]);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}

/* -------------------------------------------------------------------------
 * GSAP in React
 * ---------------------------------------------------------------------- */

/**
 * Runs a GSAP setup function inside a scope that cleans itself up.
 *
 * `gsap.context` records every tween, timeline and ScrollTrigger created
 * inside the callback and reverts all of them on teardown, including the
 * inline styles GSAP wrote. Without it, a ScrollTrigger outlives the component
 * that made it, goes on firing against detached nodes, and — because pinning
 * rewrites the element's layout — leaves a pin-spacer wedged in the document.
 * On a lazily routed page that is one navigation away from happening every
 * time.
 *
 * The scope argument also lets the callback use selector text (`'.js-beat'`)
 * that is automatically confined to the container, so two instances of a
 * section never animate each other's children.
 *
 * Returns the ref to attach to the scope element. Skips the callback entirely
 * under reduced motion, so callers express the choreography once and get the
 * static version for free.
 */
export function useGsapScope<T extends HTMLElement>(
  setup: (context: { scope: T }) => void,
  deps: React.DependencyList = [],
): React.RefObject<T> {
  const ref = React.useRef<T>(null);
  const reduced = useReducedMotion();

  /*
   * The setup closure is held in a ref rather than listed as a dependency.
   *
   * It is redefined on every render — callers write it inline, which is the
   * whole ergonomic point — so depending on it would revert and rebuild every
   * ScrollTrigger in the scope on each render, and a scrubbed scene would
   * visibly reset while the reader was scrolling through it. `deps` is the
   * supported way to ask for a rebuild.
   */
  const setupRef = React.useRef(setup);
  setupRef.current = setup;

  React.useLayoutEffect(() => {
    const scope = ref.current;
    if (!scope || reduced) return undefined;

    const context = gsap.context(() => setupRef.current({ scope }), scope);
    return () => context.revert();
    // Spread, not nested: `deps` is a fresh array literal on every render, so
    // listing it as a single dependency would compare unequal every time and
    // rebuild the scene continuously — the exact failure the ref above avoids.
  }, [reduced, ...deps]);

  return ref;
}

import * as React from 'react';
import type Lenis from 'lenis';

/**
 * The running Lenis instance, held apart from `scroll-engine`.
 *
 * `scroll-engine` imports GSAP, ScrollTrigger and Lenis itself. Chrome that is
 * also rendered off the landing page — the footer, on the legal pages — needs
 * to know whether Lenis is driving the scroll, but must not pull that whole
 * engine into those chunks to find out. The type-only import keeps this
 * module free of all three.
 */
export const LenisContext = React.createContext<Lenis | null>(null);

/** The running Lenis instance, or `null` when smooth scrolling is off or absent. */
export function useLenis(): Lenis | null {
  return React.useContext(LenisContext);
}

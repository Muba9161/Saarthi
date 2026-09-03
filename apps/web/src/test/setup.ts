import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Component-test bootstrap.
 *
 * jsdom has no layout engine, so anything the UI relies on from a real browser
 * is stubbed here once rather than in every test file.
 */

afterEach(() => cleanup());

// Framer Motion and Radix both read this on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Scroll-triggered reveals need this.
 *
 * The stub reports every observed element as visible straight away, which is
 * the only useful behaviour without a layout engine: jsdom gives every element
 * a zero-sized rect, so a faithful implementation would report nothing as ever
 * on screen and any content behind a scroll reveal would be untestable.
 */
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    private readonly callback: IntersectionObserverCallback;

    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [0];

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      this.callback(
        [
          {
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: 0,
          } as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

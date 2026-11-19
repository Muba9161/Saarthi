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

// The wizard's step strip scrolls the current step into view; jsdom has no
// layout to scroll, so the call simply has nothing to do.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

/**
 * Node 22+ / 24+ undici Request webidl brand check workaround for JSDOM.
 *
 * JSDOM provides its own AbortSignal in the window/global scope, but Node 22/24
 * native Request performs a strict WebIDL brand-check against Node's internal
 * AbortSignal. In tests that navigate react-router memory routers, router.navigate
 * creates client-side Request instances with JSDOM's AbortSignal, triggering
 * "TypeError: RequestInit: Expected signal to be an instance of AbortSignal".
 */
const OriginalRequest = globalThis.Request;
if (typeof OriginalRequest === 'function') {
  const PatchedRequest = function (input: RequestInfo | URL, init?: RequestInit) {
    try {
      return new OriginalRequest(input, init);
    } catch (err: unknown) {
      if (init?.signal && err instanceof TypeError && err.message.includes('Expected signal')) {
        const { signal, ...rest } = init;
        const req = new OriginalRequest(input, rest);
        Object.defineProperty(req, 'signal', { value: signal, configurable: true });
        return req;
      }
      throw err;
    }
  };
  PatchedRequest.prototype = OriginalRequest.prototype;
  Object.setPrototypeOf(PatchedRequest, OriginalRequest);
  globalThis.Request = PatchedRequest as unknown as typeof Request;
}


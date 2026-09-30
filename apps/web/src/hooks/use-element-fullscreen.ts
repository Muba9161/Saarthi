import * as React from 'react';

/**
 * Full screen for one element, on every browser that can show one.
 *
 * The Fullscreen API where it exists. Where it does not — Safari on iPhone
 * refuses it for anything but a video — the element is pinned over the whole
 * window instead (`mode === 'window'`), which the caller styles, with Escape
 * and page-scroll locking handled here so the two modes behave the same.
 */
export function useElementFullscreen<T extends HTMLElement>(ref: React.RefObject<T>) {
  const [mode, setMode] = React.useState<'native' | 'window' | null>(null);

  React.useEffect(() => {
    const onChange = (): void => {
      const element = ref.current;
      if (element && document.fullscreenElement === element) setMode('native');
      else setMode((current) => (current === 'native' ? null : current));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  React.useEffect(() => {
    if (mode !== 'window') return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMode(null);
    };
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [mode]);

  const exit = React.useCallback((): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setMode(null);
  }, []);

  const enter = React.useCallback((): void => {
    const element = ref.current;
    if (!element) return;
    if (document.fullscreenEnabled && typeof element.requestFullscreen === 'function') {
      element.requestFullscreen().catch(() => setMode('window'));
    } else {
      setMode('window');
    }
  }, [ref]);

  const toggle = React.useCallback((): void => (mode ? exit() : enter()), [mode, enter, exit]);

  return { mode, active: mode !== null, toggle, exit };
}

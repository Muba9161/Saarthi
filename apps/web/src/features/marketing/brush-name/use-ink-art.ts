import * as React from 'react';
import type { InkArt } from '@/components/ink/ink-art.types';

type InkArtState =
  | { status: 'loading' }
  | { status: 'ready'; art: Readonly<Record<string, InkArt>> }
  | { status: 'failed' };

/**
 * The generated outlines, fetched as their own chunk.
 *
 * Tens of kilobytes of path data for a band well below the fold has no
 * business in the landing page's first download, where it would compete with
 * the hero. It is requested as soon as the band mounts, which is long before a
 * reader scrolls to it.
 *
 * A failed chunk — a deploy that replaced it mid-visit, a dropped connection —
 * reports `failed` so the band can fall back to plain text rather than sit
 * empty.
 */
export function useInkArt(enabled: boolean): InkArtState {
  const [state, setState] = React.useState<InkArtState>({ status: 'loading' });

  React.useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    import('./ink-art.generated')
      .then((module) => {
        if (!cancelled) setState({ status: 'ready', art: module.INK_ART });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

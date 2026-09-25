import * as React from 'react';
import { useLocation } from 'react-router-dom';
import type { MitraDraftState } from '@/lib/api-types';

/**
 * Apply the draft Saarthi Mitra handed this screen, once.
 *
 * Mitra's buttons navigate here with `{ mitraDraft }` in router state. The
 * screen prefills itself from it and the person carries on as normal — the
 * draft is a head start, never a submission. `ready` lets a screen wait for
 * what it needs (the taxonomy, say) before applying.
 */
export function useMitraDraft(apply: (draft: Record<string, string>) => void, ready = true): void {
  const location = useLocation();
  const applied = React.useRef(false);
  const draft = (location.state as MitraDraftState | null)?.mitraDraft;

  React.useEffect(() => {
    if (applied.current || !ready || !draft) return;
    applied.current = true;
    apply(draft);
  }, [apply, draft, ready]);
}

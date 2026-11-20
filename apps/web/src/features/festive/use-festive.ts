import * as React from 'react';
import type { FestivalKey } from '@saarthi/shared';
import { getFestiveState, subscribeFestive, type FestiveState } from './festive-state';

export interface FestiveView extends FestiveState {
  /** The festival on screen: `key` when wanted, otherwise null. */
  active: FestivalKey | null;
}

/** The festive state, re-rendering when the day or the visitor's choice changes. */
export function useFestive(): FestiveView {
  const value = React.useSyncExternalStore(subscribeFestive, getFestiveState, getFestiveState);
  return React.useMemo(() => ({ ...value, active: value.on ? value.key : null }), [value]);
}

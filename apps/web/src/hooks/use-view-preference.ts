import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ViewMode, ViewPreference } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';

/**
 * A person's saved layout for one list.
 *
 * The preference lives on the server so it follows the user between devices,
 * but a copy is kept in `localStorage` for one reason only: to paint the right
 * layout on first render instead of flashing a table and then swapping to
 * cards. The server value wins the moment it arrives.
 *
 * Writes are optimistic and failures are silent. Someone toggling a view is not
 * performing a transaction — if the save fails, the layout still changed for
 * this session and the next toggle will try again. A red toast here would be
 * noise about something nobody asked to be told.
 */

const STORAGE_PREFIX = 'saarthi.view.';

function readCached(surface: string): ViewMode | null {
  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${surface}`);
    return value === 'TABLE' || value === 'CARDS' ? value : null;
  } catch {
    // Private mode, disabled storage, an embedded webview — none of which are
    // a reason for a list to fail to render.
    return null;
  }
}

function writeCached(surface: string, mode: ViewMode): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${surface}`, mode);
  } catch {
    /* Ignored — see readCached. */
  }
}

export interface UseViewPreferenceResult {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  hiddenColumns: string[];
  toggleColumn: (key: string) => void;
  /** True until the server preference has been read at least once. */
  isResolving: boolean;
}

export function useViewPreference(
  surface: string,
  defaultMode: ViewMode = 'TABLE',
): UseViewPreferenceResult {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = status === 'authenticated';

  const [localMode, setLocalMode] = React.useState<ViewMode>(
    () => readCached(surface) ?? defaultMode,
  );
  const [localHidden, setLocalHidden] = React.useState<string[] | null>(null);

  const preferences = useQuery({
    queryKey: ['view-preferences'],
    queryFn: () => api.get<ViewPreference[]>('/me/view-preferences'),
    enabled: signedIn,
    // Preferences change only when this user changes them, and the mutation
    // updates the cache directly — so there is no reason to refetch on focus.
    staleTime: 30 * 60_000,
  });

  const stored = preferences.data?.find((entry) => entry.surface === surface);

  React.useEffect(() => {
    if (!stored) return;
    setLocalMode(stored.viewMode);
    writeCached(surface, stored.viewMode);
  }, [stored, surface]);

  const save = useMutation({
    mutationFn: (input: { viewMode?: ViewMode; hiddenColumns?: string[] }) =>
      api.put<ViewPreference>(`/me/view-preferences/${surface}`, input),
    onSuccess: (saved) => {
      queryClient.setQueryData<ViewPreference[]>(['view-preferences'], (previous) => {
        const rest = (previous ?? []).filter((entry) => entry.surface !== surface);
        return [...rest, saved];
      });
    },
  });

  const setViewMode = React.useCallback(
    (mode: ViewMode) => {
      setLocalMode(mode);
      writeCached(surface, mode);
      if (signedIn) save.mutate({ viewMode: mode });
    },
    [save, signedIn, surface],
  );

  const hiddenColumns = localHidden ?? stored?.hiddenColumns ?? [];

  const toggleColumn = React.useCallback(
    (key: string) => {
      const next = hiddenColumns.includes(key)
        ? hiddenColumns.filter((entry) => entry !== key)
        : [...hiddenColumns, key];
      setLocalHidden(next);
      if (signedIn) save.mutate({ hiddenColumns: next });
    },
    [hiddenColumns, save, signedIn],
  );

  return {
    viewMode: localMode,
    setViewMode,
    hiddenColumns,
    toggleColumn,
    isResolving: signedIn && preferences.isLoading,
  };
}

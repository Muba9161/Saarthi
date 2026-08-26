import type { UpdateViewPreferenceInput, ViewMode, ViewPreference } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import type { AuthContext } from '../../auth/context';

/**
 * Per-user list presentation preferences.
 *
 * Stored server-side rather than in the browser so the choice follows the
 * person: a dispatcher who switched the vehicle list to cards on their phone
 * finds it in cards on the depot machine too. `localStorage` still holds a copy
 * on the client, but only to avoid a flash of the wrong layout on first paint —
 * this is the source of truth.
 */

export async function listViewPreferences(auth: AuthContext): Promise<ViewPreference[]> {
  const rows = await prisma.userViewPreference.findMany({
    where: { userId: auth.user.id },
    orderBy: { surface: 'asc' },
    take: 200,
  });

  return rows.map((row) => ({
    surface: row.surface,
    viewMode: row.viewMode as ViewMode,
    hiddenColumns: row.hiddenColumns,
    pageSize: row.pageSize,
    sortKey: row.sortKey,
    sortDirection: (row.sortDirection as 'asc' | 'desc' | null) ?? null,
  }));
}

/**
 * Save one surface's preference.
 *
 * Upsert rather than create-then-update: a preference is a single fact about a
 * user and a screen, and the row simply appears the first time they change
 * anything. A user who never touches the toggle never gets a row.
 */
export async function saveViewPreference(
  auth: AuthContext,
  surface: string,
  input: UpdateViewPreferenceInput,
): Promise<ViewPreference> {
  const row = await prisma.userViewPreference.upsert({
    where: { userId_surface: { userId: auth.user.id, surface } },
    create: {
      userId: auth.user.id,
      surface,
      viewMode: input.viewMode ?? 'TABLE',
      hiddenColumns: input.hiddenColumns ?? [],
      pageSize: input.pageSize ?? null,
      sortKey: input.sortKey ?? null,
      sortDirection: input.sortDirection ?? null,
    },
    update: {
      ...(input.viewMode !== undefined ? { viewMode: input.viewMode } : {}),
      ...(input.hiddenColumns !== undefined ? { hiddenColumns: input.hiddenColumns } : {}),
      ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
      ...(input.sortKey !== undefined ? { sortKey: input.sortKey } : {}),
      ...(input.sortDirection !== undefined ? { sortDirection: input.sortDirection } : {}),
    },
  });

  return {
    surface: row.surface,
    viewMode: row.viewMode as ViewMode,
    hiddenColumns: row.hiddenColumns,
    pageSize: row.pageSize,
    sortKey: row.sortKey,
    sortDirection: (row.sortDirection as 'asc' | 'desc' | null) ?? null,
  };
}

/** Forget a surface, returning it to the screen's own default. */
export async function resetViewPreference(auth: AuthContext, surface: string): Promise<void> {
  await prisma.userViewPreference.deleteMany({
    where: { userId: auth.user.id, surface },
  });
}

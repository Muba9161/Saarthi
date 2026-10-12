import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Permission, type ExpenseCategory } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { ExpenseListResult } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';

export interface ExpenseListFilters {
  page: number;
  pageSize: number;
  tripId?: string;
  category?: ExpenseCategory;
}

/**
 * Expense slips under a filter, with the totals across all of them.
 *
 * Read under the fuel permission, as the API does: a viewer who may not see
 * running costs is never sent to a request that would be refused.
 */
export function useExpenses(filters: ExpenseListFilters) {
  const { can } = useAuth();

  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: () =>
      api.get<ExpenseListResult>('/fleet/expenses', {
        page: filters.page,
        pageSize: filters.pageSize,
        ...(filters.tripId ? { tripId: filters.tripId } : {}),
        ...(filters.category ? { category: filters.category } : {}),
      }),
    enabled: can(Permission.FUEL_READ),
    // The fleet list keeps its page on screen while the next one loads; one
    // trip's slips never stand in for another trip's.
    ...(filters.tripId ? {} : { placeholderData: keepPreviousData }),
  });
}

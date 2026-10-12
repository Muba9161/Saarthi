import { Link } from 'react-router-dom';
import { Permission, formatCurrency, formatDateTime } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ExpenseCategoryLabel } from './expense-category';
import { ExpenseSlipPhoto } from './expense-slip-photo';
import { useExpenses } from './use-expenses';

/** The most a trip panel lists; the total beside it still covers every slip. */
const TRIP_SLIP_LIMIT = 50;

/**
 * The slips a driver filed against one trip, and what they add up to.
 *
 * They are already counted in the trip's expenses and its cost, so this is
 * where that figure can be checked slip by slip, against the photograph
 * behind each amount.
 */
export function TripExpenseSlips({ tripId }: { tripId: string }) {
  const { can } = useAuth();
  const slips = useExpenses({ tripId, page: 1, pageSize: TRIP_SLIP_LIMIT });

  // Slips are running costs, read under the fuel permission like the rest.
  if (!can(Permission.FUEL_READ)) return null;

  const items = slips.data?.items ?? [];
  const total = slips.data?.pagination.total ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Expense slips"
          description="Paid on the road and photographed in the driver app."
          actions={
            slips.data && total > 0 ? (
              <span className="tabular text-sm font-semibold">
                {formatCurrency(slips.data.totals.amount)}
              </span>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="pt-0">
        {slips.isLoading ? (
          <LoadingState label="Loading slips…" className="min-h-24 p-4" />
        ) : slips.error ? (
          <ErrorState error={slips.error} onRetry={() => void slips.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No slips filed against this trip.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <ExpenseSlipPhoto expense={expense} className="size-11" />
                <div className="min-w-0 flex-1">
                  <ExpenseCategoryLabel
                    category={expense.category}
                    className="max-w-full text-sm font-medium"
                  />
                  <p className="truncate text-xs text-muted-foreground">
                    {[expense.vendorName, formatDateTime(expense.recordedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm font-medium">
                  {formatCurrency(expense.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {total > items.length && items.length > 0 ? (
          <p className="pt-3 text-xs text-muted-foreground">
            Showing the latest {items.length} of {total} slips.{' '}
            <Link to="/fleet/expenses" className="font-medium text-foreground hover:underline">
              See all expenses
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

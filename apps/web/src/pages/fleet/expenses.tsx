import * as React from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  Permission,
  formatCurrency,
  formatDateTime,
  type ExpenseCategory,
} from '@saarthi/shared';
import type { ExpenseListItem, ExpenseListTotals } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import {
  EXPENSE_CATEGORY_ICONS,
  EXPENSE_CATEGORY_LABELS,
  ExpenseCategoryLabel,
} from '@/features/expenses/expense-category';
import { ExpenseSlipPhoto } from '@/features/expenses/expense-slip-photo';
import { useExpenses } from '@/features/expenses/use-expenses';
import { PageHeader } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { MiniStat, StatCard } from '@/components/common/stat-card';
import { UnauthorizedState } from '@/components/common/states';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** The select's value for "no category filter"; never a category itself. */
const ALL_CATEGORIES = 'ALL';

/**
 * Expenses — the road slips other than fuel.
 *
 * A driver pays a toll in cash, a parking attendant or a mechanic, photographs
 * the slip in the driver app, and it lands here filed against the trip under
 * way. Fuel slips are not repeated: they become fill-ups on the Fuel tab.
 */
export function ExpensesPage() {
  const { can } = useAuth();
  const [page, setPage] = React.useState(1);
  const [category, setCategory] = React.useState<ExpenseCategory | null>(null);

  const query = useExpenses({ page, pageSize: 20, ...(category ? { category } : {}) });

  if (!can(Permission.FUEL_READ)) return <UnauthorizedState />;

  const totals = query.data?.totals;
  const slipCount = query.data?.pagination.total ?? 0;

  const columns: Column<ExpenseListItem>[] = [
    {
      key: 'slip',
      header: 'Slip',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <ExpenseSlipPhoto expense={row} className="size-10" />
          <div className="min-w-0">
            <ExpenseCategoryLabel category={row.category} className="max-w-full font-medium" />
            <p className="truncate text-xs text-muted-foreground">{row.registrationNumber}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'paidAt',
      header: 'Paid',
      cell: (row) => (
        <span className="whitespace-nowrap text-sm">{formatDateTime(row.recordedAt)}</span>
      ),
    },
    {
      key: 'vendor',
      header: 'Paid to',
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.vendorName ?? '-'}</span>,
    },
    {
      key: 'trip',
      header: 'Trip',
      hideOnMobile: true,
      cell: (row) =>
        row.tripId ? (
          <Link to={`/trips/${row.tripId}`} className="text-sm font-medium hover:underline">
            {row.tripReference ?? 'View trip'}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Between trips</span>
        ),
    },
    {
      key: 'driver',
      header: 'Driver',
      hideOnMobile: true,
      cell: (row) => <span className="text-sm">{row.driverName ?? '-'}</span>,
    },
    {
      key: 'notes',
      header: 'Notes',
      hideOnMobile: true,
      cell: (row) => (
        <span
          className="block max-w-56 truncate text-sm text-muted-foreground"
          {...(row.notes ? { title: row.notes } : {})}
        >
          {row.notes ?? '-'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (row) => <span className="font-medium">{formatCurrency(row.amount)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        description="Road slips drivers pay and photograph, each added to the trip it was paid on."
      />

      {totals ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <StatCard
            label="Total spend"
            value={formatCurrency(totals.amount)}
            icon={Wallet}
            hint={`${slipCount} slip${slipCount === 1 ? '' : 's'}`}
          />
          <CategoryBreakdown totals={totals} />
        </div>
      ) : null}

      <DataView
        surface="fleet.expenses"
        columns={columns}
        rows={query.data?.items}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isPlaceholderData}
        error={query.error}
        onRetry={() => void query.refetch()}
        pagination={query.data?.pagination}
        onPageChange={setPage}
        toolbar={
          <Select
            value={category ?? ALL_CATEGORIES}
            onValueChange={(value) => {
              setCategory(EXPENSE_CATEGORIES.find((option) => option === value) ?? null);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
              {EXPENSE_CATEGORIES.map((option) => (
                <SelectItem key={option} value={option}>
                  <ExpenseCategoryLabel category={option} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        emptyTitle={
          category
            ? `No ${EXPENSE_CATEGORY_LABELS[category].toLowerCase()} slips`
            : 'No expense slips yet'
        }
        emptyDescription={
          category
            ? 'Nothing has been filed under this category. Choose All categories to see every slip.'
            : 'Slips appear here when drivers photograph a toll, parking, repair or other road expense in the driver app.'
        }
      />
    </div>
  );
}

/** Where the money went, largest first, under the same filter as the table. */
function CategoryBreakdown({ totals }: { totals: ExpenseListTotals }) {
  const entries = EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: totals.byCategory[category] ?? 0,
  }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return (
    <Card variant="glass" className="rounded-2xl p-5 sm:p-6 lg:col-span-2">
      <p className="section-label">By category</p>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {entries.map((entry) => (
            <MiniStat
              key={entry.category}
              label={EXPENSE_CATEGORY_LABELS[entry.category]}
              value={formatCurrency(entry.amount)}
              icon={EXPENSE_CATEGORY_ICONS[entry.category]}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export default ExpensesPage;

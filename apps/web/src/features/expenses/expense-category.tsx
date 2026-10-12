import {
  CircleEllipsis,
  Forklift,
  Gavel,
  SquareParking,
  Ticket,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ExpenseCategory } from '@saarthi/shared';
import { cn } from '@/lib/utils';

/**
 * How each kind of road expense slip is named and drawn.
 *
 * Written out rather than run through `humanizeEnum`, because the enum is the
 * API's vocabulary and not the owner's: `LOADING` is paid at either end of a
 * trip, and "Loading" alone reads as only one of them.
 */
export const EXPENSE_CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = {
  TOLL: 'Toll',
  PARKING: 'Parking',
  REPAIR: 'Repair',
  FOOD: 'Food',
  LOADING: 'Loading / unloading',
  CHALLAN: 'Challan',
  OTHER: 'Other',
};

export const EXPENSE_CATEGORY_ICONS: Readonly<Record<ExpenseCategory, LucideIcon>> = {
  TOLL: Ticket,
  PARKING: SquareParking,
  REPAIR: Wrench,
  FOOD: UtensilsCrossed,
  LOADING: Forklift,
  CHALLAN: Gavel,
  OTHER: CircleEllipsis,
};

/** The category as a small icon and its name. */
export function ExpenseCategoryLabel({
  category,
  className,
}: {
  category: ExpenseCategory;
  className?: string;
}) {
  const Icon = EXPENSE_CATEGORY_ICONS[category];

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{EXPENSE_CATEGORY_LABELS[category]}</span>
    </span>
  );
}

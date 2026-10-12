import { ImageOff } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@saarthi/shared';
import type { ExpenseListItem } from '@/lib/api-types';
import { MediaImage } from '@/features/media/media-image';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { EXPENSE_CATEGORY_LABELS } from './expense-category';

/**
 * The slip's photograph — the evidence for the amount beside it.
 *
 * The list shows the small rendition, and the original is asked for only when
 * the dialog opens: a page of slips should not download a full-resolution
 * photograph of every one of them before anybody has looked at any.
 */
export function ExpenseSlipPhoto({
  expense,
  className,
}: {
  expense: ExpenseListItem;
  /** Sizes the thumbnail, e.g. `size-12`. */
  className?: string;
}) {
  const slip = `${EXPENSE_CATEGORY_LABELS[expense.category]} slip`;

  if (!expense.photoId) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground/60',
          className,
        )}
        role="img"
        aria-label={`${slip}: no photo`}
      >
        <ImageOff className="size-4" />
      </div>
    );
  }

  const details = [
    expense.vendorName,
    expense.registrationNumber,
    formatDateTime(expense.recordedAt),
  ].filter(Boolean);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`View the photo of this ${slip.toLowerCase()}`}
          className={cn(
            'shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-opacity hover:opacity-90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <MediaImage
            source={expense.photoId}
            alt={slip}
            variant="thumbnail"
            className="size-full object-cover"
          />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {slip} · {formatCurrency(expense.amount)}
          </DialogTitle>
          <DialogDescription>{details.join(' · ')}</DialogDescription>
        </DialogHeader>
        <MediaImage
          source={expense.photoId}
          alt={`Photo of the ${slip.toLowerCase()}`}
          className="max-h-[70dvh] min-h-48 w-full rounded-lg bg-muted object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}

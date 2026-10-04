import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The vehicle page's surface: a frosted panel with one heading style.
 *
 * Local to the detail feature rather than a new variant of `Card`, because the
 * frost only works over the hero's wash — elsewhere in the product a panel sits
 * on a flat canvas and the plain card is right.
 */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('vd-panel px-6 py-[22px]', className)} {...props} />;
}

export function PanelHeader({
  id,
  title,
  description,
  action,
  className,
}: {
  /** Referenced by the panel's `aria-labelledby`. */
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3.5 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * A table's heading row with nothing under it yet — so the reader learns what
 * will appear here as well as that nothing has.
 */
export function EmptyRows({ title, hint }: { title: string; hint: string }) {
  return (
    <p className="px-3 py-7 text-center text-sm text-muted-foreground">
      <strong className="mb-0.5 block font-semibold text-foreground">{title}</strong>
      {hint}
    </p>
  );
}

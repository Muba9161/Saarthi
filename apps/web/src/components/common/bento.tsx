import * as React from 'react';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/common/page-header';
import { cn } from '@/lib/utils';

/**
 * The dashboard grid.
 *
 * Every board in the product used to be a stack of full-width rows: four
 * tiles, then a map, then two panels. It reads as a list of sections rather
 * than as one picture, and it wastes the widest screens — a 1600px row holding
 * a single list is mostly empty.
 *
 * This is the arrangement the reference boards use instead. A twelve-column
 * grid on desktop lets a tile claim the area its content deserves: the live
 * map is worth half the board and two rows tall, a queue of things needing
 * attention is worth a narrow full-height column beside it, and a metric is
 * worth a quarter row. Below `lg` it collapses to a single column in source
 * order, because on a phone the only useful arrangement is the order of
 * importance, which is the order these are written in.
 *
 * Twelve columns rather than a masonry library: the layouts here are known at
 * build time, an operator needs the same tile in the same place every morning,
 * and measured reflow is what makes a board feel unstable while it loads.
 */
export function BentoGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5',
        // Rows share a height so a tile spanning two of them lines up with the
        // pair beside it. `auto` would let a tall neighbour stretch the row.
        'lg:auto-rows-[minmax(0,auto)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** How much of the twelve columns a tile claims on a wide screen. */
type Span = 3 | 4 | 6 | 8 | 9 | 12;

const COL: Record<Span, string> = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  12: 'lg:col-span-12',
};

const ROW: Record<number, string> = {
  1: '',
  2: 'lg:row-span-2',
  3: 'lg:row-span-3',
};

/**
 * A cell in the grid.
 *
 * `plain` skips the surface, for a tile that already brings its own panel —
 * a `StatCard`, say, which is a card in its own right. Wrapping one in
 * another card gives it a double edge.
 */
export function BentoTile({
  span = 6,
  rows = 1,
  plain = false,
  className,
  children,
}: {
  span?: Span;
  rows?: 1 | 2 | 3;
  plain?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const position = cn(COL[span], ROW[rows], 'min-w-0');

  if (plain) return <div className={cn(position, className)}>{children}</div>;

  return (
    <Card variant="glass" className={cn(position, 'flex flex-col overflow-hidden', className)}>
      {children}
    </Card>
  );
}

/**
 * A titled panel inside a tile — the common case.
 *
 * The header keeps its own padding and the body scrolls, so a tile spanning
 * two rows shows a long list without pushing the grid taller than the row it
 * was given.
 */
export function BentoPanel({
  title,
  description,
  actions,
  span = 6,
  rows = 1,
  bodyClassName,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  span?: Span;
  rows?: 1 | 2 | 3;
  bodyClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BentoTile span={span} rows={rows} className={className}>
      <div className="shrink-0 px-5 pb-3 pt-5">
        <SectionHeader
          title={title}
          {...(description ? { description } : {})}
          {...(actions ? { actions } : {})}
        />
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 pb-5', bodyClassName)}>
        {children}
      </div>
    </BentoTile>
  );
}

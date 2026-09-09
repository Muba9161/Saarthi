import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A specification sheet — grouped rows, label left, value right, hairline
 * between.
 *
 * Replaces the floating two-column label-over-value grid this page used to
 * show. That grid put twelve equally-weighted pairs in one rectangle with
 * nothing to separate them, so reading it meant scanning for the label you
 * wanted rather than looking it up. Rows on a shared baseline with a rule
 * between them are how a spec sheet has always worked, and grouping them under
 * headings means "what can it carry" and "what is on record" are two questions
 * with two answers rather than one wall of figures.
 *
 * Values are right-aligned and tabular so a column of numbers lines up on the
 * decimal — the reason a price list is set this way and a paragraph is not.
 */

export interface SpecRow {
  label: string;
  value: React.ReactNode;
  /** Draws attention to a value that is a problem, not just a fact. */
  tone?: 'warning' | 'destructive' | 'success';
}

export interface SpecGroup {
  /** Omit for a single ungrouped run of rows. */
  title?: string;
  rows: SpecRow[];
}

const TONES = {
  warning: 'text-warning',
  destructive: 'text-destructive',
  success: 'text-success',
} as const;

export function SpecSheet({ groups, className }: { groups: SpecGroup[]; className?: string }) {
  return (
    <div className={cn('space-y-5', className)}>
      {groups.map((group, index) => (
        <section key={group.title ?? `group-${index}`}>
          {group.title ? <p className="section-label mb-1">{group.title}</p> : null}

          <dl className="divide-y divide-border/60">
            {group.rows.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 py-2.5 first:pt-1.5"
              >
                <dt className="shrink-0 text-sm text-muted-foreground">{row.label}</dt>
                <dd
                  className={cn(
                    'tabular min-w-0 truncate text-right text-sm font-medium',
                    row.tone && TONES[row.tone],
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export default SpecSheet;

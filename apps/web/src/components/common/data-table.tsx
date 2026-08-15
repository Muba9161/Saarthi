import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@saarthi/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from './states';
import { motion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Table with the loading, empty, error and pagination states already handled,
 * so feature screens only describe their columns.
 */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Right-aligned, tabular figures — use for numbers and currency. */
  numeric?: boolean;
  className?: string;
  headerClassName?: string;
  /** Hidden below the `md` breakpoint to keep mobile tables readable. */
  hideOnMobile?: boolean;
}

/**
 * A table row that fades in on first render. The stagger is capped so a full
 * page of results still finishes revealing quickly.
 */
// framer-motion redefines the drag handlers, so the DOM ones are omitted here
// rather than fought with — the table never uses HTML5 drag.
type MotionRowProps = Omit<
  React.HTMLAttributes<HTMLTableRowElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
> & { index: number };

function MotionRow({ index, className, children, ...props }: MotionRowProps) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 12) * 0.02, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/50 data-[state=selected]:bg-primary/5',
        className,
      )}
      {...props}
    >
      {children}
    </motion.tr>
  );
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  onRowClick,
  pagination,
  onPageChange,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  className,
}: DataTableProps<T>) {
  if (error) {
    return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
  }

  if (isLoading && !rows) {
    return (
      <div className={cn('glass-panel glass-sheen overflow-hidden rounded-xl', className)}>
        <TableSkeleton columns={Math.min(columns.length, 6)} />
      </div>
    );
  }

  if (rows && rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDescription ? { description: emptyDescription } : {})}
        {...(emptyAction ? { action: emptyAction } : {})}
      />
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        className={cn(
          'glass-panel glass-sheen overflow-hidden rounded-xl',
          isLoading && 'opacity-60 transition-opacity',
        )}
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.numeric && 'text-right',
                    column.hideOnMobile && 'hidden md:table-cell',
                    column.headerClassName,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row, index) => (
              <MotionRow
                index={index}
                key={rowKey(row)}
                className={onRowClick ? 'cursor-pointer' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                {...(onRowClick
                  ? {
                      tabIndex: 0,
                      role: 'link',
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      },
                    }
                  : {})}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      column.numeric && 'tabular text-right',
                      column.hideOnMobile && 'hidden md:table-cell',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </MotionRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">
            Showing{' '}
            <span className="tabular font-medium text-foreground">
              {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.total)}
            </span>{' '}
            of <span className="tabular font-medium text-foreground">{pagination.total}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPreviousPage || isLoading}
              onClick={() => onPageChange?.(pagination.page - 1)}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="tabular text-xs text-muted-foreground">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNextPage || isLoading}
              onClick={() => onPageChange?.(pagination.page + 1)}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

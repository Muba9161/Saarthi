import * as React from 'react';
import { Columns3, LayoutGrid, Table as TableIcon } from 'lucide-react';
import type { PaginationMeta, ViewMode } from '@saarthi/shared';
import { DataTable, type Column } from './data-table';
import { EmptyState, ErrorState } from './states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewPreference } from '@/hooks/use-view-preference';
import { motion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * One list, two layouts.
 *
 * A table is right at a desk with a wide screen and forty rows to compare; a
 * card is right on a phone in a yard, where the same forty rows are unreadable
 * and the three facts that matter should be legible at arm's length. Rather
 * than making every screen implement both, a list describes its columns once
 * and this decides how to present them.
 *
 * A screen may supply its own `card` renderer when the card wants a shape a
 * table row cannot express — a photograph, a progress bar, a map thumbnail.
 * When it does not, the columns are rendered as label/value pairs, so adopting
 * this component is a one-line change and no list is left without a mobile
 * layout because nobody got round to designing one.
 */

interface DataViewProps<T> {
  /** Stable key the user's choice is remembered against, e.g. "fleet.vehicles". */
  surface: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  /** Custom card body. Falls back to the columns as label/value pairs. */
  card?: (row: T) => React.ReactNode;
  defaultView?: ViewMode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Rendered next to the view toggle — filters, a create button. */
  toolbar?: React.ReactNode;
  className?: string;
}

export function DataView<T>({
  surface,
  columns,
  rows,
  rowKey,
  card,
  defaultView = 'TABLE',
  isLoading,
  error,
  onRetry,
  onRowClick,
  pagination,
  onPageChange,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  toolbar,
  className,
}: DataViewProps<T>): React.ReactElement {
  const { viewMode, setViewMode, hiddenColumns, toggleColumn } = useViewPreference(
    surface,
    defaultView,
  );

  const visibleColumns = React.useMemo(
    () => columns.filter((column) => !hiddenColumns.includes(column.key)),
    [columns, hiddenColumns],
  );

  // Hiding every column would leave an empty grid with no way back, so the
  // table falls back to the full set rather than rendering nothing.
  const tableColumns = visibleColumns.length > 0 ? visibleColumns : columns;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="flex items-center gap-1.5">
          <ColumnPicker
            columns={columns}
            hiddenColumns={hiddenColumns}
            onToggle={toggleColumn}
            disabled={viewMode === 'CARDS'}
          />
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {viewMode === 'TABLE' ? (
        <DataTable
          columns={tableColumns}
          rows={rows}
          rowKey={rowKey}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          onRowClick={onRowClick}
          pagination={pagination}
          onPageChange={onPageChange}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          emptyAction={emptyAction}
        />
      ) : (
        <CardGrid
          columns={tableColumns}
          rows={rows}
          rowKey={rowKey}
          card={card}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          onRowClick={onRowClick}
          pagination={pagination}
          onPageChange={onPageChange}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          emptyAction={emptyAction}
        />
      )}
    </div>
  );
}

/** The toggle itself, exported so a screen can place it somewhere bespoke. */
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}): React.ReactElement {
  return (
    <div
      className="inline-flex rounded-lg border border-border p-0.5"
      role="group"
      aria-label="List layout"
    >
      <ToggleButton
        active={value === 'TABLE'}
        onClick={() => onChange('TABLE')}
        label="Table view"
        icon={TableIcon}
      />
      <ToggleButton
        active={value === 'CARDS'}
        onClick={() => onChange('CARDS')}
        label="Card view"
        icon={LayoutGrid}
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className={cn(
            'rounded-md p-1.5 transition-colors',
            active
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ColumnPicker<T>({
  columns,
  hiddenColumns,
  onToggle,
  disabled,
}: {
  columns: Column<T>[];
  hiddenColumns: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}): React.ReactElement | null {
  // Column visibility is a table concept. In card view the choice is meaningless
  // and the control is hidden rather than shown disabled and confusing.
  if (disabled) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Choose columns">
          <Columns3 className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={!hiddenColumns.includes(column.key)}
            onCheckedChange={() => onToggle(column.key)}
            onSelect={(event) => event.preventDefault()}
          >
            {typeof column.header === 'string' ? column.header : column.key}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface CardGridProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  card?: (row: T) => React.ReactNode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

function CardGrid<T>({
  columns,
  rows,
  rowKey,
  card,
  isLoading,
  error,
  onRetry,
  onRowClick,
  pagination,
  onPageChange,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: CardGridProps<T>): React.ReactElement {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  if (!rows || rows.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, index) => (
          <motion.div
            key={rowKey(row)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.22,
              delay: Math.min(index, 12) * 0.02,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <Card
              className={cn(
                'h-full p-4',
                onRowClick && 'cursor-pointer transition-colors hover:bg-secondary/40',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {card ? card(row) : <DefaultCardBody columns={columns} row={row} />}
            </Card>
          </motion.div>
        ))}
      </div>

      {pagination && pagination.totalPages > 1 && onPageChange ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Columns rendered as a card, when a screen has not written its own.
 *
 * The first column becomes the heading — it is the identifying one in every
 * table in this codebase — and the rest become labelled rows.
 */
function DefaultCardBody<T>({
  columns,
  row,
}: {
  columns: Column<T>[];
  row: T;
}): React.ReactElement {
  const [lead, ...rest] = columns;

  return (
    <div className="space-y-3">
      {lead ? <div className="min-w-0">{lead.cell(row)}</div> : null}
      {rest.length > 0 ? (
        <dl className="space-y-1.5 border-t border-border pt-3">
          {rest.map((column) => (
            <div key={column.key} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">
                {typeof column.header === 'string' ? column.header : column.key}
              </dt>
              <dd
                className={cn(
                  'min-w-0 truncate text-sm',
                  column.numeric && 'tabular-nums',
                )}
              >
                {column.cell(row)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export type { Column };

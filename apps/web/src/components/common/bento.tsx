import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stagger, StaggerItem } from '@/components/motion';
import { SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
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
 * order, because on anything narrower the only useful arrangement is the order
 * of importance, which is the order these are written in.
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
        // One column until the twelve arrive.
        //
        // There used to be a two-column band between `sm` and `lg`. It looked
        // like a compromise and behaved like one: a tile asking for eight of
        // twelve columns got half of a 700px screen, and a row whose spans did
        // not happen to pair up left a hole beside the odd tile out. Below
        // `lg` the content column is under 700px anyway, which is one useful
        // column of dashboard, so that is what it now is.
        'grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5',
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

// ---------------------------------------------------------------------------
// The tiles the reference boards are actually built from.
//
// A dashboard used to be assembled from whatever card happened to be nearest:
// eight metric panels, a brief panel, a chip row and five more panels, each one
// drawing its own edge and its own shadow. Fifteen floating planes is not a
// hierarchy — it is a list, and the eye has nothing to land on first.
//
// These four cover every arrangement the boards need. A board is then a hero,
// one metric tile and a handful of panels whose rows are quiet enough that the
// panel edge is the only line on the screen.
// ---------------------------------------------------------------------------

/**
 * How many figures sit across the strip.
 *
 * These are viewport breakpoints, not container ones, so a metric tile belongs
 * at `span={12}` — the full content width — where the two line up. The ladder
 * is the one the old free-standing metric row used, and it is a ladder rather
 * than a fixed count because a cell holds a label, a figure and an 84px
 * sparkline: below about 240px the label wraps to three lines and the figure
 * breaks mid-number. One column on a phone is not a fallback, it is the only
 * arrangement that fits.
 */
const METRIC_COLUMNS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
};

/**
 * One tile holding a row of figures, divided by hairlines rather than by air.
 *
 * Each cell is a `StatCard` in its bare mode, so a figure reads identically
 * whether it is shown here or on a card of its own — same animation, same
 * series, same tones. Only the surface differs.
 *
 * The negative margins are what let a ragged final row work: every cell draws a
 * right and bottom hairline, and the grid is pulled one pixel past the tile's
 * clipped edge so the outermost of those lines lands outside it. Five metrics
 * in a four-column grid therefore leave a clean empty cell rather than a stripe
 * of border colour.
 *
 * Keep this at `span={12}`. The cell count comes from viewport breakpoints, so
 * a narrower tile would be told to draw four columns in two thirds of the room
 * they need.
 */
export function BentoMetrics({
  span = 12,
  columns = 4,
  delay = 0,
  className,
  children,
}: {
  span?: Span;
  columns?: 2 | 3 | 4;
  /** Stagger offset, so a second strip does not animate in step with the first. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BentoTile span={span} className={className}>
      <Stagger
        delay={delay}
        className={cn(
          // `flex-1` so the cells fill the tile rather than leaving a band of
          // empty panel under them: this tile usually sits beside a hero that
          // is half as tall again, and grid distributes the spare height
          // across its auto rows.
          '-mb-px -mr-px grid flex-1',
          METRIC_COLUMNS[columns],
          '[&>*]:min-w-0 [&>*]:border-b [&>*]:border-r [&>*]:border-border/60',
        )}
      >
        {children}
      </Stagger>
    </BentoTile>
  );
}

/** A figure inside a `BentoMetrics` tile. Takes everything `StatCard` takes. */
export function BentoMetric(props: Omit<React.ComponentProps<typeof StatCard>, 'bare'>) {
  return (
    <StaggerItem className="h-full">
      <StatCard {...props} bare />
    </StaggerItem>
  );
}

/**
 * The board's opening tile: what this account is here to do, and the control
 * that starts it.
 *
 * A brand wash rather than a neutral panel, because it is the only tile on the
 * board that is an invitation rather than a reading, and an operator should be
 * able to find it without reading it. Everything it holds is optional — a board
 * with nothing to look up simply renders its action.
 */
export function BentoHero({
  span = 4,
  eyebrow,
  title,
  description,
  lookup,
  action,
  footer,
  className,
}: {
  span?: Span;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * A reference field.
   *
   * Present only where the account has something to look up: no board here
   * shows a search box over an endpoint that cannot answer it.
   */
  lookup?: {
    placeholder: string;
    /** Accessible name for the field — the tile's heading is not a label. */
    label: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    pending?: boolean;
    /** Matches, or a line saying there were none. Rendered under the field. */
    results?: React.ReactNode;
  };
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <BentoTile span={span} plain className={className}>
      <Card variant="gradient" className="flex h-full flex-col gap-4 rounded-xl p-5">
        <div className="space-y-1.5">
          {eyebrow ? <p className="section-label">{eyebrow}</p> : null}
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
          {description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {lookup ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              lookup.onSubmit();
            }}
          >
            {/*
              The submit sits inside the field rather than beside it. A hero is
              a third of the board, which at a laptop width is about 220px: a
              44px control taken off the side of that leaves a field too short
              to show a reference number while it is being typed.
            */}
            <div className="relative">
              <Input
                aria-label={lookup.label}
                placeholder={lookup.placeholder}
                value={lookup.value}
                onChange={(event) => lookup.onChange(event.target.value)}
                className="h-12 rounded-full bg-card/90 pl-4 pr-14"
              />
              <Button
                type="submit"
                size="icon"
                shape="pill"
                className="absolute right-1 top-1 size-10"
                loading={lookup.pending ?? false}
                disabled={lookup.value.trim().length === 0}
                aria-label={lookup.label}
              >
                <ArrowRight className="size-4" />
              </Button>
            </div>
            {lookup.results}
          </form>
        ) : null}

        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
        {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
      </Card>
    </BentoTile>
  );
}

const ROW_TONES = {
  default: 'bg-primary/10 text-primary ring-primary/15',
  success: 'bg-success/12 text-success ring-success/20',
  warning: 'bg-warning/14 text-warning ring-warning/20',
  destructive: 'bg-destructive/12 text-destructive ring-destructive/20',
  info: 'bg-info/12 text-info ring-info/20',
  accent: 'bg-accent/14 text-accent ring-accent/20',
  muted: 'bg-muted text-muted-foreground ring-border',
} as const;

/**
 * A line in a panel's list.
 *
 * Deliberately borderless. A panel holding five bordered rows is six nested
 * rectangles, which is most of what made these boards read as a filing
 * cabinet. The row here is carried by a tinted glyph on the left and a status
 * on the right, and the only drawn edge on the screen is the panel's own.
 */
export function BentoRow({
  to,
  onClick,
  icon: Icon,
  tone = 'default',
  title,
  subtitle,
  trailing,
  className,
}: {
  /** Renders the row as a link. Takes precedence over `onClick`. */
  to?: string;
  onClick?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof ROW_TONES;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Status, figure or both — whatever the row is answering. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {Icon ? (
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl ring-1',
            ROW_TONES[tone],
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-right">{trailing}</span>
      ) : null}
    </>
  );

  const shell = cn(
    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
    to !== undefined || onClick !== undefined ? 'hover:bg-muted/60' : undefined,
    className,
  );

  if (to !== undefined) {
    return (
      <Link to={to} className={shell}>
        {inner}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" onClick={onClick} className={shell}>
        {inner}
      </button>
    );
  }
  return <div className={shell}>{inner}</div>;
}

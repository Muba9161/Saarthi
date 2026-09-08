import * as React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AnimatedNumber, HoverLift } from '@/components/motion';
import { MiniChart, hasPlottableData, type MiniChartSpec } from '@/components/common/mini-chart';
import { cn } from '@/lib/utils';

/**
 * Metric tile.
 *
 * Every value here is computed by the API from database rows — the component
 * only animates toward it. Numbers count up so a change reads as movement
 * rather than a silent swap.
 *
 * The right-hand slot prefers a chart to an icon. An icon repeats what the
 * label already says; a fortnight of the same figure says whether the number
 * is climbing, and that is the question an operator actually opens the board
 * to answer. Pass `chart` and the tile plots it; pass only `icon` and the tile
 * is exactly what it was, so no existing call site changes behaviour.
 */
export function StatCard({
  label,
  value,
  numericValue,
  format,
  hint,
  icon: Icon,
  chart,
  trend,
  tone = 'default',
  onClick,
  className,
  live,
}: {
  label: string;
  /** Rendered directly when `numericValue` is not supplied. */
  value?: React.ReactNode;
  /** Supply this (with `format`) to animate the figure. */
  numericValue?: number;
  format?: (value: number) => string;
  hint?: React.ReactNode;
  /** Drawn only when no `chart` is supplied. */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Real figures to plot in the icon's place.
   *
   * Never synthesised: a series comes from the same API response as the value
   * above it, so the curve and the number cannot disagree.
   */
  chart?: MiniChartSpec;
  /** Percentage change against the comparison period. */
  trend?: { value: number; label?: string; goodDirection?: 'up' | 'down' };
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'accent';
  onClick?: () => void;
  className?: string;
  /** Shows a pulsing dot — the figure is updating in realtime. */
  live?: boolean;
}) {
  const valueTones = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info',
    accent: 'text-accent',
  } as const;

  const iconTones = {
    default: 'bg-primary/10 text-primary ring-primary/15',
    success: 'bg-success/12 text-success ring-success/20',
    warning: 'bg-warning/14 text-warning ring-warning/20',
    destructive: 'bg-destructive/12 text-destructive ring-destructive/20',
    info: 'bg-info/12 text-info ring-info/20',
    accent: 'bg-accent/14 text-accent ring-accent/20',
  } as const;

  const goodDirection = trend?.goodDirection ?? 'up';
  const isFlat = trend !== undefined && Math.abs(trend.value) < 0.5;
  const isGood =
    trend === undefined || isFlat
      ? null
      : goodDirection === 'up'
        ? trend.value > 0
        : trend.value < 0;
  const TrendIcon = isFlat ? ArrowRight : (trend?.value ?? 0) > 0 ? ArrowUpRight : ArrowDownRight;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <HoverLift disabled={!onClick} className={cn('h-full', className)}>
      <Card
        variant="glass"
        className={cn('h-full rounded-2xl p-5 sm:p-6', onClick && 'cursor-pointer')}
      >
        <Wrapper
          {...(onClick ? { type: 'button' as const, onClick } : {})}
          className="flex h-full w-full items-center justify-between gap-3 text-left sm:gap-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <p className="section-label flex items-center gap-1.5">
              {label}
              {live ? <span className="live-dot" aria-label="Updating live" /> : null}
            </p>

            <p
              className={cn(
                'tabular text-[1.75rem] font-semibold leading-none tracking-[-0.03em] sm:text-[2rem]',
                'break-words',
                valueTones[tone],
              )}
            >
              {numericValue !== undefined ? (
                <AnimatedNumber value={numericValue} {...(format ? { format } : {})} />
              ) : (
                value
              )}
            </p>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {trend !== undefined ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium',
                    isGood === null
                      ? 'bg-muted text-muted-foreground'
                      : isGood
                        ? 'bg-success/10 text-success'
                        : 'bg-destructive/10 text-destructive',
                  )}
                >
                  <TrendIcon className="size-3" />
                  {Math.abs(trend.value).toFixed(1)}%
                </span>
              ) : null}
              {trend?.label ? <span>{trend.label}</span> : null}
              {hint ? <span className="truncate">{hint}</span> : null}
            </div>
          </div>

          {chart && hasPlottableData(chart) ? (
            <span className="shrink-0 self-center">
              <MiniChart spec={chart} tone={tone} />
            </span>
          ) : Icon ? (
            <span className={cn('shrink-0 rounded-2xl p-3 ring-1', iconTones[tone])}>
              <Icon className="size-5" />
            </span>
          ) : null}
        </Wrapper>
      </Card>
    </HoverLift>
  );
}

/** Compact variant for dense secondary rows. */
export function MiniStat({
  label,
  value,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  className?: string;
}) {
  const tones = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  } as const;

  return (
    <div className={cn('min-w-0 space-y-0.5', className)}>
      <p className="section-label flex items-center gap-1">
        {Icon ? <Icon className="size-3" /> : null}
        {label}
      </p>
      <p className={cn('tabular text-sm font-semibold', tones[tone])}>{value}</p>
    </div>
  );
}

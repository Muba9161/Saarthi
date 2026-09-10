import * as React from 'react';
import { useReducedMotion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Small charts for metric tiles.
 *
 * These sit where a decorative icon used to sit, so they must earn the space:
 * every one of them plots figures the API computed from real rows. Nothing is
 * smoothed, padded or invented to make a nicer curve — a flat line means a
 * quiet fortnight, and a card with no series at all keeps its icon rather than
 * drawing a shape that implies history the organization does not have.
 *
 * Hand-rolled SVG rather than recharts. Recharts earns its weight on the
 * analytics screens, where axes, legends and shared tooltips matter; at
 * 84 x 44 it brings a wrapper, a resize observer and a popover tooltip per
 * card, and a command centre renders eight of them above the fold. These draw
 * one path from a memoised point list and read colour straight from the theme
 * tokens, so light and dark need no second palette.
 */

export type ChartTone = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'accent';

/** Stroke/fill colour per tone, as an HSL triplet from the theme. */
const TONE_VAR: Record<ChartTone, string> = {
  default: '--primary',
  success: '--success',
  warning: '--warning',
  destructive: '--destructive',
  info: '--info',
  accent: '--accent',
};

function toneColor(tone: ChartTone, alpha = 1): string {
  return alpha >= 1 ? `hsl(var(${TONE_VAR[tone]}))` : `hsl(var(${TONE_VAR[tone]}) / ${alpha})`;
}

/** A point on a mini series. `label` is what the tooltip says about it. */
export interface SeriesPoint {
  label: string;
  value: number;
}

/** What a tile draws in place of its icon. */
export type MiniChartSpec =
  /** Movement over time — cumulative or continuous figures. */
  | { kind: 'area'; points: SeriesPoint[]; format?: (value: number) => string; domainMax?: number }
  /** Discrete per-period counts, where each bucket is a countable thing. */
  | { kind: 'bars'; points: SeriesPoint[]; format?: (value: number) => string }
  /** How a total splits right now. Needs no history. */
  | { kind: 'split'; segments: { label: string; value: number; tone: ChartTone }[] }
  /** A share of a whole, as a ring. */
  | { kind: 'gauge'; percent: number; caption?: string };

const WIDTH = 84;
const HEIGHT = 44;

/**
 * Whether a spec has anything to draw at all.
 *
 * An all-zero series *is* plottable and is drawn — a new organization gets an
 * honest flat line on the baseline, which keeps a row of tiles the same shape
 * without claiming movement that did not happen. An *empty* series is a
 * different thing: the API sent no history, and the tile falls back to its
 * icon rather than leaving a hole where a chart should be.
 */
export function hasPlottableData(spec: MiniChartSpec): boolean {
  switch (spec.kind) {
    case 'area':
    case 'bars':
      return spec.points.length > 0;
    case 'split':
      return spec.segments.length > 0;
    case 'gauge':
      return Number.isFinite(spec.percent);
    default:
      return false;
  }
}

/** Index of the point nearest a pointer position across the plot width. */
function pointIndexAt(clientX: number, element: SVGSVGElement, count: number): number {
  const box = element.getBoundingClientRect();
  if (box.width === 0 || count === 0) return 0;
  const ratio = (clientX - box.left) / box.width;
  return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
}

/**
 * Tooltip shown against the hovered bucket.
 *
 * Straddles the top edge of the plot rather than floating clear above it: the
 * glass card these tiles live in clips its overflow, and a tip that escaped
 * upwards would be sliced off on the shorter cards. Half in, half out keeps it
 * inside the card on every tile while leaving most of the chart visible.
 *
 * Kept out of the SVG so it is not scaled by the viewBox and can use the app's
 * own type styles. The horizontal anchor is clamped so a tip on the first or
 * last bucket does not run past the card's edge either.
 */
function ChartTip({ text, xPercent }: { text: string; xPercent: number }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute top-0 z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap',
        'rounded-md border border-border bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground',
        'shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.25)]',
      )}
      style={{ left: `${Math.min(88, Math.max(12, xPercent))}%` }}
    >
      {text}
    </span>
  );
}

/**
 * Filled line chart.
 *
 * The baseline is the series minimum floored at zero, so a fortnight that
 * never dips to nothing still reads as a level line rather than a fake climb
 * out of the axis.
 */
export function MiniArea({
  points,
  tone = 'default',
  format,
  domainMax,
  className,
  ariaLabel,
}: {
  points: SeriesPoint[];
  tone?: ChartTone;
  format?: (value: number) => string;
  /** Fixes the top of the scale — use 100 for a percentage series. */
  domainMax?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState<number | null>(null);
  const gradientId = React.useId();

  const geometry = React.useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((point) => point.value);
    const min = Math.min(0, ...values);
    const max = domainMax ?? Math.max(...values);
    // A flat series has no range to scale against; pin it to the baseline
    // rather than dividing by zero and drawing a line through the middle.
    const span = max - min;
    const stepX = points.length > 1 ? WIDTH / (points.length - 1) : 0;

    const coordinates = points.map((point, index) => {
      const x = points.length > 1 ? index * stepX : WIDTH / 2;
      // Clamped to the plot: a fixed domain can be overshot — a utilisation
      // figure rounding to 101 — and an unclamped point would be drawn outside
      // the box rather than at the ceiling it actually hit.
      const ratio = span > 0 ? Math.min(1, Math.max(0, (point.value - min) / span)) : 0;
      const y = span > 0 ? HEIGHT - 2 - ratio * (HEIGHT - 6) : HEIGHT - 2;
      return { x, y };
    });

    const line = coordinates
      .map(
        (coordinate, index) =>
          `${index === 0 ? 'M' : 'L'}${coordinate.x.toFixed(2)},${coordinate.y.toFixed(2)}`,
      )
      .join(' ');
    const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;

    return { coordinates, line, area, last: coordinates[coordinates.length - 1] };
  }, [points, domainMax]);

  if (!geometry || !geometry.last) return null;

  const activePoint = active !== null ? points[active] : undefined;
  const activeCoordinate = active !== null ? geometry.coordinates[active] : undefined;
  const describe = (point: SeriesPoint): string =>
    `${point.label}: ${format ? format(point.value) : point.value}`;

  return (
    <div className={cn('relative', className)}>
      {activePoint ? (
        <ChartTip
          text={describe(activePoint)}
          xPercent={((activeCoordinate?.x ?? 0) / WIDTH) * 100}
        />
      ) : null}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel ?? `Trend: ${points.map(describe).join(', ')}`}
        className="block h-11 w-[84px] overflow-visible"
        onPointerMove={(event) =>
          setActive(pointIndexAt(event.clientX, event.currentTarget, points.length))
        }
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={toneColor(tone, 0.35)} />
            <stop offset="100%" stopColor={toneColor(tone, 0)} />
          </linearGradient>
        </defs>

        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={toneColor(tone)}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={reduced ? undefined : 'mini-chart-draw'}
        />

        {/* The head of the series — where the metric stands today. */}
        <circle
          cx={geometry.last.x}
          cy={geometry.last.y}
          r={2}
          fill={toneColor(tone)}
          stroke="hsl(var(--card))"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />

        {activeCoordinate ? (
          <>
            <line
              x1={activeCoordinate.x}
              y1={0}
              x2={activeCoordinate.x}
              y2={HEIGHT}
              stroke={toneColor(tone, 0.45)}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={activeCoordinate.x}
              cy={activeCoordinate.y}
              r={2.5}
              fill={toneColor(tone)}
              stroke="hsl(var(--card))"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}

/**
 * Column chart for per-period counts.
 *
 * A zero bucket still draws a hairline at the baseline, so "no trips on
 * Sunday" is visible as a gap in a run of bars rather than as absent data.
 */
export function MiniBars({
  points,
  tone = 'default',
  format,
  className,
  ariaLabel,
}: {
  points: SeriesPoint[];
  tone?: ChartTone;
  format?: (value: number) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);

  const bars = React.useMemo(() => {
    if (points.length === 0) return [];
    const max = Math.max(...points.map((point) => point.value));
    const slot = WIDTH / points.length;
    const barWidth = Math.max(1.5, slot * 0.62);

    return points.map((point, index) => {
      const height = max > 0 ? Math.max(1, (point.value / max) * (HEIGHT - 6)) : 1;
      return {
        x: index * slot + (slot - barWidth) / 2,
        y: HEIGHT - height,
        width: barWidth,
        height,
        point,
      };
    });
  }, [points]);

  if (bars.length === 0) return null;

  const activeBar = active !== null ? bars[active] : undefined;
  const describe = (point: SeriesPoint): string =>
    `${point.label}: ${format ? format(point.value) : point.value}`;

  return (
    <div className={cn('relative', className)}>
      {activeBar ? (
        <ChartTip
          text={describe(activeBar.point)}
          xPercent={((activeBar.x + activeBar.width / 2) / WIDTH) * 100}
        />
      ) : null}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel ?? `Trend: ${points.map(describe).join(', ')}`}
        className="block h-11 w-[84px] overflow-visible"
        onPointerMove={(event) =>
          setActive(pointIndexAt(event.clientX, event.currentTarget, points.length))
        }
        onPointerLeave={() => setActive(null)}
      >
        {bars.map((bar, index) => (
          <rect
            key={bar.point.label}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={0.9}
            fill={toneColor(tone, index === active ? 1 : index === bars.length - 1 ? 0.95 : 0.5)}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * How a total divides right now.
 *
 * Drawn for stock figures — a fleet by status, documents by validity — where
 * there is no series to plot but the composition is the whole story. Segments
 * that are zero are dropped rather than drawn as slivers.
 */
export function MiniSplit({
  segments,
  className,
  ariaLabel,
}: {
  segments: { label: string; value: number; tone: ChartTone }[];
  className?: string;
  ariaLabel?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);

  const present = segments.filter((segment) => segment.value > 0);
  const total = present.reduce((sum, segment) => sum + segment.value, 0);

  const describe = (segment: { label: string; value: number }): string =>
    `${segment.label}: ${segment.value}${total > 0 ? ` (${Math.round((segment.value / total) * 100)}%)` : ''}`;

  // Nothing recorded yet — an empty track, not a fabricated split.
  if (total === 0) {
    return (
      <div className={cn('relative flex h-11 w-[84px] items-center', className)}>
        <span
          className="h-2 w-full rounded-full bg-muted"
          role="img"
          aria-label={ariaLabel ?? 'Nothing recorded yet'}
        />
      </div>
    );
  }

  return (
    <div
      className={cn('relative flex h-11 w-[84px] flex-col justify-center gap-1.5', className)}
      onPointerLeave={() => setActive(null)}
    >
      {active !== null && present[active] ? (
        <ChartTip text={describe(present[active])} xPercent={50} />
      ) : null}

      <div
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={ariaLabel ?? present.map(describe).join(', ')}
      >
        {present.map((segment, index) => (
          <span
            key={segment.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: toneColor(segment.tone, index === active ? 1 : 0.8),
            }}
            onPointerEnter={() => setActive(index)}
          />
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-x-1.5 gap-y-0.5">
        {present.slice(0, 3).map((segment) => (
          <span key={segment.label} className="flex items-center gap-[3px]">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: toneColor(segment.tone) }}
            />
            <span className="tabular text-[9px] leading-none text-muted-foreground">
              {segment.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A share of a whole, as a ring.
 *
 * Used where the metric *is* a percentage — utilisation, a driver's score, how
 * far a loan has been repaid — because a ring reads as "out of 100" in a way a
 * two-week line does not.
 */
export function MiniGauge({
  percent,
  tone = 'default',
  caption,
  className,
  ariaLabel,
}: {
  percent: number;
  tone?: ChartTone;
  caption?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const radius = 15;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={cn('relative flex h-11 w-[84px] items-center justify-end', className)}>
      <svg
        viewBox="0 0 40 40"
        width={40}
        height={40}
        role="img"
        aria-label={ariaLabel ?? `${Math.round(clamped)} percent${caption ? ` - ${caption}` : ''}`}
        className="block size-11"
      >
        <circle cx={20} cy={20} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={4} />
        <circle
          cx={20}
          cy={20}
          r={radius}
          fill="none"
          stroke={toneColor(tone)}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          transform="rotate(-90 20 20)"
          style={reduced ? undefined : { transition: 'stroke-dasharray 700ms ease-out' }}
        />
        <text
          x={20}
          y={20}
          textAnchor="middle"
          dominantBaseline="central"
          className="tabular fill-foreground text-[11px] font-semibold"
        >
          {Math.round(clamped)}
        </text>
      </svg>
    </div>
  );
}

/** Renders whichever chart a tile asked for. */
export function MiniChart({
  spec,
  tone = 'default',
  className,
}: {
  spec: MiniChartSpec;
  tone?: ChartTone;
  className?: string;
}) {
  switch (spec.kind) {
    case 'area':
      return (
        <MiniArea
          points={spec.points}
          tone={tone}
          {...(spec.format ? { format: spec.format } : {})}
          {...(spec.domainMax !== undefined ? { domainMax: spec.domainMax } : {})}
          {...(className ? { className } : {})}
        />
      );
    case 'bars':
      return (
        <MiniBars
          points={spec.points}
          tone={tone}
          {...(spec.format ? { format: spec.format } : {})}
          {...(className ? { className } : {})}
        />
      );
    case 'split':
      return <MiniSplit segments={spec.segments} {...(className ? { className } : {})} />;
    case 'gauge':
      return (
        <MiniGauge
          percent={spec.percent}
          tone={tone}
          {...(spec.caption ? { caption: spec.caption } : {})}
          {...(className ? { className } : {})}
        />
      );
    default:
      return null;
  }
}

/**
 * Turns a dated series from the API into tooltip-ready points.
 *
 * Buckets arrive as `YYYY-MM-DD` for daily and weekly series and `YYYY-MM` for
 * monthly ones, so the label is chosen from the key's own shape. Nothing is
 * re-bucketed or interpolated on the way through — the tile plots exactly the
 * points the API sent.
 */
export function toSeriesPoints(entries: readonly { date: string; value: number }[]): SeriesPoint[] {
  return entries.map((entry) => {
    const monthly = entry.date.length === 7;
    const parsed = new Date(`${entry.date}${monthly ? '-01' : ''}T00:00:00Z`);
    const label = Number.isNaN(parsed.getTime())
      ? entry.date
      : parsed.toLocaleDateString('en-IN', {
          ...(monthly ? { year: 'numeric' } : { day: 'numeric' }),
          month: 'short',
          timeZone: 'UTC',
        });
    return { label, value: entry.value };
  });
}

import * as React from 'react';
import { useReducedMotion } from '@/components/motion';
import { toneColor, type ChartTone } from '@/components/common/mini-chart';
import { Badge } from '@/components/ui/badge';

/**
 * One instrument on the telemetry panel — a 270° dial, like the cluster in a cab.
 *
 * A dial is only drawn for a figure the reading actually carries; the caller
 * decides that. What this component guarantees is that an invented value never
 * looks like a measured one: a simulated figure is drawn muted and labelled,
 * and it never takes a warning colour, because the colour is a claim about the
 * vehicle and a simulator has no standing to make it.
 */

/** A coloured band on the scale, e.g. the overspeed range. */
export interface DialZone {
  from: number;
  /** Omitted: the band runs to the end of the scale, however far it extends. */
  to?: number;
  tone: Extract<ChartTone, 'warning' | 'destructive'>;
}

export interface TelemetryDialProps {
  label: string;
  value: number | null;
  unit: string;
  min: number;
  /** Nominal top of the scale. Extended by `step` when a reading goes past it. */
  max: number;
  step: number;
  zones?: DialZone[];
  simulated?: boolean;
  /** Decimal places shown in the centre. */
  precision?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

const CENTER = 60;
const RADIUS = 46;
const SWEEP_DEGREES = 270;
/** The arc opens at the bottom: it starts bottom-left and ends bottom-right. */
const START_DEGREES = 135;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_LENGTH = CIRCUMFERENCE * (SWEEP_DEGREES / 360);
const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** A stretch of the arc, as a dash pattern on a circle rotated to the start. */
function arcDash(fromFraction: number, toFraction: number): string {
  const start = Math.max(0, fromFraction) * ARC_LENGTH;
  const length = Math.max(0, Math.min(1, toFraction) - Math.max(0, fromFraction)) * ARC_LENGTH;
  return `0 ${start} ${length} ${CIRCUMFERENCE}`;
}

function pointAt(fraction: number, radius: number): { x: number; y: number } {
  const radians = ((START_DEGREES + SWEEP_DEGREES * fraction) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

export function TelemetryDial({
  label,
  value,
  unit,
  min,
  max,
  step,
  zones = [],
  simulated = false,
  precision = 0,
  icon: Icon,
}: TelemetryDialProps) {
  const reduced = useReducedMotion();
  const hasValue = value !== null && Number.isFinite(value);

  // A reading past the printed scale widens it rather than pinning the needle,
  // so 150 km/h is never drawn as if it were the 140 at the end of the dial.
  const top = hasValue && value > max ? Math.ceil(value / step) * step : max;
  const span = top - min;
  const toFraction = (figure: number) => Math.min(1, Math.max(0, (figure - min) / span));
  const fraction = hasValue ? toFraction(value) : 0;

  const zone =
    hasValue && !simulated
      ? zones.find((z) => value >= z.from && value <= (z.to ?? top))
      : undefined;
  const valueColor = simulated
    ? 'hsl(var(--muted-foreground))'
    : zone
      ? toneColor(zone.tone)
      : toneColor('default');

  const shown = hasValue ? value.toFixed(precision) : null;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={top}
      aria-valuenow={hasValue ? value : undefined}
      aria-valuetext={
        shown === null ? 'No reading' : `${shown} ${unit}${simulated ? ', simulated' : ''}`
      }
      className="flex flex-col rounded-lg border border-border p-3"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
          <span className="truncate">{label}</span>
        </span>
        {simulated ? (
          <Badge variant="warning" size="sm">
            Simulated
          </Badge>
        ) : null}
      </div>

      <svg viewBox="0 0 120 106" className="mx-auto mt-1 block w-full max-w-[168px]" aria-hidden>
        <g transform={`rotate(${START_DEGREES} ${CENTER} ${CENTER})`}>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={arcDash(0, 1)}
          />
          {zones.map((band) => (
            <circle
              key={`${band.from}-${band.to}`}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={toneColor(band.tone, 0.28)}
              strokeWidth={8}
              strokeDasharray={arcDash(toFraction(band.from), toFraction(band.to ?? top))}
            />
          ))}
          {hasValue ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={valueColor}
              strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={`${fraction * ARC_LENGTH} ${CIRCUMFERENCE}`}
              opacity={simulated ? 0.6 : 1}
              style={reduced ? undefined : { transition: 'stroke-dasharray 600ms ease-out' }}
            />
          ) : null}
        </g>

        {TICKS.map((tick) => {
          const inner = pointAt(tick, RADIUS + 7);
          const outer = pointAt(tick, RADIUS + 11);
          return (
            <line
              key={tick}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="hsl(var(--border))"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}

        {hasValue ? (
          <g
            style={{
              transform: `rotate(${START_DEGREES + SWEEP_DEGREES * fraction}deg)`,
              transformOrigin: `${CENTER}px ${CENTER}px`,
              transition: reduced ? undefined : 'transform 600ms ease-out',
            }}
          >
            <circle
              cx={CENTER + RADIUS}
              cy={CENTER}
              r={5.5}
              fill="hsl(var(--card))"
              stroke={valueColor}
              strokeWidth={2.5}
            />
          </g>
        ) : null}

        <text
          x={CENTER}
          y={CENTER - 2}
          textAnchor="middle"
          dominantBaseline="central"
          className={
            shown === null
              ? 'fill-muted-foreground text-[11px]'
              : simulated
                ? 'tabular fill-muted-foreground text-[22px] font-semibold'
                : 'tabular fill-foreground text-[22px] font-semibold'
          }
        >
          {shown ?? 'No reading'}
        </text>
        {shown !== null ? (
          <text
            x={CENTER}
            y={CENTER + 17}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {unit}
          </text>
        ) : null}
        <text
          x={pointAt(0, RADIUS).x}
          y={102}
          textAnchor="middle"
          className="tabular fill-muted-foreground text-[8px]"
        >
          {min}
        </text>
        <text
          x={pointAt(1, RADIUS).x}
          y={102}
          textAnchor="middle"
          className="tabular fill-muted-foreground text-[8px]"
        >
          {top}
        </text>
      </svg>
    </div>
  );
}

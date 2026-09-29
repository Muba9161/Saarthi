import * as React from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * One figure from a reading that is not worth a dial — a heading, an odometer.
 *
 * A metric the vehicle does not report shows "Not reported" rather than its
 * zero value: "0 °C coolant" and "this vehicle has no coolant sensor on the bus"
 * would send a mechanic looking for entirely different things.
 */
export function MetricTile({
  label,
  value,
  unit,
  icon: Icon,
  available,
  simulated = false,
  tone,
}: {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  /** False when this vehicle does not report the metric at all. */
  available: boolean;
  /**
   * True when this particular figure was invented rather than measured.
   *
   * Per metric, not per reading. A phone paired to a vehicle sends a real
   * position and a simulated RPM in the same frame, so a row-level flag would
   * either brand the position as fake or present the RPM as real.
   */
  simulated?: boolean;
  tone?: 'warning' | 'destructive';
}) {
  // A made-up 112 °C must not be painted like a real overheating engine. The
  // colour is a claim about the vehicle, and a simulator has no standing to
  // make it.
  const effectiveTone = simulated ? undefined : tone;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {!available ? (
        <p className="mt-1 text-sm text-muted-foreground">Not reported</p>
      ) : value === null ? (
        <p className="mt-1 text-sm text-muted-foreground">No reading</p>
      ) : (
        <>
          <p
            className={
              effectiveTone === 'destructive'
                ? 'mt-1 text-xl font-semibold text-destructive'
                : effectiveTone === 'warning'
                  ? 'mt-1 text-xl font-semibold text-warning'
                  : simulated
                    ? 'mt-1 text-xl font-semibold text-muted-foreground'
                    : 'mt-1 text-xl font-semibold'
            }
          >
            {Math.round(value * 10) / 10}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
          </p>
          {simulated ? (
            <Badge variant="warning" size="sm" className="mt-1">
              Simulated
            </Badge>
          ) : null}
        </>
      )}
    </div>
  );
}

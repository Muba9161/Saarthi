import * as React from 'react';
import { TrackRouteState } from '@saarthi/shared';
import { cn } from '@/lib/utils';
import { TRAIL_CASING_COLOUR, TRAIL_COLOURS } from './map-config';

/**
 * Key to the covered-path colours.
 *
 * Every colour is named in words beside its swatch. Red against green is the
 * pair colour-blind eyes confuse most, and a deviation is exactly the thing an
 * operator cannot afford to misread.
 */

const ENTRIES: readonly { state: TrackRouteState; label: string }[] = [
  { state: TrackRouteState.NO_TRIP, label: 'No trip' },
  { state: TrackRouteState.ON_ROUTE, label: 'On route' },
  { state: TrackRouteState.OFF_ROUTE, label: 'Off route' },
  { state: TrackRouteState.ALTERNATE, label: 'Other road (Google Maps)' },
];

export function TrailLegend({ className }: { className?: string }) {
  const headingId = React.useId();

  return (
    <div className={cn('glass rounded-md px-2.5 py-2 shadow-lifted', className)}>
      <p id={headingId} className="section-label">
        Path
      </p>
      <ul aria-labelledby={headingId} className="mt-1 space-y-0.5">
        {ENTRIES.map((entry) => (
          <li key={entry.state} className="flex items-center gap-2 text-2xs font-medium">
            {/* A short line, not a dot: it stands for a line on the map. */}
            <span
              aria-hidden
              className="h-1 w-4 shrink-0 rounded-full"
              style={{
                backgroundColor: TRAIL_COLOURS[entry.state],
                boxShadow: `0 0 0 1px ${TRAIL_CASING_COLOUR}`,
              }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

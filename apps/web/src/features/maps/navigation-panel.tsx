import * as React from 'react';
import { ChevronDown, ChevronRight, Gauge, Route, RotateCw, TriangleAlert } from 'lucide-react';
import { formatDistanceKm } from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ManeuverIcon } from './maneuver-icon';
import type { NavigationState } from './use-navigation';
import { formatEtaClock, formatEtaDuration, formatManeuverDistance } from './route-progress';

/**
 * Turn-by-turn guidance panel.
 *
 * The hierarchy matches how a driver reads a navigation screen: the next
 * manoeuvre dominates, the one after it is a small preview, and the ETA row sits
 * underneath. Everything else — the full step list, the alternatives — is
 * collapsed until asked for, so the panel never covers the road ahead.
 *
 * One subtlety that decides whether the banner is right or useless. The router
 * emits an instruction at the *start* of each step, so the step being driven
 * carries the turn already taken. The manoeuvre a driver needs is therefore the
 * *next* step's instruction, paired with the distance left on the current one —
 * "in 400 m, turn slight left". Pairing a step's own instruction with the
 * distance to its end reads as a banner that never changes.
 */

export interface NavigationPanelProps {
  state: NavigationState;
  /** Drops the step list and alternatives; for small map tiles. */
  compact?: boolean;
  /** Current ground speed, shown beside the ETA when known. */
  speedKph?: number | null;
  /** Open the full step list straight away — used in fullscreen. */
  defaultExpanded?: boolean;
  className?: string;
}

export function NavigationPanel({
  state,
  compact = false,
  speedKph = null,
  defaultExpanded = false,
  className,
}: NavigationPanelProps) {
  const { route, progress, routes, selectedRouteIndex, selectRoute, error, isLoading } = state;
  const [showSteps, setShowSteps] = React.useState(defaultExpanded);

  // Entering fullscreen opens the list; leaving it closes it again, so the
  // small panel never comes back covering half the map.
  React.useEffect(() => {
    setShowSteps(defaultExpanded);
  }, [defaultExpanded]);

  if (!state.configured) return null;

  if (isLoading) {
    return (
      <div className={cn('glass rounded-xl p-3.5', className)}>
        <div className="flex items-center gap-2.5">
          <Route className="size-4 animate-pulse text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Calculating route…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('glass rounded-xl p-3.5', className)}>
        <div className="flex items-start gap-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium">Route unavailable</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
            {error.code !== 'MISSING_TOKEN' ? (
              <Button size="sm" variant="outline" onClick={state.recalculate}>
                <RotateCw className="size-3.5" />
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!route) return null;

  const steps = route.legs.flatMap((leg) => leg.steps);
  const activeIndex = progress?.activeStepIndex ?? 0;
  const activeStep = progress?.activeStep ?? steps[0] ?? null;

  /**
   * The manoeuvre the banner announces: the instruction that comes into force
   * at the end of the step being driven. On the final step there is no next
   * instruction, so the step's own arrival text is the right thing to show.
   */
  const bannerIndex = steps[activeIndex + 1] ? activeIndex + 1 : activeIndex;
  const bannerStep = steps[bannerIndex] ?? activeStep;
  const followingStep = steps[bannerIndex + 1] ?? null;
  const upcoming = steps.slice(bannerIndex);

  /** Distance left before the banner's manoeuvre. */
  const distanceToBanner =
    progress?.distanceToManeuverMeters ?? activeStep?.distanceMeters ?? route.distanceMeters;

  const remainingMeters = progress?.remainingMeters ?? route.distanceMeters;
  const remainingSeconds = progress?.remainingSeconds ?? route.durationSeconds;
  const eta = progress?.etaEpochMs ?? Date.now() + route.durationSeconds * 1000;
  const showSpeed = typeof speedKph === 'number' && Number.isFinite(speedKph) && speedKph >= 0;

  return (
    <div className={cn('glass overflow-hidden rounded-xl', className)}>
      {/* --- Off-route / rerouting notice ---------------------------------- */}
      {state.isRerouting ? (
        <div className="flex items-center gap-2 bg-warning/15 px-3.5 py-2 text-xs font-medium text-warning">
          <RotateCw className="size-3.5 animate-spin" />
          Recalculating route…
        </div>
      ) : progress?.isOffRoute ? (
        <div className="flex items-center gap-2 bg-warning/15 px-3.5 py-2 text-xs font-medium text-warning">
          <TriangleAlert className="size-3.5" />
          {Math.round(progress.offRouteMeters)} m off the planned route
        </div>
      ) : null}

      {/* --- Active manoeuvre --------------------------------------------- */}
      {progress?.arrived ? (
        <div className="flex items-center gap-3 p-3.5">
          <ManeuverIcon
            emphasis
            maneuver={{
              type: 'arrive',
              modifier: null,
              instruction: 'Arrived',
              location: { latitude: 0, longitude: 0 },
              bearingBefore: 0,
              bearingAfter: 0,
              exit: null,
            }}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Arrived at destination</p>
            <p className="text-xs text-muted-foreground">{route.summary || 'Trip complete'}</p>
          </div>
        </div>
      ) : bannerStep ? (
        <div className="p-3.5">
          <div className="flex items-start gap-3">
            <ManeuverIcon emphasis maneuver={bannerStep.maneuver} />
            <div className="min-w-0 flex-1">
              <p className="tabular text-lg font-semibold leading-tight">
                {formatManeuverDistance(distanceToBanner)}
              </p>
              <p className="truncate text-sm leading-snug" title={bannerStep.instruction}>
                {bannerStep.instruction}
              </p>
              {/* The road being driven now, which is what a driver checks the
                  banner against — the manoeuvre alone does not locate them. */}
              {activeStep && activeStep.name !== 'Unnamed road' ? (
                <p className="truncate text-xs text-muted-foreground" title={activeStep.name}>
                  on {activeStep.ref ? `${activeStep.ref} · ` : ''}
                  {activeStep.name}
                </p>
              ) : null}
            </div>
          </div>

          {followingStep ? (
            <div className="mt-2.5 flex items-center gap-2 border-t border-border/70 pt-2.5">
              <span className="section-label shrink-0">Then</span>
              <ManeuverIcon maneuver={followingStep.maneuver} className="size-6 [&_svg]:size-3.5" />
              <p className="truncate text-xs text-muted-foreground" title={followingStep.instruction}>
                {followingStep.instruction}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- ETA ---------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 border-t border-border/70 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div>
            <p className="section-label">Arrive</p>
            <p className="tabular text-sm font-semibold">{formatEtaClock(eta)}</p>
          </div>
          <div>
            <p className="section-label">Time</p>
            <p className="tabular text-sm font-semibold">{formatEtaDuration(remainingSeconds)}</p>
          </div>
          <div>
            <p className="section-label">Left</p>
            <p className="tabular text-sm font-semibold">
              {formatDistanceKm(remainingMeters / 1000)}
            </p>
          </div>
          {/* Shown only when a speed is actually known. A stationary vehicle
              reads 0, which is true; a device that publishes no speed at all
              shows nothing rather than an invented figure. */}
          {showSpeed ? (
            <div>
              <p className="section-label">Speed</p>
              <p className="tabular flex items-center gap-1 text-sm font-semibold">
                <Gauge className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {Math.round(speedKph)}
                <span className="text-2xs font-normal text-muted-foreground">km/h</span>
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {route.profile === 'driving-hgv' ? (
            <Badge variant="secondary" size="sm" title="Routed for a heavy goods vehicle">
              Truck route
            </Badge>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={state.recalculate}
            title="Recalculate route"
            aria-label="Recalculate route"
          >
            <RotateCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {compact ? null : (
        <>
          {/* --- Alternatives --------------------------------------------- */}
          {routes.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-3.5 py-2.5">
              {routes.map((option, index) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={index === selectedRouteIndex ? 'default' : 'outline'}
                  onClick={() => selectRoute(index)}
                  className="h-auto flex-col items-start gap-0 py-1.5"
                >
                  <span className="tabular text-xs font-semibold">
                    {formatEtaDuration(option.durationSeconds)}
                  </span>
                  <span className="tabular text-2xs font-normal opacity-80">
                    {formatDistanceKm(option.distanceMeters / 1000)}
                    {option.summary ? ` · ${option.summary}` : ''}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}

          {/* --- Full step list ------------------------------------------- */}
          <button
            type="button"
            onClick={() => setShowSteps((open) => !open)}
            className="flex w-full items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2 text-xs font-medium hover:bg-secondary/60"
            aria-expanded={showSteps}
          >
            <span>
              {showSteps ? 'Hide' : 'Show'} all directions ({upcoming.length})
            </span>
            {showSteps ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>

          {showSteps ? (
            <ol className="max-h-64 divide-y divide-border/60 overflow-y-auto border-t border-border/70">
              {upcoming.map((step, index) => (
                <li key={step.id} className="flex items-start gap-2.5 px-3.5 py-2">
                  <ManeuverIcon
                    maneuver={step.maneuver}
                    className={cn(index === 0 && 'bg-primary/15 text-primary')}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-snug">{step.instruction}</p>
                    <p className="text-2xs text-muted-foreground">
                      {step.ref ? `${step.ref} · ` : ''}
                      {step.name}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-2xs text-muted-foreground">
                    {formatManeuverDistance(step.distanceMeters)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </div>
  );
}

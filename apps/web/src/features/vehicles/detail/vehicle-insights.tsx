import * as React from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import {
  compassDirection,
  formatDistanceKm,
  formatNumber,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import type { TruckPassport } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { Skeleton } from '@/components/ui/skeleton';
import { statusTextClass } from '@/components/common/status-badge';
import { cn } from '@/lib/utils';
import { Panel, PanelHeader } from './panel';

/**
 * The rail's two context cards: where the vehicle is, and what condition it is
 * in — the questions asked of a vehicle that its specification does not answer.
 *
 * Every figure is read off `VehicleSummary` or the passport the page already
 * fetched. Nothing is derived, estimated or defaulted: where the API has no
 * answer the card says so, because a plausible-looking zero on a fleet console
 * is worse than an admitted gap.
 */

/*
 * MapLibre and its stylesheet are a large dependency, and this is a preview on
 * a page whose main job is elsewhere. Loaded lazily, and only mounted when there
 * is a fix to draw — a vehicle that has never reported costs nothing at all.
 */
const FleetMap = React.lazy(async () => {
  const module = await import('@/features/maps');
  return { default: module.FleetMap };
});

/** Height of the map preview, in pixels — see `FleetMap`'s height note. */
const MAP_PREVIEW_HEIGHT = '132px';

type Tone = 'warning' | 'destructive' | 'success';
const TONES: Record<Tone, string> = {
  warning: 'text-warning',
  destructive: 'text-destructive',
  success: 'text-success',
};

/** One label-over-value pair. */
function Fact({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string | undefined;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular mt-px truncate text-sm font-medium', className)}>{children}</dd>
      {hint ? <dd className="mt-px truncate text-[11px] text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Faint streets behind an empty preview, so it reads as a map with nothing on it. */
function MapPlaceholder() {
  return (
    <svg
      viewBox="0 0 320 132"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 size-full"
      aria-hidden
    >
      <g fill="none" strokeLinecap="round" className="stroke-border">
        <path d="M-10 98 C 66 78, 132 106, 202 62 S 300 34, 336 44" strokeWidth="6" />
        <path d="M44 -10 L 86 142" strokeWidth="2" />
        <path d="M222 -10 C 212 56, 254 90, 244 142" strokeWidth="2" />
      </g>
    </svg>
  );
}

/**
 * Where the vehicle last reported from — distinguishing "not sharing", "sharing
 * but never reported" and "here is the fix", which look alike in a list and
 * mean entirely different things to whoever is looking for the vehicle.
 */
export function VehicleLocationCard({ vehicle }: { vehicle: VehicleSummary }) {
  const fix = vehicle.lastLocation;

  return (
    <Panel aria-labelledby="vehicle-location">
      <PanelHeader
        id="vehicle-location"
        title="Location"
        className="mb-2 items-center"
        action={
          <Link
            to="/tracking"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            Live map
          </Link>
        }
      />

      <div className="relative h-[132px] overflow-hidden rounded-[14px] bg-foreground/[0.04] dark:bg-white/[0.05]">
        {fix ? (
          <React.Suspense fallback={<Skeleton className="size-full rounded-none" />}>
            <FleetMap
              trucks={[
                {
                  id: vehicle.id,
                  registrationNumber: vehicle.registrationNumber,
                  latitude: fix.latitude,
                  longitude: fix.longitude,
                  heading: fix.heading,
                  speedKph: fix.speedKph,
                  status: vehicle.status,
                  driverName: vehicle.currentDriver?.name ?? null,
                },
              ]}
              focusPoint={{ latitude: fix.latitude, longitude: fix.longitude }}
              focusZoom={13}
              // A preview tile: no controls, no search, no pan. The live map is
              // one click away and is where those belong.
              showControls={false}
              showSearch={false}
              interactive={false}
              height={MAP_PREVIEW_HEIGHT}
              className="rounded-none border-0"
            />
          </React.Suspense>
        ) : (
          <>
            <MapPlaceholder />
            <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] text-muted-foreground">
              {vehicle.shareLocation ? 'No position reported yet' : 'Location sharing is off'}
            </p>
          </>
        )}
      </div>

      {fix ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-[18px] gap-y-3">
          <Fact
            label="Last reported"
            hint={new Date(fix.recordedAt).toLocaleString('en-IN')}
          >
            {relativeTimeFrom(fix.recordedAt)}
          </Fact>
          <Fact
            label="Speed"
            hint={fix.heading !== null ? `Heading ${compassDirection(fix.heading)}` : undefined}
          >
            {fix.speedKph !== null ? `${Math.round(fix.speedKph)} km/h` : '-'}
          </Fact>
        </dl>
      ) : null}
    </Panel>
  );
}

/**
 * Status, connectivity, paperwork and usage in one card. Which rows say what
 * depends on what the vehicle actually has: no telematics unit is "Not
 * fitted", not a silent device.
 */
export function VehicleConditionCard({
  vehicle,
  passport,
  isLoading,
  onOpenDocuments,
}: {
  vehicle: VehicleSummary;
  passport: TruckPassport | undefined;
  isLoading: boolean;
  /** Takes the reader to the Documents tab. */
  onOpenDocuments: () => void;
}) {
  const lifetime = passport?.lifetime;
  const { total, expired, expiringSoon, pending } = vehicle.documentHealth;

  /** The paperwork reduced to the one thing worth saying about it. */
  const documents: { value: string; tone?: Tone } = (() => {
    if (total === 0) return { value: 'None uploaded' };
    if (expired > 0) return { value: `${formatNumber(expired)} expired`, tone: 'destructive' };
    if (expiringSoon > 0)
      return { value: `${formatNumber(expiringSoon)} expiring`, tone: 'warning' };
    if (pending > 0) return { value: `${formatNumber(pending)} in review` };
    return { value: 'All valid' };
  })();

  const verified = vehicle.verificationStatus === 'VERIFIED';

  return (
    <Panel aria-labelledby="vehicle-condition">
      <PanelHeader id="vehicle-condition" title="Condition & usage" />

      <dl className="grid grid-cols-2 gap-x-[18px] gap-y-3">
        <Fact label="Status" className={statusTextClass(vehicle.status)}>
          {humanizeEnum(vehicle.status)}
        </Fact>
        <Fact
          label="Verification"
          className={verified ? 'text-success' : statusTextClass(vehicle.verificationStatus)}
        >
          {humanizeEnum(vehicle.verificationStatus)}
        </Fact>
        <Fact
          label="Hardware"
          hint={
            vehicle.device
              ? vehicle.device.lastSeenAt
                ? `Seen ${relativeTimeFrom(vehicle.device.lastSeenAt)}`
                : 'Never reported'
              : undefined
          }
        >
          {vehicle.device ? humanizeEnum(vehicle.device.status) : 'Not fitted'}
        </Fact>
        <Fact label="Documents" className={documents.tone ? TONES[documents.tone] : undefined}>
          <button
            type="button"
            onClick={onOpenDocuments}
            className="truncate font-medium underline-offset-2 hover:underline"
          >
            {documents.value}
          </button>
        </Fact>
        <Fact
          label="Open alerts"
          className={vehicle.openTelemetryAlerts > 0 ? TONES.warning : undefined}
        >
          {formatNumber(vehicle.openTelemetryAlerts)}
        </Fact>
        <Fact
          label="Location sharing"
          hint={
            vehicle.fuelEfficiency !== null ? `Rated ${vehicle.fuelEfficiency} L/100 km` : undefined
          }
        >
          {vehicle.shareLocation ? 'On' : 'Off'}
        </Fact>

        {isLoading ? (
          [0, 1, 2].map((key) => (
            <div key={key} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))
        ) : (
          <>
            <Fact
              label="Distance on trips"
              hint={lifetime ? `${formatNumber(lifetime.completedTrips)} completed` : undefined}
            >
              {lifetime ? formatDistanceKm(lifetime.totalDistanceKm) : '-'}
            </Fact>
            <Fact label="Orders carried">
              {lifetime ? formatNumber(lifetime.totalOrders) : '-'}
            </Fact>
            <Fact
              label="Services done"
              hint={
                lifetime && lifetime.incidents > 0
                  ? `${formatNumber(lifetime.incidents)} incidents`
                  : undefined
              }
            >
              {lifetime ? formatNumber(lifetime.servicesCompleted) : '-'}
            </Fact>
          </>
        )}
      </dl>

      {vehicle.openTelemetryAlerts > 0 ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-xs text-warning ring-1 ring-warning/20">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {formatNumber(vehicle.openTelemetryAlerts)} open telemetry{' '}
          {vehicle.openTelemetryAlerts === 1 ? 'alert' : 'alerts'} on this vehicle.
        </p>
      ) : null}
    </Panel>
  );
}

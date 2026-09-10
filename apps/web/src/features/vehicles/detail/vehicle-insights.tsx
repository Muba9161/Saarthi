import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Cpu, Gauge, MapPin, Radio, TriangleAlert } from 'lucide-react';
import {
  compassDirection,
  formatDistanceKm,
  formatNumber,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import type { TruckPassport } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/common/status-badge';
import { cn } from '@/lib/utils';

/**
 * Location, usage and operational condition — the three questions asked of a
 * vehicle that are not answered by its specification.
 *
 * Every figure here is read off `VehicleSummary` or the passport the page has
 * already fetched. Nothing is derived, estimated or defaulted: where the API
 * has no answer the card says so, because a plausible-looking zero on a fleet
 * console is worse than an admitted gap. Two fields the reference layouts
 * usually show are therefore absent — a fuel level, which no endpoint reports,
 * and a distance-this-month, which the passport does not break out.
 */

/*
 * MapLibre and its stylesheet are a large dependency, and this is a preview on
 * a page whose main job is elsewhere. Loading it lazily keeps it out of the
 * initial bundle, and the card only ever mounts it when there is a fix to draw
 * — so a vehicle that has never reported costs nothing at all.
 */
const FleetMap = React.lazy(async () => {
  const module = await import('@/features/maps');
  return { default: module.FleetMap };
});

/** A card heading with an optional link out, used by all three panels. */
function InsightHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <p className="section-label inline-flex items-center gap-1.5">
        <Icon className="size-3.5" />
        {title}
      </p>
      {action}
    </div>
  );
}

/** One label-over-value pair. */
function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'warning' | 'destructive' | 'success';
}) {
  const tones = {
    warning: 'text-warning',
    destructive: 'text-destructive',
    success: 'text-success',
  };
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('tabular mt-0.5 truncate text-sm font-semibold', tone && tones[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Where the vehicle last reported from.
 *
 * The distinction the card has to make is between "not sharing", "sharing but
 * never reported" and "here is the fix" — they look the same in a list and
 * mean entirely different things to whoever is looking for the vehicle.
 */
function LocationCard({ vehicle }: { vehicle: VehicleSummary }) {
  const fix = vehicle.lastLocation;

  return (
    <Card variant="glass" className="flex flex-col overflow-hidden rounded-2xl">
      <InsightHeader
        icon={MapPin}
        title="Location"
        action={
          <Button variant="ghost" size="sm" shape="pill" className="-mr-2 text-xs" asChild>
            <Link to="/tracking">
              Live map
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      {fix ? (
        <>
          <div className="mt-4 h-40 w-full overflow-hidden border-y border-border/70 bg-muted">
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
                // A preview tile: no controls, no search, no pan. The live map
                // is one click away and is where those belong.
                showControls={false}
                showSearch={false}
                interactive={false}
                height="100%"
              />
            </React.Suspense>
          </div>

          <div className="grid grid-cols-2 gap-4 p-5">
            <Figure
              label="Last reported"
              value={relativeTimeFrom(fix.recordedAt)}
              hint={new Date(fix.recordedAt).toLocaleString('en-IN')}
            />
            <Figure
              label="Speed"
              value={fix.speedKph !== null ? `${Math.round(fix.speedKph)} km/h` : '-'}
              hint={fix.heading !== null ? `Heading ${compassDirection(fix.heading)}` : undefined}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <span className="rounded-2xl bg-muted p-3 text-muted-foreground">
            <MapPin className="size-5" />
          </span>
          <p className="text-sm font-medium">
            {vehicle.shareLocation ? 'No position reported yet' : 'Location sharing is off'}
          </p>
          <p className="max-w-64 text-xs text-muted-foreground">
            {vehicle.shareLocation
              ? 'This vehicle will appear on the live map once its device or driver app reports a position.'
              : 'Turn location sharing on for this vehicle to see it on the live map.'}
          </p>
        </div>
      )}
    </Card>
  );
}

/** What the vehicle has actually done, from the passport. */
function UsageCard({
  vehicle,
  passport,
  isLoading,
}: {
  vehicle: VehicleSummary;
  passport: TruckPassport | undefined;
  isLoading: boolean;
}) {
  const lifetime = passport?.lifetime;

  return (
    <Card variant="glass" className="flex flex-col rounded-2xl">
      <InsightHeader icon={Gauge} title="Usage" />

      <div className="px-5 pb-1 pt-2">
        <p className="text-xs text-muted-foreground">
          On the platform since {new Date(vehicle.createdAt).toLocaleDateString('en-IN')}
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 p-5">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 p-5">
          <Figure
            label="Odometer"
            value={`${formatNumber(Math.round(vehicle.odometerKm))} km`}
            hint="As last recorded"
          />
          <Figure
            label="Distance on trips"
            value={lifetime ? formatDistanceKm(lifetime.totalDistanceKm) : '-'}
            hint={lifetime ? `${formatNumber(lifetime.completedTrips)} completed` : undefined}
          />
          <Figure
            label="Orders carried"
            value={lifetime ? formatNumber(lifetime.totalOrders) : '-'}
          />
          <Figure
            label="Services done"
            value={lifetime ? formatNumber(lifetime.servicesCompleted) : '-'}
            hint={
              lifetime && lifetime.incidents > 0
                ? `${formatNumber(lifetime.incidents)} incidents`
                : undefined
            }
          />
        </div>
      )}
    </Card>
  );
}

/**
 * Operational condition — status, connectivity and paperwork.
 *
 * Which rows appear depends on what the vehicle actually has: a vehicle with no
 * telematics unit is not given an empty "connectivity" row, because the absence
 * of a device is not the same as a device that is silent.
 */
function OperationalCard({ vehicle }: { vehicle: VehicleSummary }) {
  const { total, expired, expiringSoon, pending } = vehicle.documentHealth;

  /** The paperwork reduced to the one thing worth saying about it. */
  const documents: { value: string; tone?: 'warning' | 'destructive'; hint: string } = (() => {
    if (total === 0) return { value: 'None uploaded', hint: 'No documents on file' };
    if (expired > 0)
      return {
        value: `${formatNumber(expired)} expired`,
        tone: 'destructive',
        hint: `of ${formatNumber(total)} on file`,
      };
    if (expiringSoon > 0)
      return {
        value: `${formatNumber(expiringSoon)} expiring`,
        tone: 'warning',
        hint: `of ${formatNumber(total)} on file`,
      };
    if (pending > 0)
      return {
        value: `${formatNumber(pending)} in review`,
        hint: `of ${formatNumber(total)} on file`,
      };
    return { value: 'All valid', hint: `${formatNumber(total)} on file` };
  })();

  return (
    <Card variant="glass" className="flex flex-col rounded-2xl">
      <InsightHeader icon={Radio} title="Operational" />

      <div className="grid grid-cols-2 gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Status</p>
          <div className="mt-1">
            <StatusBadge status={vehicle.status} size="sm" />
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Verification</p>
          <div className="mt-1">
            <StatusBadge status={vehicle.verificationStatus} size="sm" />
          </div>
        </div>

        {vehicle.device ? (
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Hardware</p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
              <Badge variant={vehicle.device.status === 'ACTIVE' ? 'success' : 'warning'} size="sm">
                {humanizeEnum(vehicle.device.status)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {vehicle.device.lastSeenAt
                ? `Seen ${relativeTimeFrom(vehicle.device.lastSeenAt)}`
                : 'Never reported'}
            </p>
          </div>
        ) : (
          <Figure label="Hardware" value="Not fitted" hint="No telematics unit" />
        )}

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Documents</p>
          <p
            className={cn(
              'tabular mt-0.5 truncate text-sm font-semibold',
              documents.tone === 'destructive' && 'text-destructive',
              documents.tone === 'warning' && 'text-warning',
            )}
          >
            {documents.value}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{documents.hint}</p>
        </div>

        <Figure
          label="Open alerts"
          value={formatNumber(vehicle.openTelemetryAlerts)}
          {...(vehicle.openTelemetryAlerts > 0 ? { tone: 'warning' as const } : {})}
          {...(vehicle.openTelemetryAlerts > 0 ? { hint: 'Needs attention' } : {})}
        />

        <Figure
          label="Location sharing"
          value={vehicle.shareLocation ? 'On' : 'Off'}
          hint={
            vehicle.fuelEfficiency !== null ? `Rated ${vehicle.fuelEfficiency} L/100 km` : undefined
          }
        />
      </div>

      {vehicle.openTelemetryAlerts > 0 ? (
        <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 ring-1 ring-warning/20">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <p className="text-xs text-warning">
            {formatNumber(vehicle.openTelemetryAlerts)} open telemetry{' '}
            {vehicle.openTelemetryAlerts === 1 ? 'alert' : 'alerts'} on this vehicle.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export function VehicleInsights({
  vehicle,
  passport,
  isLoading,
}: {
  vehicle: VehicleSummary;
  passport: TruckPassport | undefined;
  isLoading: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <LocationCard vehicle={vehicle} />
      <UsageCard vehicle={vehicle} passport={passport} isLoading={isLoading} />
      <OperationalCard vehicle={vehicle} />
    </div>
  );
}

export default VehicleInsights;

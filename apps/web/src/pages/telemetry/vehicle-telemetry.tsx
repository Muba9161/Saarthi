import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Cpu } from 'lucide-react';
import {
  DeviceProvider,
  Feature,
  Permission,
  RealtimeEvent,
  OrganizationType,
  describeTrackerPrices,
  humanizeEnum,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type {
  VehicleDeviceHistory,
  TelemetryAlertSummary,
  TelemetryReadingSummary,
  VehicleSummary,
  VehicleTelemetryCapabilities,
} from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { EmptyState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LiveReadings } from '@/features/telemetry/live-readings';
import { TrackerOfferDialog } from '@/features/telemetry/tracker-offer-dialog';

/** Remembered for the session, so "Continue" means continue. */
function offerDismissedKey(vehicleId: string): string {
  return `saarthi:tracker-offer-dismissed:${vehicleId}`;
}

function offerDismissed(vehicleId: string): boolean {
  try {
    return window.sessionStorage.getItem(offerDismissedKey(vehicleId)) === '1';
  } catch {
    return false;
  }
}

function dismissOffer(vehicleId: string): void {
  try {
    window.sessionStorage.setItem(offerDismissedKey(vehicleId), '1');
  } catch {
    // Storage unavailable (private window): the offer simply reappears next visit.
  }
}

/**
 * Vehicle telemetry.
 *
 * The single rule that shapes this whole screen: **a gauge is only rendered when
 * the vehicle actually reports it.** Every reading carries the list of metrics it
 * genuinely contains, and a metric that is absent shows "not reported" rather
 * than its zero value — because "0 °C coolant" and "this vehicle has no coolant
 * sensor on the bus" would send a mechanic looking for entirely different
 * things. Section 22 of the expansion spec requires exactly this.
 */
export function VehicleTelemetryPage() {
  const { id } = useParams<{ id: string }>();
  const { can, hasFeature, session } = useAuth();
  const queryClient = useQueryClient();
  const [offerOpen, setOfferOpen] = React.useState(false);

  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api.get<VehicleSummary>(`/fleet/vehicles/${id}`),
    enabled: Boolean(id) && can(Permission.VEHICLES_READ),
  });

  const capabilities = useQuery({
    queryKey: ['telemetry', 'capabilities', id],
    queryFn: () =>
      api.get<VehicleTelemetryCapabilities>(`/telemetry/vehicles/${id}/capabilities`),
    enabled: Boolean(id) && can(Permission.TELEMETRY_READ),
  });

  // Not feature-gated: without a tracker the API sends what the driver's phone
  // measured — position, speed and motion — and nothing it could not.
  const latest = useQuery({
    queryKey: ['telemetry', 'latest', id],
    queryFn: () => api.get<TelemetryReadingSummary | null>(`/telemetry/vehicles/${id}/latest`),
    enabled: Boolean(id) && can(Permission.TELEMETRY_READ),
    refetchInterval: 15_000,
  });

  const history = useQuery({
    queryKey: ['telemetry', 'history', id],
    queryFn: () =>
      api.get<Paginated<TelemetryReadingSummary> & { windowStart: string }>('/telemetry/history', {
        vehicleId: id!,
        pageSize: 50,
        intervalSeconds: 300,
      }),
    enabled: Boolean(id) && can(Permission.TELEMETRY_READ),
  });

  const alerts = useQuery({
    queryKey: ['telemetry', 'alerts', id],
    queryFn: () =>
      api.get<Paginated<TelemetryAlertSummary>>('/telemetry/alerts', {
        vehicleId: id!,
        pageSize: 20,
      }),
    enabled: Boolean(id) && can(Permission.TELEMETRY_ALERTS_READ),
  });

  const devices = useQuery({
    queryKey: ['telemetry', 'device-history', id],
    queryFn: () => api.get<VehicleDeviceHistory[]>(`/telemetry/vehicles/${id}/devices`),
    enabled: Boolean(id) && can(Permission.DEVICES_READ),
  });

  useRealtimeEvent(RealtimeEvent.TELEMETRY_UPDATED, (message) => {
    if (message.payload.vehicleId === id) void latest.refetch();
  });
  useRealtimeEvent(RealtimeEvent.TELEMETRY_ALERT_CREATED, (message) => {
    if (message.payload.vehicleId === id) void alerts.refetch();
  });

  /*
   * A fleet owner running trucks needs a tracker for live telemetry, so the
   * offer opens by itself the first time they look at a vehicle without one.
   * Anyone else can open it from the cards below.
   */
  const needsTracker = !hasFeature(Feature.TELEMETRY_LIVE);
  // History narrows the same way; the two are granted together, but each tab
  // follows its own entitlement.
  const phoneOnlyHistory = !hasFeature(Feature.TELEMETRY_HISTORY);
  const fromPhone = vehicle.data?.device?.provider === DeviceProvider.MOBILE;
  const isFleetOwner =
    session?.organization?.type === OrganizationType.FLEET_OWNER &&
    !session.organization.isPersonalSeat;
  React.useEffect(() => {
    if (id && needsTracker && isFleetOwner && !offerDismissed(id)) setOfferOpen(true);
  }, [id, needsTracker, isFleetOwner]);

  const onOfferChange = (next: boolean): void => {
    setOfferOpen(next);
    if (!next && id) dismissOffer(id);
  };

  if (!can(Permission.TELEMETRY_READ)) return <UnauthorizedState />;
  if (vehicle.isLoading) return <LoadingState label="Loading the vehicle…" />;

  const reading = latest.data ?? null;

  // Which figures in *this* reading were invented. A phone standing in for
  // fitted hardware reports real GPS and a simulated engine, and the difference
  // has to survive all the way to the gauge.
  const simulatedMetrics = new Set(reading?.simulatedMetrics ?? []);

  const noDevice = capabilities.data && !capabilities.data.hasDevice;

  return (
    <div className="space-y-5">
      {id ? (
        <TrackerOfferDialog
          open={offerOpen}
          onOpenChange={onOfferChange}
          vehicleId={id}
          vehicleLabel={vehicle.data?.registrationNumber ?? 'this vehicle'}
          onPurchased={() => {
            void queryClient.invalidateQueries({ queryKey: ['telemetry'] });
            void queryClient.invalidateQueries({ queryKey: ['session'] });
          }}
        />
      ) : null}
      <PageHeader
        eyebrow={
          <Link
            to={`/fleet/vehicles/${id}`}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Vehicle
          </Link>
        }
        title={`${vehicle.data?.registrationNumber ?? 'Vehicle'} telemetry`}
        description={
          capabilities.data?.hasDevice
            ? `Device ${humanizeEnum(capabilities.data.deviceStatus ?? '')} · ${capabilities.data.readingCount.toLocaleString('en-IN')} readings recorded`
            : 'No telematics device is fitted to this vehicle.'
        }
        actions={
          reading?.simulated ? (
            <Badge variant="warning">Simulated data</Badge>
          ) : simulatedMetrics.size > 0 ? (
            // Some of it is invented, not all. Saying "simulated data" outright
            // would discredit a position that is genuinely this vehicle's.
            <Badge variant="warning">Partly simulated</Badge>
          ) : fromPhone ? (
            <Badge variant="info">Driver app</Badge>
          ) : capabilities.data?.hasDevice ? (
            <Badge variant="success">Live hardware</Badge>
          ) : null
        }
      />

      {noDevice ? (
        <EmptyState
          icon={Cpu}
          title="No device fitted"
          description="Fit a telematics unit to this vehicle to see engine, fuel, motion and diagnostic data. Until then Saarthi shows only phone or simulator GPS."
          action={
            needsTracker ? (
              <Button onClick={() => setOfferOpen(true)}>See tracker options</Button>
            ) : can(Permission.DEVICES_ASSIGN) ? (
              <Button asChild>
                <Link to="/devices">Open devices</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="alerts">
              Alerts
              {alerts.data && alerts.data.items.filter((a) => a.status === 'OPEN').length > 0 ? (
                <Badge variant="warning" size="sm" className="ml-1.5">
                  {alerts.data.items.filter((a) => a.status === 'OPEN').length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-4">
            {needsTracker ? (
              <Card>
                {/* Not an upgrade prompt: no plan sells this at any price,
                    because it reads a device wired into the vehicle. Telling a
                    Business customer to upgrade would be advice they could not
                    act on. */}
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-muted-foreground">
                  <span className="min-w-0 flex-1">
                    Showing what the driver&apos;s phone reports - position, speed and motion - so
                    these figures are estimates. Engine, fuel and fault codes are read from the
                    vehicle itself and need a Saarthi tracker - {describeTrackerPrices()}, once per
                    vehicle.
                  </span>
                  <Button size="sm" onClick={() => setOfferOpen(true)}>
                    See tracker options
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {reading === null ? (
              <EmptyState
                icon={Activity}
                title="No readings yet"
                description={
                  needsTracker
                    ? 'Readings appear here once a driver signs on in the driver app and starts moving.'
                    : 'The device is registered but has not reported. Nothing is shown here rather than placeholder figures.'
                }
              />
            ) : (
              <LiveReadings
                reading={reading}
                observedMetrics={capabilities.data?.observedMetrics ?? []}
                supportedMetricCount={capabilities.data?.supportedMetrics.length ?? 0}
                needsTracker={needsTracker}
              />
            )}
          </TabsContent>

          <TabsContent value="alerts" className="space-y-3">
            {(alerts.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon={Activity}
                title="No alerts"
                description="Overspeed, harsh driving, temperature and voltage alerts for this vehicle appear here."
              />
            ) : (
              alerts.data!.items.map((alert) => (
                <Card key={alert.id}>
                  <CardContent className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{humanizeEnum(alert.type)}</p>
                        <Badge
                          variant={
                            alert.severity === 'CRITICAL'
                              ? 'destructive'
                              : alert.severity === 'WARNING'
                                ? 'warning'
                                : 'info'
                          }
                          size="sm"
                        >
                          {alert.severity.toLowerCase()}
                        </Badge>
                        <Badge variant={alert.status === 'OPEN' ? 'warning' : 'success'} size="sm">
                          {humanizeEnum(alert.status)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(alert.occurredAt).toLocaleString('en-IN')}
                        {alert.driverName ? ` · ${alert.driverName}` : ''}
                        {alert.scoreEventId ? ' · affected the driver score' : ''}
                      </p>
                    </div>
                    {alert.observedValue !== null ? (
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-semibold">
                          {alert.observedValue}
                          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                            {alert.unit}
                          </span>
                        </p>
                        {alert.threshold !== null ? (
                          <p className="text-2xs text-muted-foreground">
                            limit {alert.threshold}
                            {alert.unit}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            {(history.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon={Activity}
                title="No history"
                description={
                  phoneOnlyHistory
                    ? 'Readings from the driver app appear here once a driver signs on and starts moving.'
                    : 'Readings appear here once the device starts reporting.'
                }
              />
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeader
                    title="Recent readings"
                    description={`${
                      phoneOnlyHistory ? "From the driver's phone, so figures are estimates. " : ''
                    }Sampled every 5 minutes. Retained from ${
                      history.data?.windowStart
                        ? new Date(history.data.windowStart).toLocaleDateString('en-IN')
                        : 'the start of your retention window'
                    }.`}
                  />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-3 font-medium">Time</th>
                          <th className="pb-2 pr-3 text-right font-medium">Speed</th>
                          {phoneOnlyHistory ? (
                            <>
                              <th className="pb-2 pr-3 text-right font-medium">Heading</th>
                              <th className="pb-2 text-right font-medium">Position</th>
                            </>
                          ) : (
                            <>
                              <th className="pb-2 pr-3 text-right font-medium">RPM</th>
                              <th className="pb-2 pr-3 text-right font-medium">Coolant</th>
                              <th className="pb-2 text-right font-medium">Fuel</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {history.data!.items.map((row) => (
                          <tr key={row.id} className="border-b border-border/60 last:border-0">
                            <td className="py-1.5 pr-3 text-muted-foreground">
                              {new Date(row.recordedAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {row.speedKph === null ? '-' : `${Math.round(row.speedKph)}`}
                            </td>
                            {phoneOnlyHistory ? (
                              <>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                  {row.heading === null ? '-' : `${Math.round(row.heading)}°`}
                                </td>
                                <td className="py-1.5 text-right tabular-nums">
                                  {row.latitude === null || row.longitude === null
                                    ? '-'
                                    : `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                  {row.rpm === null ? '-' : Math.round(row.rpm)}
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                  {row.coolantTemperature === null
                                    ? '-'
                                    : `${Math.round(row.coolantTemperature)}°`}
                                </td>
                                <td className="py-1.5 text-right tabular-nums">
                                  {row.fuelLevel === null ? '-' : `${Math.round(row.fuelLevel)}%`}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="hardware" className="space-y-3">
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Device history"
                  description="Every unit ever fitted. Closed assignments are kept so old readings stay attributable to the device that produced them."
                />
              </CardHeader>
              <CardContent className="pt-0">
                {(devices.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No device has been fitted.</p>
                ) : (
                  <ul className="space-y-2">
                    {devices.data!.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0">
                          <Link
                            to={`/devices/${entry.deviceId}`}
                            className="truncate font-medium hover:text-foreground"
                          >
                            {entry.deviceIdentifier}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {humanizeEnum(entry.provider)}
                            {entry.model ? ` · ${entry.model}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <Badge
                            variant={entry.status === 'ACTIVE' ? 'success' : 'secondary'}
                            size="sm"
                          >
                            {humanizeEnum(entry.status)}
                          </Badge>
                          <p className="mt-1">
                            {new Date(entry.assignedAt).toLocaleDateString('en-IN')}
                            {entry.unassignedAt
                              ? ` → ${new Date(entry.unassignedAt).toLocaleDateString('en-IN')}`
                              : ' → now'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default VehicleTelemetryPage;

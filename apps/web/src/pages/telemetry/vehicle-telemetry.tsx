import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  BatteryCharging,
  Cpu,
  Fuel,
  Gauge,
  Thermometer,
  TriangleAlert,
} from 'lucide-react';
import {
  Feature,
  Permission,
  RealtimeEvent,
  TelemetryMetric,
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

function MetricTile({
  label,
  value,
  unit,
  icon: Icon,
  available,
  tone,
}: {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  /** False when this vehicle does not report the metric at all. */
  available: boolean;
  tone?: 'warning' | 'destructive';
}) {
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
        <p
          className={
            tone === 'destructive'
              ? 'mt-1 text-xl font-semibold text-destructive'
              : tone === 'warning'
                ? 'mt-1 text-xl font-semibold text-warning'
                : 'mt-1 text-xl font-semibold'
          }
        >
          {Math.round(value * 10) / 10}
          <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
        </p>
      )}
    </div>
  );
}

export function VehicleTelemetryPage() {
  const { id } = useParams<{ id: string }>();
  const { can, hasFeature } = useAuth();

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

  const latest = useQuery({
    queryKey: ['telemetry', 'latest', id],
    queryFn: () => api.get<TelemetryReadingSummary | null>(`/telemetry/vehicles/${id}/latest`),
    enabled:
      Boolean(id) && can(Permission.TELEMETRY_READ) && hasFeature(Feature.TELEMETRY_LIVE),
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
    enabled:
      Boolean(id) && can(Permission.TELEMETRY_READ) && hasFeature(Feature.TELEMETRY_HISTORY),
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

  if (!can(Permission.TELEMETRY_READ)) return <UnauthorizedState />;
  if (vehicle.isLoading) return <LoadingState label="Loading the vehicle…" />;

  const reading = latest.data ?? null;
  const supported = new Set(capabilities.data?.observedMetrics ?? []);
  const has = (metric: TelemetryMetric) => supported.has(metric);

  const noDevice = capabilities.data && !capabilities.data.hasDevice;

  return (
    <div className="space-y-5">
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
            can(Permission.DEVICES_ASSIGN) ? (
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
            {!hasFeature(Feature.TELEMETRY_LIVE) ? (
              <Card>
                <CardContent className="py-4 text-sm text-muted-foreground">
                  Live telemetry is available on the Saarthi Pro plan and above.
                </CardContent>
              </Card>
            ) : reading === null ? (
              <EmptyState
                icon={Activity}
                title="No readings yet"
                description="The device is registered but has not reported. Nothing is shown here rather than placeholder figures."
              />
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeader
                      title="Position"
                      description={`Recorded ${new Date(reading.recordedAt).toLocaleString('en-IN')}`}
                    />
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-4">
                    <MetricTile
                      label="Speed"
                      value={reading.speedKph}
                      unit="km/h"
                      icon={Gauge}
                      available={has(TelemetryMetric.SPEED)}
                    />
                    <MetricTile
                      label="Heading"
                      value={reading.heading}
                      unit="°"
                      icon={Activity}
                      available={has(TelemetryMetric.HEADING)}
                    />
                    <MetricTile
                      label="Altitude"
                      value={reading.altitude}
                      unit="m"
                      icon={Activity}
                      available={has(TelemetryMetric.ALTITUDE)}
                    />
                    <MetricTile
                      label="Satellites"
                      value={reading.satellites}
                      unit=""
                      icon={Activity}
                      available={has(TelemetryMetric.SATELLITES)}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeader
                      title="Engine"
                      description="Only parameters this vehicle exposes on its diagnostic bus are shown."
                    />
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-4">
                    <MetricTile
                      label="RPM"
                      value={reading.rpm}
                      unit="rpm"
                      icon={Gauge}
                      available={has(TelemetryMetric.RPM)}
                    />
                    <MetricTile
                      label="Coolant"
                      value={reading.coolantTemperature}
                      unit="°C"
                      icon={Thermometer}
                      available={has(TelemetryMetric.COOLANT_TEMPERATURE)}
                      tone={
                        reading.coolantTemperature !== null && reading.coolantTemperature > 105
                          ? 'destructive'
                          : undefined
                      }
                    />
                    <MetricTile
                      label="Engine load"
                      value={reading.engineLoad}
                      unit="%"
                      icon={Activity}
                      available={has(TelemetryMetric.ENGINE_LOAD)}
                    />
                    <MetricTile
                      label="Throttle"
                      value={reading.throttlePosition}
                      unit="%"
                      icon={Activity}
                      available={has(TelemetryMetric.THROTTLE_POSITION)}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeader title="Fuel and electrical" />
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-4">
                    <MetricTile
                      label="Fuel level"
                      value={reading.fuelLevel}
                      unit="%"
                      icon={Fuel}
                      available={has(TelemetryMetric.FUEL_LEVEL)}
                      tone={
                        reading.fuelLevel !== null && reading.fuelLevel < 15 ? 'warning' : undefined
                      }
                    />
                    <MetricTile
                      label="Consumption"
                      value={reading.fuelRate}
                      unit="L/h"
                      icon={Fuel}
                      available={has(TelemetryMetric.FUEL_RATE)}
                    />
                    <MetricTile
                      label="Battery"
                      value={reading.batteryVoltage}
                      unit="V"
                      icon={BatteryCharging}
                      available={has(TelemetryMetric.BATTERY_VOLTAGE)}
                      tone={
                        reading.batteryVoltage !== null && reading.batteryVoltage < 11.8
                          ? 'warning'
                          : undefined
                      }
                    />
                    <MetricTile
                      label="Odometer"
                      value={reading.odometerKm}
                      unit="km"
                      icon={Gauge}
                      available={has(TelemetryMetric.ODOMETER)}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <SectionHeader title="Motion" />
                  </CardHeader>
                  <CardContent className="pt-0">
                    {!has(TelemetryMetric.ACCELEROMETER) ? (
                      <p className="text-sm text-muted-foreground">
                        This device does not report accelerometer data, so harsh-driving events
                        cannot be detected for this vehicle.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={reading.harshBraking ? 'destructive' : 'secondary'}>
                          {reading.harshBraking ? 'Harsh braking detected' : 'No harsh braking'}
                        </Badge>
                        <Badge variant={reading.harshAcceleration ? 'destructive' : 'secondary'}>
                          {reading.harshAcceleration
                            ? 'Harsh acceleration detected'
                            : 'No harsh acceleration'}
                        </Badge>
                        {reading.accelerationX !== null ? (
                          <Badge variant="outline">
                            longitudinal {reading.accelerationX.toFixed(2)} g
                          </Badge>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {reading.diagnostics.length > 0 ? (
                  <Card className="border-destructive/40 bg-destructive/5">
                    <CardHeader className="pb-3">
                      <SectionHeader title="Diagnostic trouble codes" />
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {reading.diagnostics.map((code) => (
                        <div key={code.code} className="flex items-start gap-2 text-sm">
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <div>
                            <p className="font-mono font-medium">{code.code}</p>
                            {code.description ? (
                              <p className="text-muted-foreground">{code.description}</p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardContent className="py-3">
                    <p className="text-xs text-muted-foreground">
                      This vehicle reports{' '}
                      <strong>{capabilities.data?.observedMetrics.length ?? 0}</strong> of the{' '}
                      {capabilities.data?.supportedMetrics.length ?? 0} metrics the device is capable
                      of. What a device can do and what a given vehicle exposes are different
                      questions — Saarthi shows only the second.
                    </p>
                  </CardContent>
                </Card>
              </>
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
                        <Badge
                          variant={alert.status === 'OPEN' ? 'warning' : 'success'}
                          size="sm"
                        >
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
            {!hasFeature(Feature.TELEMETRY_HISTORY) ? (
              <Card>
                <CardContent className="py-4 text-sm text-muted-foreground">
                  Telemetry history is available on the Saarthi Pro plan and above.
                </CardContent>
              </Card>
            ) : (history.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon={Activity}
                title="No history"
                description="Readings appear here once the device starts reporting."
              />
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeader
                    title="Recent readings"
                    description={`Sampled every 5 minutes. Retained from ${
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
                          <th className="pb-2 pr-3 text-right font-medium">RPM</th>
                          <th className="pb-2 pr-3 text-right font-medium">Coolant</th>
                          <th className="pb-2 text-right font-medium">Fuel</th>
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
                              {row.speedKph === null ? '—' : `${Math.round(row.speedKph)}`}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {row.rpm === null ? '—' : Math.round(row.rpm)}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {row.coolantTemperature === null
                                ? '—'
                                : `${Math.round(row.coolantTemperature)}°`}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {row.fuelLevel === null ? '—' : `${Math.round(row.fuelLevel)}%`}
                            </td>
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

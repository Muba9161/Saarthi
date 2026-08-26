import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Link2, Link2Off, Play, Square } from 'lucide-react';
import { Permission, humanizeEnum } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import type {
  DeviceAssignmentHistory,
  DeviceEventEntry,
  DeviceSummary,
  MockRunSummary,
  VehicleSummary,
} from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * One device: what it is, where it is fitted, what it reports and its history.
 *
 * Sensitive identifiers (IMEI, SIM) are shown masked — the API never returns
 * them in full, because an ICCID is enough to attempt a SIM swap.
 */

const SCENARIOS = [
  'NORMAL',
  'OVERSPEED',
  'HARSH_DRIVING',
  'OVERHEATING',
  'LOW_VOLTAGE',
  'FAULT_CODE',
] as const;

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, session } = useAuth();
  const queryClient = useQueryClient();

  const [vehicleId, setVehicleId] = React.useState('');
  const [scenario, setScenario] = React.useState<string>('NORMAL');
  const [rotated, setRotated] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const canManage = can(Permission.DEVICES_MANAGE);
  const canAssign = can(Permission.DEVICES_ASSIGN);

  const device = useQuery({
    queryKey: ['device', id],
    queryFn: () => api.get<DeviceSummary>(`/devices/${id}`),
    enabled: Boolean(id) && can(Permission.DEVICES_READ),
    refetchInterval: 20_000,
  });

  const assignments = useQuery({
    queryKey: ['device', id, 'assignments'],
    queryFn: () => api.get<DeviceAssignmentHistory[]>(`/devices/${id}/assignments`),
    enabled: Boolean(id) && can(Permission.DEVICES_READ),
  });

  const events = useQuery({
    queryKey: ['device', id, 'events'],
    queryFn: () => api.get<DeviceEventEntry[]>(`/devices/${id}/events`),
    enabled: Boolean(id) && can(Permission.DEVICES_READ),
  });

  const vehicles = useQuery({
    queryKey: ['devices', 'assignable-vehicles'],
    queryFn: () => api.get<Paginated<VehicleSummary>>('/fleet/vehicles', { pageSize: 100 }),
    enabled: canAssign && Boolean(device.data) && !device.data?.assignedVehicle,
  });

  const mockRuns = useQuery({
    queryKey: ['devices', 'mock-runs'],
    queryFn: () => api.get<MockRunSummary[]>('/devices/mock/runs'),
    enabled: Boolean(session?.demoMode) && can(Permission.DEVICES_READ),
    refetchInterval: 8_000,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['device'] });
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
  }

  function onError(error: unknown) {
    setActionError(
      error instanceof ApiError ? error.message : 'That action could not be completed.',
    );
  }

  const assign = useMutation({
    mutationFn: () => api.post(`/devices/${id}/assign`, { vehicleId }),
    onSuccess: () => {
      setVehicleId('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const unassign = useMutation({
    mutationFn: () => api.post(`/devices/${id}/unassign`, { reason: 'Removed from service.' }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const rotate = useMutation({
    mutationFn: () => api.post<{ secret: string }>(`/devices/${id}/rotate-secret`),
    onSuccess: (result) => {
      setRotated(result.secret);
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const startMock = useMutation({
    mutationFn: () =>
      api.post('/devices/mock/start', { deviceId: id, intervalSeconds: 5, scenario }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
      void mockRuns.refetch();
    },
    onError,
  });

  const stopMock = useMutation({
    mutationFn: (runId: string) => api.post(`/devices/mock/${runId}/stop`),
    onSuccess: () => {
      invalidate();
      void mockRuns.refetch();
    },
    onError,
  });

  if (!can(Permission.DEVICES_READ)) return <UnauthorizedState />;
  if (device.isLoading) return <LoadingState label="Loading the device…" />;
  if (device.error) return <ErrorState error={device.error} onRetry={() => void device.refetch()} />;
  if (!device.data) return <ErrorState error={new Error('Device not found')} />;

  const data = device.data;
  const activeRun = (mockRuns.data ?? []).find(
    (run) => run.deviceId === data.id && run.status === 'RUNNING',
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/devices" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Devices
          </Link>
        }
        title={data.deviceIdentifier}
        description={`${humanizeEnum(data.provider)} · ${data.model ?? data.serialNumber}`}
        actions={
          <Badge
            variant={
              data.status === 'ACTIVE'
                ? 'success'
                : data.status === 'OFFLINE' || data.status === 'SUSPENDED'
                  ? 'destructive'
                  : 'warning'
            }
          >
            {humanizeEnum(data.status)}
          </Badge>
        }
      />

      {actionError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">{actionError}</CardContent>
        </Card>
      ) : null}

      {rotated ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="space-y-2 py-4">
            <p className="text-sm font-medium">New secret — copy it now</p>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-warning" />
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-sm">
                {rotated}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(rotated)}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The previous secret stopped working the moment this was issued — reflash the unit
              before it next reports.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setRotated(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Hardware" />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Serial</p>
                <p className="font-medium">{data.serialNumber}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">IMEI</p>
                <p className="font-mono font-medium">{data.imeiMasked ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Firmware</p>
                <p className="font-medium">{data.firmwareVersion ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">SIM</p>
                <p className="font-mono font-medium">{data.simMasked ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Operator</p>
                <p className="font-medium">{data.simOperator ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Readings</p>
                <p className="font-medium">
                  {data.readingCount.toLocaleString('en-IN')}
                  {data.rejectedCount > 0 ? (
                    <span className="ml-1 text-xs text-destructive">
                      ({data.rejectedCount} rejected)
                    </span>
                  ) : null}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader
                title="What it reports"
                description="Observed is what VorldX Saarthi has actually received from this unit on this vehicle — which is not always everything the datasheet claims."
              />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  Observed ({data.observedMetrics.length})
                </p>
                {data.observedMetrics.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing yet — this device has not reported.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {data.observedMetrics.map((metric) => (
                      <Badge key={metric} variant="success" size="sm">
                        {humanizeEnum(metric)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              {data.supportedMetrics.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                    Expected ({data.supportedMetrics.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {data.supportedMetrics
                      .filter((metric) => !data.observedMetrics.includes(metric))
                      .map((metric) => (
                        <Badge key={metric} variant="outline" size="sm">
                          {humanizeEnum(metric)}
                        </Badge>
                      ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader
                title="Fitment history"
                description="Closed assignments are kept so historical telemetry stays attributable to the unit that produced it."
              />
            </CardHeader>
            <CardContent className="pt-0">
              {(assignments.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Never fitted to a vehicle.</p>
              ) : (
                <ul className="space-y-2">
                  {assignments.data!.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/fleet/vehicles/${entry.vehicleId}/telemetry`}
                          className="truncate font-medium hover:text-foreground"
                        >
                          {entry.registrationNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.assignedAt).toLocaleDateString('en-IN')}
                          {entry.unassignedAt
                            ? ` → ${new Date(entry.unassignedAt).toLocaleDateString('en-IN')}`
                            : ' → now'}
                        </p>
                        {entry.removalReason ? (
                          <p className="text-xs text-muted-foreground">{entry.removalReason}</p>
                        ) : null}
                      </div>
                      <Badge
                        variant={entry.status === 'ACTIVE' ? 'success' : 'secondary'}
                        size="sm"
                      >
                        {humanizeEnum(entry.status)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Device log" />
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-2.5">
                {(events.data ?? []).slice(0, 30).map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{humanizeEnum(event.eventType)}</p>
                      {event.description ? (
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Vehicle" />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {data.assignedVehicle ? (
                <>
                  <div>
                    <p className="font-medium">{data.assignedVehicle.registrationNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanizeEnum(data.assignedVehicle.vehicleType)} · fitted{' '}
                      {new Date(data.assignedVehicle.assignedAt).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <Button asChild variant="secondary" className="w-full">
                    <Link to={`/fleet/vehicles/${data.assignedVehicle.id}/telemetry`}>
                      Open telemetry
                    </Link>
                  </Button>
                  {canAssign ? (
                    <Button
                      variant="ghost"
                      className="w-full gap-1.5"
                      loading={unassign.isPending}
                      onClick={() => unassign.mutate()}
                    >
                      <Link2Off className="h-4 w-4" />
                      Remove from vehicle
                    </Button>
                  ) : null}
                </>
              ) : canAssign ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    This unit is a spare. Fit it to a vehicle to start receiving telemetry — a
                    device with no vehicle has nothing to attribute its readings to, so the gateway
                    rejects them.
                  </p>
                  <div className="space-y-1.5">
                    <Label>Vehicle</Label>
                    <Select value={vehicleId} onValueChange={setVehicleId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a vehicle" />
                      </SelectTrigger>
                      <SelectContent>
                        {(vehicles.data?.items ?? [])
                          .filter((vehicle) => !vehicle.device)
                          .map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              {vehicle.registrationNumber} · {vehicle.typeLabel}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full gap-1.5"
                    disabled={!vehicleId}
                    loading={assign.isPending}
                    onClick={() => assign.mutate()}
                  >
                    <Link2 className="h-4 w-4" />
                    Fit to vehicle
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Not fitted to a vehicle.</p>
              )}
            </CardContent>
          </Card>

          {session?.demoMode && canManage && data.provider === 'MOCK' ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Simulate"
                  description="Drives this device through the real gateway, adapter and rule engine — the same path physical hardware takes."
                />
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {activeRun ? (
                  <>
                    <div className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">Running · {humanizeEnum(activeRun.scenario)}</p>
                      <p className="text-xs text-muted-foreground">
                        {activeRun.readingsSent} reading(s) sent every {activeRun.intervalSeconds}s
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      className="w-full gap-1.5"
                      loading={stopMock.isPending}
                      onClick={() => stopMock.mutate(activeRun.id)}
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Scenario</Label>
                      <Select value={scenario} onValueChange={setScenario}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SCENARIOS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {humanizeEnum(option)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">
                        Anything other than Normal injects a fault so the matching alert path can be
                        demonstrated.
                      </p>
                    </div>
                    <Button
                      className="w-full gap-1.5"
                      disabled={!data.assignedVehicle}
                      loading={startMock.isPending}
                      onClick={() => startMock.mutate()}
                    >
                      <Play className="h-4 w-4" />
                      Start streaming
                    </Button>
                    {!data.assignedVehicle ? (
                      <p className="text-2xs text-muted-foreground">
                        Fit the device to a vehicle first.
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {canManage ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Credentials" />
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <p className="text-sm text-muted-foreground">
                  The device authenticates with its identifier and a secret. VorldX Saarthi keeps only a
                  hash, so a lost secret is replaced rather than recovered.
                </p>
                <Button
                  variant="secondary"
                  className="w-full gap-1.5"
                  loading={rotate.isPending}
                  onClick={() => rotate.mutate()}
                >
                  <KeyRound className="h-4 w-4" />
                  Rotate secret
                </Button>
                <Separator />
                <p className="text-2xs text-muted-foreground">
                  Telemetry endpoint:{' '}
                  <code className="font-mono">POST /api/v1/device-gateway/telemetry</code> with{' '}
                  <code className="font-mono">x-device-id</code> and{' '}
                  <code className="font-mono">x-device-secret</code>.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DeviceDetailPage;

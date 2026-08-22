import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Cpu, KeyRound, PlugZap, Play, Radio, Square, TriangleAlert } from 'lucide-react';
import { Feature, Permission, RealtimeEvent, humanizeEnum } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import type {
  DeviceOverview,
  DeviceSummary,
  MockRunSummary,
  RegisteredDevice,
} from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Connected hardware.
 *
 * Two honesty rules run through this screen:
 *
 *  * A device secret is shown exactly once, at registration. It is stored as a
 *    bcrypt hash, so there is no "show again" — the dialog says so.
 *  * "Offline" is Saarthi's own verdict formed from silence, so the list shows
 *    how long a unit has been quiet rather than only a status pill.
 */

function statusTone(status: DeviceSummary['status']) {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'OFFLINE':
      return 'destructive';
    case 'SUSPENDED':
    case 'RETIRED':
      return 'destructive';
    case 'REGISTERED':
      return 'warning';
    default:
      return 'secondary';
  }
}

function formatSilence(seconds: number | null): string {
  if (seconds === null) return 'never reported';
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function DevicesPage() {
  const { can, hasFeature, session } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [secret, setSecret] = React.useState<RegisteredDevice | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [identifier, setIdentifier] = React.useState('');
  const [provider, setProvider] = React.useState('MOCK');
  const [serialNumber, setSerialNumber] = React.useState('');
  const [model, setModel] = React.useState('');

  const canRead = can(Permission.DEVICES_READ);
  const canManage = can(Permission.DEVICES_MANAGE);
  const hasHardware = hasFeature(Feature.HARDWARE_CONNECTIVITY);

  const overview = useQuery({
    queryKey: ['devices', 'overview'],
    queryFn: () => api.get<DeviceOverview>('/devices/overview'),
    enabled: canRead,
  });

  const devices = useQuery({
    queryKey: ['devices', page, search],
    queryFn: () =>
      api.get<Paginated<DeviceSummary>>('/devices', {
        page,
        pageSize: 20,
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    enabled: canRead,
  });

  const mockRuns = useQuery({
    queryKey: ['devices', 'mock-runs'],
    queryFn: () => api.get<MockRunSummary[]>('/devices/mock/runs'),
    enabled: canRead && Boolean(session?.demoMode),
    refetchInterval: 10_000,
  });

  useRealtimeEvent(RealtimeEvent.DEVICE_OFFLINE, () => {
    void devices.refetch();
    void overview.refetch();
  });
  useRealtimeEvent(RealtimeEvent.DEVICE_ONLINE, () => {
    void devices.refetch();
    void overview.refetch();
  });

  const register = useMutation({
    mutationFn: () =>
      api.post<RegisteredDevice>('/devices', {
        deviceIdentifier: identifier.trim(),
        provider,
        serialNumber: serialNumber.trim(),
        model: model.trim() || undefined,
      }),
    onSuccess: (result) => {
      setSecret(result);
      setIdentifier('');
      setSerialNumber('');
      setModel('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError ? error.message : 'That device could not be registered.',
      );
    },
  });

  const startMock = useMutation({
    mutationFn: (deviceId: string) =>
      api.post('/devices/mock/start', { deviceId, intervalSeconds: 5, scenario: 'NORMAL' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });

  const stopMock = useMutation({
    mutationFn: (runId: string) => api.post(`/devices/mock/${runId}/stop`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });

  if (!canRead) return <UnauthorizedState />;
  if (!hasHardware) {
    return (
      <div className="space-y-5">
        <PageHeader title="Devices" />
        <FeatureLockedState feature="Hardware connectivity" requiredPlan="Pro" />
      </div>
    );
  }

  const runningByDevice = new Map(
    (mockRuns.data ?? []).filter((run) => run.status === 'RUNNING').map((run) => [run.deviceId, run]),
  );

  const columns: Column<DeviceSummary>[] = [
    {
      key: 'device',
      header: 'Device',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.deviceIdentifier}</p>
          <p className="truncate text-xs text-muted-foreground">
            {humanizeEnum(row.provider)} · {row.model ?? row.serialNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="space-y-0.5">
          <Badge variant={statusTone(row.status)} size="sm">
            {humanizeEnum(row.status)}
          </Badge>
          <p className="text-2xs text-muted-foreground">{formatSilence(row.silentForSeconds)}</p>
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Fitted to',
      cell: (row) =>
        row.assignedVehicle ? (
          <Link
            to={`/fleet/vehicles/${row.assignedVehicle.id}`}
            className="text-sm hover:text-foreground"
          >
            {row.assignedVehicle.registrationNumber}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Spare</span>
        ),
    },
    {
      key: 'metrics',
      header: 'Reporting',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.observedMetrics.length > 0
            ? `${row.observedMetrics.length} metric${row.observedMetrics.length === 1 ? '' : 's'}`
            : 'nothing yet'}
        </span>
      ),
    },
    {
      key: 'readings',
      header: 'Readings',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (
        <div>
          <p className="text-sm">{row.readingCount.toLocaleString('en-IN')}</p>
          {row.rejectedCount > 0 ? (
            <p className="text-2xs text-destructive">{row.rejectedCount} rejected</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'alerts',
      header: 'Alerts',
      numeric: true,
      cell: (row) =>
        row.openAlerts > 0 ? (
          <Badge variant="warning" size="sm">
            {row.openAlerts}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'action',
      header: '',
      cell: (row) => {
        const run = runningByDevice.get(row.id);
        return (
          <div className="flex items-center gap-1">
            {session?.demoMode && canManage && row.provider === 'MOCK' && row.assignedVehicle ? (
              run ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  loading={stopMock.isPending}
                  onClick={() => stopMock.mutate(run.id)}
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  loading={startMock.isPending}
                  onClick={() => startMock.mutate(row.id)}
                >
                  <Play className="h-3.5 w-3.5" /> Simulate
                </Button>
              )
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link to={`/devices/${row.id}`}>Open</Link>
            </Button>
          </div>
        );
      },
    },
  ];

  const stats = overview.data;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Connect"
        title="Devices"
        description="Telematics units, their vehicles and what each one actually reports."
        actions={
          canManage ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button className="gap-1.5">
                  <PlugZap className="h-4 w-4" />
                  Register device
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Register a device</DialogTitle>
                  <DialogDescription>
                    Saarthi issues a secret the unit uses to authenticate. It is shown once and
                    stored only as a hash.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="device-id">Device identifier</Label>
                    <Input
                      id="device-id"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="FRM-ONEPLUS-H-0042"
                    />
                    <p className="text-2xs text-muted-foreground">
                      As printed on the unit. Letters, digits, hyphens and underscores.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hardware family</Label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FREEMATICS">Freematics ONE+ Model H</SelectItem>
                        <SelectItem value="GENERIC_OBD">Generic OBD device</SelectItem>
                        <SelectItem value="GENERIC_GPS">Generic GPS tracker</SelectItem>
                        <SelectItem value="GENERIC_CAN">Generic CAN / J1939 logger</SelectItem>
                        <SelectItem value="MOCK">Mock device (demonstrations)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-serial">Serial number</Label>
                    <Input
                      id="device-serial"
                      value={serialNumber}
                      onChange={(event) => setSerialNumber(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="device-model">Model</Label>
                    <Input
                      id="device-model"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder="ONE+ Model H"
                    />
                  </div>
                  {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                </div>
                <DialogFooter>
                  <Button
                    loading={register.isPending}
                    disabled={identifier.trim().length < 4 || serialNumber.trim().length < 3}
                    onClick={() => register.mutate()}
                  >
                    Register
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {secret ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader className="pb-2">
            <SectionHeader
              title="Copy this secret now"
              description="It cannot be shown again. If it is lost, rotate the credential from the device page."
            />
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-warning" />
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-sm">
                {secret.secret}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(secret.secret)}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Device <strong>{secret.device.deviceIdentifier}</strong> registered. Configure the unit
              to POST telemetry with the headers{' '}
              <code className="font-mono">x-device-id</code> and{' '}
              <code className="font-mono">x-device-secret</code>.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Reporting"
          numericValue={stats?.active ?? 0}
          format={(value) => String(Math.round(value))}
          icon={Radio}
          tone="success"
          live
        />
        <StatCard
          label="Offline"
          numericValue={stats?.offline ?? 0}
          format={(value) => String(Math.round(value))}
          icon={TriangleAlert}
          tone={stats && stats.offline > 0 ? 'destructive' : 'default'}
          hint="No telemetry for over 10 minutes"
        />
        <StatCard
          label="Spare units"
          numericValue={stats?.unassigned ?? 0}
          format={(value) => String(Math.round(value))}
          icon={Cpu}
        />
        <StatCard
          label="Readings today"
          numericValue={stats?.readingsToday ?? 0}
          format={(value) => Math.round(value).toLocaleString('en-IN')}
          icon={Radio}
          tone="info"
        />
      </div>

      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search by identifier, serial or model"
          className="max-w-sm"
        />
      </div>

      {devices.data && devices.data.items.length === 0 && !search ? (
        <EmptyState
          icon={PlugZap}
          title="No devices registered"
          description="Register a telematics unit to start receiving live engine, fuel and motion data. A mock device can be registered first to try the whole pipeline without hardware."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={devices.data?.items}
          rowKey={(row) => row.id}
          isLoading={devices.isLoading}
          error={devices.error}
          pagination={devices.data?.pagination}
          onPageChange={setPage}
          emptyTitle="No devices match"
          emptyDescription="Try a different search."
        />
      )}
    </div>
  );
}

export default DevicesPage;

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BatteryLow,
  BatteryMedium,
  Cpu,
  Link2Off,
  Plus,
  Signal,
  SignalZero,
  MonitorSmartphone,
  Smartphone,
  Video,
} from 'lucide-react';
import { Permission, humanizeEnum } from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { TerminalPairingPanel } from '@/features/terminal/terminal-pairing-panel';
import { cn } from '@/lib/utils';

/**
 * Vehicle → Hardware.
 *
 * Everything fitted to one vehicle, and the way to fit something else. Three
 * decisions shape it:
 *
 * **The QR is the whole "add device" flow.** There is no form asking somebody
 * to type an identifier off a screen — the phone already knows what it is, and
 * the only thing it is missing is which truck it is in. So the dashboard's job
 * is to answer that one question, and a code is the shortest path.
 *
 * **The code is visibly perishable.** A pairing code is a bearer credential:
 * anyone who photographs it can attach a device to this vehicle until it
 * expires. So the countdown is the largest thing on the dialog, not a footnote,
 * and the code is cancellable while it is still live.
 *
 * **A phone's health is shown, a Freematics' absence of one is not.** Battery
 * and signal are meaningful for an app-based device and meaningless for a
 * hard-wired unit. Rendering "Battery —" against a Freematics would invite
 * somebody to go looking for a fault; the row is simply not drawn.
 */

interface VehicleDeviceRow {
  id: string;
  deviceId: string;
  deviceIdentifier: string;
  provider: string;
  model: string | null;
  deviceStatus: string;
  status: string;
  assignedAt: string;
  unassignedAt: string | null;
  lastTelemetryAt: string | null;
}

interface DeviceClientHealth {
  selfEnrolled: boolean;
  platform: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  lastHeartbeatAt: string | null;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  networkType: string | null;
  gpsStatus: string | null;
  cameraStatus: string | null;
  bufferedEvents: number | null;
  reportingIntervalSeconds: number | null;
}

interface DeviceDetail {
  id: string;
  deviceIdentifier: string;
  provider: string;
  deviceType: string;
  role: string;
  status: string;
  lastSeenAt: string | null;
  lastTelemetryAt: string | null;
  client: DeviceClientHealth;
}

/** What a device may be connected as. Decided before the code is issued. */
type PairingKind = 'DEVICE' | 'TERMINAL';

interface IssuedPairingCode {
  id: string;
  registrationNumber: string;
  deviceType: string;
  expiresAt: string;
  ttlSeconds: number;
  qrImage: string;
  /** What the code actually encodes. Surfaced so `api` can be checked. */
  qrPayload: { v: number; kind: string; api: string; token: string };
  /**
   * The human-typeable form, `STH-XXXX-XXXX`.
   *
   * Terminal codes only. A tablet bolted into a cab often has a scratched
   * camera or is mounted where nothing can be held in front of it, and a
   * pairing flow that only works through a lens fails on exactly the units that
   * are hardest to reach. A test phone always has a working camera, so its code
   * has never needed one.
   */
  pairingCode?: string;
}

/**
 * Would this code work on a phone?
 *
 * The QR carries whichever address this dashboard was opened on, and a
 * loopback address is the one that cannot possibly work: on a phone,
 * `localhost` is the phone. The code scans perfectly and then fails on the
 * first request with a connection error naming an address the person never
 * typed, which is a genuinely hard thing to work out from the handset.
 *
 * Cheap to detect, so it is detected.
 */
function encodesUnreachableAddress(api: string): boolean {
  try {
    const { hostname } = new URL(api);
    return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
  } catch {
    return false;
  }
}

interface VehicleHardwareProps {
  vehicleId: string;
  registrationNumber: string;
}

/** Seconds remaining, ticking, so an expired code cannot look live. */
function useCountdown(expiresAt: string | undefined): number {
  const [remaining, setRemaining] = React.useState(0);

  React.useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = (): void => {
      const seconds = Math.max(
        0,
        Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setRemaining(seconds);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function relativeTime(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/**
 * Whether this unit reports its own health.
 *
 * A hard-wired tracker has no battery percentage to be missing, so the panel is
 * only drawn for devices that genuinely report one.
 */
function reportsOwnHealth(client: DeviceClientHealth): boolean {
  return client.lastHeartbeatAt !== null || client.platform !== null;
}

function HealthPanel({ client }: { client: DeviceClientHealth }): React.ReactElement {
  const battery = client.batteryPercent;
  const low = battery !== null && battery <= 20;
  const offline = client.networkType === 'OFFLINE' || client.networkType === null;

  return (
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Battery</p>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-medium',
            low && 'text-warning',
          )}
        >
          {low ? <BatteryLow className="size-3.5" /> : <BatteryMedium className="size-3.5" />}
          {battery === null ? 'Not reported' : `${battery}%`}
          {client.batteryCharging ? (
            <span className="text-xs text-muted-foreground">charging</span>
          ) : null}
        </span>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Network</p>
        <span className="inline-flex items-center gap-1.5 font-medium">
          {offline ? (
            <SignalZero className="size-3.5 text-warning" />
          ) : (
            <Signal className="size-3.5" />
          )}
          {client.networkType ? humanizeEnum(client.networkType) : 'Unknown'}
        </span>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">GPS</p>
        <span className="font-medium">
          {client.gpsStatus ? humanizeEnum(client.gpsStatus) : 'Unknown'}
        </span>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Camera</p>
        <span className="font-medium">
          {client.cameraStatus ? humanizeEnum(client.cameraStatus) : 'Unknown'}
        </span>
      </div>

      {client.bufferedEvents !== null && client.bufferedEvents > 0 ? (
        <div className="col-span-2 sm:col-span-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Waiting to upload
          </p>
          {/* Not an error. A device holding events is a device that kept them
              through an outage instead of losing them, which is the behaviour
              we want — so it reads as information, not as a fault. */}
          <span className="font-medium">
            {client.bufferedEvents} event{client.bufferedEvents === 1 ? '' : 's'} buffered on the
            device
          </span>
        </div>
      ) : null}

      <div className="col-span-2 sm:col-span-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Last heartbeat</p>
        <span className="font-medium">{relativeTime(client.lastHeartbeatAt)}</span>
        {client.appVersion ? (
          <span className="ml-2 text-xs text-muted-foreground">
            app {client.appVersion}
            {client.deviceModel ? ` · ${client.deviceModel}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DeviceCard({
  row,
  canUnpair,
  onUnpair,
  unpairing,
}: {
  row: VehicleDeviceRow;
  canUnpair: boolean;
  onUnpair: (deviceId: string) => void;
  unpairing: boolean;
}): React.ReactElement {
  const { can } = useAuth();

  const detail = useQuery({
    queryKey: ['device', row.deviceId],
    queryFn: () => api.get<DeviceDetail>(`/devices/${row.deviceId}`),
    enabled: can(Permission.DEVICES_READ),
    // A heartbeat lands every thirty seconds; polling faster would show the
    // same figures back with more requests.
    refetchInterval: 30_000,
  });

  const isPhone = row.provider === 'MOBILE';
  const client = detail.data?.client;
  /*
   * A terminal is listed here too, and correctly so: it genuinely is this
   * vehicle's telemetry source and this list answers "what is reporting".
   * But it enrols as provider MOBILE, so unlabelled it reads "Mobile" here and
   * "Saarthi Terminal" in the section below — the same identifier twice under
   * two names, which is exactly how one unit gets mistaken for two.
   */
  const isTerminal = detail.data?.deviceType === 'VEHICLE_TERMINAL';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              {isTerminal ? (
                <MonitorSmartphone className="size-4 text-muted-foreground" />
              ) : isPhone ? (
                <Smartphone className="size-4 text-muted-foreground" />
              ) : (
                <Cpu className="size-4 text-muted-foreground" />
              )}
              <Link to={`/devices/${row.deviceId}`} className="hover:underline">
                {row.deviceIdentifier}
              </Link>
            </span>
            <p className="text-xs text-muted-foreground">
              {isTerminal ? 'Saarthi Terminal' : humanizeEnum(row.provider)}
              {row.model ? ` · ${row.model}` : ''}
              {detail.data ? ` · ${humanizeEnum(detail.data.role)}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={
                row.deviceStatus === 'ACTIVE'
                  ? 'success'
                  : row.deviceStatus === 'OFFLINE'
                    ? 'warning'
                    : 'secondary'
              }
              size="sm"
            >
              {humanizeEnum(row.deviceStatus)}
            </Badge>
            {canUnpair ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Confirmed, because it stops a device that may be reporting
                  // right now — and on a vehicle with one telemetry slot, the
                  // consequence is that the map goes quiet.
                  const ok = window.confirm(
                    `Unpair ${row.deviceIdentifier} from this vehicle?\n\n` +
                      'It will stop reporting immediately. Telemetry already recorded stays ' +
                      'attached to this vehicle, and the device can be paired again with a new code.',
                  );
                  if (ok) onUnpair(row.deviceId);
                }}
                disabled={unpairing}
              >
                <Link2Off className="mr-1.5 size-3.5" />
                {unpairing ? 'Unpairing…' : 'Unpair'}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Fitted</p>
            <span className="font-medium">
              {new Date(row.assignedAt).toLocaleDateString()}
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Last telemetry
            </p>
            <span className="font-medium">{relativeTime(row.lastTelemetryAt)}</span>
          </div>
          {client?.reportingIntervalSeconds ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Reporting</p>
              <span className="font-medium">every {client.reportingIntervalSeconds}s</span>
            </div>
          ) : null}
        </div>

        {client && reportsOwnHealth(client) ? (
          <>
            <Separator />
            <HealthPanel client={client} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PairingDialog({
  code,
  kind,
  onClose,
  onCancel,
  cancelling,
}: {
  code: IssuedPairingCode | null;
  kind: PairingKind;
  onClose: () => void;
  onCancel: () => void;
  cancelling: boolean;
}): React.ReactElement {
  const remaining = useCountdown(code?.expiresAt);
  const expired = code !== null && remaining === 0;
  const terminal = kind === 'TERMINAL';

  return (
    <Dialog open={code !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {terminal ? 'Connect a terminal to ' : 'Pair a device to '}
            {code?.registrationNumber}
          </DialogTitle>
        </DialogHeader>

        {code ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              {expired ? (
                <div className="flex size-[320px] items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                  This code has expired.
                  <br />
                  Close and generate a new one.
                </div>
              ) : (
                <img
                  src={code.qrImage}
                  alt="Pairing code"
                  className="size-[320px] rounded-lg border bg-white p-2"
                />
              )}
            </div>

            {code.pairingCode ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-center">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                  Or type this on the terminal
                </p>
                <p
                  className={cn(
                    'select-all font-mono text-2xl font-semibold tracking-[0.2em]',
                    expired && 'text-muted-foreground line-through',
                  )}
                >
                  {code.pairingCode}
                </p>
              </div>
            ) : null}

            <div className="text-center">
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  remaining <= 30 && 'text-warning',
                )}
              >
                {formatCountdown(remaining)}
              </p>
              <p className="text-xs text-muted-foreground">
                {terminal
                  ? 'Open Saarthi Terminal on the tablet and scan or type this code.'
                  : 'Open Saarthi Device on the phone and scan this code.'}
              </p>
            </div>

            {encodesUnreachableAddress(code.qrPayload.api) ? (
              /*
               * The failure this prevents costs about twenty minutes to
               * diagnose from the phone, because the error names an address
               * nobody chose. Better to refuse to look ready.
               */
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="font-medium text-warning-foreground">
                  This code will not work on a phone.
                </p>
                <p className="mt-1 text-muted-foreground">
                  It points at{' '}
                  <code className="rounded bg-muted px-1">{code.qrPayload.api}</code>, which on a
                  phone means the phone itself. The code carries whichever address this dashboard
                  was opened on — reopen it on your machine&rsquo;s network address or tunnel URL,
                  then generate a new code.
                </p>
              </div>
            ) : (
              <p className="text-center text-2xs text-muted-foreground">
                The phone will connect to{' '}
                <code className="rounded bg-muted px-1">{code.qrPayload.api}</code>
              </p>
            )}

            {/* Stated at the moment of use rather than in a settings page
                nobody opens: this code is a credential, and it is what makes
                the phone part of this fleet. */}
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Anyone who uses this code before it expires can connect{' '}
              {terminal ? 'a terminal' : 'a device'} to {code.registrationNumber}
              {terminal
                ? ' and drivers will sign on to the vehicle through it.'
                : ' and start reporting its position.'}{' '}
              Cancel it if you did not mean to show it.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling || expired}>
                Cancel code
              </Button>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function VehicleHardware({
  vehicleId,
  registrationNumber,
}: VehicleHardwareProps): React.ReactElement {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = React.useState<IssuedPairingCode | null>(null);
  const [pairingKind, setPairingKind] = React.useState<PairingKind>('DEVICE');

  const canPair = can(Permission.DEVICES_PAIR) || can(Permission.DEVICES_ASSIGN);
  /*
   * Unpairing follows pairing.
   *
   * This was `devices.assign` alone, which a fleet operator does not hold — so
   * they could connect a phone and then had no way to disconnect it. Since a
   * vehicle carries only one telemetry source, that made the first pairing
   * permanent and the slot unusable.
   *
   * The server enforces the real boundary by device type: `devices.pair` may
   * disconnect an app-based device, and fitted hardware still needs
   * `devices.assign`.
   */
  const canUnpair = can(Permission.DEVICES_PAIR) || can(Permission.DEVICES_ASSIGN);

  const devices = useQuery({
    queryKey: ['vehicle-devices', vehicleId],
    queryFn: () => api.get<VehicleDeviceRow[]>(`/telemetry/vehicles/${vehicleId}/devices`),
    enabled: can(Permission.DEVICES_READ),
    refetchInterval: 30_000,
  });

  /**
   * Issue a pairing code, for either kind of unit.
   *
   * One mutation and one dialog rather than two of each. They are the same
   * decision — "connect something to this vehicle" — differing only in what is
   * on the other end, and two near-identical dialogs metres apart on the same
   * tab is how somebody opens the wrong one, scans a genuinely valid code and
   * watches nothing happen.
   *
   * The endpoints differ because the permissions do: connecting a terminal is
   * `terminal.manage`, connecting a test phone is `devices.pair`.
   */
  const issue = useMutation({
    mutationFn: (kind: PairingKind) => {
      setPairingKind(kind);
      return kind === 'TERMINAL'
        ? api.post<IssuedPairingCode>(
            `/fleet/vehicles/${vehicleId}/terminal-pairing`,
            {},
          )
        : api.post<IssuedPairingCode>(`/fleet/vehicles/${vehicleId}/pairing-token`, {
            deviceType: 'MOBILE_TEST_DEVICE',
          });
    },
    onSuccess: (issued) => setCode(issued),
    onError: (error) => {
      // "This vehicle already reports its position from X" is an ordinary
      // answer, not a failure — it tells the operator exactly what to do next.
      toast.error(
        error instanceof ApiError ? error.message : errorMessage(error),
      );
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/devices/pairing-tokens/${id}`),
    onSuccess: () => {
      setCode(null);
      toast.success('Pairing code cancelled.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unpair = useMutation({
    // The vehicle-scoped route, which accepts `devices.pair`. The older
    // `/devices/:id/unassign` is the platform-admin path for fitted hardware and
    // refuses a fleet operator outright.
    mutationFn: (deviceId: string) =>
      api.post(`/fleet/vehicles/${vehicleId}/devices/${deviceId}/unpair`, {}),
    onSuccess: async () => {
      toast.success('Device unpaired. The vehicle can now be paired to another device.');
      await queryClient.invalidateQueries({ queryKey: ['vehicle-devices', vehicleId] });
      await queryClient.invalidateQueries({ queryKey: ['vehicle-cameras', vehicleId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!can(Permission.DEVICES_READ)) {
    return (
      <EmptyState
        icon={Cpu}
        title="Hardware is not visible on your account"
        description="Ask a fleet administrator if you need to see the devices fitted to this vehicle."
      />
    );
  }

  if (devices.isLoading) return <LoadingState label="Loading hardware…" />;
  if (devices.isError) return <ErrorState error={devices.error} />;

  const active = (devices.data ?? []).filter((row) => row.status === 'ACTIVE');
  const past = (devices.data ?? []).filter((row) => row.status !== 'ACTIVE');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="Devices"
          description="Everything currently reporting for this vehicle. A vehicle can carry one telemetry source plus any number of cameras."
        />
        <div className="flex flex-wrap gap-2">
          {canPair ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => issue.mutate('DEVICE')}
              disabled={issue.isPending}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add device
            </Button>
          ) : null}
          {can(Permission.TERMINAL_MANAGE) ? (
            <Button
              size="sm"
              onClick={() => issue.mutate('TERMINAL')}
              disabled={issue.isPending}
            >
              <MonitorSmartphone className="mr-1.5 size-3.5" />
              Connect a terminal
            </Button>
          ) : null}
        </div>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="No device fitted"
          description={
            canPair
              ? 'Add a device to turn a phone into a Saarthi test device for this vehicle, or wait for Saarthi to install a telematics unit.'
              : 'No telematics unit or test device is reporting for this vehicle yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {active.map((row) => (
            <DeviceCard
              key={row.id}
              row={row}
              canUnpair={canUnpair}
              onUnpair={(deviceId) => unpair.mutate(deviceId)}
              unpairing={unpair.isPending}
            />
          ))}
        </div>
      )}

      {past.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <SectionHeader
              title="Previously fitted"
              description="Telemetry recorded by these devices stays attached to this vehicle."
            />
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm">
            {past.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0"
              >
                <Link to={`/devices/${row.deviceId}`} className="font-medium hover:underline">
                  {row.deviceIdentifier}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {new Date(row.assignedAt).toLocaleDateString()} –{' '}
                  {row.unassignedAt ? new Date(row.unassignedAt).toLocaleDateString() : '—'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {active.some((row) => row.provider === 'MOBILE' || row.provider === 'YC06') ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Video className="size-3.5" />
          Cameras on these devices appear under the Cameras tab, listed against{' '}
          {registrationNumber} rather than against the device.
        </p>
      ) : null}

      <Separator />

      {/*
        Terminals fitted to this vehicle, and who is signed on to them.
        Read-only: connecting one is the "Connect a terminal" action in the
        header above, so there is one pairing flow on this screen rather than
        two that look alike.
      */}
      <TerminalPairingPanel vehicleId={vehicleId} registrationNumber={registrationNumber} />

      <PairingDialog
        code={code}
        kind={pairingKind}
        onClose={() => setCode(null)}
        onCancel={() => code && cancel.mutate(code.id)}
        cancelling={cancel.isPending}
      />
    </div>
  );
}

export default VehicleHardware;

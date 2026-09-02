import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2Off, MonitorSmartphone } from 'lucide-react';
import { Permission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Vehicle → Hardware → Saarthi Terminal.
 *
 * Read-only. Connecting a terminal is the "Connect a terminal" action in the
 * Devices header above, alongside "Add device", because they are the same
 * decision — connect something to this vehicle — and only differ in what is on
 * the other end.
 *
 * This panel previously carried its own pairing dialog. That was a mistake:
 * two near-identical dialogs metres apart on one tab meant somebody opened the
 * wrong one, scanned a code that was genuinely valid, and watched a terminal do
 * nothing. One flow, one dialog, one place to look.
 *
 * What is left here is the thing the other panel cannot show — which terminals
 * are fitted, and who is signed on to them right now — plus the way to remove
 * one. Disconnecting stays *here* rather than joining the pairing dialog above,
 * because it is an action on a specific fitted unit and this is the only place
 * that names them.
 */

interface TerminalRow {
  deviceId: string;
  deviceIdentifier: string;
  status: string;
  vehicleId: string | null;
  registrationNumber: string | null;
  appVersion: string | null;
  lastHeartbeatAt: string | null;
  batteryPercent: number | null;
  currentDriverName: string | null;
  state: string;
}

export function TerminalPairingPanel({
  vehicleId,
  registrationNumber,
}: {
  vehicleId: string;
  registrationNumber: string;
}): React.ReactElement | null {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const terminals = useQuery({
    queryKey: ['fleet-terminals'],
    queryFn: () => api.get<TerminalRow[]>('/terminal/terminals'),
    enabled: can(Permission.TERMINAL_READ),
    refetchInterval: 30_000,
  });

  /**
   * Disconnect a terminal from this vehicle.
   *
   * The same vehicle-scoped route the device list uses — a terminal is an
   * app-based device and takes the app-based removal path, not the
   * platform-admin one for fitted hardware.
   *
   * A vehicle carries exactly one telemetry source, so this is not a tidying-up
   * action: until the fitted terminal is removed, "Connect a terminal" refuses
   * and the slot is stuck. That is why the button lives on the card rather than
   * behind a menu.
   */
  const unpair = useMutation({
    mutationFn: (deviceId: string) =>
      api.post(`/fleet/vehicles/${vehicleId}/devices/${deviceId}/unpair`, {
        reason: 'Disconnected from the Saarthi dashboard.',
      }),
    onSuccess: async () => {
      toast.success('Terminal disconnected. You can connect another one now.');
      await queryClient.invalidateQueries({ queryKey: ['fleet-terminals'] });
      await queryClient.invalidateQueries({ queryKey: ['vehicle-devices', vehicleId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!can(Permission.TERMINAL_READ)) return null;

  const fitted = (terminals.data ?? []).filter((row) => row.vehicleId === vehicleId);

  return (
    <div className="space-y-3">
      <SectionHeader
        title="Saarthi Terminal"
        description="The vehicle-mounted tablet drivers sign on to. It shows this vehicle's permanent QR and runs the pre-trip safety check."
      />

      {fitted.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <MonitorSmartphone className="size-5 shrink-0" />
            <span>
              No terminal is connected to {registrationNumber}. Use{' '}
              <span className="font-medium text-foreground">Connect a terminal</span> above —
              drivers cannot sign on to this vehicle until one is.
            </span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {fitted.map((row) => (
            <Card key={row.deviceId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="space-y-1">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <MonitorSmartphone className="size-4" />
                    {row.deviceIdentifier}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.currentDriverName
                      ? `${row.currentDriverName} signed on`
                      : 'No driver signed on'}
                    {row.appVersion ? ` · v${row.appVersion}` : ''}
                    {row.batteryPercent !== null ? ` · ${row.batteryPercent}%` : ''}
                  </p>
                  {row.currentDriverName ? (
                    // Said before the tap rather than after it. Disconnecting
                    // ends the driver's authorisation, and somebody removing a
                    // terminal to swap hardware may not realise a driver is
                    // mid-shift on it.
                    <p className="text-2xs text-warning">
                      Disconnecting will sign {row.currentDriverName} off this vehicle.
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={row.state === 'AWAITING_DRIVER' ? 'secondary' : 'default'}>
                    {row.state.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  {can(Permission.TERMINAL_MANAGE) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => unpair.mutate(row.deviceId)}
                      disabled={unpair.isPending}
                    >
                      <Link2Off className="mr-1.5 size-3.5" />
                      {unpair.isPending ? 'Disconnecting…' : 'Disconnect'}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default TerminalPairingPanel;

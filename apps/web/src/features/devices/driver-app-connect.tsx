import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bluetooth, Cpu, Radio, ScanLine, UserCheck, UserPlus } from 'lucide-react';
import { Feature, Permission, TrackerProduct, describeTrackerPrices } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SubjectQrPanel } from '@/features/qr/subject-qr-panel';
import { TrackerOfferDialog } from '@/features/telemetry/tracker-offer-dialog';

/**
 * Vehicle → Hardware: connecting the driver's phone.
 *
 * The owner's whole path from "driver app only" to "tracker fitted", on one
 * card. The owner assigns a driver; that driver scans this vehicle's QR in the
 * Saarthi Driver app and the phone pairs and stays paired; every shift is still
 * approved, and the phone reports only while one is. A Saarthi OBD then rides on
 * that same phone, and a 4G tracker takes over reporting from it.
 */

const STEPS = [
  {
    icon: UserPlus,
    title: 'Assign a driver',
    body: 'Assign the driver who drives this vehicle, from its Overview.',
  },
  {
    icon: ScanLine,
    title: 'Driver scans this QR',
    body: 'In the Saarthi Driver app. Their phone pairs to the vehicle and stays paired.',
  },
  {
    icon: UserCheck,
    title: 'Approve each shift',
    body: 'Selfie, approval and the pre-trip check every shift. The phone reports only while a shift is approved.',
  },
] as const;

interface VehicleTrackerRow {
  status: string;
  product: TrackerProduct;
  truckId: string | null;
}

/** What the tracker on this vehicle means for the driver's phone. */
const TRACKER_NOTE: Record<TrackerProduct, { icon: typeof Cpu; title: string; body: string }> = {
  [TrackerProduct.OBD_BLUETOOTH]: {
    icon: Bluetooth,
    title: 'Saarthi OBD on this vehicle',
    body: 'Once the driver scans, the app opens the OBD connection. Engine and fuel data then come through their phone.',
  },
  [TrackerProduct.CONNECTED_4G]: {
    icon: Radio,
    title: 'Saarthi 4G Tracker on this vehicle',
    body: 'The tracker reports on its own. The driver’s phone stays paired for the app, but its position is not used.',
  },
};

export function DriverAppConnect({
  vehicleId,
  registrationNumber,
}: {
  vehicleId: string;
  registrationNumber: string;
}): React.ReactElement {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const [offerOpen, setOfferOpen] = React.useState(false);

  const canSeeQr = can(Permission.QR_READ) && hasFeature(Feature.QR_IDENTITY);
  const canApprove = can(Permission.TERMINAL_APPROVE);
  const canReadTrackers = can(Permission.SUBSCRIPTION_READ);

  // The same query, and so the same cache, as the subscription screen.
  const trackers = useQuery({
    queryKey: ['subscription', 'trackers'],
    queryFn: () => api.get<VehicleTrackerRow[]>('/subscriptions/trackers'),
    enabled: canReadTrackers,
  });
  const tracker =
    trackers.data?.find((row) => row.status === 'ACTIVE' && row.truckId === vehicleId)?.product ??
    null;
  const note = tracker ? TRACKER_NOTE[tracker] : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Connect with the Saarthi Driver app"
          description={`The assigned driver's phone reports for ${registrationNumber} during their approved shifts.`}
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs tabular-nums">
                  {index + 1}
                </span>
                <step.icon className="size-3.5 text-muted-foreground" aria-hidden />
                {step.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>

        <p className="text-xs text-muted-foreground">
          A driver who is not assigned can still scan for a shift. Approving them replaces the
          assigned driver, whose phone is then unpaired.
        </p>

        {canApprove ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/fleet/terminal-approvals">Open terminal approvals</Link>
          </Button>
        ) : null}

        {canSeeQr ? (
          <SubjectQrPanel
            subjectType="VEHICLE"
            subjectId={vehicleId}
            description="The same code as the QR tab. Show it on this screen or print it for the cab - the driver app accepts either."
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask a fleet administrator for this vehicle&apos;s QR code - the driver scans it to pair
            their phone.
          </p>
        )}

        {note ? (
          <div className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <note.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{note.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {note.body}
              </span>
            </span>
          </div>
        ) : canReadTrackers && trackers.isSuccess ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3 text-sm">
            <span className="flex min-w-0 flex-1 items-start gap-2 text-muted-foreground">
              <Cpu className="mt-0.5 size-4 shrink-0" aria-hidden />A phone reports where the
              vehicle is. Engine, fuel and fault codes need a Saarthi tracker -{' '}
              {describeTrackerPrices()}, once per vehicle.
            </span>
            <Button size="sm" variant="outline" onClick={() => setOfferOpen(true)}>
              See tracker options
            </Button>
          </div>
        ) : null}
      </CardContent>

      <TrackerOfferDialog
        open={offerOpen}
        onOpenChange={setOfferOpen}
        vehicleId={vehicleId}
        vehicleLabel={registrationNumber}
        onPurchased={() => {
          void queryClient.invalidateQueries({ queryKey: ['session'] });
          void queryClient.invalidateQueries({ queryKey: ['subscription', 'trackers'] });
          void queryClient.invalidateQueries({ queryKey: ['vehicle-devices', vehicleId] });
        }}
      />
    </Card>
  );
}

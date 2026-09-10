import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackageCheck } from 'lucide-react';
import {
  Permission,
  TrackerHandoverStatus,
  formatDate,
  formatNumber,
  relativeTimeFrom,
} from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import type { HandoverSummary, HandoverView } from '@/features/sales/types';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { MiniStat } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The trackers a salesperson is carrying.
 *
 * Saarthi provides the tracker and a customer cannot substitute their own, so
 * this screen is a custody chain and nothing more: which paid-for units are in
 * the salesperson's bag, which have been handed over and to whom, and which the
 * customer has since fitted.
 *
 * Two things it deliberately does not do.
 *
 * **It does not activate anything.** Recording a handover grants no
 * entitlement, starts no billing and pairs no device. The tracker was paid for
 * on the customer's own subscription, and fitting it to a vehicle is the
 * customer's action on their own subscription screen.
 *
 * **There is no QR code here.** Saarthi trackers carry none. The vehicle does,
 * and scanning it is the existing Saarthi Driver App flow.
 */
export function SalesTrackersPage(): React.ReactElement {
  const { can } = useAuth();
  const { profile, godWebVerificationAvailable, canSell } = useSalesProfile();
  const [page, setPage] = React.useState(1);
  const [handingOver, setHandingOver] = React.useState<HandoverView | null>(null);

  const summary = useQuery({
    queryKey: ['/sales/trackers/summary'],
    queryFn: () => api.get<HandoverSummary>('/sales/trackers/summary'),
    enabled: can(Permission.TRACKER_HANDOVER_READ),
  });

  const handovers = useQuery({
    queryKey: ['/sales/trackers', page],
    queryFn: () => api.get<Paginated<HandoverView>>('/sales/trackers', { page, pageSize: 20 }),
    enabled: can(Permission.TRACKER_HANDOVER_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.TRACKER_HANDOVER_READ)) return <UnauthorizedState />;

  const columns: Column<HandoverView>[] = [
    {
      key: 'serial',
      header: 'Tracker',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.serialNumber ?? `Unit ${row.trackerId.slice(0, 8)}`}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.organizationName ?? 'Not allocated to a customer'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Custody',
      cell: (row) =>
        /*
         * A written-off unit is stated in words rather than through
         * `StatusBadge`. `LOST` is a value of both the lead pipeline and this
         * one, and the shared colour map cannot make it muted for a lost
         * prospect and destructive for lost hardware — see the note there.
         */
        row.status === TrackerHandoverStatus.LOST ? (
          <span className="text-sm font-medium text-destructive">Written off</span>
        ) : (
          <StatusBadge status={row.status} />
        ),
    },
    {
      key: 'acknowledged',
      header: 'Signed for by',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.acknowledgedBy ?? '—'}</span>
      ),
    },
    {
      key: 'vehicle',
      header: 'Fitted to',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.vehicleRegistration ?? '—'}</span>
      ),
    },
    {
      key: 'when',
      header: 'When',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.handedOverAt
            ? relativeTimeFrom(row.handedOverAt)
            : `Allocated ${formatDate(row.assignedAt)}`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        row.status === TrackerHandoverStatus.ASSIGNED_TO_SALESMAN ? (
          <Button size="sm" variant="outline" onClick={() => setHandingOver(row)} disabled={!canSell}>
            Hand over
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title="My trackers"
        description="Units allocated to you, and who you gave each one to."
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      {summary.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Available" value={formatNumber(summary.data.available)} />
          <MiniStat label="Handed over" value={formatNumber(summary.data.handedOver)} />
          <MiniStat label="Installed" value={formatNumber(summary.data.installed)} />
          <MiniStat
            label="Returned or lost"
            value={formatNumber(summary.data.returned + summary.data.lost)}
          />
        </div>
      ) : null}

      <Alert>
        <PackageCheck className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Recording a handover does not switch a tracker on or charge anybody. The customer paid
          for it on their subscription; they fit it to a vehicle from their own subscription
          screen, then the driver connects it with the Saarthi Driver App. Saarthi marks a unit
          installed on its own, from the vehicle’s device record.
        </AlertDescription>
      </Alert>

      <section className="space-y-3">
        <SectionHeader title="Custody" />
        <DataTable
          columns={columns}
          rows={handovers.data?.items}
          rowKey={(row) => row.id}
          isLoading={handovers.isLoading}
          error={handovers.error}
          onRetry={() => void handovers.refetch()}
          {...(handovers.data?.pagination ? { pagination: handovers.data.pagination } : {})}
          onPageChange={setPage}
          emptyTitle="No trackers allocated to you"
          emptyDescription="Saarthi operations allocates stock to you once a customer has paid for a tracker."
        />
      </section>

      <HandoverDialog
        handover={handingOver}
        onClose={() => setHandingOver(null)}
      />
    </div>
  );
}

/**
 * Record a tracker changing hands.
 *
 * `acknowledgedBy` is required, and it is the whole point of the form: a
 * handover with nobody's name against it is the one that gets disputed months
 * later when a unit cannot be found. The salesperson is standing in front of
 * that person when they fill it in.
 */
function HandoverDialog({
  handover,
  onClose,
}: {
  handover: HandoverView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [acknowledgedBy, setAcknowledgedBy] = React.useState('');
  const [serialNumber, setSerialNumber] = React.useState('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    setAcknowledgedBy('');
    setSerialNumber(handover?.serialNumber ?? '');
    setNote('');
  }, [handover]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<HandoverView>(`/sales/trackers/${handover?.id}/handover`, {
        acknowledgedBy,
        ...(serialNumber ? { serialNumber } : {}),
        ...(note ? { note } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/trackers'] });
      void queryClient.invalidateQueries({ queryKey: ['/sales/trackers/summary'] });
      void queryClient.invalidateQueries({ queryKey: ['/sales/dashboard'] });
      toast.success('Handover recorded.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={handover !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand over the tracker</DialogTitle>
          <DialogDescription>
            {handover?.organizationName
              ? `To ${handover.organizationName}.`
              : 'Record who took the unit.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="handover-by">Who signed for it *</Label>
            <Input
              id="handover-by"
              value={acknowledgedBy}
              onChange={(event) => setAcknowledgedBy(event.target.value)}
              placeholder="Name of the person who took it"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-serial">Serial number</Label>
            <Input
              id="handover-serial"
              value={serialNumber}
              onChange={(event) => setSerialNumber(event.target.value)}
              placeholder="Printed on the unit"
            />
            <p className="text-xs text-muted-foreground">
              Saved onto the customer’s own subscription record too, so they can see which unit
              they have.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handover-note">Note</Label>
            <Textarea
              id="handover-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={acknowledgedBy.trim().length < 2 || submit.isPending}
          >
            {submit.isPending ? 'Recording…' : 'Record handover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SalesTrackersPage;

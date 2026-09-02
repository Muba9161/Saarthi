import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BadgeCheck,
  Check,
  Clock,
  MonitorSmartphone,
  ShieldAlert,
  Truck,
  X,
} from 'lucide-react';
import {
  Permission,
  RealtimeEvent,
  TERMINAL_APPROVAL_SLA,
  humanizeEnum,
  type Paginated,
  type TerminalSessionView,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnauthorizedState,
} from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MediaImage } from '@/features/media/media-image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Terminal arrivals — the approval queue.
 *
 * This screen is where a person decides whether somebody may take a vehicle
 * out. Three things shape it, and each answers a way the decision can go wrong:
 *
 * **The evidence comes before the buttons.** The photo the driver just took,
 * their licence validity and their history with this vehicle are all above the
 * Approve control, because an approval made without looking is worse than no
 * approval process at all.
 *
 * **The clock is visible and it is honest.** It counts toward escalation, and
 * the copy says escalation — never "auto-approve", because nothing here ever
 * approves on its own. A manager who believed the system would sort it out is a
 * manager who stops answering.
 *
 * **A rejection needs a reason.** The driver reads it on the terminal. A
 * refusal with no explanation leaves somebody standing at a truck at four in
 * the morning with nothing to do next.
 */

interface ApprovalDetail extends TerminalSessionView {
  recentAssignments: {
    id: string;
    registrationNumber: string;
    status: string;
    requestedAt: string;
    /** True when this arrival was at the vehicle now being decided. */
    sameVehicle: boolean;
  }[];
  events: { id: string; eventType: string; description: string | null; createdAt: string }[];
}

const PENDING_STATUSES = new Set([
  'DRIVER_IDENTIFIED',
  'SELFIE_SUBMITTED',
  'PENDING_APPROVAL',
]);

/** Seconds remaining, ticking, so a stale countdown cannot look live. */
function useTicker(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function EscalationClock({
  session,
  now,
}: {
  session: TerminalSessionView;
  now: number;
}): React.ReactElement | null {
  if (session.status !== 'PENDING_APPROVAL' || !session.submittedAt) return null;

  const deadline =
    new Date(session.submittedAt).getTime() +
    TERMINAL_APPROVAL_SLA.escalateAfterMinutes * 60_000;
  const remaining = Math.round((deadline - now) / 1000);
  const overdue = remaining <= 0;
  const minutes = Math.floor(Math.abs(remaining) / 60);
  const seconds = Math.abs(remaining) % 60;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium tabular-nums',
        overdue ? 'text-destructive' : remaining < 300 ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      <Clock className="size-3.5" />
      {overdue ? 'Escalated ' : ''}
      {minutes}:{String(seconds).padStart(2, '0')}
      {overdue ? ' ago' : ' to escalation'}
    </span>
  );
}

function LicenceBadge({ session }: { session: TerminalSessionView }): React.ReactElement {
  const validity = session.driver?.licenseValidity ?? 'NO_EXPIRY';
  const bad = validity === 'EXPIRED' || validity === 'REJECTED';
  const warn = validity === 'EXPIRING_SOON' || validity === 'PENDING_VERIFICATION';

  return (
    <Badge variant={bad ? 'destructive' : warn ? 'outline' : 'secondary'}>
      {bad ? <ShieldAlert className="mr-1 size-3" /> : <BadgeCheck className="mr-1 size-3" />}
      Licence {humanizeEnum(validity).toLowerCase()}
    </Badge>
  );
}

function RequestCard({
  session,
  now,
  onOpen,
}: {
  session: TerminalSessionView;
  now: number;
  onOpen: () => void;
}): React.ReactElement {
  const pending = PENDING_STATUSES.has(session.status);

  return (
    <Card className={cn(pending && 'border-primary/40')}>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
{/*
          The photograph the approver is deciding on.
          Fetched with the session token: a plain `<img src>` sends no
          Authorization header, so this rendered as an empty box — which meant
          approving a driver on the strength of a photo nobody had seen.
        */}
        <MediaImage
          source={session.selfieUrl}
          alt={`Arrival photo for ${session.driver?.name ?? 'the driver'}`}
          variant="thumbnail"
          className="size-16 shrink-0 rounded-lg border object-cover"
          fallback={
            <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed text-2xs text-muted-foreground">
              No photo
            </div>
          }
        />

        <div className="min-w-[12rem] flex-1 space-y-1">
          <p className="font-medium">{session.driver?.name ?? 'Unknown driver'}</p>
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Truck className="size-3.5" />
            {session.registrationNumber}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <LicenceBadge session={session} />
            <Badge variant={pending ? 'default' : 'outline'}>
              {humanizeEnum(session.status)}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <EscalationClock session={session} now={now} />
          <span className="text-xs text-muted-foreground">
            Arrived {new Date(session.requestedAt).toLocaleTimeString()}
          </span>
          <Button size="sm" variant={pending ? 'default' : 'outline'} onClick={onOpen}>
            {pending ? 'Review' : 'View'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionDialog({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const now = useTicker();

  React.useEffect(() => {
    setReason('');
    setNote('');
  }, [sessionId]);

  const detail = useQuery({
    queryKey: ['terminal-approval', sessionId],
    queryFn: () => api.get<ApprovalDetail>(`/terminal/assignments/${sessionId}`),
    enabled: sessionId !== null,
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['terminal-approvals'] });
    await queryClient.invalidateQueries({ queryKey: ['terminal-approval', sessionId] });
  };

  const approve = useMutation({
    mutationFn: () =>
      api.post(`/terminal/assignments/${sessionId}/approve`, {
        note: note || undefined,
        assignVehicle: true,
      }),
    onSuccess: async () => {
      toast.success('Driver approved. The terminal has been told.');
      await invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reject = useMutation({
    mutationFn: () =>
      api.post(`/terminal/assignments/${sessionId}/reject`, { reason }),
    onSuccess: async () => {
      toast.success('Request rejected. The driver has been told why.');
      await invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const session = detail.data;
  const decidable = session ? PENDING_STATUSES.has(session.status) : false;
  const canDecide = can(Permission.TERMINAL_APPROVE);

  return (
    <Dialog open={sessionId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Driver arrival</DialogTitle>
        </DialogHeader>

        {detail.isLoading ? <LoadingState label="Loading request…" /> : null}
        {detail.isError ? <ErrorState error={detail.error} /> : null}

        {session ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <MediaImage
                source={session.selfieUrl}
                alt={`Arrival photo for ${session.driver?.name ?? 'the driver'}`}
                className="size-28 rounded-lg border object-cover"
                fallback={
                  <div className="flex size-28 items-center justify-center rounded-lg border border-dashed text-center text-2xs text-muted-foreground">
                    No arrival photo submitted
                  </div>
                }
              />
              <div className="flex-1 space-y-1.5">
                <p className="text-lg font-semibold">{session.driver?.name ?? 'Unknown driver'}</p>
                <p className="text-sm text-muted-foreground">{session.registrationNumber}</p>
                <LicenceBadge session={session} />
                {session.driver ? (
                  <p className="text-xs text-muted-foreground">
                    {session.driver.licenseClass ?? 'Licence class not recorded'} ·{' '}
                    {session.driver.experienceYears} yrs · {session.driver.totalTrips} trips
                    {session.driver.scoreBand
                      ? ` · ${humanizeEnum(session.driver.scoreBand).toLowerCase()}`
                      : ''}
                  </p>
                ) : null}
                <EscalationClock session={session} now={now} />
              </div>
            </div>

            {session.driver?.verificationStatus !== 'VERIFIED' ? (
              /* Stated plainly at the point of decision. An approver reading
                 "licence valid" off an unchecked self-declaration is exactly
                 the failure this warning exists to prevent. */
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="font-medium text-warning-foreground">
                  This driver&rsquo;s profile has not been verified by Saarthi.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Their licence details are self-declared. Check the licence itself before
                  approving.
                </p>
              </div>
            ) : null}

            <Separator />

            <div>
              <SectionHeader
                title="Recent arrivals"
                description="Whether this is somebody who drives this vehicle regularly."
              />
              {session.recentAssignments.length === 0 ? (
                <p className="pt-2 text-sm text-muted-foreground">
                  No previous terminal arrivals on record.
                </p>
              ) : (
                <ul className="space-y-1 pt-2 text-sm">
                  {session.recentAssignments.map((entry) => (
                    <li key={entry.id} className="flex justify-between gap-2">
                      <span className={entry.sameVehicle ? 'font-medium' : undefined}>
                        {entry.registrationNumber}
                        {entry.sameVehicle ? ' · this vehicle' : ''}
                      </span>
                      <span className="text-muted-foreground">
                        {humanizeEnum(entry.status).toLowerCase()} ·{' '}
                        {new Date(entry.requestedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {session.rejectionReason ? (
              <div className="rounded-md bg-destructive/10 p-3 text-sm">
                <p className="font-medium text-destructive">Rejected</p>
                <p className="text-muted-foreground">{session.rejectionReason}</p>
              </div>
            ) : null}

            {decidable && canDecide ? (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="approval-note">Note (optional, kept on the record)</Label>
                    <Textarea
                      id="approval-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      placeholder="Anything worth recording about this approval."
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reject-reason">
                      Reason for rejection — the driver reads this
                    </Label>
                    <Textarea
                      id="reject-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={2}
                      placeholder="e.g. You are rostered on UP32 CD 5678 today."
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => reject.mutate()}
                      disabled={reject.isPending || reason.trim().length < 3}
                    >
                      <X className="mr-1.5 size-3.5" />
                      Reject
                    </Button>
                    <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                      <Check className="mr-1.5 size-3.5" />
                      Approve
                    </Button>
                  </div>

                  <p className="text-2xs text-muted-foreground">
                    Approving assigns {session.driver?.name ?? 'this driver'} to{' '}
                    {session.registrationNumber} and lets them start the pre-trip safety check.
                    Nothing approves on its own — an unanswered request escalates after{' '}
                    {TERMINAL_APPROVAL_SLA.escalateAfterMinutes} minutes and then lapses.
                  </p>
                </div>
              </>
            ) : null}

            {session.events.length > 0 ? (
              <>
                <Separator />
                <div>
                  <SectionHeader title="History" />
                  <ul className="space-y-1 pt-2 text-xs text-muted-foreground">
                    {session.events.map((event) => (
                      <li key={event.id}>
                        {new Date(event.createdAt).toLocaleTimeString()} —{' '}
                        {event.description ?? humanizeEnum(event.eventType)}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function TerminalApprovalsPage(): React.ReactElement {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [showAll, setShowAll] = React.useState(false);
  const now = useTicker();

  const selected = params.get('session');

  const queue = useQuery({
    queryKey: ['terminal-approvals', showAll],
    queryFn: () =>
      api.get<Paginated<TerminalSessionView>>(
        `/terminal/assignments?pageSize=50${showAll ? '' : '&pendingOnly=true'}`,
      ),
    enabled: can(Permission.TERMINAL_READ),
    // A fallback behind the socket. A driver waiting at a truck is the one case
    // where a missed realtime message must not cost minutes.
    refetchInterval: 30_000,
  });

  useRealtimeEvent(RealtimeEvent.TERMINAL_SESSION_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['terminal-approvals'] });
    void queryClient.invalidateQueries({ queryKey: ['terminal-approval'] });
  });

  if (!can(Permission.TERMINAL_READ)) {
    return <UnauthorizedState message="Terminal arrivals are not visible on your account." />;
  }

  const items = queue.data?.items ?? [];
  const pending = items.filter((session) => PENDING_STATUSES.has(session.status));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Terminal arrivals"
        description="Drivers who have scanned a vehicle QR at a Saarthi Terminal and are waiting to be authorised."
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show waiting only' : 'Show all arrivals'}
          </Button>
        }
      />

      {pending.length > 0 ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          <p className="font-medium">
            {pending.length} driver{pending.length === 1 ? '' : 's'} waiting at a vehicle.
          </p>
          <p className="text-muted-foreground">
            An unanswered request escalates to fleet owners after{' '}
            {TERMINAL_APPROVAL_SLA.escalateAfterMinutes} minutes. It is never approved
            automatically.
          </p>
        </div>
      ) : null}

      {queue.isLoading ? <LoadingState label="Loading arrivals…" /> : null}
      {queue.isError ? <ErrorState error={queue.error} /> : null}

      {queue.isSuccess && items.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title={showAll ? 'No terminal arrivals yet' : 'Nobody is waiting'}
          description={
            showAll
              ? 'Connect a Saarthi Terminal to a vehicle from its Hardware tab, then ask a driver to scan the vehicle QR from their Saarthi account.'
              : 'Every driver who arrived has been dealt with.'
          }
        />
      ) : null}

      <div className="space-y-3">
        {items.map((session) => (
          <RequestCard
            key={session.id}
            session={session}
            now={now}
            onOpen={() => setParams({ session: session.id })}
          />
        ))}
      </div>

      <DecisionDialog
        sessionId={selected}
        onClose={() => {
          const next = new URLSearchParams(params);
          next.delete('session');
          setParams(next);
        }}
      />
    </div>
  );
}

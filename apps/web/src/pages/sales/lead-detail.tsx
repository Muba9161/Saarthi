import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  CircleDashed,
  HelpCircle,
  MessageSquarePlus,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  Permission,
  SALES_LEAD_STATUS_LABEL,
  formatDate,
  formatDateTime,
  humanizeEnum,
  relativeTimeFrom,
  type OnboardingStepResult,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import type {
  AssistedSignupResponse,
  CustomerVehiclesResponse,
  LeadEventView,
  LeadView,
  OnboardingCompleteResponse,
  OnboardingReadiness,
} from '@/features/sales/types';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * One lead, from first call to a live first vehicle.
 *
 * Two parts of this screen are worth reading closely.
 *
 * The stage dropdown offers only `lead.availableStatuses`, which the API
 * computes. The stages Saarthi sets itself — Subscribed, Tracker pending,
 * Onboarding, Activated — never appear there, because they are read from the
 * customer's real subscription, handover and telemetry. A salesperson cannot
 * mark their own conversion.
 *
 * The first-vehicle checklist is a mirror, not a form. Each of its six ticks is
 * the API reporting what the tracker, the device assignment and the vehicle's
 * own telemetry actually say, and Complete onboarding is refused by the server
 * unless all six are confirmed — so it is not a button that asserts anything.
 */
export function SalesLeadDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const lead = useQuery({
    queryKey: ['/sales/leads', id],
    queryFn: () => api.get<LeadView>(`/sales/leads/${id}`),
    enabled: can(Permission.LEADS_READ) && Boolean(id),
  });

  const history = useQuery({
    queryKey: ['/sales/leads', id, 'history'],
    queryFn: () => api.get<LeadEventView[]>(`/sales/leads/${id}/history`),
    enabled: can(Permission.LEADS_READ) && Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['/sales/leads'] });
    void queryClient.invalidateQueries({ queryKey: ['/sales/dashboard'] });
  };

  if (!can(Permission.LEADS_READ)) return <UnauthorizedState />;
  if (lead.isLoading) return <LoadingState className="min-h-[50vh]" />;
  if (!lead.data) {
    return (
      <EmptyState
        title="Lead not found"
        description="It may belong to another salesperson, or it may have been removed."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/sales/leads">Back to my leads</Link>
          </Button>
        }
      />
    );
  }

  const row = lead.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/sales/leads" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="h-3 w-3" /> My leads
          </Link>
        }
        title={row.businessName ?? row.contactName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{row.contactName}</span>
            <span>·</span>
            <a href={`tel:${row.phone}`} className="hover:underline">
              {row.phone}
            </a>
            {row.city ? (
              <>
                <span>·</span>
                <span>{row.city}</span>
              </>
            ) : null}
          </span>
        }
        actions={<StatusBadge status={row.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <StageCard lead={row} onChanged={invalidate} />

          {row.organizationId ? (
            <FirstVehicleCard lead={row} onCompleted={invalidate} />
          ) : (
            <AssistedSignupCard lead={row} onSent={invalidate} />
          )}

          <NotesCard lead={row} events={history.data} />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prospect</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="Fleet size" value={row.fleetSize?.toString() ?? 'Not recorded'} />
              <Field
                label="Vehicle types"
                value={
                  row.vehicleTypes.length > 0
                    ? row.vehicleTypes.map(humanizeEnum).join(', ')
                    : 'Not recorded'
                }
              />
              <Field
                label="Interested plan"
                value={row.interestedPlan ? humanizeEnum(row.interestedPlan) : 'Undecided'}
              />
              <Field label="How you met" value={humanizeEnum(row.source)} />
              <Separator />
              <Field
                label="Next follow-up"
                value={row.nextFollowUpAt ? formatDate(row.nextFollowUpAt) : 'None set'}
                tone={row.followUpOverdue ? 'destructive' : undefined}
              />
              <Field
                label="Demo completed"
                value={row.demoCompletedAt ? formatDate(row.demoCompletedAt) : 'Not yet'}
              />
              <Field label="Added" value={relativeTimeFrom(row.createdAt)} />
              {row.organizationName ? (
                <>
                  <Separator />
                  <Field label="Saarthi customer" value={row.organizationName} />
                </>
              ) : null}
              {row.closeReason ? (
                <>
                  <Separator />
                  <Field label="Closed because" value={row.closeReason} />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'destructive';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right text-sm font-medium',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Move the lead along.
 *
 * The dropdown is populated from `availableStatuses`, which the API sends. It
 * deliberately excludes the stages Saarthi derives from the customer's own
 * records — offering a status the server would refuse is how a salesperson
 * learns to distrust the screen.
 */
function StageCard({ lead, onChanged }: { lead: LeadView; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState('');
  const [note, setNote] = React.useState('');
  const [followUp, setFollowUp] = React.useState('');

  const advance = useMutation({
    mutationFn: () =>
      api.post<LeadView>(`/sales/leads/${lead.id}/status`, {
        status,
        ...(note ? { note } : {}),
        ...(followUp ? { nextFollowUpAt: followUp } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/leads', lead.id] });
      onChanged();
      setStatus('');
      setNote('');
      setFollowUp('');
      toast.success('Stage updated.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (lead.availableStatuses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This lead is at {SALES_LEAD_STATUS_LABEL[lead.status]}, which is where it finishes.
            Everything beyond this point is set by Saarthi from the customer’s own subscription,
            tracker and vehicles.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Move to</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder={`Currently ${SALES_LEAD_STATUS_LABEL[lead.status]}`} />
              </SelectTrigger>
              <SelectContent>
                {lead.availableStatuses.map((next) => (
                  <SelectItem key={next} value={next}>
                    {SALES_LEAD_STATUS_LABEL[next]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stage-followup">Next follow-up</Label>
            <Input
              id="stage-followup"
              type="date"
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stage-note">What happened</Label>
          <Textarea
            id="stage-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Kept with the lead so the next conversation starts where this one ended."
          />
        </div>
        <Button
          size="sm"
          onClick={() => advance.mutate()}
          disabled={!status || advance.isPending}
        >
          {advance.isPending ? 'Saving…' : 'Update stage'}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Start a signup the customer completes themselves.
 *
 * The safety notice is not decoration. A salesperson standing beside a customer
 * is exactly the person who might offer to "just type it in for them", and the
 * whole design of this flow is that they cannot: the endpoint takes a name and
 * a phone number and has nowhere to put a password, an OTP or a card number.
 */
function AssistedSignupCard({ lead, onSent }: { lead: LeadView; onSent: () => void }) {
  const [result, setResult] = React.useState<AssistedSignupResponse | null>(null);

  const start = useMutation({
    mutationFn: () =>
      api.post<AssistedSignupResponse>('/sales/leads/assisted-signup', {
        leadId: lead.id,
        ...(lead.interestedPlan ? { planTier: lead.interestedPlan } : {}),
      }),
    onSuccess: (response) => {
      setResult(response);
      onSent();
      toast.success('Signup link ready.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sign this customer up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>The customer signs themselves up</AlertTitle>
          <AlertDescription>
            Never ask a customer for their password, an OTP, card details or a UPI PIN. Send them
            the link, hand them the phone, and let them create their own account and authorise
            their own payment. Saarthi credits the sale to you from the link.
          </AlertDescription>
        </Alert>

        {result ? (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
            <p className="text-xs text-muted-foreground">
              Sent to {result.sentTo}. Open this on the customer’s own phone:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                {result.signupUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(result.signupUrl)
                    .then(() => toast.success('Link copied.'))
                    .catch(() => toast.error('Could not copy the link.'));
                }}
              >
                Copy
              </Button>
              <Button asChild size="sm" variant="outline">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(result.signupUrl)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
            <Send className="mr-1.5 h-4 w-4" />
            {start.isPending ? 'Preparing…' : 'Start assisted signup'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The first vehicle, set up in front of the owner.
 *
 * The salesperson does **one** complete vehicle so the owner learns the
 * process; vehicles two to ten are then done by the owner's own drivers using
 * the same Driver App, the same vehicle QR and the same OBD. That is stated on
 * the card, because it is the entire point of the visit and the thing a
 * salesperson has to say out loud.
 *
 * Every tick comes from the API reading real device and telemetry state. A step
 * that cannot be confirmed shows as pending or unknown with the reason, rather
 * than as a failure — a tracker fitted ninety seconds ago that has not reported
 * is not a broken cable.
 */
function FirstVehicleCard({ lead, onCompleted }: { lead: LeadView; onCompleted: () => void }) {
  const queryClient = useQueryClient();
  const [vehicleId, setVehicleId] = React.useState(lead.firstVehicleId ?? '');

  const vehicles = useQuery({
    queryKey: ['/sales/customers', lead.organizationId, 'vehicles'],
    queryFn: () =>
      api.get<CustomerVehiclesResponse>(
        `/sales/customers/${lead.organizationId}/vehicles`,
      ),
    enabled: Boolean(lead.organizationId),
  });

  const readiness = useQuery({
    queryKey: ['/sales/onboarding/readiness', vehicleId],
    queryFn: () =>
      api.get<OnboardingReadiness>('/sales/onboarding/readiness', { vehicleId }),
    enabled: Boolean(vehicleId),
    // Polled while the salesperson waits for the first reading to arrive. The
    // endpoint is read-only, so this costs four SELECTs.
    refetchInterval: (query) => (query.state.data?.complete ? false : 10_000),
  });

  const complete = useMutation({
    mutationFn: () =>
      api.post<OnboardingCompleteResponse>('/sales/onboarding/complete', {
        leadId: lead.id,
        vehicleId,
      }),
    onSuccess: (response) => {
      if (response.completed) {
        void queryClient.invalidateQueries({ queryKey: ['/sales/leads', lead.id] });
        onCompleted();
        toast.success('First vehicle demonstration recorded.');
      } else {
        toast.error(response.reason ?? 'Onboarding could not be completed yet.');
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const report = readiness.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">First vehicle demonstration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {lead.onboardingCompletedAt ? (
          <Alert>
            <Check className="h-4 w-4" />
            <AlertTitle>Completed</AlertTitle>
            <AlertDescription>
              Recorded {formatDateTime(lead.onboardingCompletedAt)}. The owner’s drivers repeat the
              same process for the remaining vehicles — connect the tracker, open the Saarthi Driver
              App, scan the vehicle QR or enter its number, connect the OBD.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            Set up <strong>one</strong> vehicle with the owner watching, then show them the same
            three steps for the rest: connect the Saarthi tracker, open the Saarthi Driver App, and
            scan the vehicle’s QR code or type its registration number. You do not need to fit
            every vehicle yourself.
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Which vehicle</Label>
          <Select value={vehicleId} onValueChange={setVehicleId}>
            <SelectTrigger>
              <SelectValue
                placeholder={
                  vehicles.isLoading
                    ? 'Loading vehicles…'
                    : (vehicles.data?.vehicles.length ?? 0) === 0
                      ? 'The customer has not added a vehicle yet'
                      : 'Pick the vehicle you are setting up'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {vehicles.data?.vehicles.map((vehicle) => (
                <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicle.registrationNumber}
                  {vehicle.live ? ' · live' : vehicle.hasTracker ? ' · tracker fitted' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {report ? (
          <>
            <ul className="space-y-2">
              {report.steps.map((step) => (
                <ChecklistRow key={step.step} step={step} />
              ))}
            </ul>

            {report.complete ? (
              <Button
                size="sm"
                onClick={() => complete.mutate()}
                disabled={complete.isPending || Boolean(lead.onboardingCompletedAt)}
              >
                {complete.isPending ? 'Recording…' : 'Complete onboarding'}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Saarthi will let you complete this once all six are confirmed. The checks refresh
                on their own every few seconds.
              </p>
            )}
          </>
        ) : vehicleId ? (
          <LoadingState />
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One line of the checklist, with the evidence behind it. */
function ChecklistRow({ step }: { step: OnboardingStepResult }) {
  const Icon =
    step.state === 'CONFIRMED' ? Check : step.state === 'PENDING' ? CircleDashed : HelpCircle;

  return (
    <li className="flex items-start gap-2.5">
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          step.state === 'CONFIRMED' && 'text-success',
          step.state === 'PENDING' && 'text-warning',
          step.state === 'UNKNOWN' && 'text-muted-foreground',
        )}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{step.label}</p>
        <p className="text-xs text-muted-foreground">{step.detail}</p>
        {step.observedAt ? (
          <p className="text-[11px] text-muted-foreground/80">
            {relativeTimeFrom(step.observedAt)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The lead's own history — append-only, and what settles a disputed sale. */
function NotesCard({ lead, events }: { lead: LeadView; events: LeadEventView[] | undefined }) {
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState('');

  const add = useMutation({
    mutationFn: () => api.post<LeadEventView[]>(`/sales/leads/${lead.id}/notes`, { note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/leads', lead.id, 'history'] });
      setNote('');
      toast.success('Note added.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <section className="space-y-3">
      <SectionHeader title="History" description="Everything that happened, in order." />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a note"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => add.mutate()}
              disabled={note.trim().length === 0 || add.isPending}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>

          <Separator />

          {events && events.length > 0 ? (
            <ol className="space-y-3">
              {events.map((event) => (
                <li key={event.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {humanizeEnum(event.type)}
                    </Badge>
                    {event.toStatus ? <StatusBadge status={event.toStatus} size="sm" /> : null}
                    <span className="text-[11px] text-muted-foreground">
                      {relativeTimeFrom(event.createdAt)}
                    </span>
                  </div>
                  {event.note ? <p className="text-sm">{event.note}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default SalesLeadDetailPage;

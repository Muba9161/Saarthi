import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Gavel,
  MapPin,
  Star,
  Truck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BID_SCOPE_LABELS,
  Permission,
  REQUIREMENT_KIND_LABELS,
  RequirementBidScope,
  RequirementBidStatus,
  RequirementKind,
  RequirementStatus,
  formatCurrency,
  formatDateTime,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type {
  AwardResult,
  RequirementBidSummary,
  RequirementSummary,
  RequirementTimelineEvent,
} from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { EmptyState, LoadingState, ErrorState } from '@/components/common/states';
import { StatusBadge } from '@/components/common/status-badge';
import { routeLabel, summarise } from '@/features/requirements/requirement-line';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * One requirement, and the offers against it.
 *
 * The whole screen is built around one decision: which bid to take. Bids are
 * therefore grouped by scope rather than listed flat — on a material
 * requirement the customer is making two separate choices, and a single sorted
 * list would invite them to compare a cement price against a lorry price.
 */
export function RequirementDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [awarding, setAwarding] = React.useState<RequirementBidSummary | null>(null);
  const [awardNote, setAwardNote] = React.useState('');
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const requirementQuery = useQuery({
    queryKey: ['requirements', id],
    queryFn: () => api.get<RequirementSummary>(`/requirements/${id}`),
    enabled: Boolean(id) && can(Permission.REQUIREMENTS_READ),
  });

  const bidsQuery = useQuery({
    queryKey: ['requirements', id, 'bids'],
    queryFn: () => api.get<RequirementBidSummary[]>(`/requirements/${id}/bids`),
    enabled: Boolean(id) && can(Permission.REQUIREMENTS_READ),
  });

  const timelineQuery = useQuery({
    queryKey: ['requirements', id, 'timeline'],
    queryFn: () => api.get<RequirementTimelineEvent[]>(`/requirements/${id}/timeline`),
    enabled: Boolean(id) && can(Permission.REQUIREMENTS_READ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['requirements'] });
  };

  const award = useMutation({
    mutationFn: (bidId: string) =>
      api.post<AwardResult>(`/requirements/${id}/award`, {
        bidId,
        ...(awardNote ? { note: awardNote } : {}),
      }),
    onSuccess: (result) => {
      setAwarding(null);
      setAwardNote('');
      invalidate();
      toast.success('Bid awarded', { description: result.nextStep });
      if (result.tripId) navigate(`/trips/${result.tripId}`);
      else if (result.orderId) navigate(`/orders/${result.orderId}`);
      else if (result.bookingId) navigate(`/travel/bookings/${result.bookingId}`);
    },
    onError: (error) => toast.error('Could not award', { description: errorMessage(error) }),
  });

  const shortlist = useMutation({
    mutationFn: (input: { bidId: string; shortlisted: boolean }) =>
      api.post(`/requirements/${id}/shortlist`, input),
    onSuccess: invalidate,
    onError: (error) => toast.error('Could not update', { description: errorMessage(error) }),
  });

  const reject = useMutation({
    mutationFn: (bidId: string) => api.post(`/requirements/${id}/reject`, { bidId }),
    onSuccess: () => {
      invalidate();
      toast.success('Bid rejected');
    },
    onError: (error) => toast.error('Could not reject', { description: errorMessage(error) }),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/requirements/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      setCancelling(false);
      setCancelReason('');
      invalidate();
      toast.success('Requirement withdrawn');
    },
    onError: (error) => toast.error('Could not withdraw', { description: errorMessage(error) }),
  });

  if (requirementQuery.isLoading) return <LoadingState label="Loading requirement…" />;
  if (requirementQuery.error) {
    return (
      <ErrorState error={requirementQuery.error} onRetry={() => void requirementQuery.refetch()} />
    );
  }

  const requirement = requirementQuery.data;
  if (!requirement) return <EmptyState title="Requirement not found" />;

  const isMine = can(Permission.REQUIREMENTS_MANAGE);
  const { headline, detail } = summarise(requirement);
  const bids = bidsQuery.data ?? [];

  const scopes = (
    requirement.kind === RequirementKind.MATERIAL_SUPPLY
      ? requirement.needsTransport
        ? [RequirementBidScope.MATERIAL, RequirementBidScope.TRANSPORT]
        : [RequirementBidScope.MATERIAL]
      : requirement.kind === RequirementKind.FREIGHT_TRANSPORT
        ? [RequirementBidScope.TRANSPORT]
        : [RequirementBidScope.TRAVEL]
  ).filter(Boolean);

  const awardableStatuses: RequirementStatus[] = [
    RequirementStatus.OPEN,
    RequirementStatus.BIDDING,
    RequirementStatus.PARTIALLY_AWARDED,
  ];
  const canStillAward = isMine && awardableStatuses.includes(requirement.status);

  const awardedIdFor = (scope: RequirementBidScope): string | null =>
    scope === RequirementBidScope.MATERIAL
      ? requirement.awardedMaterialBidId
      : scope === RequirementBidScope.TRANSPORT
        ? requirement.awardedTransportBidId
        : requirement.awardedTravelBidId;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/requirements')}>
        <ArrowLeft className="size-4" />
        All requirements
      </Button>

      <PageHeader
        title={requirement.title}
        description={`${requirement.reference} · posted ${relativeTimeFrom(requirement.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={requirement.status} />
            {canStillAward ? (
              <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>
                <X className="size-4" />
                Withdraw
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* What is being asked for */}
          <Card>
            <CardHeader className="pb-3">
              <SectionHeader
                title={REQUIREMENT_KIND_LABELS[requirement.kind]}
                description={headline}
              />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}

              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field icon={MapPin} label="Route" value={routeLabel(requirement)} />
                <Field
                  icon={CalendarClock}
                  label="Starts"
                  value={formatDateTime(requirement.startAt)}
                />
                <Field
                  icon={Gavel}
                  label={requirement.biddingClosed ? 'Bidding closed' : 'Bidding closes'}
                  value={formatDateTime(requirement.bidsCloseAt)}
                />
                {requirement.budgetAmount !== null ? (
                  <Field
                    icon={Star}
                    label={requirement.budgetIsPublic ? 'Budget (visible to bidders)' : 'Budget (private)'}
                    value={formatCurrency(requirement.budgetAmount)}
                  />
                ) : null}
              </dl>

              {requirement.description ? (
                <>
                  <Separator />
                  <p className="whitespace-pre-line text-sm">{requirement.description}</p>
                </>
              ) : null}

              {requirement.specification ? (
                <>
                  <Separator />
                  <div>
                    <p className="section-label">Specification</p>
                    <p className="whitespace-pre-line text-sm">{requirement.specification}</p>
                  </div>
                </>
              ) : null}

              {requirement.handlingNotes ? (
                <>
                  <Separator />
                  <div>
                    <p className="section-label">Handling</p>
                    <p className="whitespace-pre-line text-sm">{requirement.handlingNotes}</p>
                  </div>
                </>
              ) : null}

              {requirement.requiredInclusions.length > 0 ? (
                <>
                  <Separator />
                  <div>
                    <p className="section-label">Price should cover</p>
                    <ul className="mt-1 space-y-0.5">
                      {requirement.requiredInclusions.map((entry) => (
                        <li key={entry} className="text-sm text-muted-foreground">
                          • {entry}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : null}

              {requirement.cancellationReason ? (
                <>
                  <Separator />
                  <p className="text-sm text-destructive">{requirement.cancellationReason}</p>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* The bids, grouped by what they are offering */}
          {scopes.map((scope) => {
            const forScope = bids.filter((bid) => bid.scope === scope);
            const awardedId = awardedIdFor(scope);

            return (
              <Card key={scope}>
                <CardHeader className="pb-3">
                  <SectionHeader
                    title={`${BID_SCOPE_LABELS[scope]} offers`}
                    description={
                      awardedId
                        ? 'Awarded. This half of the requirement is settled.'
                        : scopes.length > 1
                          ? 'Awarded separately from the other half.'
                          : undefined
                    }
                  />
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {bidsQuery.isLoading ? (
                    <LoadingState label="Loading offers…" />
                  ) : forScope.length === 0 ? (
                    <EmptyState
                      title="No offers yet"
                      description={
                        requirement.biddingClosed
                          ? 'Bidding closed without an offer for this part.'
                          : 'Businesses that can serve this have been notified.'
                      }
                      className="min-h-32 border-0"
                    />
                  ) : (
                    forScope.map((bid) => (
                      <BidCard
                        key={bid.id}
                        bid={bid}
                        canAct={canStillAward && !awardedId}
                        onShortlist={() =>
                          shortlist.mutate({
                            bidId: bid.id,
                            shortlisted: bid.status !== RequirementBidStatus.SHORTLISTED,
                          })
                        }
                        onReject={() => reject.mutate(bid.id)}
                        onAward={() => setAwarding(bid)}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Timeline */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <SectionHeader title="History" description="Everything that happened, in order." />
          </CardHeader>
          <CardContent className="pt-0">
            {timelineQuery.isLoading ? (
              <LoadingState label="Loading…" />
            ) : (timelineQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ol className="space-y-3">
                {(timelineQuery.data ?? []).map((event) => (
                  <li key={event.id} className="border-l-2 border-border pl-3">
                    <p className="text-sm">{event.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {relativeTimeFrom(event.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Award confirmation. Deliberately a dialog: it commits the customer. */}
      <Dialog open={Boolean(awarding)} onOpenChange={(open) => !open && setAwarding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Award this bid?</DialogTitle>
            <DialogDescription>
              {awarding
                ? `${awarding.bidderName} at ${formatCurrency(awarding.price)}. Every other ${BID_SCOPE_LABELS[awarding.scope].toLowerCase()} offer will be rejected.`
                : null}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={awardNote}
            onChange={(event) => setAwardNote(event.target.value)}
            rows={3}
            placeholder="Anything the winner should know (optional)…"
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAwarding(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => awarding && award.mutate(awarding.id)}
              disabled={award.isPending}
            >
              <Gavel className="size-4" />
              Award
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this requirement?</DialogTitle>
            <DialogDescription>
              Every offer on it will be rejected and the bidders told why.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={3}
            placeholder="Why are you withdrawing it?"
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              Keep it open
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending || cancelReason.trim().length < 5}
            >
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium">{value}</dd>
      </div>
    </div>
  );
}

function BidCard({
  bid,
  canAct,
  onShortlist,
  onReject,
  onAward,
}: {
  bid: RequirementBidSummary;
  canAct: boolean;
  onShortlist: () => void;
  onReject: () => void;
  onAward: () => void;
}) {
  const live =
    bid.status === RequirementBidStatus.OFFERED ||
    bid.status === RequirementBidStatus.SHORTLISTED;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            {bid.bidderName}
            {bid.bidderVerified ? (
              <BadgeCheck className="size-3.5 shrink-0 text-success" aria-label="Verified" />
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {bid.bidderRating !== null ? (
              <span>
                {bid.bidderRating.toFixed(1)}★ ({bid.bidderRatingCount})
              </span>
            ) : (
              <span>No ratings yet</span>
            )}
            <span>{relativeTimeFrom(bid.createdAt)}</span>
            {bid.expired ? <span className="text-destructive">Expired</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold tabular">{formatCurrency(bid.price)}</p>
          {bid.status !== RequirementBidStatus.OFFERED ? (
            <StatusBadge status={bid.status} size="sm" />
          ) : null}
        </div>
      </div>

      {bid.vehicle ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Truck className="size-3.5" />
          <span>
            {bid.vehicle.registrationNumber} · {humanizeEnum(bid.vehicle.vehicleType)} ·{' '}
            {bid.vehicle.capacityTons}T
          </span>
          {bid.distanceToPickupKm !== null ? <span>· {bid.distanceToPickupKm} km away</span> : null}
        </div>
      ) : null}

      {bid.offeredVehicleType ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" size="sm">
            {humanizeEnum(bid.offeredVehicleType)}
          </Badge>
          {bid.driverIncluded ? <span>Driver included</span> : null}
          {bid.fuelIncluded ? <span>· Fuel included</span> : null}
        </div>
      ) : null}

      {bid.includesDelivery ? (
        <Badge variant="accent" size="sm" className="mt-2">
          Delivered price
        </Badge>
      ) : null}

      {bid.leadTimeDays !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Ready in {bid.leadTimeDays} day{bid.leadTimeDays === 1 ? '' : 's'}
        </p>
      ) : null}

      {bid.priceBreakdown ? (
        <p className="mt-2 text-xs text-muted-foreground">{bid.priceBreakdown}</p>
      ) : null}

      {bid.inclusions.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {bid.inclusions.map((entry) => (
            <li key={entry} className="text-xs text-muted-foreground">
              • {entry}
            </li>
          ))}
        </ul>
      ) : null}

      {bid.itinerarySummary ? (
        <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
          {bid.itinerarySummary}
        </p>
      ) : null}

      {bid.message ? <p className="mt-2 text-sm">{bid.message}</p> : null}

      {canAct && live && !bid.expired ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onAward}>
            <Gavel className="size-4" />
            Award
          </Button>
          <Button size="sm" variant="outline" onClick={onShortlist}>
            <Star className="size-4" />
            {bid.status === RequirementBidStatus.SHORTLISTED ? 'Remove from shortlist' : 'Shortlist'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject}>
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default RequirementDetailPage;

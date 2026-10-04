import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Route, Search } from 'lucide-react';
import {
  OPEN_RETURN_LOAD_STATUSES,
  RequirementBidScope,
  ReturnLoadStatus,
  formatDateTime,
  formatPercent,
} from '@saarthi/shared';
import type { TripDetail } from '@/lib/api-types';
import { SectionHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BidDialog, type BackhaulBid } from '@/features/requirements/bid-dialog';
import { BackhaulRequirementCard } from './backhaul-requirement-card';
import { EnableBackhaulDialog } from './enable-backhaul-dialog';
import { ENABLE_BACKHAUL_PARAM } from './backhaul-link';
import { backhaulRequirementsKey, useBackhaulOffer, useBackhaulRequirements } from './use-backhaul';
import type { BackhaulOffer, BackhaulRequirement, ReturnLoadView } from './types';

/**
 * Backhaul on a completed trip.
 *
 * Offered once the trip is done: the owner enables it, agreeing to the
 * backhaul commission, and the customer requirements on the way home are
 * listed here with sellers near the truck — ready to bid on.
 */
export function BackhaulPanel({ trip }: { trip: TripDetail }) {
  const offer = useBackhaulOffer(trip.id, true);
  const [params, setParams] = useSearchParams();
  // Null until the owner opens or closes it; until then the notification's
  // button decides, so arriving from it opens the dialog straight away.
  const [dialogOpen, setDialogOpen] = React.useState<boolean | null>(null);

  if (offer.isLoading) return null;
  if (offer.error) {
    return <ErrorState error={offer.error} onRetry={() => void offer.refetch()} />;
  }
  if (!offer.data) return null;

  const { request, unavailableReason, commission } = offer.data;
  const isOpen = request !== null && OPEN_RETURN_LOAD_STATUSES.includes(request.status);
  // The server says "not available" once the return leg is booked, so a won
  // backhaul is never offered again.
  const canEnable = unavailableReason === null && !isOpen;
  if (!request && !canEnable) return null;

  const vehicleLabel =
    request?.truckRegistration ?? trip.truck?.registrationNumber ?? 'this vehicle';
  const openDialog = dialogOpen ?? (canEnable && params.get(ENABLE_BACKHAUL_PARAM) === 'enable');

  const changeDialog = (next: boolean): void => {
    setDialogOpen(next);
    if (!next && params.has(ENABLE_BACKHAUL_PARAM)) {
      const remaining = new URLSearchParams(params);
      remaining.delete(ENABLE_BACKHAUL_PARAM);
      setParams(remaining, { replace: true });
    }
  };

  return (
    <section aria-labelledby="backhaul-heading" className="space-y-3">
      {request && isOpen ? (
        <OpenBackhaul request={request} offer={offer.data} vehicleLabel={vehicleLabel} />
      ) : request && !canEnable ? (
        <ClosedBackhaul request={request} />
      ) : (
        <EnableCard
          destination={trip.destinationAddress}
          rate={formatPercent(commission.rate * 100)}
          again={request !== null}
          onEnable={() => changeDialog(true)}
        />
      )}

      {canEnable ? (
        <EnableBackhaulDialog
          tripId={trip.id}
          vehicleLabel={vehicleLabel}
          freeAt={trip.destinationAddress}
          commission={commission}
          open={openDialog}
          onOpenChange={changeDialog}
        />
      ) : null}
    </section>
  );
}

function EnableCard({
  destination,
  rate,
  again,
  onEnable,
}: {
  destination: string;
  rate: string;
  again: boolean;
  onEnable: () => void;
}) {
  return (
    <Card className="border-primary/25 bg-primary/[0.03]">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Route className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <h2 id="backhaul-heading" className="text-base font-semibold tracking-[-0.01em]">
              {again ? 'Look for work on the way home again' : "Don't drive back empty"}
            </h2>
            <p className="text-sm text-muted-foreground">
              See customers who need material delivered on the way home from {destination}, with
              sellers near your truck. Saarthi takes {rate} of the profit, only on a job you win.
            </p>
          </div>
        </div>
        <Button onClick={onEnable} className="shrink-0">
          <Route className="size-4" />
          Enable backhaul
        </Button>
      </CardContent>
    </Card>
  );
}

function ClosedBackhaul({ request }: { request: ReturnLoadView }) {
  const booked = request.status === ReturnLoadStatus.BOOKED;
  const completed = request.status === ReturnLoadStatus.COMPLETED;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <PackageCheck
            aria-hidden
            className={booked || completed ? 'size-5 text-success' : 'size-5 text-muted-foreground'}
          />
          <div className="space-y-0.5">
            <h2 id="backhaul-heading" className="text-sm font-semibold">
              {booked
                ? 'Backhaul booked — this truck has work for the way home'
                : completed
                  ? 'Backhaul delivered'
                  : 'Backhaul closed'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {request.reference} · {request.originAddress} → {request.destinationAddress}
            </p>
          </div>
        </div>
        {request.matchedOrderId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/orders/${request.matchedOrderId}`}>Open the order</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OpenBackhaul({
  request,
  offer,
  vehicleLabel,
}: {
  request: ReturnLoadView;
  offer: BackhaulOffer;
  vehicleLabel: string;
}) {
  const queryClient = useQueryClient();
  const requirements = useBackhaulRequirements(request.id);
  const [bidding, setBidding] = React.useState<{
    requirement: BackhaulRequirement;
    sourceMaterialId: string;
  } | null>(null);

  const backhaulBid = (sourceMaterialId: string): BackhaulBid => ({
    returnLoadRequestId: request.id,
    vehicleId: request.truckId,
    vehicleLabel,
    near: { latitude: request.originLatitude, longitude: request.originLongitude },
    sourceMaterialId,
    commission: { rate: offer.commission.rate, version: offer.commission.ruleVersion },
  });

  const items = requirements.data ?? [];

  return (
    <>
      <SectionHeader
        title={
          <span id="backhaul-heading" className="flex items-center gap-2">
            Backhaul — work on the way home
            <Badge variant="success" size="sm">
              On
            </Badge>
          </span>
        }
        description={`${vehicleLabel} · ${request.originAddress} → ${request.destinationAddress} · looking until ${formatDateTime(request.availableUntil)} · up to ${request.detourToleranceKm} km detour`}
      />

      {requirements.isLoading ? (
        <LoadingState label="Finding customers on the way home…" />
      ) : requirements.error ? (
        <ErrorState error={requirements.error} onRetry={() => void requirements.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No customer requirements on the way home yet"
          description="New requirements are matched as customers post them. Check back here until the backhaul window closes."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((requirement) => (
            <BackhaulRequirementCard
              key={requirement.id}
              requirement={requirement}
              onBid={(sourceMaterialId) => setBidding({ requirement, sourceMaterialId })}
            />
          ))}
        </div>
      )}

      {bidding ? (
        <BidDialog
          // A fresh dialog per requirement, so no price carries over.
          key={bidding.requirement.id}
          requirement={bidding.requirement}
          scope={RequirementBidScope.TRANSPORT}
          open
          onOpenChange={(next) => !next && setBidding(null)}
          onPlaced={() => {
            setBidding(null);
            void queryClient.invalidateQueries({ queryKey: backhaulRequirementsKey(request.id) });
          }}
          backhaul={backhaulBid(bidding.sourceMaterialId)}
        />
      ) : null}
    </>
  );
}

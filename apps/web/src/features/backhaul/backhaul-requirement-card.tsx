import type { ReactNode } from 'react';
import { BadgeCheck, CalendarClock, Gavel } from 'lucide-react';
import {
  LIVE_BID_STATUSES,
  formatCurrency,
  formatDateTime,
  formatNumber,
  humanizeEnum,
} from '@saarthi/shared';
import { summarise } from '@/features/requirements/requirement-line';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BackhaulRequirement } from './types';

/**
 * One customer requirement on the way home.
 *
 * Read as the route the truck would actually drive: from where it unloaded,
 * to a seller close by, to the customer's site — so the owner sees at a glance
 * what the detour is for, and which seller makes it work.
 */
export function BackhaulRequirementCard({
  requirement,
  onBid,
}: {
  requirement: BackhaulRequirement;
  /** Open the bid dialog, starting from this seller listing. */
  onBid: (sourceMaterialId: string) => void;
}) {
  const { headline, detail } = summarise(requirement);
  const { backhaul, myBid } = requirement;
  const [bestSeller] = backhaul.sellers;
  const liveBid = myBid && LIVE_BID_STATUSES.includes(myBid.status) ? myBid : null;
  const deliverTo =
    requirement.destinationCity ?? requirement.destinationAddress ?? 'Customer site';

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{headline}</p>
            <p className="truncate text-xs text-muted-foreground">
              {requirement.reference} · {requirement.customerName}
              {detail ? ` · ${detail}` : ''}
            </p>
          </div>
          <Badge variant="success" size="sm" className="shrink-0 tabular-nums">
            {Math.round(backhaul.score)} match
          </Badge>
        </div>

        <ol aria-label="Route on the way home" className="relative space-y-2 pl-5 text-sm">
          <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-border" />
          <RouteStop tone="muted">Your truck — unloaded</RouteStop>
          {bestSeller ? (
            <RouteStop tone="primary">
              <span className="font-medium">{bestSeller.sellerName}</span>
              {bestSeller.sellerVerified ? (
                <BadgeCheck
                  className="ml-1 inline size-3.5 text-success"
                  aria-label="Verified seller"
                />
              ) : null}
              <span className="text-muted-foreground">
                {' '}
                · {formatNumber(backhaul.sellerDistanceKm)} km away ·{' '}
                {formatCurrency(bestSeller.pricePerUnit)}/
                {humanizeEnum(bestSeller.unit).toLowerCase()}
              </span>
            </RouteStop>
          ) : null}
          <RouteStop tone="success">
            Deliver to <span className="font-medium">{deliverTo}</span>
          </RouteStop>
        </ol>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>+{formatNumber(Math.round(backhaul.detourKm))} km detour</span>
          <span>~{formatNumber(Math.round(backhaul.emptyKmSaved))} empty km saved</span>
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            {formatDateTime(requirement.startAt)}
          </span>
          {requirement.budgetAmount !== null ? (
            <span className="font-medium text-foreground">
              Budget {formatCurrency(requirement.budgetAmount)}
            </span>
          ) : null}
        </div>

        {backhaul.sellers.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Also nearby:{' '}
            {backhaul.sellers
              .slice(1)
              .map((seller) => `${seller.sellerName} (${formatNumber(seller.distanceKm ?? 0)} km)`)
              .join(', ')}
          </p>
        ) : null}

        {myBid ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-2.5">
            <p className="text-sm">
              Your offer: <span className="font-semibold">{formatCurrency(myBid.price)}</span>{' '}
              <span className="text-xs text-muted-foreground">({myBid.status.toLowerCase()})</span>
            </p>
            {liveBid && bestSeller ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBid(liveBid.sourceMaterialId ?? bestSeller.materialId)}
              >
                Revise
              </Button>
            ) : null}
          </div>
        ) : bestSeller ? (
          <Button size="sm" onClick={() => onBid(bestSeller.materialId)}>
            <Gavel className="size-4" />
            Bid on this load
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RouteStop({
  tone,
  children,
}: {
  tone: 'muted' | 'primary' | 'success';
  children: ReactNode;
}) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className={cn(
          'absolute -left-5 top-1.5 size-2.5 rounded-full ring-2 ring-card',
          tone === 'muted' && 'bg-muted-foreground/50',
          tone === 'primary' && 'bg-primary',
          tone === 'success' && 'bg-success',
        )}
      />
      {children}
    </li>
  );
}

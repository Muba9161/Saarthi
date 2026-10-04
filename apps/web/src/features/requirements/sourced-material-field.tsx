import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BadgeCheck } from 'lucide-react';
import {
  MARKETPLACE_COMMISSION_RULE,
  formatCurrency,
  formatNumber,
  formatPercent,
  humanizeEnum,
  profitCommission,
  type CommissionRule,
  type LatLng,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { BoardRequirement, SellerMatch } from '@/lib/api-types';
import { cn } from '@/lib/utils';
import { WizardField } from '@/components/common/form-wizard';
import { Badge } from '@/components/ui/badge';

/**
 * The seller listing a fleet's delivered bid is sourced from.
 *
 * Listings arrive ranked by the commerce engine on structured data — same
 * product type, matching details, enough stock, nearest to the delivery — so
 * the best candidates are at the top rather than in a flat alphabetical list.
 *
 * The margin shown is a preview. The server works out the procurement
 * reference from the listing itself and never trusts these figures.
 *
 * On a backhaul bid, sellers are measured from where the returning vehicle
 * stands (`near`), and the margin uses the backhaul commission rate.
 */
export function SourcedMaterialField({
  requirement,
  materialId,
  onMaterialChange,
  price,
  open,
  near,
  commission = MARKETPLACE_COMMISSION_RULE,
}: {
  requirement: BoardRequirement;
  materialId: string;
  onMaterialChange: (next: string) => void;
  price: number;
  open: boolean;
  near?: LatLng;
  commission?: CommissionRule;
}) {
  const unit = humanizeEnum(requirement.unit ?? 'UNIT').toLowerCase();
  const rate = formatPercent(commission.rate * 100);
  const matches = useQuery({
    queryKey: ['commerce', 'matches', requirement.id, near ?? null],
    queryFn: () =>
      api.get<SellerMatch[]>(
        `/commerce/requirements/${requirement.id}/matches`,
        near ? { nearLatitude: near.latitude, nearLongitude: near.longitude } : undefined,
      ),
    enabled: open,
  });

  const chosen = matches.data?.find((match) => match.materialId === materialId) ?? null;
  const reference = chosen?.procurementReference ?? null;
  const preview =
    reference !== null && price > 0
      ? profitCommission({ revenue: price, costBasis: reference }, commission)
      : null;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">You supply and deliver the material</p>
        <p className="text-xs leading-snug text-muted-foreground">
          Buy it from a seller on Saarthi and quote the customer one delivered price. The customer
          pays 30% on award and the rest after delivery; Saarthi takes {rate} of your profit. The
          customer never sees which seller you use.
        </p>
      </div>

      <WizardField
        label="Seller listing"
        required
        hint={`${formatNumber(requirement.quantity ?? 1)} ${unit} needed. Best matches first.`}
      >
        {matches.isLoading ? (
          <p className="text-xs text-muted-foreground">Finding sellers…</p>
        ) : matches.error ? (
          <p className="text-xs text-destructive">
            Could not load seller listings. Close and reopen to try again.
          </p>
        ) : (matches.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No seller has this listed with stock right now.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Seller listings"
            className="max-h-64 space-y-2 overflow-y-auto pr-1"
          >
            {matches.data!.map((match) => (
              <button
                key={match.materialId}
                type="button"
                role="radio"
                aria-checked={match.materialId === materialId}
                onClick={() => onMaterialChange(match.materialId)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  match.materialId === materialId
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{match.name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {match.sellerName}
                      {match.sellerVerified ? (
                        <BadgeCheck className="size-3.5 text-success" aria-label="Verified" />
                      ) : null}
                      {match.distanceKm !== null
                        ? ` · ${formatNumber(match.distanceKm)} km from ${near ? 'your truck' : 'delivery'}`
                        : ''}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium tabular-nums">
                    {formatCurrency(match.pricePerUnit)}
                    <span className="text-xs font-normal text-muted-foreground">
                      /{humanizeEnum(match.unit).toLowerCase()}
                    </span>
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {match.stockSufficient === false ? (
                    <Badge variant="warning" size="sm">
                      Short of stock
                    </Badge>
                  ) : match.stockSufficient ? (
                    <Badge variant="success" size="sm">
                      Enough stock
                    </Badge>
                  ) : null}
                  {match.conflictingAttributes.length > 0 ? (
                    <Badge variant="muted" size="sm">
                      Some details differ
                    </Badge>
                  ) : null}
                  {match.meetsMinimumOrder === false ? (
                    <Badge variant="warning" size="sm">
                      Below seller minimum
                    </Badge>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </WizardField>

      {reference !== null ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4">
          <Figure label="Material cost" value={formatCurrency(reference)} />
          <Figure label="Your profit" value={preview ? formatCurrency(preview.profitBasis) : '—'} />
          <Figure label={`Saarthi (${rate})`} value={preview ? formatCurrency(preview.amount) : '—'} />
          <Figure
            label="Net profit"
            value={preview ? formatCurrency(preview.profitBasis - preview.amount) : '—'}
            strong
          />
        </dl>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Payments reach you only through a verified bank account -{' '}
        <Link to="/settings/payouts" className="underline underline-offset-2">
          connect one
        </Link>{' '}
        before bidding.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'font-medium tabular-nums'}>
        {value}
      </dd>
    </div>
  );
}

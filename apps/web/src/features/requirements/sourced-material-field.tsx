import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatCurrency, formatNumber, humanizeEnum, profitCommission } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { BoardRequirement, MaterialSummary, Paginated } from '@/lib/api-types';
import { WizardField } from '@/components/common/form-wizard';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * A fleet's delivered bid: it buys the material from a supplier listing and
 * delivers it, so the customer awards one bid for both.
 *
 * The margin shown is a preview. The server works out the procurement
 * reference from the listing itself and never trusts these figures.
 */
export function SourcedMaterialField({
  requirement,
  enabled,
  onEnabledChange,
  materialId,
  onMaterialChange,
  price,
  open,
}: {
  requirement: BoardRequirement;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  materialId: string;
  onMaterialChange: (next: string) => void;
  price: number;
  open: boolean;
}) {
  const quantity = requirement.quantity ?? 1;
  const listings = useQuery({
    queryKey: ['materials', 'sourceable', requirement.materialCategory],
    queryFn: () =>
      api.get<Paginated<MaterialSummary>>('/marketplace/materials', {
        pageSize: 100,
        availableOnly: true,
        ...(requirement.materialCategory ? { category: requirement.materialCategory } : {}),
      }),
    enabled: open && enabled,
  });

  const listing = listings.data?.items.find((item) => item.id === materialId) ?? null;
  const reference = listing ? listing.pricePerUnit * quantity : null;
  const preview =
    reference !== null && price > 0 ? profitCommission({ revenue: price, costBasis: reference }) : null;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        <Switch id="bid-sourced" checked={enabled} onCheckedChange={onEnabledChange} />
        <label htmlFor="bid-sourced" className="min-w-0 cursor-pointer space-y-0.5">
          <span className="block text-sm font-medium">I will supply and deliver the material</span>
          <span className="block text-xs leading-snug text-muted-foreground">
            You buy it from a supplier on Saarthi and quote one delivered price. The customer pays 30% on
            award and the rest after delivery; Saarthi takes 2% of your profit.
          </span>
        </label>
      </div>

      {enabled ? (
        <>
          <WizardField
            label="Supplier listing"
            required
            hint={`${formatNumber(quantity)} ${humanizeEnum(requirement.unit ?? 'UNIT').toLowerCase()} needed.`}
          >
            <Select value={materialId} onValueChange={onMaterialChange}>
              <SelectTrigger>
                <SelectValue placeholder={listings.isLoading ? 'Loading listings…' : 'Choose a listing'} />
              </SelectTrigger>
              <SelectContent>
                {(listings.data?.items ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} · {item.supplierName} · {formatCurrency(item.pricePerUnit)}/
                    {humanizeEnum(item.unit).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>
          {listings.data && listings.data.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No supplier has this material listed right now.</p>
          ) : null}

          {reference !== null ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <Figure label="Material cost" value={formatCurrency(reference)} />
              <Figure label="Your profit" value={preview ? formatCurrency(preview.profitBasis) : '—'} />
              <Figure label="Saarthi (2%)" value={preview ? formatCurrency(preview.amount) : '—'} />
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
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'font-medium tabular-nums'}>{value}</dd>
    </div>
  );
}

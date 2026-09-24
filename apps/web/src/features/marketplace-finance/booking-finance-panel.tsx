import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Receipt, Trash2 } from 'lucide-react';
import { formatCurrency, formatPercent, humanizeEnum, profitCommission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { SectionHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { BookingFinanceSummary } from './types';

interface CostLine {
  label: string;
  amount: string;
}

const STARTING_LINES: CostLine[] = [
  { label: 'Fuel', amount: '' },
  { label: 'Driver', amount: '' },
  { label: 'Tolls and parking', amount: '' },
];

/**
 * A completed trip's costs and Saarthi's 2% of the profit on it.
 *
 * Provider-only, once the trip is completed. The costs are recorded once and are final: the commission
 * and the provider's settlement are worked out from them on the server.
 */
export function BookingFinancePanel({
  bookingId,
  canRecord,
}: {
  bookingId: string;
  /** Recording the costs settles the booking, so it needs the payout permission. */
  canRecord: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['travel-booking', bookingId, 'finance'];
  const finance = useQuery({
    queryKey,
    queryFn: () => api.get<BookingFinanceSummary>(`/travel/bookings/${bookingId}/finance`),
  });

  const [lines, setLines] = React.useState<CostLine[]>(STARTING_LINES);
  const entered = lines
    .map((line) => ({ label: line.label.trim(), amount: Number(line.amount) }))
    .filter((line) => line.label.length >= 2 && Number.isFinite(line.amount) && line.amount > 0);
  const totalCost = entered.reduce((sum, line) => sum + line.amount, 0);

  const record = useMutation({
    mutationFn: () =>
      api.post<BookingFinanceSummary>(`/travel/bookings/${bookingId}/finance/costs`, { costs: entered }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      toast.success('Costs recorded', { description: 'Your settlement is on its way to your bank account.' });
    },
    onError: (error) => toast.error('Could not record the costs', { description: errorMessage(error) }),
  });

  if (!finance.data) return null;
  const data = finance.data;
  const preview = profitCommission({ revenue: data.customerPayment, costBasis: totalCost });

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Profit & commission"
          description="Saarthi takes 2% of your profit on this trip - nothing on a loss."
          actions={
            data.final ? (
              <Badge variant="success">{data.settlementStatus ? humanizeEnum(data.settlementStatus) : 'Final'}</Badge>
            ) : null
          }
        />
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        <Row label="Customer paid" value={formatCurrency(data.customerPayment)} />

        {data.final ? (
          <>
            {(data.costs ?? []).map((cost) => (
              <Row key={cost.label} label={cost.label} value={`− ${formatCurrency(cost.amount)}`} muted />
            ))}
            <Separator />
            <Row label="Profit" value={formatCurrency(data.profitBasis ?? 0)} />
            <Row
              label={`Saarthi (${formatPercent(data.commissionRate * 100)} of profit)`}
              value={`− ${formatCurrency(data.commissionAmount ?? 0)}`}
              muted
            />
            <Row label="Net profit after commission" value={formatCurrency(data.netAfterCommission ?? 0)} strong />
          </>
        ) : canRecord ? (
          <>
            <p className="text-xs text-muted-foreground">
              Enter what the trip cost you. Once recorded they cannot be changed.
            </p>
            <ul className="space-y-2">
              {lines.map((line, index) => (
                <li key={index} className="flex gap-2">
                  <Input
                    aria-label="Cost"
                    value={line.label}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((entry, at) => (at === index ? { ...entry, label: event.target.value } : entry)),
                      )
                    }
                  />
                  <Input
                    aria-label={`${line.label || 'Cost'} amount (₹)`}
                    type="number"
                    min={0}
                    className="w-28 shrink-0"
                    value={line.amount}
                    placeholder="₹"
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((entry, at) => (at === index ? { ...entry, amount: event.target.value } : entry)),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove this cost"
                    onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            {lines.length < 20 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLines((current) => [...current, { label: '', amount: '' }])}
              >
                <Plus className="size-4" />
                Add a cost
              </Button>
            ) : null}
            <Separator />
            <Row label="Profit" value={formatCurrency(preview.profitBasis)} />
            <Row label="Saarthi (2%)" value={`− ${formatCurrency(preview.amount)}`} muted />
            <Row
              label="Net profit after commission"
              value={formatCurrency(preview.profitBasis - preview.amount)}
              strong
            />
            <Button className="w-full" loading={record.isPending} onClick={() => record.mutate()}>
              <Receipt className="size-4" />
              Record costs and settle
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            The trip&rsquo;s costs are recorded by whoever manages payouts for your business.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={strong ? 'flex justify-between font-semibold' : 'flex justify-between'}>
      <span className={muted ? 'text-muted-foreground' : undefined}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

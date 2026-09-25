import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CreditCard, PackageCheck, Wallet } from 'lucide-react';
import {
  OrderFinanceStage,
  OrderStatus,
  formatCurrency,
  formatNumber,
  formatPercent,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useCheckout, useCheckoutReturn } from '@/features/payments/use-checkout';
import { SectionHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { CheckoutResponse, OrderFinanceSummary } from './types';

/** The money path of a fleet-delivered order, in the order it happens. */
const STEPS: { stage: OrderFinanceStage; label: string }[] = [
  { stage: OrderFinanceStage.PAYMENT_30_PAID, label: 'Customer pays 30%' },
  { stage: OrderFinanceStage.PROCUREMENT_PAID, label: 'Fleet pays the seller' },
  { stage: OrderFinanceStage.PAYMENT_70_REQUIRED, label: 'Delivery confirmed' },
  { stage: OrderFinanceStage.PAYMENT_70_PAID, label: 'Customer pays the balance' },
  { stage: OrderFinanceStage.FINALIZED, label: 'Settled' },
];
const ORDER = [OrderFinanceStage.PAYMENT_30_REQUIRED, ...STEPS.map((step) => step.stage)];

const PAYMENT_LABEL: Record<string, string> = {
  CONFIRMATION_30: '30% at confirmation',
  PROCUREMENT: 'Seller payment',
  FINAL_70: 'Balance after delivery',
};

/**
 * Payments on an order a fleet won with a delivered bid.
 *
 * Every figure comes from the API, which works them out from the stored bid —
 * the buttons here only ask for the next step. Renders nothing for orders
 * without a marketplace payment plan.
 */
export function OrderFinancePanel({ orderId, orderStatus }: { orderId: string; orderStatus: OrderStatus }) {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ['order', orderId, 'finance'], [orderId]);

  const finance = useQuery({
    queryKey,
    queryFn: () => api.get<OrderFinanceSummary | null>(`/orders/${orderId}/finance`),
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
  }, [queryClient, orderId]);

  const { run, busy } = useCheckout(refresh);
  useCheckoutReturn({ onPayment: refresh });

  const pay = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown; success: string }) =>
      api.post<CheckoutResponse>(`/orders/${orderId}/finance/${path}`, body),
    onSuccess: (result, variables) => run(result.checkout, variables.success),
    onError: (error) => toast.error('Could not start the payment', { description: errorMessage(error) }),
  });

  if (!finance.data) return null;
  const data = finance.data;
  const working = busy || pay.isPending;
  const reached = ORDER.indexOf(data.stage);

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Payments"
          description="Paid through Saarthi's Cashfree checkout - each share goes straight to its owner's bank account."
          actions={
            data.stage === OrderFinanceStage.CANCELLED ? (
              <Badge variant="destructive">Cancelled</Badge>
            ) : (
              <Badge variant={data.stage === OrderFinanceStage.FINALIZED ? 'success' : 'info'}>
                {humanizeEnum(data.stage)}
              </Badge>
            )
          }
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {data.stage !== OrderFinanceStage.CANCELLED ? (
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            {STEPS.map((step) => {
              const done = reached >= ORDER.indexOf(step.stage);
              return (
                <li
                  key={step.stage}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs sm:flex-col sm:items-start',
                    done ? 'border-success/40 bg-success/5 text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      done ? 'border-success bg-success text-success-foreground' : 'border-border',
                    )}
                  >
                    {done ? <Check className="size-3" /> : null}
                  </span>
                  {step.label}
                </li>
              );
            })}
          </ol>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {data.role !== 'SUPPLIER' ? (
            <>
              <Figure label="Agreed price" value={formatCurrency(data.agreedAmount)} />
              <Figure label="30% at confirmation" value={formatCurrency(data.confirmationAmount)} />
              <Figure
                label="Final amount"
                value={data.finalAmount !== null ? formatCurrency(data.finalAmount) : 'After delivery'}
              />
              <Figure
                label="Quantity"
                value={`${formatNumber(data.deliveredQuantity ?? data.orderedQuantity)} of ${formatNumber(data.orderedQuantity)}`}
              />
              <Figure label="Balance due" value={formatCurrency(data.balanceDue)} strong />
            </>
          ) : (
            <Figure
              label="Paid to you for the material"
              value={
                data.supplier?.procurementAmount !== null && data.supplier?.procurementAmount !== undefined
                  ? formatCurrency(data.supplier.procurementAmount)
                  : 'Not yet paid'
              }
              strong
            />
          )}
        </dl>

        {data.provider ? <ProviderEconomics provider={data.provider} agreedAmount={data.finalAmount ?? data.agreedAmount} /> : null}

        <Actions
          data={data}
          orderStatus={orderStatus}
          working={working}
          onPay={(path, success, body) => pay.mutate({ path, success, ...(body ? { body } : {}) })}
          onDelivered={refresh}
        />

        {data.payments.length > 0 ? (
          <>
            <Separator />
            <ul className="space-y-2 text-sm">
              {data.payments.map((payment) => (
                <li key={payment.reference} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{PAYMENT_LABEL[payment.stage] ?? humanizeEnum(payment.stage)}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{payment.reference}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatCurrency(payment.amount)}</span>
                    <StatusBadge status={payment.status} size="sm" />
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Actions({
  data,
  orderStatus,
  working,
  onPay,
  onDelivered,
}: {
  data: OrderFinanceSummary;
  orderStatus: OrderStatus;
  working: boolean;
  onPay: (path: string, success: string, body?: unknown) => void;
  onDelivered: () => void;
}) {
  const customer = data.role === 'CUSTOMER' || data.role === 'ADMIN';
  const fleet = data.role === 'FLEET' || data.role === 'ADMIN';

  if (customer && data.stage === OrderFinanceStage.PAYMENT_30_REQUIRED) {
    return (
      <Button
        className="w-full sm:w-auto"
        loading={working}
        onClick={() => onPay('confirmation-payment', 'Payment received - the fleet can prepare your order.')}
      >
        <CreditCard className="size-4" />
        Pay {formatCurrency(data.confirmationAmount)} to confirm
      </Button>
    );
  }
  if (fleet && data.stage === OrderFinanceStage.PAYMENT_30_PAID) {
    return <ProcurementAction data={data} working={working} onPay={onPay} />;
  }
  if (customer && data.stage === OrderFinanceStage.PROCUREMENT_PAID) {
    return orderStatus === OrderStatus.DELIVERED ? (
      <DeliveryConfirmation orderId={data.orderId} ordered={data.orderedQuantity} onDone={onDelivered} />
    ) : (
      <p className="text-sm text-muted-foreground">Confirm what arrived once the order is delivered.</p>
    );
  }
  if (customer && data.stage === OrderFinanceStage.PAYMENT_70_REQUIRED && data.balanceDue > 0) {
    return (
      <Button
        className="w-full sm:w-auto"
        loading={working}
        onClick={() => onPay('final-payment', 'Balance paid - thank you.')}
      >
        <Wallet className="size-4" />
        Pay balance {formatCurrency(data.balanceDue)}
      </Button>
    );
  }
  return null;
}

function ProcurementAction({
  data,
  working,
  onPay,
}: {
  data: OrderFinanceSummary;
  working: boolean;
  onPay: (path: string, success: string, body?: unknown) => void;
}) {
  const reference = data.provider?.procurementReference ?? 0;
  const [amount, setAmount] = React.useState(reference);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label htmlFor="procurement-amount">Pay the seller for the material (₹)</Label>
      <p className="text-xs text-muted-foreground">
        Loading is unlocked once the seller is paid. The listing price for this quantity was{' '}
        {formatCurrency(reference)}.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="procurement-amount"
          type="number"
          min={1}
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
        <Button
          loading={working}
          disabled={!(amount > 0)}
          onClick={() => onPay('procurement-payment', 'Seller paid - loading can start.', { amount })}
        >
          <CreditCard className="size-4" />
          Pay seller
        </Button>
      </div>
    </div>
  );
}

function DeliveryConfirmation({ orderId, ordered, onDone }: { orderId: string; ordered: number; onDone: () => void }) {
  const [quantity, setQuantity] = React.useState(ordered);
  const confirm = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/finance/delivery`, { deliveredQuantity: quantity }),
    onSuccess: () => {
      toast.success('Delivery confirmed', { description: 'Your balance is now worked out on what arrived.' });
      onDone();
    },
    onError: (error) => toast.error('Could not confirm the delivery', { description: errorMessage(error) }),
  });

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label htmlFor="delivered-quantity">How much arrived?</Label>
      <p className="text-xs text-muted-foreground">
        A short delivery is charged pro rata; you are never charged more than agreed.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="delivered-quantity"
          type="number"
          min={0}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
        <Button loading={confirm.isPending} disabled={!(quantity >= 0)} onClick={() => confirm.mutate()}>
          <PackageCheck className="size-4" />
          Confirm delivery
        </Button>
      </div>
    </div>
  );
}

function ProviderEconomics({
  provider,
  agreedAmount,
}: {
  provider: NonNullable<OrderFinanceSummary['provider']>;
  agreedAmount: number;
}) {
  const cost = provider.procurementAmount ?? provider.procurementReference;
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        Your margin {provider.final ? null : <Badge size="sm" variant="muted">Estimate</Badge>}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Figure label="Selling price" value={formatCurrency(agreedAmount)} />
        <Figure label="Material cost" value={cost !== null ? formatCurrency(cost) : '—'} />
        <Figure label="Profit" value={formatCurrency(provider.profitBasis)} />
        <Figure
          label={`Saarthi (${formatPercent(provider.commissionRate * 100)} of profit)`}
          value={formatCurrency(provider.commissionAmount)}
        />
        <Figure label="Net profit after commission" value={formatCurrency(provider.netAfterCommission)} strong />
      </dl>
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-semibold' : 'font-medium')}>{value}</dd>
    </div>
  );
}

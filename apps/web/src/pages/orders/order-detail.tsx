import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Star, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { OrderStatus, Permission, RealtimeChannel, RealtimeEvent, formatCurrency, formatNumber, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { OrderDetail } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatusBadge, ScoreBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, session } = useAuth();
  const queryClient = useQueryClient();
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const [rateOpen, setRateOpen] = React.useState(false);

  useChannels(id ? [RealtimeChannel.order(id)] : []);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetail>(`/orders/${id}`),
    enabled: Boolean(id),
  });

  useRealtimeEvent(RealtimeEvent.ORDER_UPDATED, (message) => {
    if (message.payload.orderId === id) void queryClient.invalidateQueries({ queryKey: ['order', id] });
  });

  const accept = useMutation({
    mutationFn: (quoteId: string) => api.post<{ tripId: string }>(`/orders/${id}/accept-quote`, { quoteId }),
    onSuccess: (result) => {
      toast.success('Quote accepted', { description: 'A trip has been created and the fleet notified.' });
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
      navigate(`/trips/${result.tripId}`);
    },
    onError: (error) => toast.error('Could not accept the quote', { description: errorMessage(error) }),
  });

  if (order.isLoading) return <LoadingState label="Loading order…" />;
  if (order.error) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  if (!order.data) return <EmptyState title="Order not found" />;

  const data = order.data;
  const isCustomer = data.customerOrganizationId === session?.organization?.id;
  const canQuote = can(Permission.ORDERS_QUOTE) && !isCustomer && ([OrderStatus.REQUESTED, OrderStatus.QUOTED] as OrderStatus[]).includes(data.status);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/orders')}>
        <ArrowLeft className="size-4" />All orders
      </Button>

      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2.5">{data.reference}<StatusBadge status={data.status} /></span>}
        description={`${formatNumber(data.quantity)} ${humanizeEnum(data.unit).toLowerCase()} of ${data.materialName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canQuote ? <Button onClick={() => setQuoteOpen(true)}><Truck className="size-4" />Quote for this</Button> : null}
            {isCustomer && data.status === OrderStatus.DELIVERED && !data.rating ? (
              <Button onClick={() => setRateOpen(true)}><Star className="size-4" />Rate delivery</Button>
            ) : null}
            {data.tripId ? <Button variant="outline" asChild><Link to={`/trips/${data.tripId}`}>Track delivery</Link></Button> : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><SectionHeader title="Requirement" /></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm">
              <div><p className="text-xs text-muted-foreground">Pickup</p><p className="font-medium">{data.originAddress}</p></div>
              <div><p className="text-xs text-muted-foreground">Delivery</p><p className="font-medium">{data.destinationAddress}</p></div>
              <div><p className="text-xs text-muted-foreground">Distance</p><p className="tabular font-medium">{data.distanceKm ?? '—'} km</p></div>
              <div><p className="text-xs text-muted-foreground">Capacity needed</p><p className="tabular font-medium">{data.requiredCapacityTons}T</p></div>
              <div><p className="text-xs text-muted-foreground">Material value</p><p className="tabular font-medium">{formatCurrency(data.materialPrice)}</p></div>
              <div><p className="text-xs text-muted-foreground">Transport</p><p className="tabular font-medium">{formatCurrency(data.transportPrice)}</p></div>
              {data.notes ? <div className="col-span-2"><p className="text-xs text-muted-foreground">Notes</p><p>{data.notes}</p></div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title={`Quotes (${data.quotes.length})`} description={isCustomer ? 'Compare price, ETA, truck and driver score.' : 'Your offer on this requirement.'} />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {data.quotes.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No quotes yet.</p>
              ) : (
                data.quotes.map((quote) => (
                  <div key={quote.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{quote.fleetName}</p>
                        <p className="text-xs text-muted-foreground">
                          {quote.truck ? `${quote.truck.registrationNumber} · ${quote.truck.capacityTons}T` : 'No truck named'}
                          {quote.truck?.verificationStatus === 'VERIFIED' ? ' · verified' : ''}
                        </p>
                        {quote.driver ? (
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            {quote.driver.name} <ScoreBadge score={quote.driver.overallScore} />
                          </p>
                        ) : null}
                        {quote.message ? <p className="mt-1.5 text-xs">{quote.message}</p> : null}
                      </div>
                      <div className="text-right">
                        <p className="tabular text-lg font-semibold">{formatCurrency(quote.price)}</p>
                        {quote.distanceToPickupKm !== null ? <p className="text-xs text-muted-foreground">{quote.distanceToPickupKm} km from pickup</p> : null}
                        <StatusBadge status={quote.status} size="sm" />
                      </div>
                    </div>
                    {isCustomer && quote.status === 'OFFERED' && ([OrderStatus.REQUESTED, OrderStatus.QUOTED] as OrderStatus[]).includes(data.status) ? (
                      <Button size="sm" className="mt-3 w-full" loading={accept.isPending} onClick={() => accept.mutate(quote.id)}>
                        <Check className="size-4" />Accept this quote
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3"><SectionHeader title="History" /></CardHeader>
          <CardContent className="pt-0">
            <ol className="relative space-y-3 border-l border-border pl-5">
              {data.events.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-primary" />
                  <p className="text-sm">{event.description}</p>
                  <p className="text-xs text-muted-foreground">{relativeTimeFrom(event.createdAt)}</p>
                </li>
              ))}
            </ol>
            {data.rating ? (
              <div className="mt-4 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium">Customer rating</p>
                <p className="text-sm">{'★'.repeat(data.rating.rating)}{'☆'.repeat(5 - data.rating.rating)}</p>
                {data.rating.comment ? <p className="mt-1 text-xs text-muted-foreground">{data.rating.comment}</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <QuoteDialog orderId={id} open={quoteOpen} onOpenChange={setQuoteOpen} />
      <RateDialog orderId={id} open={rateOpen} onOpenChange={setRateOpen} />
      {void Badge}
    </div>
  );
}

function QuoteDialog({ orderId, open, onOpenChange }: { orderId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [truckId, setTruckId] = React.useState('');
  const [price, setPrice] = React.useState(0);
  const [message, setMessage] = React.useState('');

  const trucks = useQuery({
    queryKey: ['trucks', 'quotable'],
    queryFn: () => api.get<any>('/trucks', { status: 'AVAILABLE,ASSIGNED,IDLE', verificationStatus: 'VERIFIED', pageSize: 100 }),
    enabled: open,
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/quotes`, { truckId, price, ...(message ? { message } : {}) }),
    onSuccess: () => {
      toast.success('Quote submitted');
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not submit the quote', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Quote for this requirement</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Truck</Label>
            <select className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm" value={truckId} onChange={(event) => setTruckId(event.target.value)}>
              <option value="">Choose a verified truck</option>
              {(trucks.data?.items ?? []).map((truck: any) => (
                <option key={truck.id} value={truck.id}>{truck.registrationNumber} · {truck.capacityTons}T</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label required>Your price (₹)</Label>
            <Input type="number" min={0} value={price} onChange={(event) => setPrice(Number(event.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Message to the customer</Label>
            <Textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Availability, driver experience, anything that helps them choose." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!truckId || price <= 0} loading={submit.isPending} onClick={() => submit.mutate()}>Submit quote</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RateDialog({ orderId, open, onOpenChange }: { orderId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState('');

  const submit = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/rate`, { rating, ...(comment ? { comment } : {}) }),
    onSuccess: () => {
      toast.success('Thanks for rating this delivery');
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not save the rating', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rate this delivery</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} stars`} className="text-2xl">
                <span className={value <= rating ? 'text-accent' : 'text-muted-foreground'}>★</span>
              </button>
            ))}
          </div>
          <Textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="How did the delivery go?" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>Submit rating</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OrderDetailPage;

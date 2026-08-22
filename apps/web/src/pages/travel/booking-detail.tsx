import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CreditCard,
  MapPin,
  Navigation,
  Phone,
  Star,
  UserRound,
} from 'lucide-react';
import { Permission, RealtimeEvent, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import type { BookingDetail, BookingTracking, VehicleSummary } from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { FleetMap, type MapMarkerPoint } from '@/features/maps';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { bookingStatusTone } from './bookings';

/**
 * One booking, from either side.
 *
 * The customer pays, tracks and rates here; the provider confirms, assigns and
 * runs the trip. Which controls appear is decided by whether the signed-in
 * organization is the customer or the provider — the API enforces the same
 * split, so hiding a button is a courtesy rather than the boundary.
 *
 * Tracking is deliberately the simplified view: location, driver, progress and
 * ETA. A passenger has no business seeing the coolant temperature of a vehicle
 * they do not own.
 */

export function TravelBookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, session } = useAuth();
  const queryClient = useQueryClient();

  const [vehicleId, setVehicleId] = React.useState('');
  const [declineReason, setDeclineReason] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [rating, setRating] = React.useState(5);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const booking = useQuery({
    queryKey: ['travel', 'booking', id],
    queryFn: () => api.get<BookingDetail>(`/travel/bookings/${id}`),
    enabled: Boolean(id) && can(Permission.BOOKINGS_READ),
  });

  const data = booking.data;
  const isProvider = Boolean(data && session?.organization?.id === data.providerOrganizationId);
  const isCustomer = Boolean(data && session?.organization?.id === data.customerOrganizationId);
  const trackable = data?.status === 'CONFIRMED' || data?.status === 'IN_PROGRESS';

  const tracking = useQuery({
    queryKey: ['travel', 'booking', id, 'tracking'],
    queryFn: () => api.get<BookingTracking>(`/travel/bookings/${id}/tracking`),
    enabled: Boolean(id) && Boolean(trackable),
    refetchInterval: 15_000,
  });

  // The provider needs its own passenger vehicles to assign one.
  const vehicles = useQuery({
    queryKey: ['travel', 'assignable-vehicles'],
    queryFn: () =>
      api.get<Paginated<VehicleSummary>>('/fleet/vehicles', {
        capability: 'PASSENGER',
        pageSize: 50,
      }),
    enabled: isProvider && data?.status === 'AWAITING_CONFIRMATION',
  });

  useRealtimeEvent(RealtimeEvent.BOOKING_UPDATED, (message) => {
    if (message.payload.bookingId === id) void booking.refetch();
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['travel'] });
  }

  function onError(error: unknown) {
    setActionError(
      error instanceof ApiError ? error.message : 'That action could not be completed.',
    );
  }

  const pay = useMutation({
    mutationFn: () => api.post(`/travel/bookings/${id}/pay`, { method: 'MOCK' }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.post(`/travel/bookings/${id}/confirm`, {
        vehicleId: vehicleId || undefined,
      }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const decline = useMutation({
    mutationFn: () =>
      api.post(`/travel/bookings/${id}/decline`, { reason: declineReason.trim() }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const start = useMutation({
    mutationFn: () => api.post(`/travel/bookings/${id}/start`),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const complete = useMutation({
    mutationFn: () => api.post(`/travel/bookings/${id}/complete`),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/travel/bookings/${id}/cancel`, { reason: cancelReason.trim() }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const rate = useMutation({
    mutationFn: () =>
      api.post(`/travel/bookings/${id}/rate`, {
        rating,
        comment: comment.trim() || undefined,
      }),
    onSuccess: () => {
      setComment('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  if (!can(Permission.BOOKINGS_READ)) return <UnauthorizedState />;
  if (booking.isLoading) return <LoadingState label="Loading the booking…" />;
  if (booking.error) return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  if (!data) return <ErrorState error={new Error('Booking not found')} />;

  const markers: MapMarkerPoint[] = tracking.data?.available
    ? [
        {
          id: 'vehicle',
          latitude: tracking.data.latitude!,
          longitude: tracking.data.longitude!,
          label: tracking.data.vehicleRegistration ?? 'Vehicle',
          kind: 'waypoint',
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link
            to={isProvider ? '/travel/provider/bookings' : '/travel/bookings'}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Bookings
          </Link>
        }
        title={data.packageTitle}
        description={`${data.reference} · ${new Date(data.startDate).toLocaleDateString('en-IN')} · ${data.passengers} passenger${data.passengers === 1 ? '' : 's'}`}
        actions={
          <Badge variant={bookingStatusTone(data.status)}>{humanizeEnum(data.status)}</Badge>
        }
      />

      {actionError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">{actionError}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          {trackable ? (
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Live tracking"
                  description="Location, driver and ETA only — engine data is never shared with passengers."
                />
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {tracking.isLoading ? (
                  <LoadingState label="Locating the vehicle…" className="min-h-[200px]" />
                ) : tracking.data?.available ? (
                  <>
                    <FleetMap markers={markers} height="280px" autoFit />
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Vehicle
                        </p>
                        <p className="font-medium">{tracking.data.vehicleRegistration}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Speed
                        </p>
                        <p className="font-medium">
                          {tracking.data.speedKph === null
                            ? 'Not reported'
                            : `${Math.round(tracking.data.speedKph)} km/h`}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Driver
                        </p>
                        <p className="font-medium">{tracking.data.driverName ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">ETA</p>
                        <p className="font-medium">
                          {tracking.data.etaAt
                            ? new Date(tracking.data.etaAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </p>
                      </div>
                    </div>
                    {tracking.data.progressPercent !== null ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Trip progress</span>
                          <span>{tracking.data.progressPercent}%</span>
                        </div>
                        <Progress value={tracking.data.progressPercent} className="h-1.5" />
                      </div>
                    ) : null}
                    {tracking.data.recordedAt ? (
                      <p className="text-2xs text-muted-foreground">
                        Position from {new Date(tracking.data.recordedAt).toLocaleTimeString('en-IN')}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
                    <Navigation className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{tracking.data?.reason ?? 'Tracking is not available for this trip yet.'}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Trip" />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Departs</p>
                <p className="font-medium">{new Date(data.startDate).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Returns</p>
                <p className="font-medium">{new Date(data.endDate).toLocaleDateString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Passengers</p>
                <p className="font-medium">{data.passengers}</p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pickup</p>
                <p className="font-medium">{data.pickupAddress ?? '—'}</p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Destinations
                </p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {data.destinations.map((destination) => (
                    <Badge key={destination} variant="outline" size="sm">
                      {destination}
                    </Badge>
                  ))}
                </div>
              </div>
              {data.specialRequests ? (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Requests</p>
                  <p>{data.specialRequests}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="History" />
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-3">
                {data.events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{humanizeEnum(event.eventType)}</p>
                      {event.description ? (
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Payment" />
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{data.priceBreakdown ?? 'Subtotal'}</span>
                <span>{formatCurrency(data.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Booking fee</span>
                <span>{formatCurrency(data.platformFee)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{formatCurrency(data.totalAmount)}</span>
              </div>
              {data.paymentStatus ? (
                <p className="text-xs text-muted-foreground">
                  Payment: {humanizeEnum(data.paymentStatus)}
                </p>
              ) : null}
              {data.refundAmount !== null ? (
                <p className="text-xs text-success">
                  Refunded {formatCurrency(data.refundAmount)}
                </p>
              ) : null}

              {isCustomer && data.status === 'PENDING_PAYMENT' ? (
                <>
                  <Button
                    className="w-full gap-1.5"
                    loading={pay.isPending}
                    onClick={() => pay.mutate()}
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay {formatCurrency(data.totalAmount)}
                  </Button>
                  <p className="text-2xs text-muted-foreground">
                    This environment uses a mock gateway — no real money moves, and the reference is
                    prefixed MOCK so it can never be mistaken for a real settlement.
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title={isProvider ? 'Customer' : 'Provider'} />
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <p className="font-medium">
                {isProvider ? data.contactName : (data.providerName ?? 'Saarthi provider')}
              </p>
              {isProvider ? (
                <Button asChild variant="secondary" className="w-full gap-1.5">
                  <a href={`tel:${data.contactPhone}`}>
                    <Phone className="h-4 w-4" />
                    {data.contactPhone}
                  </a>
                </Button>
              ) : data.providerPhone ? (
                <Button asChild variant="secondary" className="w-full gap-1.5">
                  <a href={`tel:${data.providerPhone}`}>
                    <Phone className="h-4 w-4" />
                    {data.providerPhone}
                  </a>
                </Button>
              ) : (
                <p className="text-muted-foreground">
                  The provider&rsquo;s number is shared once the booking is confirmed.
                </p>
              )}

              {data.vehicle ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</p>
                  <p className="font-medium">{data.vehicle.registrationNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {humanizeEnum(data.vehicle.vehicleType)}
                    {data.vehicle.model ? ` · ${data.vehicle.model}` : ''}
                  </p>
                </div>
              ) : null}

              {data.driver ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Driver</p>
                  <p className="inline-flex items-center gap-1.5 font-medium">
                    <UserRound className="h-3.5 w-3.5" />
                    {data.driver.name}
                  </p>
                  {data.driver.overallScore !== null ? (
                    <p className="text-xs text-muted-foreground">
                      Saarthi safety score {data.driver.overallScore}/100
                    </p>
                  ) : null}
                  {data.driver.phone ? (
                    <a
                      href={`tel:${data.driver.phone}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs hover:text-foreground"
                    >
                      <Phone className="h-3 w-3" />
                      {data.driver.phone}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {isProvider && data.status === 'AWAITING_CONFIRMATION' ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Confirm this booking"
                  description="Assign a vehicle to create the trip and start tracking."
                />
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1.5">
                  <Label>Vehicle</Label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a vehicle" />
                    </SelectTrigger>
                    <SelectContent>
                      {(vehicles.data?.items ?? [])
                        .filter(
                          (vehicle) =>
                            vehicle.passengerCapacity === null ||
                            vehicle.passengerCapacity >= data.passengers,
                        )
                        .map((vehicle) => (
                          <SelectItem key={vehicle.id} value={vehicle.id}>
                            {vehicle.registrationNumber} · {vehicle.typeLabel}
                            {vehicle.passengerCapacity ? ` · ${vehicle.passengerCapacity} seats` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  loading={confirm.isPending}
                  onClick={() => confirm.mutate()}
                >
                  Confirm booking
                </Button>

                <Separator />

                <div className="space-y-1.5">
                  <Label htmlFor="decline">Cannot take it?</Label>
                  <Textarea
                    id="decline"
                    rows={2}
                    value={declineReason}
                    onChange={(event) => setDeclineReason(event.target.value)}
                    placeholder="No vehicle free that weekend."
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    disabled={declineReason.trim().length < 3}
                    loading={decline.isPending}
                    onClick={() => decline.mutate()}
                  >
                    Decline and refund in full
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isProvider && data.status === 'CONFIRMED' ? (
            <Button className="w-full" loading={start.isPending} onClick={() => start.mutate()}>
              Start trip
            </Button>
          ) : null}

          {isProvider && data.status === 'IN_PROGRESS' ? (
            <Button
              className="w-full"
              loading={complete.isPending}
              onClick={() => complete.mutate()}
            >
              Complete trip
            </Button>
          ) : null}

          {isCustomer && data.status === 'COMPLETED' && data.rating === null ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Rate this trip" />
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(value)}
                      className="p-1"
                      aria-label={`${value} star${value === 1 ? '' : 's'}`}
                    >
                      <Star
                        className={
                          value <= rating
                            ? 'h-6 w-6 fill-warning text-warning'
                            : 'h-6 w-6 text-muted-foreground'
                        }
                      />
                    </button>
                  ))}
                </div>
                <Textarea
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="How was the vehicle and the driver?"
                />
                <Button className="w-full" loading={rate.isPending} onClick={() => rate.mutate()}>
                  Submit rating
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {data.rating !== null ? (
            <Card className="border-success/40 bg-success/5">
              <CardContent className="flex items-center gap-2 py-3 text-sm">
                <Star className="h-4 w-4 fill-warning text-warning" />
                <span>You rated this trip {data.rating}/5.</span>
              </CardContent>
            </Card>
          ) : null}

          {(isCustomer || isProvider) &&
          ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED'].includes(data.status) ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Cancel" />
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <Textarea
                  rows={2}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Reason for cancelling"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  disabled={cancelReason.trim().length < 3}
                  loading={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  Cancel booking
                </Button>
                {isCustomer ? (
                  <p className="text-2xs text-muted-foreground">
                    The refund follows the provider&rsquo;s published cancellation policy. The
                    booking fee is not refundable on a customer cancellation.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {data.cancellationReason ? (
            <Card>
              <CardContent className="space-y-1 py-3 text-sm">
                <p className="font-medium">
                  Cancelled by {data.cancelledBy?.toLowerCase() ?? 'someone'}
                </p>
                <p className="text-muted-foreground">{data.cancellationReason}</p>
              </CardContent>
            </Card>
          ) : null}

          {data.declineReason ? (
            <Card>
              <CardContent className="space-y-1 py-3 text-sm">
                <p className="font-medium">Declined by the provider</p>
                <p className="text-muted-foreground">{data.declineReason}</p>
              </CardContent>
            </Card>
          ) : null}

          {data.tripId ? (
            <Card>
              <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  This booking runs on Saarthi trip {data.tripId.slice(0, 8)} — the same trip engine
                  the freight side uses, which is why live tracking works here at all.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default TravelBookingDetailPage;

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  Car,
  Check,
  Clock,
  Contact,
  Fuel,
  MapPin,
  ShieldCheck,
  Star,
  UserRound,
  X,
} from 'lucide-react';
import { Feature, Permission, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import type { BookingSummary, PackageSummary, PriceQuote } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormWizard, WizardField, type WizardStep } from '@/components/common/form-wizard';

/**
 * Package detail and the booking form.
 *
 * The price is quoted from the API before the customer commits, and the same
 * figure is snapshotted onto the booking — so a later change to the package
 * price cannot alter what they agreed to pay.
 */

/** Per-field messages for the booking wizard. */
type BookingErrors = Partial<
  Record<'passengers' | 'startDate' | 'contactName' | 'contactPhone', string>
>;

/** Minimum notice Saarthi requires, mirrored from the shared domain rules. */
const MIN_LEAD_HOURS = 4;

function defaultStartDate(advanceDays: number): string {
  const start = new Date(Date.now() + Math.max(1, advanceDays) * 86_400_000 + 3_600_000);
  return start.toISOString().slice(0, 16);
}

export function TravelPackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can, hasFeature, session } = useAuth();

  const pkg = useQuery({
    queryKey: ['travel', 'package', id],
    queryFn: () => api.get<PackageSummary>(`/travel/packages/${id}`),
    enabled: Boolean(id),
  });

  const [passengers, setPassengers] = React.useState<string>('');
  const [startDate, setStartDate] = React.useState('');
  const [contactName, setContactName] = React.useState('');
  const [contactPhone, setContactPhone] = React.useState('');
  const [pickup, setPickup] = React.useState('');
  const [requests, setRequests] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [bookingErrors, setBookingErrors] = React.useState<BookingErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);

  // Seed the form from the package and the signed-in user once loaded.
  React.useEffect(() => {
    if (!pkg.data) return;
    setPassengers((current) => current || String(pkg.data.minPassengers));
    setStartDate((current) => current || defaultStartDate(pkg.data.advanceBookingDays));
    setPickup((current) => current || pkg.data.startLocation);
  }, [pkg.data]);

  React.useEffect(() => {
    if (!session?.user) return;
    setContactName((current) => current || session.user.fullName);
    setContactPhone((current) => current || (session.user.phone ?? ''));
  }, [session]);

  const partySize = Number(passengers) || 0;

  const quote = useQuery({
    queryKey: ['travel', 'quote', id, partySize],
    queryFn: () => api.get<PriceQuote>('/travel/quote', { packageId: id!, passengers: partySize }),
    enabled:
      Boolean(id) &&
      partySize > 0 &&
      Boolean(pkg.data) &&
      partySize >= (pkg.data?.minPassengers ?? 1) &&
      partySize <= (pkg.data?.maxPassengers ?? 1),
  });

  const book = useMutation({
    mutationFn: () =>
      api.post<BookingSummary>('/travel/bookings', {
        packageId: id,
        startDate: new Date(startDate).toISOString(),
        passengers: partySize,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        pickupAddress: pickup.trim() || undefined,
        specialRequests: requests.trim() || undefined,
      }),
    onSuccess: (booking) => {
      // Straight to the booking, where payment is the next step.
      navigate(`/travel/bookings/${booking.id}`);
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError ? error.message : 'That booking could not be created.',
      );
    },
  });

  if (pkg.isLoading) return <LoadingState label="Loading the trip…" />;
  if (pkg.error) return <ErrorState error={pkg.error} onRetry={() => void pkg.refetch()} />;
  if (!pkg.data) return <ErrorState error={new Error('Package not found')} />;

  const data = pkg.data;
  const canBook = can(Permission.BOOKINGS_CREATE) && hasFeature(Feature.TRAVEL_BOOKINGS);
  const isOwnPackage = session?.organization?.id === data.organizationId;

  const leadHours = startDate
    ? (new Date(startDate).getTime() - Date.now()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const tooSoon = leadHours < MIN_LEAD_HOURS;
  const partyValid = partySize >= data.minPassengers && partySize <= data.maxPassengers;

  /**
   * The quote rides along beside every step rather than sitting under the last
   * one. Party size is set on step one and drives the price, so the customer
   * sees the total move while they are still choosing it.
   */
  const priceSummary = quote.data ? (
    <div className="glass-inset space-y-1.5 p-3 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{quote.data.breakdown}</span>
        <span className="tabular-nums">{formatCurrency(quote.data.subtotal)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Saarthi booking fee</span>
        <span className="tabular-nums">{formatCurrency(quote.data.platformFee)}</span>
      </div>
      <div className="flex justify-between gap-3 border-t border-white/40 pt-1.5 font-semibold dark:border-white/[0.08]">
        <span>Total</span>
        <span className="tabular-nums">{formatCurrency(quote.data.total)}</span>
      </div>
      {formError ? <p className="pt-1 text-xs text-destructive">{formError}</p> : null}
    </div>
  ) : partyValid ? (
    <p className="text-sm text-muted-foreground">Working out the price…</p>
  ) : formError ? (
    <p className="text-sm text-destructive">{formError}</p>
  ) : null;

  const bookingSteps: WizardStep[] = [
    {
      id: 'trip',
      title: 'Trip',
      description: 'When, and how many.',
      icon: CalendarClock,
      content: (
        <>
          <WizardField
            label="Passengers"
            htmlFor="party"
            required
            error={
              bookingErrors.passengers ??
              (!partyValid && passengers
                ? `${data.minPassengers}–${data.maxPassengers} passengers`
                : null)
            }
          >
            <Input
              id="party"
              type="number"
              min={data.minPassengers}
              max={data.maxPassengers}
              value={passengers}
              aria-invalid={(!partyValid && Boolean(passengers)) || undefined}
              onChange={(event) => {
                setPassengers(event.target.value);
                setBookingErrors((previous) => ({ ...previous, passengers: undefined }));
              }}
            />
          </WizardField>

          <WizardField
            label="Start"
            htmlFor="start"
            required
            error={
              bookingErrors.startDate ?? (tooSoon ? `At least ${MIN_LEAD_HOURS} hours' notice` : null)
            }
          >
            <Input
              id="start"
              type="datetime-local"
              value={startDate}
              aria-invalid={tooSoon || undefined}
              onChange={(event) => {
                setStartDate(event.target.value);
                setBookingErrors((previous) => ({ ...previous, startDate: undefined }));
              }}
            />
          </WizardField>
        </>
      ),
    },
    {
      id: 'contact',
      title: 'Contact',
      description: 'Who the provider calls.',
      icon: Contact,
      content: (
        <>
          <WizardField
            label="Contact name"
            htmlFor="contact-name"
            required
            error={bookingErrors.contactName}
          >
            <Input
              id="contact-name"
              value={contactName}
              aria-invalid={Boolean(bookingErrors.contactName) || undefined}
              onChange={(event) => {
                setContactName(event.target.value);
                setBookingErrors((previous) => ({ ...previous, contactName: undefined }));
              }}
            />
          </WizardField>

          <WizardField
            label="Contact phone"
            htmlFor="contact-phone"
            required
            error={bookingErrors.contactPhone}
          >
            <Input
              id="contact-phone"
              value={contactPhone}
              aria-invalid={Boolean(bookingErrors.contactPhone) || undefined}
              onChange={(event) => {
                setContactPhone(event.target.value);
                setBookingErrors((previous) => ({ ...previous, contactPhone: undefined }));
              }}
              placeholder="9876543210"
            />
          </WizardField>
        </>
      ),
    },
    {
      id: 'pickup',
      title: 'Pickup',
      description: 'Where to collect you.',
      icon: MapPin,
      content: (
        <>
          <WizardField label="Pickup" htmlFor="pickup">
            <Input
              id="pickup"
              value={pickup}
              onChange={(event) => setPickup(event.target.value)}
            />
          </WizardField>

          <WizardField label="Anything the provider should know?" htmlFor="requests">
            <Textarea
              id="requests"
              rows={3}
              value={requests}
              onChange={(event) => setRequests(event.target.value)}
              placeholder="Early start, child seat needed."
            />
          </WizardField>

          <p className="text-2xs text-muted-foreground">
            Paying reserves the trip. The provider confirms a vehicle and driver next — if they
            cannot, you are refunded in full.
          </p>
        </>
      ),
    },
  ];

  const validateBookingStep = (step: WizardStep): boolean => {
    const found: BookingErrors = {};

    if (step.id === 'trip') {
      if (!partyValid)
        found.passengers = `${data.minPassengers}–${data.maxPassengers} passengers`;
      if (!startDate) found.startDate = 'Pick a start date and time.';
      else if (tooSoon) found.startDate = `At least ${MIN_LEAD_HOURS} hours' notice`;
    }

    if (step.id === 'contact') {
      if (!contactName.trim()) found.contactName = 'Who should the provider ask for?';
      if (!contactPhone.trim()) found.contactPhone = 'A number they can reach on the day.';
    }

    const ok = Object.keys(found).length === 0;
    setBookingErrors(found);
    setErroredStepIds((previous) =>
      ok
        ? previous.filter((entry) => entry !== step.id)
        : previous.includes(step.id)
          ? previous
          : [...previous, step.id],
    );

    return ok;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/travel" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Travel
          </Link>
        }
        title={data.title}
        description={data.summary}
        actions={
          data.ratingCount > 0 ? (
            <Badge variant="secondary" className="gap-1">
              <Star className="h-3 w-3 fill-warning text-warning" />
              {data.ratingAverage.toFixed(1)} · {data.ratingCount} review
              {data.ratingCount === 1 ? '' : 's'}
            </Badge>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 py-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Duration</p>
                <p className="font-medium">
                  {data.durationDays} day{data.durationDays === 1 ? '' : 's'}
                  {data.durationNights ? `, ${data.durationNights} night(s)` : ''}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</p>
                <p className="font-medium">{humanizeEnum(data.vehicleType)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Capacity</p>
                <p className="font-medium">
                  {data.minPassengers}–{data.maxPassengers} passengers
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Route</p>
                <p className="font-medium">
                  {data.startLocation} → {data.endLocation}
                </p>
              </div>
            </CardContent>
          </Card>

          {data.description ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="About this trip" />
              </CardHeader>
              <CardContent className="pt-0 text-sm leading-relaxed text-muted-foreground">
                {data.description}
              </CardContent>
            </Card>
          ) : null}

          {data.itinerary.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Itinerary" />
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {data.itinerary.map((day) => (
                  <div key={day.dayNumber} className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {day.dayNumber}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{day.title}</p>
                      {day.description ? (
                        <p className="text-sm text-muted-foreground">{day.description}</p>
                      ) : null}
                      {day.highlights.length > 0 ? (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {day.highlights.map((highlight) => (
                            <Badge key={highlight} variant="outline" size="sm">
                              {highlight}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex gap-3 pt-0.5 text-xs text-muted-foreground">
                        {day.overnightAt ? <span>Overnight: {day.overnightAt}</span> : null}
                        {day.approxDistanceKm ? <span>≈ {day.approxDistanceKm} km</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader title="Included" />
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1.5">
                  {data.inclusions.length === 0 ? (
                    <li className="text-sm text-muted-foreground">Not itemised.</li>
                  ) : (
                    data.inclusions.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                        {item}
                      </li>
                    ))
                  )}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <SectionHeader title="Not included" />
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1.5">
                  {data.exclusions.length === 0 ? (
                    <li className="text-sm text-muted-foreground">Not itemised.</li>
                  ) : (
                    data.exclusions.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm">
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {item}
                      </li>
                    ))
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>

          {data.cancellationPolicy && data.cancellationPolicy.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Cancellation"
                  description="The booking fee is not refundable when the customer cancels. A provider cancellation always refunds in full."
                />
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1 text-sm">
                  {data.cancellationPolicy.map((tier) => (
                    <li key={tier.hoursBefore} className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        {tier.hoursBefore === 0
                          ? 'Less than 24 hours before'
                          : `${Math.round(tier.hoursBefore / 24)} day(s) or more before`}
                      </span>
                      <span className="font-medium">{tier.refundPercent}% refunded</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {data.provider ? (
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Operated by</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{data.provider.displayName}</p>
                  {data.provider.verificationStatus === 'VERIFIED' ? (
                    <Badge variant="success" size="sm" className="gap-1">
                      <ShieldCheck className="h-3 w-3" /> Verified
                    </Badge>
                  ) : null}
                </div>
                {data.provider.ratingCount > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {data.provider.ratingAverage.toFixed(1)} from {data.provider.ratingCount}{' '}
                    completed trip{data.provider.ratingCount === 1 ? '' : 's'}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No reviews yet.</p>
                )}
                <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
                  {data.driverIncluded ? (
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-3.5 w-3.5" /> Driver included
                    </span>
                  ) : null}
                  {data.fuelIncluded ? (
                    <span className="inline-flex items-center gap-1">
                      <Fuel className="h-3.5 w-3.5" /> Fuel included
                    </span>
                  ) : null}
                  {data.vehicle ? (
                    <span className="inline-flex items-center gap-1">
                      <Car className="h-3.5 w-3.5" /> {data.vehicle.model ?? data.vehicle.registrationNumber}
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isOwnPackage || !canBook ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Book this trip" />
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">
                  {isOwnPackage
                    ? 'This is your own package. Bookings arrive under Travel → Bookings.'
                    : 'Sign in with a customer account to book this trip.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            /*
              The strip layout, not the rail: this column is a sidebar, and a
              vertical rail would leave the fields about ten characters wide.
            */
            <FormWizard
              variant="strip"
              title="Book this trip"
              steps={bookingSteps}
              aside={priceSummary}
              onValidateStep={validateBookingStep}
              onSubmit={() => {
                setFormError(null);
                book.mutate();
              }}
              submitting={book.isPending}
              submitLabel="Continue to payment"
              erroredStepIds={erroredStepIds}
            />
          )}

          <Card>
            <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                This provider asks for {data.advanceBookingDays} day
                {data.advanceBookingDays === 1 ? '' : 's'} of notice.
                {data.availableWeekdays.length > 0
                  ? ' It does not depart every day of the week.'
                  : ''}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Once the trip starts you can follow the vehicle live from your booking. Saarthi shows
                location, driver and ETA — never the vehicle&rsquo;s engine data.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default TravelPackageDetailPage;

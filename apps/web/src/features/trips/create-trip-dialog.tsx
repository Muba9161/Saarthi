import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarClock, Fuel, MapPinned, Plus, Truck, TriangleAlert } from 'lucide-react';
import {
  estimateTripFare,
  formatCurrency,
  fuelRateForVehicle,
  humanizeEnum,
  type CityFuelRate,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { DriverSummary, Paginated } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FormWizard,
  WizardField,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';
import type { NavigationRoute } from '@/features/maps/directions';
import { reverseCity } from '@/features/maps/places';
import { useCityFuelRate } from '@/features/petrol-stations/use-city-fuel-rate';
import {
  EMPTY_POINT,
  JourneyPicker,
  isLocatable,
  type JourneyPoint,
} from '@/features/travel/journey-picker';

/**
 * Dispatch a trip that no order created.
 *
 * Most work reaches a fleet through Saarthi — a quote accepted, a bid awarded —
 * and a trip is raised for it automatically. Plenty does not. A regular
 * customer rings the owner, a load is agreed over WhatsApp, a neighbour needs a
 * lorry on Tuesday; the movement is just as real, and until it exists as a trip
 * none of it is tracked, none of it reaches the driver's app, and none of it
 * appears in the fuel or distance figures the fleet is run on.
 *
 * `POST /trips` has always accepted an `orderId` of null for exactly this. What
 * was missing was any way to reach it: nothing in the app posted to that
 * endpoint at all.
 *
 * The journey is picked on a map rather than typed, because the API stores
 * coordinates and the tracking pipeline measures progress against them — an
 * address alone would produce a trip that cannot be followed.
 */

interface TripFormState {
  truckId: string;
  driverId: string;
  origin: JourneyPoint;
  destination: JourneyPoint;
  plannedStartAt: string;
  plannedArrivalAt: string;
  price: string;
  notes: string;
}

type FieldErrors = Partial<Record<keyof TripFormState | 'journey', string>>;

const EMPTY: TripFormState = {
  truckId: '',
  driverId: '',
  origin: EMPTY_POINT,
  destination: EMPTY_POINT,
  plannedStartAt: '',
  plannedArrivalAt: '',
  price: '',
  notes: '',
};

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO string. */
function localDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateTripDialog({ trigger }: { trigger?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<TripFormState>(EMPTY);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);
  /** The road route, which is what the fuel is actually burned over. */
  const [route, setRoute] = React.useState<NavigationRoute | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRoute(null);
    setForm({ ...EMPTY, plannedStartAt: localDateTime(new Date(Date.now() + 3_600_000)) });
    setErrors({});
    setErroredStepIds([]);
  }, [open]);

  const vehicles = useQuery({
    queryKey: ['vehicles', 'dispatchable'],
    queryFn: () => api.get<Paginated<VehicleSummary>>('/fleet/vehicles', { pageSize: 100 }),
    enabled: open,
  });

  const drivers = useQuery({
    queryKey: ['drivers', 'dispatchable'],
    queryFn: () => api.get<Paginated<DriverSummary>>('/drivers', { pageSize: 100 }),
    enabled: open,
  });

  const vehicle = vehicles.data?.items.find((item) => item.id === form.truckId) ?? null;

  /*
   * Which city's fuel price applies.
   *
   * The vehicle's own position, because that is where it will fill up before
   * it leaves — rates differ by several rupees a litre between neighbouring
   * states, and a fleet parked in Noida does not buy Delhi diesel. A vehicle
   * that has never reported falls back to where the load is collected.
   */
  const fuelPoint = vehicle?.lastLocation
    ? { latitude: vehicle.lastLocation.latitude, longitude: vehicle.lastLocation.longitude }
    : isLocatable(form.origin)
      ? { latitude: form.origin.latitude, longitude: form.origin.longitude }
      : null;

  const fuelCity = useQuery({
    queryKey: [
      'reverse-city',
      fuelPoint ? `${fuelPoint.latitude.toFixed(3)},${fuelPoint.longitude.toFixed(3)}` : '',
    ],
    queryFn: () => reverseCity(fuelPoint!),
    enabled: open && Boolean(fuelPoint),
    staleTime: 30 * 60_000,
    retry: false,
  });

  const rate = useCityFuelRate({
    city: fuelCity.data?.city ?? null,
    state: fuelCity.data?.state ?? null,
    enabled: open,
  });

  /*
   * Priced on the road distance rather than the straight line: fuel is burned
   * over the route the lorry actually drives, and on Indian highways the two
   * differ by a fifth or more.
   */
  const estimate =
    route && vehicle
      ? estimateTripFare({
          distanceKm: route.distanceMeters / 1000,
          fuelEfficiency: vehicle.fuelEfficiency,
          rate: fuelRateForVehicle(rate.data as CityFuelRate | null, vehicle.fuelType),
        })
      : null;

  const enteredFare = Number(form.price);
  const belowFuel =
    estimate !== null && form.price.trim() !== '' && Number.isFinite(enteredFare)
      ? enteredFare < estimate.fuelCost
      : false;

  const set = <K extends keyof TripFormState>(key: K, value: TripFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));
  };

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<{ id: string }>('/trips', payload),
    onSuccess: (trip) => {
      toast.success('Trip dispatched', {
        description: 'The vehicle and driver have been assigned.',
      });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setOpen(false);
      // Straight to the trip, which is where the map and the timeline are.
      navigate(`/trips/${trip.id}`);
    },
    onError: (error) =>
      toast.error('Could not dispatch the trip', { description: errorMessage(error) }),
  });

  const submit = (): void => {
    if (!isLocatable(form.origin) || !isLocatable(form.destination)) return;

    create.mutate({
      truckId: form.truckId,
      ...(form.driverId ? { driverId: form.driverId } : {}),
      origin: {
        addressLine: form.origin.address.trim(),
        latitude: form.origin.latitude,
        longitude: form.origin.longitude,
      },
      destination: {
        addressLine: form.destination.address.trim(),
        latitude: form.destination.latitude,
        longitude: form.destination.longitude,
      },
      ...(form.plannedStartAt
        ? { plannedStartAt: new Date(form.plannedStartAt).toISOString() }
        : {}),
      ...(form.plannedArrivalAt
        ? { plannedArrivalAt: new Date(form.plannedArrivalAt).toISOString() }
        : {}),
      ...(form.price ? { price: Number(form.price) } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    });
  };

  /** Mirrors `createTripSchema`, keyed by step id. */
  const validateStep = (step: WizardStep): boolean => {
    const found: FieldErrors = {};

    if (step.id === 'vehicle') {
      if (!form.truckId) found.truckId = 'Choose the vehicle making this trip.';
      // The API falls back to whoever is already on the truck, and refuses the
      // dispatch when there is nobody — better to say so before the last step.
      const truck = vehicles.data?.items.find((vehicle) => vehicle.id === form.truckId);
      if (form.truckId && !form.driverId && !truck?.currentDriver) {
        found.driverId = 'This vehicle has no driver assigned, so choose one here.';
      }
    }

    if (step.id === 'journey') {
      if (!isLocatable(form.origin)) found.origin = 'Search for where the load is collected.';
      if (!isLocatable(form.destination)) found.destination = 'Search for where it is delivered.';
    }

    if (step.id === 'schedule') {
      if (form.price && !(Number(form.price) >= 0)) found.price = 'Enter what this trip earns.';
      if (
        form.plannedStartAt &&
        form.plannedArrivalAt &&
        new Date(form.plannedArrivalAt) <= new Date(form.plannedStartAt)
      ) {
        found.plannedArrivalAt = 'Arrival has to be after departure.';
      }
    }

    const ok = Object.keys(found).length === 0;
    setErrors(found);
    setErroredStepIds((previous) =>
      ok
        ? previous.filter((id) => id !== step.id)
        : previous.includes(step.id)
          ? previous
          : [...previous, step.id],
    );

    return ok;
  };

  const steps: WizardStep[] = [
    {
      id: 'vehicle',
      title: 'Vehicle & driver',
      description: 'Who is running it.',
      icon: Truck,
      content: (
        <>
          <WizardField label="Vehicle" required error={errors.truckId}>
            <Select value={form.truckId} onValueChange={(value) => set('truckId', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a vehicle" />
              </SelectTrigger>
              <SelectContent>
                {(vehicles.data?.items ?? []).map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber} · {vehicle.typeLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          <WizardField
            label="Driver"
            error={errors.driverId}
            hint="Leave blank to use whoever is already assigned to the vehicle."
          >
            <Select value={form.driverId} onValueChange={(value) => set('driverId', value)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a driver" />
              </SelectTrigger>
              <SelectContent>
                {(drivers.data?.items ?? [])
                  // The API refuses an unverified driver, so offering one here
                  // would only be a rejection at the end of the form.
                  .filter((driver) => driver.verificationStatus === 'VERIFIED')
                  .map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.fullName}
                      {driver.currentTruck ? ` · on ${driver.currentTruck.registrationNumber}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </WizardField>
        </>
      ),
    },
    {
      id: 'journey',
      title: 'Journey',
      description: 'Where it goes.',
      icon: MapPinned,
      content: (
        <JourneyPicker
          pickup={form.origin}
          onPickupChange={(next) => set('origin', next)}
          dropoff={form.destination}
          onDropoffChange={(next) => set('destination', next)}
          dropoffRequired
          pickupError={errors.origin ?? null}
          dropoffError={errors.destination ?? null}
          departAt={form.plannedStartAt ? new Date(form.plannedStartAt) : null}
          near={
            vehicle?.lastLocation
              ? {
                  latitude: vehicle.lastLocation.latitude,
                  longitude: vehicle.lastLocation.longitude,
                }
              : null
          }
          onRouteChange={setRoute}
          labels={{
            pickup: 'Collect from',
            pickupPlaceholder: 'Yard, factory gate, mandi…',
            dropoff: 'Deliver to',
            dropoffPlaceholder: 'Site, warehouse, address…',
            dropoffHint: 'The driver is navigated to this point.',
          }}
        />
      ),
    },
    {
      id: 'schedule',
      title: 'Schedule & rate',
      description: 'When, and for how much.',
      icon: CalendarClock,
      optional: true,
      content: (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField label="Planned departure" htmlFor="trip-start">
              <Input
                id="trip-start"
                type="datetime-local"
                value={form.plannedStartAt}
                onChange={(event) => set('plannedStartAt', event.target.value)}
              />
            </WizardField>
            <WizardField
              label="Planned arrival"
              htmlFor="trip-arrival"
              error={errors.plannedArrivalAt}
            >
              <Input
                id="trip-arrival"
                type="datetime-local"
                value={form.plannedArrivalAt}
                aria-invalid={Boolean(errors.plannedArrivalAt) || undefined}
                onChange={(event) => set('plannedArrivalAt', event.target.value)}
              />
            </WizardField>
          </div>

          <WizardField
            label="Trip rate (₹)"
            htmlFor="trip-price"
            error={errors.price}
            hint="What the customer is paying. It feeds the earnings reports."
          >
            <Input
              id="trip-price"
              type="number"
              min={0}
              value={form.price}
              aria-invalid={Boolean(errors.price) || undefined}
              onChange={(event) => set('price', event.target.value)}
            />
          </WizardField>

          {/*
           * A price agreed on the phone is a guess unless the fuel is priced
           * first. This is the arithmetic an owner does on the back of a
           * docket, with today's rate from the city the lorry is standing in
           * — shown in full so it can be argued with rather than trusted.
           */}
          {estimate ? (
            <div className="glass-inset space-y-2.5 p-3">
              <div className="flex items-start gap-2">
                <Fuel className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    About {estimate.fuelUnits} {estimate.unit === 'kg' ? 'kg' : 'L'} of{' '}
                    {humanizeEnum(vehicle?.fuelType ?? '').toLowerCase()} —{' '}
                    {formatCurrency(estimate.fuelCost)} of fuel
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {estimate.distanceKm} km at {vehicle?.fuelEfficiency} km/
                    {estimate.unit === 'kg' ? 'kg' : 'L'}, {formatCurrency(estimate.pricePerUnit)}{' '}
                    per {estimate.unit} in {fuelCity.data?.city}
                    {rate.data?.publishedOn ? ` on ${rate.data.publishedOn}` : ''}.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                <div className="min-w-0">
                  <p className="text-sm">
                    Suggested fare{' '}
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(estimate.suggestedFare)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Fuel is roughly 55% of a fare that also covers the driver, tyres and tolls.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set('price', String(estimate.suggestedFare))}
                >
                  Use this
                </Button>
              </div>

              {belowFuel ? (
                <p className="flex items-start gap-1.5 border-t border-border/60 pt-2.5 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  That is below the {formatCurrency(estimate.fuelCost)} of fuel this trip burns —
                  the run loses money before the driver is paid.
                </p>
              ) : null}
            </div>
          ) : route && vehicle && !vehicle.fuelEfficiency ? (
            <p className="text-xs text-muted-foreground">
              Record this vehicle&rsquo;s mileage to get a fuel-based fare suggestion.
            </p>
          ) : null}

          <WizardField
            label="Notes"
            htmlFor="trip-notes"
            hint="Who the load is for, and anything the driver needs to know."
          >
            <Textarea
              id="trip-notes"
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
              placeholder="Cement for Verma Builders, booked over the phone. Gate closes at 6."
            />
          </WizardField>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            New trip
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>Dispatch a trip</DialogTitle>
          <DialogDescription>
            For work that did not come through Saarthi — a load agreed on the phone still needs a
            vehicle, a driver and tracking.
          </DialogDescription>
        </DialogHeader>

        <FormWizard
          steps={steps}
          className={WIZARD_IN_DIALOG}
          panelClassName={WIZARD_DIALOG_PANEL}
          resetKey={open}
          onValidateStep={validateStep}
          onSubmit={submit}
          submitting={create.isPending}
          submitLabel="Dispatch trip"
          erroredStepIds={erroredStepIds}
          footerStart={
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}

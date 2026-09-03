import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, HelpCircle, ListChecks, MapPin, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_BID_WINDOW_HOURS,
  HireBasis,
  MaterialUnit,
  Permission,
  REQUIREMENT_KIND_LABELS,
  RequirementKind,
  TruckType,
  VehicleType,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { RequirementSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { KindPicker } from '@/features/requirements/kind-picker';
import { PageHeader } from '@/components/common/page-header';
import { UnauthorizedState } from '@/components/common/states';
import {
  FormWizard,
  WizardField,
  WizardSection,
  type WizardStep,
} from '@/components/common/form-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Post a requirement.
 *
 * The wizard opens on the question the customer actually has — what do you
 * need — and everything after it is shaped by that answer. One "Details" step
 * renders one of four bodies, so a person asking for a taxi is never shown a
 * tonnage field, and a person asking for cement is never asked how many
 * passengers are travelling.
 *
 * Nothing is posted until the last step, and the requirement goes out to every
 * business whose account type qualifies it to serve that kind. From there it is
 * the bidding board's job.
 */

type FieldKey =
  | 'title'
  | 'materialName'
  | 'quantity'
  | 'goodsDescription'
  | 'capacity'
  | 'passengers'
  | 'destinations'
  | 'durationDays'
  | 'durationHours'
  | 'originAddress'
  | 'originLatitude'
  | 'originLongitude'
  | 'destinationAddress'
  | 'destinationLatitude'
  | 'destinationLongitude'
  | 'startAt'
  | 'bidsCloseAt'
  | 'contactPhone';

type FieldErrors = Partial<Record<FieldKey, string>>;

interface Place {
  addressLine: string;
  city: string;
  latitude: number;
  longitude: number;
}

const EMPTY_PLACE: Place = { addressLine: '', city: '', latitude: 0, longitude: 0 };

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO string. */
function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function withinRange(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Vehicle types a passenger journey can realistically be sold in. */
const PASSENGER_VEHICLE_TYPES: VehicleType[] = [
  VehicleType.CAR,
  VehicleType.SUV,
  VehicleType.TAXI,
  VehicleType.VAN,
  VehicleType.TEMPO,
  VehicleType.BUS,
];

export function NewRequirementPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [kind, setKind] = React.useState<RequirementKind | null>(null);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');

  // Material
  const [materialName, setMaterialName] = React.useState('');
  const [materialCategory, setMaterialCategory] = React.useState('');
  const [specification, setSpecification] = React.useState('');
  const [needsTransport, setNeedsTransport] = React.useState(true);

  // Material + freight share these two.
  const [quantity, setQuantity] = React.useState(20);
  const [unit, setUnit] = React.useState<MaterialUnit>(MaterialUnit.TON);

  // Freight
  const [goodsDescription, setGoodsDescription] = React.useState('');
  const [capacity, setCapacity] = React.useState(20);
  const [truckType, setTruckType] = React.useState<string>('any');
  const [handlingNotes, setHandlingNotes] = React.useState('');

  // Cab
  const [hireBasis, setHireBasis] = React.useState<HireBasis>(HireBasis.ONE_WAY);
  const [durationHours, setDurationHours] = React.useState(4);
  const [luggageCount, setLuggageCount] = React.useState(2);
  const [acRequired, setAcRequired] = React.useState(true);

  // Cab + tour share these.
  const [passengers, setPassengers] = React.useState(4);
  const [vehicleType, setVehicleType] = React.useState<string>('any');
  const [durationDays, setDurationDays] = React.useState(3);

  // Tour
  const [destinationsText, setDestinationsText] = React.useState('');
  const [durationNights, setDurationNights] = React.useState(2);
  const [inclusionsText, setInclusionsText] = React.useState('');
  const [accommodationNeeded, setAccommodationNeeded] = React.useState(false);
  const [mealsNeeded, setMealsNeeded] = React.useState(false);

  // Route & schedule
  const [origin, setOrigin] = React.useState<Place>(EMPTY_PLACE);
  const [destination, setDestination] = React.useState<Place>(EMPTY_PLACE);
  const [startAt, setStartAt] = React.useState(() =>
    toLocalInput(new Date(Date.now() + 5 * 86_400_000)),
  );
  const [endAt, setEndAt] = React.useState('');
  const [scheduleNotes, setScheduleNotes] = React.useState('');

  // Commercials
  const [budgetAmount, setBudgetAmount] = React.useState('');
  const [budgetIsPublic, setBudgetIsPublic] = React.useState(false);
  const [bidsCloseAt, setBidsCloseAt] = React.useState(() =>
    toLocalInput(new Date(Date.now() + DEFAULT_BID_WINDOW_HOURS * 3_600_000)),
  );
  const [contactName, setContactName] = React.useState('');
  const [contactPhone, setContactPhone] = React.useState('');

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);

  const clearError = (key: FieldKey): void =>
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));

  const isTour = kind === RequirementKind.TOUR_PACKAGE;
  const isTravel = isTour || kind === RequirementKind.CAB_HIRE;

  const destinations = destinationsText
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const create = useMutation({
    mutationFn: () => {
      const detail =
        kind === RequirementKind.MATERIAL_SUPPLY
          ? {
              materialDetail: {
                materialName,
                ...(materialCategory ? { category: materialCategory } : {}),
                quantity,
                unit,
                ...(specification ? { specification } : {}),
                needsTransport,
              },
            }
          : kind === RequirementKind.FREIGHT_TRANSPORT
            ? {
                freightDetail: {
                  goodsDescription,
                  quantity,
                  unit,
                  requiredCapacityTons: capacity,
                  ...(truckType !== 'any' ? { requiredTruckType: truckType } : {}),
                  ...(handlingNotes ? { handlingNotes } : {}),
                },
              }
            : kind === RequirementKind.CAB_HIRE
              ? {
                  cabDetail: {
                    hireBasis,
                    passengers,
                    ...(vehicleType !== 'any' ? { preferredVehicleType: vehicleType } : {}),
                    ...(hireBasis === HireBasis.HOURLY ? { durationHours } : {}),
                    ...(hireBasis === HireBasis.DAILY ? { durationDays } : {}),
                    luggageCount,
                    acRequired,
                  },
                }
              : {
                  tourDetail: {
                    destinations,
                    passengers,
                    durationDays,
                    durationNights,
                    ...(vehicleType !== 'any' ? { preferredVehicleType: vehicleType } : {}),
                    requiredInclusions: inclusionsText
                      .split(/[\n,]/)
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                    accommodationNeeded,
                    mealsNeeded,
                  },
                };

      return api.post<RequirementSummary>('/requirements', {
        kind,
        title,
        ...(description ? { description } : {}),
        origin: {
          addressLine: origin.addressLine,
          ...(origin.city ? { city: origin.city } : {}),
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
        ...(isTour && !destination.addressLine
          ? {}
          : {
              destination: {
                addressLine: destination.addressLine,
                ...(destination.city ? { city: destination.city } : {}),
                latitude: destination.latitude,
                longitude: destination.longitude,
              },
            }),
        startAt: new Date(startAt).toISOString(),
        ...(endAt ? { endAt: new Date(endAt).toISOString() } : {}),
        ...(scheduleNotes ? { scheduleNotes } : {}),
        ...(budgetAmount ? { budgetAmount: Number(budgetAmount) } : {}),
        budgetIsPublic,
        bidsCloseAt: new Date(bidsCloseAt).toISOString(),
        ...(contactName ? { contactName } : {}),
        ...(contactPhone ? { contactPhone } : {}),
        ...detail,
      });
    },
    onSuccess: (requirement) => {
      toast.success('Requirement posted', {
        description: 'The businesses that can serve it have been notified.',
      });
      navigate(`/requirements/${requirement.id}`);
    },
    onError: (error) =>
      toast.error('Could not post the requirement', { description: errorMessage(error) }),
  });

  const rulesFor = (stepId: string): FieldErrors => {
    const found: FieldErrors = {};

    if (stepId === 'need') {
      if (title.trim().length < 5) found.title = 'Give this a short title, so bidders know what it is.';
    }

    if (stepId === 'details') {
      if (kind === RequirementKind.MATERIAL_SUPPLY) {
        if (materialName.trim().length < 2) found.materialName = 'Name the material you need.';
        if (!(quantity > 0)) found.quantity = 'How much do you need?';
      }
      if (kind === RequirementKind.FREIGHT_TRANSPORT) {
        if (goodsDescription.trim().length < 2)
          found.goodsDescription = 'Describe what needs moving.';
        if (!(quantity > 0)) found.quantity = 'How much needs moving?';
        if (!(capacity > 0)) found.capacity = 'Enter the truck size this needs.';
      }
      if (kind === RequirementKind.CAB_HIRE) {
        if (!(passengers > 0)) found.passengers = 'How many people are travelling?';
        if (hireBasis === HireBasis.HOURLY && !(durationHours > 0))
          found.durationHours = 'How many hours do you need the vehicle?';
        if (hireBasis === HireBasis.DAILY && !(durationDays > 0))
          found.durationDays = 'How many days do you need the vehicle?';
      }
      if (kind === RequirementKind.TOUR_PACKAGE) {
        if (destinations.length === 0)
          found.destinations = 'Name at least one place you want to visit.';
        if (!(passengers > 0)) found.passengers = 'How many people are travelling?';
        if (!(durationDays > 0)) found.durationDays = 'How many days is the tour?';
      }
    }

    if (stepId === 'route') {
      if (origin.addressLine.trim().length < 3)
        found.originAddress = isTravel ? 'Where should the vehicle collect you?' : 'Enter the pickup point.';
      if (!withinRange(origin.latitude, 90))
        found.originLatitude = 'Enter a latitude between -90 and 90.';
      if (!withinRange(origin.longitude, 180))
        found.originLongitude = 'Enter a longitude between -180 and 180.';

      // A tour is defined by its itinerary, so a single end point is optional.
      if (!isTour) {
        if (destination.addressLine.trim().length < 3)
          found.destinationAddress = isTravel
            ? 'Where are you going?'
            : 'Enter where it has to arrive.';
        if (!withinRange(destination.latitude, 90))
          found.destinationLatitude = 'Enter a latitude between -90 and 90.';
        if (!withinRange(destination.longitude, 180))
          found.destinationLongitude = 'Enter a longitude between -180 and 180.';
      }
    }

    if (stepId === 'schedule') {
      const start = new Date(startAt).getTime();
      if (!Number.isFinite(start)) found.startAt = 'Choose when you need this.';
      else if (start < Date.now()) found.startAt = 'That date has already passed.';
    }

    if (stepId === 'commercials') {
      const close = new Date(bidsCloseAt).getTime();
      const start = new Date(startAt).getTime();
      if (!Number.isFinite(close)) found.bidsCloseAt = 'Choose when bidding should close.';
      else if (close < Date.now()) found.bidsCloseAt = 'That time has already passed.';
      else if (Number.isFinite(start) && close > start)
        found.bidsCloseAt = 'Bidding has to close before the job starts.';

      if (isTravel && contactPhone.trim().length === 0)
        found.contactPhone = 'The operator needs somebody to call — add a phone number.';
    }

    return found;
  };

  const validateStep = (step: WizardStep): boolean => {
    const found = rulesFor(step.id);
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

  if (!can(Permission.REQUIREMENTS_CREATE)) return <UnauthorizedState />;

  const placeFields = (
    which: 'origin' | 'destination',
    place: Place,
    setPlace: (next: Place) => void,
    labels: { address: string; placeholder: string },
  ) => {
    const addressError = which === 'origin' ? errors.originAddress : errors.destinationAddress;
    const latError = which === 'origin' ? errors.originLatitude : errors.destinationLatitude;
    const lngError = which === 'origin' ? errors.originLongitude : errors.destinationLongitude;

    return (
      <>
        <WizardField
          label={labels.address}
          htmlFor={`req-${which}`}
          required={which === 'origin' || !isTour}
          error={addressError}
        >
          <Input
            id={`req-${which}`}
            value={place.addressLine}
            aria-invalid={Boolean(addressError) || undefined}
            onChange={(event) => {
              setPlace({ ...place, addressLine: event.target.value });
              clearError(which === 'origin' ? 'originAddress' : 'destinationAddress');
            }}
            placeholder={labels.placeholder}
          />
        </WizardField>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <WizardField label="City" htmlFor={`req-${which}-city`} className="sm:col-span-1">
            <Input
              id={`req-${which}-city`}
              value={place.city}
              onChange={(event) => setPlace({ ...place, city: event.target.value })}
              placeholder="Jaipur"
            />
          </WizardField>
          <WizardField label="Latitude" htmlFor={`req-${which}-lat`} error={latError}>
            <Input
              id={`req-${which}-lat`}
              type="number"
              step="0.0001"
              value={place.latitude}
              aria-invalid={Boolean(latError) || undefined}
              onChange={(event) => {
                setPlace({ ...place, latitude: Number(event.target.value) });
                clearError(which === 'origin' ? 'originLatitude' : 'destinationLatitude');
              }}
            />
          </WizardField>
          <WizardField label="Longitude" htmlFor={`req-${which}-lng`} error={lngError}>
            <Input
              id={`req-${which}-lng`}
              type="number"
              step="0.0001"
              value={place.longitude}
              aria-invalid={Boolean(lngError) || undefined}
              onChange={(event) => {
                setPlace({ ...place, longitude: Number(event.target.value) });
                clearError(which === 'origin' ? 'originLongitude' : 'destinationLongitude');
              }}
            />
          </WizardField>
        </div>
      </>
    );
  };

  const detailBody = () => {
    if (kind === RequirementKind.MATERIAL_SUPPLY) {
      return (
        <>
          <WizardField
            label="What material?"
            htmlFor="req-material"
            required
            error={errors.materialName}
          >
            <Input
              id="req-material"
              value={materialName}
              aria-invalid={Boolean(errors.materialName) || undefined}
              onChange={(event) => {
                setMaterialName(event.target.value);
                clearError('materialName');
              }}
              placeholder="OPC 43 grade cement"
            />
          </WizardField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <WizardField label="Quantity" htmlFor="req-quantity" required error={errors.quantity}>
              <Input
                id="req-quantity"
                type="number"
                min={1}
                value={quantity}
                aria-invalid={Boolean(errors.quantity) || undefined}
                onChange={(event) => {
                  setQuantity(Number(event.target.value));
                  clearError('quantity');
                }}
              />
            </WizardField>
            <WizardField label="Unit">
              <Select value={unit} onValueChange={(value) => setUnit(value as MaterialUnit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(MaterialUnit).map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanizeEnum(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </WizardField>
            <WizardField label="Category" htmlFor="req-category" hint="Optional.">
              <Input
                id="req-category"
                value={materialCategory}
                onChange={(event) => setMaterialCategory(event.target.value)}
                placeholder="Cement"
              />
            </WizardField>
          </div>

          <WizardField
            label="Grade or specification"
            htmlFor="req-spec"
            hint="What you will and will not accept. Suppliers price against this."
          >
            <Textarea
              id="req-spec"
              value={specification}
              onChange={(event) => setSpecification(event.target.value)}
              rows={3}
              placeholder="ISI marked, bags of 50 kg, manufactured within 60 days…"
            />
          </WizardField>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              id="req-needs-transport"
              checked={needsTransport}
              onCheckedChange={setNeedsTransport}
            />
            <label htmlFor="req-needs-transport" className="min-w-0 cursor-pointer space-y-0.5">
              <span className="block text-sm font-medium">Find transport as well</span>
              <span className="block text-xs leading-snug text-muted-foreground">
                On: fleets bid to deliver it, and you award the supplier and the lorry separately.
                Off: only suppliers bid, and they quote a delivered price or you collect.
              </span>
            </label>
          </div>
        </>
      );
    }

    if (kind === RequirementKind.FREIGHT_TRANSPORT) {
      return (
        <>
          <WizardField
            label="What needs moving?"
            htmlFor="req-goods"
            required
            error={errors.goodsDescription}
          >
            <Input
              id="req-goods"
              value={goodsDescription}
              aria-invalid={Boolean(errors.goodsDescription) || undefined}
              onChange={(event) => {
                setGoodsDescription(event.target.value);
                clearError('goodsDescription');
              }}
              placeholder="Steel coils"
            />
          </WizardField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <WizardField label="Quantity" htmlFor="req-fquantity" required error={errors.quantity}>
              <Input
                id="req-fquantity"
                type="number"
                min={1}
                value={quantity}
                aria-invalid={Boolean(errors.quantity) || undefined}
                onChange={(event) => {
                  setQuantity(Number(event.target.value));
                  clearError('quantity');
                }}
              />
            </WizardField>
            <WizardField label="Unit">
              <Select value={unit} onValueChange={(value) => setUnit(value as MaterialUnit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(MaterialUnit).map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanizeEnum(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </WizardField>
            <WizardField
              label="Truck capacity (tonnes)"
              htmlFor="req-capacity"
              required
              error={errors.capacity}
            >
              <Input
                id="req-capacity"
                type="number"
                min={1}
                value={capacity}
                aria-invalid={Boolean(errors.capacity) || undefined}
                onChange={(event) => {
                  setCapacity(Number(event.target.value));
                  clearError('capacity');
                }}
              />
            </WizardField>
          </div>

          <WizardField label="Body type" hint="Widening this usually attracts more bids.">
            <Select value={truckType} onValueChange={setTruckType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any suitable body</SelectItem>
                {Object.values(TruckType).map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanizeEnum(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          <WizardField
            label="Handling notes"
            htmlFor="req-handling"
            hint="Anything that changes how it must be loaded, secured or unloaded."
          >
            <Textarea
              id="req-handling"
              value={handlingNotes}
              onChange={(event) => setHandlingNotes(event.target.value)}
              rows={3}
              placeholder="Crane needed at both ends; no tarpaulin required…"
            />
          </WizardField>
        </>
      );
    }

    if (kind === RequirementKind.CAB_HIRE) {
      return (
        <>
          <WizardField label="How will the vehicle be used?">
            <Select value={hireBasis} onValueChange={(value) => setHireBasis(value as HireBasis)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(HireBasis).map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanizeEnum(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          {hireBasis === HireBasis.HOURLY ? (
            <WizardField
              label="Hours needed"
              htmlFor="req-hours"
              required
              error={errors.durationHours}
            >
              <Input
                id="req-hours"
                type="number"
                min={1}
                max={24}
                value={durationHours}
                aria-invalid={Boolean(errors.durationHours) || undefined}
                onChange={(event) => {
                  setDurationHours(Number(event.target.value));
                  clearError('durationHours');
                }}
              />
            </WizardField>
          ) : null}

          {hireBasis === HireBasis.DAILY ? (
            <WizardField
              label="Days needed"
              htmlFor="req-days"
              required
              error={errors.durationDays}
            >
              <Input
                id="req-days"
                type="number"
                min={1}
                value={durationDays}
                aria-invalid={Boolean(errors.durationDays) || undefined}
                onChange={(event) => {
                  setDurationDays(Number(event.target.value));
                  clearError('durationDays');
                }}
              />
            </WizardField>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <WizardField
              label="Passengers"
              htmlFor="req-passengers"
              required
              error={errors.passengers}
            >
              <Input
                id="req-passengers"
                type="number"
                min={1}
                max={80}
                value={passengers}
                aria-invalid={Boolean(errors.passengers) || undefined}
                onChange={(event) => {
                  setPassengers(Number(event.target.value));
                  clearError('passengers');
                }}
              />
            </WizardField>
            <WizardField label="Bags" htmlFor="req-luggage">
              <Input
                id="req-luggage"
                type="number"
                min={0}
                value={luggageCount}
                onChange={(event) => setLuggageCount(Number(event.target.value))}
              />
            </WizardField>
            <WizardField label="Vehicle preference">
              <Select value={vehicleType} onValueChange={setVehicleType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any suitable vehicle</SelectItem>
                  {PASSENGER_VEHICLE_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanizeEnum(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </WizardField>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Switch id="req-ac" checked={acRequired} onCheckedChange={setAcRequired} />
            <label htmlFor="req-ac" className="cursor-pointer text-sm font-medium">
              Air conditioning required
            </label>
          </div>
        </>
      );
    }

    return (
      <>
        <WizardField
          label="Where do you want to go?"
          htmlFor="req-destinations"
          required
          error={errors.destinations}
          hint="One place per line, or separated by commas. Operators build the itinerary around these."
        >
          <Textarea
            id="req-destinations"
            value={destinationsText}
            aria-invalid={Boolean(errors.destinations) || undefined}
            onChange={(event) => {
              setDestinationsText(event.target.value);
              clearError('destinations');
            }}
            rows={4}
            placeholder={'Ayodhya\nVaranasi\nPrayagraj'}
          />
        </WizardField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <WizardField
            label="Travellers"
            htmlFor="req-tpassengers"
            required
            error={errors.passengers}
          >
            <Input
              id="req-tpassengers"
              type="number"
              min={1}
              max={80}
              value={passengers}
              aria-invalid={Boolean(errors.passengers) || undefined}
              onChange={(event) => {
                setPassengers(Number(event.target.value));
                clearError('passengers');
              }}
            />
          </WizardField>
          <WizardField label="Days" htmlFor="req-tdays" required error={errors.durationDays}>
            <Input
              id="req-tdays"
              type="number"
              min={1}
              value={durationDays}
              aria-invalid={Boolean(errors.durationDays) || undefined}
              onChange={(event) => {
                setDurationDays(Number(event.target.value));
                clearError('durationDays');
              }}
            />
          </WizardField>
          <WizardField label="Nights" htmlFor="req-tnights">
            <Input
              id="req-tnights"
              type="number"
              min={0}
              value={durationNights}
              onChange={(event) => setDurationNights(Number(event.target.value))}
            />
          </WizardField>
          <WizardField label="Vehicle preference">
            <Select value={vehicleType} onValueChange={setVehicleType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any suitable vehicle</SelectItem>
                {PASSENGER_VEHICLE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanizeEnum(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>
        </div>

        <WizardField
          label="What should the price cover?"
          htmlFor="req-inclusions"
          hint="One per line. Operators quote against this, so the bids stay comparable."
        >
          <Textarea
            id="req-inclusions"
            value={inclusionsText}
            onChange={(event) => setInclusionsText(event.target.value)}
            rows={3}
            placeholder={'Toll and parking\nDriver allowance\nAll sightseeing transfers'}
          />
        </WizardField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Switch
              id="req-accommodation"
              checked={accommodationNeeded}
              onCheckedChange={setAccommodationNeeded}
            />
            <label htmlFor="req-accommodation" className="cursor-pointer text-sm font-medium">
              Accommodation needed
            </label>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Switch id="req-meals" checked={mealsNeeded} onCheckedChange={setMealsNeeded} />
            <label htmlFor="req-meals" className="cursor-pointer text-sm font-medium">
              Meals needed
            </label>
          </div>
        </div>
      </>
    );
  };

  const steps: WizardStep[] = [
    {
      id: 'need',
      title: 'What you need',
      description: 'Pick a category.',
      icon: HelpCircle,
      content: (
        <>
          <KindPicker
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (!title.trim()) setTitle('');
            }}
          />

          <WizardField
            label="Title"
            htmlFor="req-title"
            required
            error={errors.title}
            hint="One line bidders will see first."
            className="pt-2"
          >
            <Input
              id="req-title"
              value={title}
              aria-invalid={Boolean(errors.title) || undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                clearError('title');
              }}
              placeholder={
                kind === RequirementKind.TOUR_PACKAGE
                  ? '5-day Ayodhya and Varanasi tour for 6'
                  : kind === RequirementKind.CAB_HIRE
                    ? 'Airport pickup for 4 with luggage'
                    : kind === RequirementKind.MATERIAL_SUPPLY
                      ? '400 bags of OPC cement, delivered to site'
                      : '20 tonnes of steel coil, Jaipur to Gurugram'
              }
            />
          </WizardField>

          <WizardField
            label="Anything else bidders should know?"
            htmlFor="req-description"
            hint="Optional, but a requirement with context attracts better prices."
          >
            <Textarea
              id="req-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </WizardField>
        </>
      ),
    },
    {
      id: 'details',
      title: 'Details',
      description: kind ? REQUIREMENT_KIND_LABELS[kind] : 'Depends on the category.',
      icon: ListChecks,
      content: kind ? (
        detailBody()
      ) : (
        <p className="text-sm text-muted-foreground">Choose a category on the first step.</p>
      ),
    },
    {
      id: 'route',
      title: isTravel ? 'Journey' : 'Route',
      description: isTravel ? 'Pickup and drop.' : 'Collection and delivery.',
      icon: MapPin,
      content: (
        <>
          <WizardSection
            title={isTravel ? 'Pickup' : 'Collection'}
            description={
              isTravel ? 'Where the vehicle should collect you.' : 'Where the load is collected.'
            }
          >
            {placeFields('origin', origin, setOrigin, {
              address: isTravel ? 'Pickup address' : 'Pickup address',
              placeholder: 'Bassi Industrial Area, Jaipur',
            })}
          </WizardSection>

          <WizardSection
            title={isTour ? 'Ending point' : 'Destination'}
            description={
              isTour
                ? 'Optional — leave it blank if the tour ends where it started.'
                : isTravel
                  ? 'Where you are going.'
                  : 'Where it has to arrive.'
            }
            className="pt-2"
          >
            {placeFields('destination', destination, setDestination, {
              address: isTour ? 'Ending address' : 'Drop address',
              placeholder: 'Sector 62, Gurugram',
            })}
          </WizardSection>
        </>
      ),
    },
    {
      id: 'schedule',
      title: 'When',
      description: 'Dates and flexibility.',
      icon: CalendarClock,
      content: (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField
              label={isTravel ? 'Travel starts' : 'Pickup by'}
              htmlFor="req-start"
              required
              error={errors.startAt}
            >
              <Input
                id="req-start"
                type="datetime-local"
                value={startAt}
                aria-invalid={Boolean(errors.startAt) || undefined}
                onChange={(event) => {
                  setStartAt(event.target.value);
                  clearError('startAt');
                }}
              />
            </WizardField>
            <WizardField
              label={isTravel ? 'Back by' : 'Deliver by'}
              htmlFor="req-end"
              hint="Optional."
            >
              <Input
                id="req-end"
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
              />
            </WizardField>
          </div>

          <WizardField
            label="How flexible are these dates?"
            htmlFor="req-schedule-notes"
            hint="Bidders price flexibility. Saying so usually lowers the quotes."
          >
            <Textarea
              id="req-schedule-notes"
              value={scheduleNotes}
              onChange={(event) => setScheduleNotes(event.target.value)}
              rows={3}
              placeholder="Any day that week works; site is closed on Sunday."
            />
          </WizardField>
        </>
      ),
    },
    {
      id: 'commercials',
      title: 'Budget & bidding',
      description: 'What you expect to pay, and how long bidders have.',
      icon: Wallet,
      content: (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField label="Budget (₹)" htmlFor="req-budget" hint="Optional.">
              <Input
                id="req-budget"
                type="number"
                min={0}
                value={budgetAmount}
                onChange={(event) => setBudgetAmount(event.target.value)}
                placeholder="45000"
              />
            </WizardField>
            <WizardField
              label="Bidding closes"
              htmlFor="req-bids-close"
              required
              error={errors.bidsCloseAt}
            >
              <Input
                id="req-bids-close"
                type="datetime-local"
                value={bidsCloseAt}
                aria-invalid={Boolean(errors.bidsCloseAt) || undefined}
                onChange={(event) => {
                  setBidsCloseAt(event.target.value);
                  clearError('bidsCloseAt');
                }}
              />
            </WizardField>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              id="req-budget-public"
              checked={budgetIsPublic}
              onCheckedChange={setBudgetIsPublic}
              disabled={!budgetAmount}
            />
            <label htmlFor="req-budget-public" className="min-w-0 cursor-pointer space-y-0.5">
              <span className="block text-sm font-medium">Show my budget to bidders</span>
              <span className="block text-xs leading-snug text-muted-foreground">
                Off by default. A visible budget tends to become the price everybody quotes, which
                is the opposite of what bidding is for.
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField label="Contact name" htmlFor="req-contact-name">
              <Input
                id="req-contact-name"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
              />
            </WizardField>
            <WizardField
              label="Contact phone"
              htmlFor="req-contact-phone"
              required={isTravel}
              error={errors.contactPhone}
              hint="Shared only with the bidder you award."
            >
              <Input
                id="req-contact-phone"
                value={contactPhone}
                aria-invalid={Boolean(errors.contactPhone) || undefined}
                onChange={(event) => {
                  setContactPhone(event.target.value);
                  clearError('contactPhone');
                }}
                placeholder="+91 98765 43210"
              />
            </WizardField>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Post a requirement"
        description="Tell Saarthi what you need. The businesses that can serve it will bid for your work."
      />

      <FormWizard
        steps={steps}
        title="Your requirement"
        description="Five steps. Nothing is posted until the last one."
        onValidateStep={validateStep}
        onSubmit={() => create.mutate()}
        submitting={create.isPending}
        submitLabel="Post requirement"
        erroredStepIds={erroredStepIds}
        footerStart={
          <Button variant="ghost" onClick={() => navigate('/requirements')}>
            Cancel
          </Button>
        }
      />
    </div>
  );
}

export default NewRequirementPage;

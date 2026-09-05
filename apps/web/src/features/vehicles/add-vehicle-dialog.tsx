import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CarFront, Gauge, IdCard, Plus } from 'lucide-react';
import {
  FuelType,
  MediaOwnerType,
  MediaPurpose,
  VEHICLE_TYPE_CATALOGUE,
  VehicleCapability,
  VehicleType,
  humanizeEnum,
  vehicleTypeDefinition,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  FormWizard,
  WizardField,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';
import { ImageCircleField } from '@/components/common/file-dropzone';
import { uploadImageOrWarn } from '@/features/media/upload-image';

/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const PHOTO_MAX_SIZE_MB = 5;
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

/**
 * Register a vehicle of any type.
 *
 * The form follows the capability model rather than hard-coding vehicle types:
 * asking a taxi for its payload tonnage, or a truck for its seat count, would
 * be asking for a number that does not exist. The type chosen at the top
 * decides which capacity field appears, and the same rule is enforced again by
 * the API — this only spares the user a round trip.
 *
 * Because that one choice reshapes the rest of the form, it gets a step of its
 * own. Fields do not appear and disappear under the cursor as the type is
 * changed; the capacity step is simply asked after the answer is known.
 */

interface AddVehicleDialogProps {
  /** Restrict the offered types, e.g. to passenger vehicles for a travel operator. */
  allowedTypes?: VehicleType[];
  defaultType?: VehicleType;
  triggerLabel?: string;
}

interface VehicleFormState {
  registrationNumber: string;
  vehicleType: VehicleType;
  manufacturer: string;
  model: string;
  year: string;
  colour: string;
  capacityTons: string;
  passengerCapacity: string;
  airConditioned: boolean;
  fuelType: FuelType;
  odometerKm: string;
}

type FieldErrors = Partial<Record<keyof VehicleFormState, string>>;

function initialState(defaultType: VehicleType): VehicleFormState {
  return {
    registrationNumber: '',
    vehicleType: defaultType,
    manufacturer: '',
    model: '',
    year: '',
    colour: '',
    capacityTons: '',
    passengerCapacity: '',
    airConditioned: false,
    fuelType: FuelType.DIESEL,
    odometerKm: '0',
  };
}

export function AddVehicleDialog({
  allowedTypes,
  defaultType = VehicleType.CAR,
  triggerLabel = 'Add vehicle',
}: AddVehicleDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<VehicleFormState>(() => initialState(defaultType));
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);
  /**
   * Held until the vehicle exists: media is addressed to an owner id, and
   * there is no vehicle to own the photograph until the registration is saved.
   */
  const [photo, setPhoto] = React.useState<File | null>(null);

  const types = React.useMemo(
    () =>
      allowedTypes
        ? VEHICLE_TYPE_CATALOGUE.filter((definition) => allowedTypes.includes(definition.type))
        : VEHICLE_TYPE_CATALOGUE,
    [allowedTypes],
  );

  const definition = vehicleTypeDefinition(form.vehicleType);
  const carriesFreight = definition.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = definition.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);

  const set = <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));
  };

  const create = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const vehicle = await api.post<{ id: string }>('/fleet/vehicles', payload);
      // Inside the mutation rather than after it, so the dialog stays open and
      // its button stays busy until the photograph has actually landed.
      if (photo) {
        await uploadImageOrWarn(
          {
            ownerType: MediaOwnerType.VEHICLE,
            ownerId: vehicle.id,
            purpose: MediaPurpose.VEHICLE_EXTERIOR,
            file: photo,
          },
          'The vehicle was added, but its photo could not be saved.',
        );
      }
      return vehicle;
    },
    onSuccess: () => {
      toast.success('Vehicle added');
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });
      void queryClient.invalidateQueries({ queryKey: ['media'] });
      setOpen(false);
      setForm(initialState(defaultType));
      setPhoto(null);
      setErrors({});
      setErroredStepIds([]);
    },
    onError: (error) =>
      toast.error('Could not add the vehicle', { description: errorMessage(error) }),
  });

  const submit = (): void => {
    // Blank optional fields are omitted rather than sent as empty strings, so
    // the API stores a real null instead of an empty value.
    create.mutate({
      registrationNumber: form.registrationNumber,
      vehicleType: form.vehicleType,
      fuelType: form.fuelType,
      odometerKm: Number(form.odometerKm || 0),
      ...(form.manufacturer.trim() ? { manufacturer: form.manufacturer.trim() } : {}),
      ...(form.model.trim() ? { model: form.model.trim() } : {}),
      ...(form.year ? { year: Number(form.year) } : {}),
      ...(form.colour.trim() ? { colour: form.colour.trim() } : {}),
      ...(carriesFreight && form.capacityTons ? { capacityTons: Number(form.capacityTons) } : {}),
      ...(carriesPassengers && form.passengerCapacity
        ? { passengerCapacity: Number(form.passengerCapacity) }
        : {}),
      ...(carriesPassengers ? { airConditioned: form.airConditioned } : {}),
    });
  };

  /**
   * The capacity rules depend on the type chosen on step one, so they are
   * written here against the live capability flags rather than in a static
   * table.
   */
  const rulesFor = (stepId: string): FieldErrors => {
    const found: FieldErrors = {};

    if (stepId === 'identity') {
      const registration = form.registrationNumber.trim();
      if (registration.length < 4) found.registrationNumber = 'Enter the registration number.';
      const year = Number(form.year);
      if (form.year && (!Number.isFinite(year) || year < 1980 || year > new Date().getFullYear() + 1))
        found.year = 'Enter a realistic model year.';
    }

    if (stepId === 'capacity') {
      if (carriesFreight && !(Number(form.capacityTons) > 0))
        found.capacityTons = 'Enter what this vehicle can carry.';
      if (carriesPassengers && !(Number(form.passengerCapacity) >= 1))
        found.passengerCapacity = 'Enter how many passengers it seats.';
      if (Number(form.odometerKm) < 0) found.odometerKm = 'An odometer cannot be negative.';
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

  const steps: WizardStep[] = [
    {
      id: 'type',
      title: 'Vehicle type',
      description: 'Decides what else we ask.',
      icon: CarFront,
      content: (
        <WizardField
          label="Vehicle type"
          htmlFor="vehicle-type"
          required
          hint={definition.description}
        >
          <Select
            value={form.vehicleType}
            onValueChange={(value) => set('vehicleType', value as VehicleType)}
          >
            <SelectTrigger id="vehicle-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((option) => (
                <SelectItem key={option.type} value={option.type}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </WizardField>
      ),
    },
    {
      id: 'identity',
      title: 'Identity',
      description: 'Registration, make and model.',
      icon: IdCard,
      content: (
        <>
          <ImageCircleField
            value={photo}
            onChange={setPhoto}
            label="Vehicle photo"
            hint={`Optional · JPEG, PNG, WebP or HEIC up to ${PHOTO_MAX_SIZE_MB} MB`}
            accept={PHOTO_ACCEPT}
            maxSizeMb={PHOTO_MAX_SIZE_MB}
            icon={CarFront}
            onReject={(reason) => toast.error(reason)}
            className="pb-1"
          />

          <WizardField
            label="Registration number"
            htmlFor="vehicle-registration"
            required
            error={errors.registrationNumber}
          >
            <Input
              id="vehicle-registration"
              value={form.registrationNumber}
              aria-invalid={Boolean(errors.registrationNumber) || undefined}
              onChange={(event) => set('registrationNumber', event.target.value.toUpperCase())}
              placeholder="UP32AB1234"
              className="font-mono uppercase tracking-wide"
              autoComplete="off"
              spellCheck={false}
            />
          </WizardField>

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField label="Make" htmlFor="vehicle-make">
              <Input
                id="vehicle-make"
                value={form.manufacturer}
                onChange={(event) => set('manufacturer', event.target.value)}
                placeholder="Mahindra"
              />
            </WizardField>
            <WizardField label="Model" htmlFor="vehicle-model">
              <Input
                id="vehicle-model"
                value={form.model}
                onChange={(event) => set('model', event.target.value)}
                placeholder="Blazo X 35"
              />
            </WizardField>
            <WizardField label="Year" htmlFor="vehicle-year" error={errors.year}>
              <Input
                id="vehicle-year"
                type="number"
                min={1980}
                max={new Date().getFullYear() + 1}
                value={form.year}
                aria-invalid={Boolean(errors.year) || undefined}
                onChange={(event) => set('year', event.target.value)}
                placeholder="2024"
              />
            </WizardField>
            <WizardField label="Colour" htmlFor="vehicle-colour">
              <Input
                id="vehicle-colour"
                value={form.colour}
                onChange={(event) => set('colour', event.target.value)}
                placeholder="White"
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'capacity',
      title: 'Capacity & fuel',
      description: 'What it carries and burns.',
      icon: Gauge,
      content: (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {carriesFreight ? (
              <WizardField
                label="Payload capacity (tonnes)"
                htmlFor="vehicle-capacity"
                required
                error={errors.capacityTons}
              >
                <Input
                  id="vehicle-capacity"
                  type="number"
                  step="0.1"
                  min={0}
                  value={form.capacityTons}
                  aria-invalid={Boolean(errors.capacityTons) || undefined}
                  onChange={(event) => set('capacityTons', event.target.value)}
                  placeholder="35"
                />
              </WizardField>
            ) : null}

            {carriesPassengers ? (
              <WizardField
                label="Passenger seats"
                htmlFor="vehicle-seats"
                required
                error={errors.passengerCapacity}
              >
                <Input
                  id="vehicle-seats"
                  type="number"
                  min={1}
                  max={80}
                  value={form.passengerCapacity}
                  aria-invalid={Boolean(errors.passengerCapacity) || undefined}
                  onChange={(event) => set('passengerCapacity', event.target.value)}
                  placeholder="4"
                />
              </WizardField>
            ) : null}

            <WizardField label="Fuel" htmlFor="vehicle-fuel">
              <Select
                value={form.fuelType}
                onValueChange={(value) => set('fuelType', value as FuelType)}
              >
                <SelectTrigger id="vehicle-fuel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(FuelType).map((fuel) => (
                    <SelectItem key={fuel} value={fuel}>
                      {humanizeEnum(fuel)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </WizardField>

            <WizardField label="Odometer (km)" htmlFor="vehicle-odometer" error={errors.odometerKm}>
              <Input
                id="vehicle-odometer"
                type="number"
                min={0}
                value={form.odometerKm}
                aria-invalid={Boolean(errors.odometerKm) || undefined}
                onChange={(event) => set('odometerKm', event.target.value)}
              />
            </WizardField>
          </div>

          {carriesPassengers ? (
            <div className="glass-inset flex items-center justify-between px-3 py-2.5">
              <div>
                <Label htmlFor="vehicle-ac">Air conditioned</Label>
                <p className="text-xs text-muted-foreground">
                  Shown to travel customers when they compare vehicles.
                </p>
              </div>
              <Switch
                id="vehicle-ac"
                checked={form.airConditioned}
                onCheckedChange={(checked) => set('airConditioned', checked)}
              />
            </div>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>{triggerLabel}</DialogTitle>
          <DialogDescription>
            Register a vehicle to your organization. You can pull its RC record and upload photos
            once it is added.
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
          submitLabel="Add vehicle"
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

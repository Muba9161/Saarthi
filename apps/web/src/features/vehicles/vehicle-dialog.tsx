import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CarFront, Gauge, IdCard, Pencil, Plus } from 'lucide-react';
import {
  FuelType,
  MediaOwnerType,
  MediaPurpose,
  Permission,
  VEHICLE_TYPE_CATALOGUE,
  VehicleCapability,
  VehicleType,
  humanizeEnum,
  vehicleTypeDefinition,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  FormWizard,
  WizardField,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';
import { ImageDropField } from '@/components/common/file-dropzone';
import { uploadImageOrWarn } from '@/features/media/upload-image';
import { cn } from '@/lib/utils';

/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const PHOTO_MAX_SIZE_MB = 5;
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

/**
 * Register a vehicle of any type, or correct the details of one that exists.
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
 *
 * Adding and editing are the same component rather than two, because they ask
 * the same questions about the same record — a second dialog beside this one
 * would be a second place for the capability rules to drift out of step. What
 * differs is kept to three things: where the answers start from (`vehicle`,
 * when editing), which verb the API is called with, and that an edit may be
 * entered at any step. That last one matters — somebody correcting a colour
 * should not have to walk back through the type and the plate to reach it,
 * which is what `allowJumpAhead` on the wizard is for.
 */

/**
 * What the form needs in order to show a vehicle that already exists.
 *
 * Structural rather than `VehicleSummary`, so the fleet list, a detail header
 * and a resale listing can all open this with the record they already hold.
 * Every field here is on the list response, so opening the dialog from the
 * grid costs no further request.
 */
export interface EditableVehicle {
  id: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  capacityTons: number | null;
  passengerCapacity: number | null;
  airConditioned: boolean | null;
  /** Widened to `string` on the summary responses; narrowed back on the way in. */
  fuelType: string;
  odometerKm: number;
}

interface VehicleDialogProps {
  /**
   * The vehicle being edited. Omit to register a new one — that is what puts
   * the dialog into one mode or the other.
   */
  vehicle?: EditableVehicle | null;
  /**
   * Called with the new vehicle's id and plate once it exists. Create only.
   *
   * The celebration cannot live inside this component: it closes itself on
   * success, and a dialog nested in one that is unmounting never appears.
   */
  onAdded?: (vehicle: { id: string; registrationNumber: string }) => void;
  /** Called after an edit has been saved. */
  onSaved?: () => void;
  /** Restrict the offered types, e.g. to passenger vehicles for a travel operator. */
  allowedTypes?: VehicleType[];
  defaultType?: VehicleType;
  triggerLabel?: string;
  /** Replaces the default trigger. Pass `null` to render none and drive `open`. */
  trigger?: React.ReactNode;
  /** Controlled open state, for a caller supplying its own trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

const FUEL_TYPES = Object.values(FuelType);

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

/** The summary responses type `fuelType` as a plain string; keep the union honest. */
function asFuelType(value: string): FuelType {
  return (FUEL_TYPES as string[]).includes(value) ? (value as FuelType) : FuelType.DIESEL;
}

/** A number the form holds as text — blank when the record has none. */
function numberField(value: number | null): string {
  return value === null ? '' : String(value);
}

function stateFromVehicle(vehicle: EditableVehicle): VehicleFormState {
  return {
    registrationNumber: vehicle.registrationNumber,
    vehicleType: vehicle.vehicleType,
    manufacturer: vehicle.manufacturer ?? '',
    model: vehicle.model ?? '',
    year: numberField(vehicle.year),
    colour: vehicle.colour ?? '',
    capacityTons: numberField(vehicle.capacityTons),
    passengerCapacity: numberField(vehicle.passengerCapacity),
    airConditioned: vehicle.airConditioned ?? false,
    fuelType: asFuelType(vehicle.fuelType),
    // Whole kilometres: the dial does not show a fraction of one.
    odometerKm: String(Math.round(vehicle.odometerKm)),
  };
}

/** Blank means "this vehicle has no recorded value", which a patch says as null. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function VehicleDialog({
  vehicle,
  allowedTypes,
  defaultType = VehicleType.CAR,
  triggerLabel,
  trigger,
  open: openProp,
  onOpenChange,
  onAdded,
  onSaved,
}: VehicleDialogProps) {
  const queryClient = useQueryClient();
  const subject = vehicle ?? null;
  const isEdit = subject !== null;

  // Controlled when a caller supplies its own trigger, self-managed otherwise.
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOwnOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const [form, setForm] = React.useState<VehicleFormState>(() =>
    subject ? stateFromVehicle(subject) : initialState(defaultType),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);
  /**
   * Held until the vehicle exists: media is addressed to an owner id, and
   * there is no vehicle to own the photograph until the registration is saved.
   */
  const [photo, setPhoto] = React.useState<File | null>(null);

  /*
   * Re-seed the fields each time the dialog is opened, and only then.
   *
   * Read through a ref rather than from the dependency list, on purpose. The
   * `vehicle` prop is a row from a list react-query refetches on its own
   * schedule, so depending on it would reset the form under the cursor the
   * moment a poll returned, discarding whatever had been typed. Opening the
   * dialog is the only event that should decide what the fields say.
   */
  const seed = React.useRef({ subject, defaultType });
  seed.current = { subject, defaultType };
  const seedKey = open ? (subject?.id ?? 'new') : '';

  React.useEffect(() => {
    if (!seedKey) return;
    const { subject: opened, defaultType: fallbackType } = seed.current;
    setForm(opened ? stateFromVehicle(opened) : initialState(fallbackType));
    setPhoto(null);
    setErrors({});
    setErroredStepIds([]);
  }, [seedKey]);

  /*
   * The offered types, narrowed when a caller restricts them.
   *
   * A vehicle's own current type is always kept in the list even when it falls
   * outside that restriction. Otherwise editing the one goods vehicle on a
   * travel operator's books would open a select with nothing selected, and
   * saving would silently retype the vehicle to whatever was picked to fill
   * the blank.
   */
  const types = React.useMemo(() => {
    if (!allowedTypes) return VEHICLE_TYPE_CATALOGUE;
    return VEHICLE_TYPE_CATALOGUE.filter(
      (definition) =>
        allowedTypes.includes(definition.type) || definition.type === subject?.vehicleType,
    );
  }, [allowedTypes, subject?.vehicleType]);

  const definition = vehicleTypeDefinition(form.vehicleType);
  const carriesFreight = definition.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = definition.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);
  const typeChanged = subject !== null && form.vehicleType !== subject.vehicleType;

  const set = <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));
  };

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (subject) return api.patch<{ id: string }>(`/fleet/vehicles/${subject.id}`, payload);

      const created = await api.post<{ id: string }>('/fleet/vehicles', payload);
      // Inside the mutation rather than after it, so the dialog stays open and
      // its button stays busy until the photograph has actually landed.
      if (photo) {
        await uploadImageOrWarn(
          {
            ownerType: MediaOwnerType.VEHICLE,
            ownerId: created.id,
            purpose: MediaPurpose.VEHICLE_EXTERIOR,
            file: photo,
          },
          'The vehicle was added, but its photo could not be saved.',
        );
      }
      return created;
    },
    onSuccess: (saved, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });

      if (subject) {
        // The detail screens read the row under its own key, so invalidating
        // the grid alone is not enough: an edit made from the list has to show
        // up on the vehicle's own page too.
        void queryClient.invalidateQueries({ queryKey: ['vehicle', subject.id] });
        void queryClient.invalidateQueries({ queryKey: ['truck', subject.id] });
        setOpen(false);
        setErrors({});
        setErroredStepIds([]);
        toast.success('Vehicle updated');
        onSaved?.();
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ['media'] });
      // Read off the submitted payload rather than form state, which is reset
      // two lines below.
      const registrationNumber = String(variables.registrationNumber ?? '');
      setOpen(false);
      setForm(initialState(defaultType));
      setPhoto(null);
      setErrors({});
      setErroredStepIds([]);

      if (onAdded) {
        // The caller shows the vehicle's QR; no toast, because that dialog says
        // the same thing and stays long enough to act on.
        onAdded({ id: saved.id, registrationNumber });
      } else {
        toast.success('Vehicle added');
      }
    },
    onError: (error) =>
      toast.error(isEdit ? 'Could not save the changes' : 'Could not add the vehicle', {
        description: errorMessage(error),
      }),
  });

  const submit = (): void => {
    // Capacity is asked per capability, so it is sent per capability too.
    const capacities = {
      ...(carriesFreight && form.capacityTons ? { capacityTons: Number(form.capacityTons) } : {}),
      ...(carriesPassengers && form.passengerCapacity
        ? { passengerCapacity: Number(form.passengerCapacity) }
        : {}),
      ...(carriesPassengers ? { airConditioned: form.airConditioned } : {}),
    };

    if (subject) {
      save.mutate({
        registrationNumber: form.registrationNumber,
        /*
         * Sent only when it actually changed.
         *
         * `updateVehicle` re-derives the legacy body type from the vehicle type
         * whenever this field is present, so sending an unchanged `TRUCK` would
         * quietly reset a tipper to a plain open body on an edit that never
         * touched the type. Omitting it leaves the body type alone; including
         * it when the type really did change is the reset that should happen.
         */
        ...(typeChanged ? { vehicleType: form.vehicleType } : {}),
        // Nulls rather than omissions: a detail cleared in the form is the
        // operator saying this vehicle does not have one.
        manufacturer: trimmedOrNull(form.manufacturer),
        model: trimmedOrNull(form.model),
        year: form.year ? Number(form.year) : null,
        colour: trimmedOrNull(form.colour),
        fuelType: form.fuelType,
        odometerKm: Number(form.odometerKm || 0),
        ...capacities,
      });
      return;
    }

    // Blank optional fields are omitted rather than sent as empty strings, so
    // the API stores a real null instead of an empty value.
    save.mutate({
      registrationNumber: form.registrationNumber,
      vehicleType: form.vehicleType,
      fuelType: form.fuelType,
      odometerKm: Number(form.odometerKm || 0),
      ...(form.manufacturer.trim() ? { manufacturer: form.manufacturer.trim() } : {}),
      ...(form.model.trim() ? { model: form.model.trim() } : {}),
      ...(form.year ? { year: Number(form.year) } : {}),
      ...(form.colour.trim() ? { colour: form.colour.trim() } : {}),
      ...capacities,
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
      // Six is what `registrationNumberSchema` accepts once spacing is
      // stripped; a lower bar here only moves the rejection to the server.
      const registration = form.registrationNumber.replace(/[\s-]/g, '');
      if (registration.length < 6) found.registrationNumber = 'Enter the registration number.';
      const year = Number(form.year);
      if (
        form.year &&
        (!Number.isFinite(year) || year < 1980 || year > new Date().getFullYear() + 1)
      )
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
        <>
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

          {/*
            Retyping a vehicle that already exists is not a relabelling: the
            capability model decides which capacities the row may hold, so the
            API drops the ones the new type cannot have and re-derives the body
            type. Said here rather than discovered afterwards.
          */}
          {typeChanged ? (
            <p className="glass-inset px-3 py-2.5 text-xs text-muted-foreground">
              Changing the type to{' '}
              <span className="font-medium text-foreground">{definition.label}</span> resets the
              body type and drops any capacity a {definition.label.toLowerCase()} cannot have.
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: 'identity',
      title: 'Identity',
      description: 'Registration, make and model.',
      icon: IdCard,
      content: (
        <>
          {/*
            Create only, and for a different reason than it used to be: a
            vehicle that already exists has a Photos tab of its own, which shows
            what is attached and can add to it. Offering a second, blind upload
            here would be the same picture asked for twice, in the one place
            that cannot show the answer.

            The frame is a rectangle rather than the circle used for a face.
            A lorry photographed side-on and then cropped to a circle loses both
            ends of itself, and this is the shape the picture is shown in
            everywhere else.
          */}
          {isEdit ? null : (
            <ImageDropField
              value={photo}
              onChange={setPhoto}
              label="Vehicle photo"
              hint={`Optional · JPEG, PNG, WebP or HEIC up to ${PHOTO_MAX_SIZE_MB} MB`}
              accept={PHOTO_ACCEPT}
              maxSizeMb={PHOTO_MAX_SIZE_MB}
              icon={CarFront}
              aspect="aspect-[2/1]"
              onReject={(reason) => toast.error(reason)}
              className="pb-1"
            />
          )}

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
                  {FUEL_TYPES.map((fuel) => (
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

  const addLabel = triggerLabel ?? 'Add vehicle';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className="size-4" />
              {addLabel}
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>
            {isEdit ? `Edit ${subject?.registrationNumber ?? 'vehicle'}` : addLabel}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Correct this vehicle’s details. Open any step directly - only what you change is saved.'
              : 'Register a vehicle to your organization. You can pull its RC record and upload photos once it is added.'}
          </DialogDescription>
        </DialogHeader>

        <FormWizard
          steps={steps}
          className={WIZARD_IN_DIALOG}
          panelClassName={WIZARD_DIALOG_PANEL}
          resetKey={open}
          onValidateStep={validateStep}
          onSubmit={submit}
          submitting={save.isPending}
          submitLabel={isEdit ? 'Save changes' : 'Add vehicle'}
          erroredStepIds={erroredStepIds}
          // An edit is a visit to one step, not a walk through three.
          allowJumpAhead={isEdit}
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

/** Register a new vehicle — the dialog's original entry point, unchanged. */
export function AddVehicleDialog(props: Omit<VehicleDialogProps, 'vehicle' | 'onSaved'>) {
  return <VehicleDialog {...props} />;
}

/**
 * The pencil on a vehicle row or card.
 *
 * Owns its own trigger for the same reasons `DeleteAction` does: it renders
 * nothing without the permission the API enforces anyway, so nobody is shown a
 * button whose refusal they could not have avoided, and it stops the click from
 * reaching the row underneath — which in this product is a link to the detail
 * page, so without that, pressing edit would navigate away instead of opening
 * the form.
 */
export function EditVehicleDialog({
  vehicle,
  allowedTypes,
  onSaved,
  size = 'icon-sm',
  label,
  variant = 'ghost',
  className,
}: {
  vehicle: EditableVehicle;
  allowedTypes?: VehicleType[];
  onSaved?: () => void;
  size?: 'icon-sm' | 'icon' | 'sm' | 'default';
  /**
   * Render a labelled button instead of the icon.
   *
   * For a detail header, where there is room for a word and no adjacent trash
   * icon to pair the pencil with. The icon stays the default so the grid and
   * the table are untouched.
   */
  label?: string;
  variant?: 'ghost' | 'outline';
  className?: string;
}) {
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);

  if (!can(Permission.VEHICLES_UPDATE)) return null;

  const accessibleLabel = label ?? `Edit ${vehicle.registrationNumber}`;

  const trigger = (
    <Button
      variant={variant}
      size={size}
      aria-label={accessibleLabel}
      className={cn(!label && 'text-muted-foreground hover:text-foreground', className)}
      onClick={(event) => {
        // The row behind this is a link to the detail page.
        event.stopPropagation();
        event.preventDefault();
        setOpen(true);
      }}
    >
      <Pencil className={label ? 'size-4' : undefined} />
      {label}
    </Button>
  );

  return (
    <>
      {/* A labelled button says what it does; only the icon needs a tooltip. */}
      {label ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{accessibleLabel}</TooltipContent>
        </Tooltip>
      )}

      <VehicleDialog
        vehicle={vehicle}
        {...(allowedTypes ? { allowedTypes } : {})}
        {...(onSaved ? { onSaved } : {})}
        trigger={null}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export default VehicleDialog;

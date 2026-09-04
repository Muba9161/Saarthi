import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CarFront, IndianRupee, ListChecks, NotebookPen, Plus, Route } from 'lucide-react';
import {
  PricingModel,
  TravelPackageStatus,
  TravelServiceKind,
  VehicleType,
  humanizeEnum,
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
import { Textarea } from '@/components/ui/textarea';
import {
  FormWizard,
  WizardField,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';
import { ChipInput } from '@/components/common/chip-input';

/**
 * Publish a travel package.
 *
 * A package is a saleable product, so the form asks for everything a customer
 * needs to decide — where it goes, how long, what is included, what it costs —
 * and nothing that only matters after a booking exists. It is created as a
 * draft; publishing is a separate, deliberate step on the packages list.
 *
 * Twenty-two fields is too many to face at once, so they are grouped the way
 * an operator thinks about a tour: what it is, where it goes, what carries it,
 * what it costs, and what is bundled in. Each step is checked before the next
 * opens, which is also what turned the old "add at least one destination"
 * toast — discovered only on submit, after every other field was filled — into
 * a message on the step that owns it.
 */

interface PackageFormState {
  title: string;
  summary: string;
  description: string;
  serviceKind: TravelServiceKind;
  destinations: string[];
  startLocation: string;
  startLatitude: string;
  startLongitude: string;
  endLocation: string;
  durationDays: string;
  durationNights: string;
  approxDistanceKm: string;
  vehicleType: VehicleType;
  minPassengers: string;
  maxPassengers: string;
  pricingModel: PricingModel;
  basePrice: string;
  inclusions: string[];
  exclusions: string[];
  advanceBookingDays: string;
  driverIncluded: boolean;
  fuelIncluded: boolean;
}

type FieldErrors = Partial<Record<keyof PackageFormState, string>>;

const EMPTY: PackageFormState = {
  title: '',
  summary: '',
  description: '',
  serviceKind: TravelServiceKind.MULTI_DAY_TOUR,
  destinations: [],
  startLocation: '',
  startLatitude: '',
  startLongitude: '',
  endLocation: '',
  durationDays: '1',
  durationNights: '0',
  approxDistanceKm: '',
  vehicleType: VehicleType.SUV,
  minPassengers: '1',
  maxPassengers: '4',
  pricingModel: PricingModel.FIXED_PACKAGE,
  basePrice: '',
  inclusions: [],
  exclusions: [],
  advanceBookingDays: '1',
  driverIncluded: true,
  fuelIncluded: true,
};

/** A latitude or longitude that the API will accept. */
function coordinate(value: string, limit: number): boolean {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) && Math.abs(parsed) <= limit;
}

/**
 * Per-step rules, mirroring what the API enforces. Keyed by step id so a step
 * cannot be reordered out of its own validation.
 */
const STEP_RULES: Record<string, (form: PackageFormState) => FieldErrors> = {
  basics: (form) => {
    const errors: FieldErrors = {};
    if (form.title.trim().length < 5) errors.title = 'Give the package a title of at least 5 characters.';
    if (form.summary.trim().length < 10)
      errors.summary = 'Write a one-line summary of at least 10 characters.';
    return errors;
  },
  route: (form) => {
    const errors: FieldErrors = {};
    if (form.destinations.length === 0) errors.destinations = 'Add at least one destination.';
    if (!form.startLocation.trim()) errors.startLocation = 'Where does the journey start?';
    if (!form.endLocation.trim()) errors.endLocation = 'Where does it end?';
    if (!coordinate(form.startLatitude, 90))
      errors.startLatitude = 'Enter a latitude between -90 and 90.';
    if (!coordinate(form.startLongitude, 180))
      errors.startLongitude = 'Enter a longitude between -180 and 180.';
    return errors;
  },
  vehicle: (form) => {
    const errors: FieldErrors = {};
    const days = Number(form.durationDays);
    const min = Number(form.minPassengers);
    const max = Number(form.maxPassengers);
    if (!Number.isFinite(days) || days < 1) errors.durationDays = 'A package runs for at least a day.';
    if (!Number.isFinite(max) || max < 1) errors.maxPassengers = 'Enter the most guests you can take.';
    else if (Number.isFinite(min) && min > max)
      errors.minPassengers = 'The minimum cannot exceed the maximum.';
    return errors;
  },
  pricing: (form) => {
    const errors: FieldErrors = {};
    const price = Number(form.basePrice);
    if (!Number.isFinite(price) || price <= 0) errors.basePrice = 'Enter the price you charge.';
    if (form.pricingModel === PricingModel.PER_KM && !(Number(form.approxDistanceKm) > 0))
      errors.approxDistanceKm = 'Per-kilometre pricing needs an approximate distance.';
    return errors;
  },
  extras: () => ({}),
};

export function CreatePackageDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<PackageFormState>(EMPTY);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);

  const set = <K extends keyof PackageFormState>(key: K, value: PackageFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    // Clear the message as soon as the field is touched — leaving it under a
    // field the user is actively fixing reads as though it is still wrong.
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));
  };

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/travel/me/packages', payload),
    onSuccess: () => {
      toast.success('Package created', {
        description: 'It is saved as a draft — publish it when you are ready.',
      });
      // Every travel query is keyed under 'travel' — the list, the provider
      // profile and its published count all move when a package is added.
      void queryClient.invalidateQueries({ queryKey: ['travel'] });
      setOpen(false);
      setForm(EMPTY);
      setErrors({});
      setErroredStepIds([]);
    },
    onError: (error) =>
      toast.error('Could not create the package', { description: errorMessage(error) }),
  });

  const submit = (): void => {
    create.mutate({
      title: form.title.trim(),
      summary: form.summary.trim(),
      serviceKind: form.serviceKind,
      destinations: form.destinations,
      startLocation: form.startLocation.trim(),
      startLatitude: Number(form.startLatitude),
      startLongitude: Number(form.startLongitude),
      endLocation: form.endLocation.trim(),
      durationDays: Number(form.durationDays || 1),
      vehicleType: form.vehicleType,
      minPassengers: Number(form.minPassengers || 1),
      maxPassengers: Number(form.maxPassengers || 1),
      pricingModel: form.pricingModel,
      basePrice: Number(form.basePrice || 0),
      inclusions: form.inclusions,
      exclusions: form.exclusions,
      advanceBookingDays: Number(form.advanceBookingDays || 0),
      driverIncluded: form.driverIncluded,
      fuelIncluded: form.fuelIncluded,
      status: TravelPackageStatus.DRAFT,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.durationNights ? { durationNights: Number(form.durationNights) } : {}),
      ...(form.approxDistanceKm ? { approxDistanceKm: Number(form.approxDistanceKm) } : {}),
    });
  };

  /**
   * Only steps that have actually been *tried* are marked on the rail. Running
   * the rules speculatively across every step would paint the whole rail red
   * the moment the dialog opens, when nothing has been filled in yet.
   */
  const validateStep = (step: WizardStep): boolean => {
    const found = STEP_RULES[step.id]?.(form) ?? {};
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
      id: 'basics',
      title: 'The package',
      description: 'What you are selling.',
      icon: NotebookPen,
      content: (
        <>
          <WizardField label="Title" htmlFor="package-title" required error={errors.title}>
            <Input
              id="package-title"
              maxLength={200}
              value={form.title}
              aria-invalid={Boolean(errors.title) || undefined}
              onChange={(event) => set('title', event.target.value)}
              placeholder="Char Dham Yatra — 10 days by Tempo Traveller"
            />
          </WizardField>

          <WizardField
            label="Short summary"
            htmlFor="package-summary"
            required
            error={errors.summary}
            hint="The one line customers see in search results."
          >
            <Input
              id="package-summary"
              maxLength={400}
              value={form.summary}
              aria-invalid={Boolean(errors.summary) || undefined}
              onChange={(event) => set('summary', event.target.value)}
            />
          </WizardField>

          <WizardField label="Full description" htmlFor="package-description">
            <Textarea
              id="package-description"
              rows={4}
              maxLength={6000}
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
              placeholder="What the journey covers, the pace, what to expect."
            />
          </WizardField>

          <WizardField label="Service kind" required>
            <Select
              value={form.serviceKind}
              onValueChange={(value) => set('serviceKind', value as TravelServiceKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TravelServiceKind).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {humanizeEnum(kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>
        </>
      ),
    },
    {
      id: 'route',
      title: 'Route',
      description: 'Where it goes and for how long.',
      icon: Route,
      content: (
        <>
          <ChipInput
            id="package-destinations"
            label="Destinations"
            placeholder="Ayodhya, then press Enter"
            values={form.destinations}
            onChange={(values) => set('destinations', values)}
            error={errors.destinations}
            required
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField
              label="Starts from"
              htmlFor="package-start"
              required
              error={errors.startLocation}
            >
              <Input
                id="package-start"
                value={form.startLocation}
                aria-invalid={Boolean(errors.startLocation) || undefined}
                onChange={(event) => set('startLocation', event.target.value)}
                placeholder="Lucknow"
              />
            </WizardField>
            <WizardField label="Ends at" htmlFor="package-end" required error={errors.endLocation}>
              <Input
                id="package-end"
                value={form.endLocation}
                aria-invalid={Boolean(errors.endLocation) || undefined}
                onChange={(event) => set('endLocation', event.target.value)}
                placeholder="Lucknow"
              />
            </WizardField>
            <WizardField
              label="Start latitude"
              htmlFor="package-lat"
              required
              error={errors.startLatitude}
            >
              <Input
                id="package-lat"
                type="number"
                step="0.0001"
                value={form.startLatitude}
                aria-invalid={Boolean(errors.startLatitude) || undefined}
                onChange={(event) => set('startLatitude', event.target.value)}
                placeholder="26.8467"
              />
            </WizardField>
            <WizardField
              label="Start longitude"
              htmlFor="package-lng"
              required
              error={errors.startLongitude}
            >
              <Input
                id="package-lng"
                type="number"
                step="0.0001"
                value={form.startLongitude}
                aria-invalid={Boolean(errors.startLongitude) || undefined}
                onChange={(event) => set('startLongitude', event.target.value)}
                placeholder="80.9462"
              />
            </WizardField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField label="Days" htmlFor="package-days" required error={errors.durationDays}>
              <Input
                id="package-days"
                type="number"
                min={1}
                max={60}
                value={form.durationDays}
                aria-invalid={Boolean(errors.durationDays) || undefined}
                onChange={(event) => set('durationDays', event.target.value)}
              />
            </WizardField>
            <WizardField label="Nights" htmlFor="package-nights">
              <Input
                id="package-nights"
                type="number"
                min={0}
                max={59}
                value={form.durationNights}
                onChange={(event) => set('durationNights', event.target.value)}
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'vehicle',
      title: 'Vehicle & guests',
      description: 'What carries the party.',
      icon: CarFront,
      content: (
        <>
          <WizardField label="Vehicle type" required>
            <Select
              value={form.vehicleType}
              onValueChange={(value) => set('vehicleType', value as VehicleType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(VehicleType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanizeEnum(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField label="Min guests" htmlFor="package-min" error={errors.minPassengers}>
              <Input
                id="package-min"
                type="number"
                min={1}
                max={80}
                value={form.minPassengers}
                aria-invalid={Boolean(errors.minPassengers) || undefined}
                onChange={(event) => set('minPassengers', event.target.value)}
              />
            </WizardField>
            <WizardField
              label="Max guests"
              htmlFor="package-max"
              required
              error={errors.maxPassengers}
            >
              <Input
                id="package-max"
                type="number"
                min={1}
                max={80}
                value={form.maxPassengers}
                aria-invalid={Boolean(errors.maxPassengers) || undefined}
                onChange={(event) => set('maxPassengers', event.target.value)}
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'pricing',
      title: 'Pricing',
      description: 'What it costs to book.',
      icon: IndianRupee,
      content: (
        <>
          <WizardField label="Pricing model" required>
            <Select
              value={form.pricingModel}
              onValueChange={(value) => set('pricingModel', value as PricingModel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PricingModel).map((model) => (
                  <SelectItem key={model} value={model}>
                    {humanizeEnum(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField
              label="Base price (₹)"
              htmlFor="package-price"
              required
              error={errors.basePrice}
            >
              <Input
                id="package-price"
                type="number"
                min={0}
                value={form.basePrice}
                aria-invalid={Boolean(errors.basePrice) || undefined}
                onChange={(event) => set('basePrice', event.target.value)}
              />
            </WizardField>
            <WizardField
              label="Approx. distance (km)"
              htmlFor="package-distance"
              required={form.pricingModel === PricingModel.PER_KM}
              error={errors.approxDistanceKm}
              hint={
                form.pricingModel === PricingModel.PER_KM
                  ? 'Used to quote the fare.'
                  : 'Optional, but customers look for it.'
              }
            >
              <Input
                id="package-distance"
                type="number"
                min={0}
                value={form.approxDistanceKm}
                aria-invalid={Boolean(errors.approxDistanceKm) || undefined}
                onChange={(event) => set('approxDistanceKm', event.target.value)}
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'extras',
      title: "What's included",
      description: 'Inclusions and booking rules.',
      icon: ListChecks,
      optional: true,
      content: (
        <>
          <ChipInput
            id="package-inclusions"
            label="What's included"
            placeholder="Driver allowance, tolls, parking…"
            values={form.inclusions}
            onChange={(values) => set('inclusions', values)}
          />

          <ChipInput
            id="package-exclusions"
            label="What's not included"
            placeholder="Hotel, meals, entry tickets…"
            values={form.exclusions}
            onChange={(values) => set('exclusions', values)}
          />

          <WizardField
            label="Notice needed (days)"
            htmlFor="package-notice"
            hint="How far ahead a customer must book."
          >
            <Input
              id="package-notice"
              type="number"
              min={0}
              max={180}
              value={form.advanceBookingDays}
              onChange={(event) => set('advanceBookingDays', event.target.value)}
            />
          </WizardField>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="glass-inset flex items-center justify-between px-3 py-2.5">
              <Label htmlFor="package-driver">Driver included</Label>
              <Switch
                id="package-driver"
                checked={form.driverIncluded}
                onCheckedChange={(checked) => set('driverIncluded', checked)}
              />
            </div>
            <div className="glass-inset flex items-center justify-between px-3 py-2.5">
              <Label htmlFor="package-fuel">Fuel included</Label>
              <Switch
                id="package-fuel"
                checked={form.fuelIncluded}
                onCheckedChange={(checked) => set('fuelIncluded', checked)}
              />
            </div>
          </div>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New package
        </Button>
      </DialogTrigger>

      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>New travel package</DialogTitle>
          <DialogDescription>
            Saved as a draft first, so you can review it before customers can book.
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
          submitLabel="Create draft"
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

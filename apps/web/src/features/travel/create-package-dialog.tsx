import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import {
  PricingModel,
  TravelPackageStatus,
  TravelServiceKind,
  VehicleType,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

/**
 * Publish a travel package.
 *
 * A package is a saleable product, so the form asks for everything a customer
 * needs to decide — where it goes, how long, what is included, what it costs —
 * and nothing that only matters after a booking exists. It is created as a
 * draft; publishing is a separate, deliberate step on the packages list.
 */

/** Free-text lists (destinations, inclusions) as removable chips. */
function ChipInput({
  id,
  label,
  placeholder,
  values,
  onChange,
  required,
}: {
  id: string;
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  required?: boolean;
}) {
  const [draft, setDraft] = React.useState('');

  const commit = (): void => {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a chip rather than submitting the whole form.
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={commit}>
          Add
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((value) => (
            <Badge key={value} variant="secondary" size="sm" className="gap-1">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

export function CreatePackageDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<PackageFormState>(EMPTY);

  const set = <K extends keyof PackageFormState>(key: K, value: PackageFormState[K]): void =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/travel/me/packages', payload),
    onSuccess: () => {
      toast.success('Package created', {
        description: 'It is saved as a draft — publish it when you are ready.',
      });
      void queryClient.invalidateQueries({ queryKey: ['travel-packages'] });
      void queryClient.invalidateQueries({ queryKey: ['provider-packages'] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (error) =>
      toast.error('Could not create the package', { description: errorMessage(error) }),
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();

    if (form.destinations.length === 0) {
      toast.error('Add at least one destination');
      return;
    }

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New package
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New travel package</DialogTitle>
          <DialogDescription>
            Saved as a draft first, so you can review it before customers can book.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="package-title">Title *</Label>
              <Input
                id="package-title"
                required
                minLength={5}
                maxLength={200}
                value={form.title}
                onChange={(event) => set('title', event.target.value)}
                placeholder="Char Dham Yatra — 10 days by Tempo Traveller"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="package-summary">Short summary *</Label>
              <Input
                id="package-summary"
                required
                minLength={10}
                maxLength={400}
                value={form.summary}
                onChange={(event) => set('summary', event.target.value)}
                placeholder="One line customers see in search results."
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="package-description">Full description</Label>
              <Textarea
                id="package-description"
                rows={4}
                maxLength={6000}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder="What the journey covers, the pace, what to expect."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Service kind *</Label>
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
            </div>

            <div className="space-y-1.5">
              <Label>Vehicle type *</Label>
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
            </div>
          </div>

          <ChipInput
            id="package-destinations"
            label="Destinations"
            placeholder="Ayodhya, then press Enter"
            values={form.destinations}
            onChange={(values) => set('destinations', values)}
            required
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="package-start">Starts from *</Label>
              <Input
                id="package-start"
                required
                value={form.startLocation}
                onChange={(event) => set('startLocation', event.target.value)}
                placeholder="Lucknow"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-end">Ends at *</Label>
              <Input
                id="package-end"
                required
                value={form.endLocation}
                onChange={(event) => set('endLocation', event.target.value)}
                placeholder="Lucknow"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-lat">Start latitude *</Label>
              <Input
                id="package-lat"
                type="number"
                step="0.0001"
                required
                value={form.startLatitude}
                onChange={(event) => set('startLatitude', event.target.value)}
                placeholder="26.8467"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-lng">Start longitude *</Label>
              <Input
                id="package-lng"
                type="number"
                step="0.0001"
                required
                value={form.startLongitude}
                onChange={(event) => set('startLongitude', event.target.value)}
                placeholder="80.9462"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="package-days">Days *</Label>
              <Input
                id="package-days"
                type="number"
                min={1}
                max={60}
                required
                value={form.durationDays}
                onChange={(event) => set('durationDays', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-nights">Nights</Label>
              <Input
                id="package-nights"
                type="number"
                min={0}
                max={59}
                value={form.durationNights}
                onChange={(event) => set('durationNights', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-min">Min guests</Label>
              <Input
                id="package-min"
                type="number"
                min={1}
                max={80}
                value={form.minPassengers}
                onChange={(event) => set('minPassengers', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-max">Max guests *</Label>
              <Input
                id="package-max"
                type="number"
                min={1}
                max={80}
                required
                value={form.maxPassengers}
                onChange={(event) => set('maxPassengers', event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Pricing model *</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-price">Base price (₹) *</Label>
              <Input
                id="package-price"
                type="number"
                min={0}
                required
                value={form.basePrice}
                onChange={(event) => set('basePrice', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package-distance">
                Approx. distance (km)
                {form.pricingModel === PricingModel.PER_KM ? ' *' : ''}
              </Label>
              <Input
                id="package-distance"
                type="number"
                min={0}
                required={form.pricingModel === PricingModel.PER_KM}
                value={form.approxDistanceKm}
                onChange={(event) => set('approxDistanceKm', event.target.value)}
              />
            </div>
          </div>

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

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="package-notice">Notice needed (days)</Label>
              <Input
                id="package-notice"
                type="number"
                min={0}
                max={180}
                value={form.advanceBookingDays}
                onChange={(event) => set('advanceBookingDays', event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <Label htmlFor="package-driver">Driver included</Label>
              <Switch
                id="package-driver"
                checked={form.driverIncluded}
                onCheckedChange={(checked) => set('driverIncluded', checked)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <Label htmlFor="package-fuel">Fuel included</Label>
              <Switch
                id="package-fuel"
                checked={form.fuelIncluded}
                onCheckedChange={(checked) => set('fuelIncluded', checked)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create draft'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

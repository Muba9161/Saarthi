import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  FuelType,
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

/**
 * Register a vehicle of any type.
 *
 * The form follows the capability model rather than hard-coding vehicle types:
 * asking a taxi for its payload tonnage, or a truck for its seat count, would
 * be asking for a number that does not exist. The type chosen at the top
 * decides which capacity field appears, and the same rule is enforced again by
 * the API — this only spares the user a round trip.
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

  const set = <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]): void =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/fleet/vehicles', payload),
    onSuccess: () => {
      toast.success('Vehicle added');
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });
      setOpen(false);
      setForm(initialState(defaultType));
    },
    onError: (error) => toast.error('Could not add the vehicle', { description: errorMessage(error) }),
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{triggerLabel}</DialogTitle>
          <DialogDescription>
            Register a vehicle to your organization. You can pull its RC record and upload photos
            once it is added.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-type">Vehicle type</Label>
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
            <p className="text-xs text-muted-foreground">{definition.description}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vehicle-registration">Registration number</Label>
            <Input
              id="vehicle-registration"
              required
              value={form.registrationNumber}
              onChange={(event) => set('registrationNumber', event.target.value.toUpperCase())}
              placeholder="UP32AB1234"
              className="font-mono uppercase tracking-wide"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-make">Make</Label>
              <Input
                id="vehicle-make"
                value={form.manufacturer}
                onChange={(event) => set('manufacturer', event.target.value)}
                placeholder="Mahindra"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-model">Model</Label>
              <Input
                id="vehicle-model"
                value={form.model}
                onChange={(event) => set('model', event.target.value)}
                placeholder="Blazo X 35"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-year">Year</Label>
              <Input
                id="vehicle-year"
                type="number"
                min={1980}
                max={new Date().getFullYear() + 1}
                value={form.year}
                onChange={(event) => set('year', event.target.value)}
                placeholder="2024"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-colour">Colour</Label>
              <Input
                id="vehicle-colour"
                value={form.colour}
                onChange={(event) => set('colour', event.target.value)}
                placeholder="White"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {carriesFreight ? (
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-capacity">Payload capacity (tonnes)</Label>
                <Input
                  id="vehicle-capacity"
                  type="number"
                  step="0.1"
                  min={0}
                  required
                  value={form.capacityTons}
                  onChange={(event) => set('capacityTons', event.target.value)}
                  placeholder="35"
                />
              </div>
            ) : null}

            {carriesPassengers ? (
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-seats">Passenger seats</Label>
                <Input
                  id="vehicle-seats"
                  type="number"
                  min={1}
                  max={80}
                  required
                  value={form.passengerCapacity}
                  onChange={(event) => set('passengerCapacity', event.target.value)}
                  placeholder="4"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="vehicle-fuel">Fuel</Label>
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
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vehicle-odometer">Odometer (km)</Label>
              <Input
                id="vehicle-odometer"
                type="number"
                min={0}
                value={form.odometerKm}
                onChange={(event) => set('odometerKm', event.target.value)}
              />
            </div>
          </div>

          {carriesPassengers ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add vehicle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fuel, Plus, Route, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { humanizeEnum, maintenanceTypeSchema } from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
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
import { Textarea } from '@/components/ui/textarea';
import {
  EMPTY_POINT,
  JourneyPicker,
  isLocatable,
  type JourneyPoint,
} from '@/features/travel/journey-picker';
import { addSharedActivity, sharedActivityKey, sharedVehicleKey } from './sharing-api';

/**
 * What a shared person can add to a vehicle: a trip, a fill-up, a service.
 *
 * Each is filed on the owner's account under the shared person's name — the
 * server decides the account, the driver and the trip link, so these forms ask
 * only for what the person actually knows.
 */

type Activity = 'trips' | 'fuel' | 'maintenance';

/** Save, refresh the list it belongs to, close. */
function useAddActivity(shareId: string, activity: Activity, onSaved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) => addSharedActivity(shareId, activity, payload),
    onSuccess: () => {
      toast.success('Saved to the vehicle', { description: 'The owner can see it too.' });
      void queryClient.invalidateQueries({ queryKey: sharedActivityKey(shareId, activity) });
      // A fill-up or a service can move the odometer shown in the header.
      void queryClient.invalidateQueries({ queryKey: sharedVehicleKey(shareId) });
      onSaved();
    },
    onError: (error) => toast.error('Could not save it', { description: errorMessage(error) }),
  });
}

function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const numberOrUndefined = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);

// ---------------------------------------------------------------------------
// Trip
// ---------------------------------------------------------------------------

export function AddSharedTripDialog({
  shareId,
  near,
}: {
  shareId: string;
  near: { latitude: number; longitude: number } | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [origin, setOrigin] = React.useState<JourneyPoint>(EMPTY_POINT);
  const [destination, setDestination] = React.useState<JourneyPoint>(EMPTY_POINT);
  const [notes, setNotes] = React.useState('');
  const save = useAddActivity(shareId, 'trips', () => setOpen(false));

  React.useEffect(() => {
    if (open) return;
    setOrigin(EMPTY_POINT);
    setDestination(EMPTY_POINT);
    setNotes('');
  }, [open]);

  const ready = isLocatable(origin) && isLocatable(destination);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!isLocatable(origin) || !isLocatable(destination)) return;
    save.mutate({
      origin: {
        addressLine: origin.address.trim(),
        latitude: origin.latitude,
        longitude: origin.longitude,
      },
      destination: {
        addressLine: destination.address.trim(),
        latitude: destination.latitude,
        longitude: destination.longitude,
      },
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" aria-hidden />
          Add trip
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="size-4 text-primary" aria-hidden />
            Add a trip
          </DialogTitle>
          <DialogDescription>
            It runs with the driver the owner has assigned to this vehicle.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <JourneyPicker
            pickup={origin}
            onPickupChange={setOrigin}
            dropoff={destination}
            onDropoffChange={setDestination}
            dropoffRequired
            near={near}
          />
          <Field id="shared-trip-notes" label="Notes (optional)">
            <Textarea
              id="shared-trip-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={!ready} loading={save.isPending}>
              Save trip
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------

export function AddSharedFuelDialog({ shareId }: { shareId: string }) {
  const [open, setOpen] = React.useState(false);
  const [litres, setLitres] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [odometer, setOdometer] = React.useState('');
  const [station, setStation] = React.useState('');
  const save = useAddActivity(shareId, 'fuel', () => setOpen(false));

  React.useEffect(() => {
    if (open) return;
    setLitres('');
    setPrice('');
    setOdometer('');
    setStation('');
  }, [open]);

  const ready = Number(litres) > 0 && Number(price) > 0;
  const total = ready ? Number(litres) * Number(price) : null;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    save.mutate({
      quantityLitres: Number(litres),
      pricePerUnit: Number(price),
      odometerKm: numberOrUndefined(odometer),
      ...(station.trim() ? { stationName: station.trim() } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" aria-hidden />
          Add fuel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fuel className="size-4 text-primary" aria-hidden />
            Add a fill-up
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="shared-fuel-litres" label="Litres">
              <Input
                id="shared-fuel-litres"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={litres}
                onChange={(event) => setLitres(event.target.value)}
              />
            </Field>
            <Field id="shared-fuel-price" label="Price per litre (₹)">
              <Input
                id="shared-fuel-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </Field>
            <Field id="shared-fuel-odometer" label="Odometer (km, optional)">
              <Input
                id="shared-fuel-odometer"
                type="number"
                inputMode="numeric"
                min={0}
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
              />
            </Field>
            <Field id="shared-fuel-station" label="Station (optional)">
              <Input
                id="shared-fuel-station"
                value={station}
                onChange={(event) => setStation(event.target.value)}
              />
            </Field>
          </div>
          {total !== null ? (
            <p className="text-sm text-muted-foreground">
              Total ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={!ready} loading={save.isPending}>
              Save fill-up
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

const MAINTENANCE_TYPES = maintenanceTypeSchema.options;

export function AddSharedMaintenanceDialog({ shareId }: { shareId: string }) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<string>(MAINTENANCE_TYPES[0]);
  const [title, setTitle] = React.useState('');
  const [when, setWhen] = React.useState<'done' | 'booked'>('done');
  const [date, setDate] = React.useState('');
  const [cost, setCost] = React.useState('');
  const [odometer, setOdometer] = React.useState('');
  const [provider, setProvider] = React.useState('');
  const save = useAddActivity(shareId, 'maintenance', () => setOpen(false));

  React.useEffect(() => {
    if (open) return;
    setType(MAINTENANCE_TYPES[0]);
    setTitle('');
    setWhen('done');
    setDate('');
    setCost('');
    setOdometer('');
    setProvider('');
  }, [open]);

  const ready = title.trim().length >= 3 && date !== '';

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    const at = new Date(date).toISOString();
    save.mutate({
      type,
      title: title.trim(),
      ...(when === 'done' ? { performedAt: at } : { scheduledAt: at }),
      cost: numberOrUndefined(cost),
      odometerKm: numberOrUndefined(odometer),
      ...(provider.trim() ? { serviceProvider: provider.trim() } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" aria-hidden />
          Add maintenance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4 text-primary" aria-hidden />
            Add maintenance
          </DialogTitle>
          <DialogDescription>Work already done, or work booked in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="shared-maint-type" label="Type">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="shared-maint-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {humanizeEnum(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="shared-maint-when" label="Status">
              <Select value={when} onValueChange={(value) => setWhen(value as 'done' | 'booked')}>
                <SelectTrigger id="shared-maint-when">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="booked">Booked</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field id="shared-maint-title" label="What was it?">
            <Input
              id="shared-maint-title"
              placeholder="e.g. General service, new tyres"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="shared-maint-date" label={when === 'done' ? 'Done on' : 'Booked for'}>
              <Input
                id="shared-maint-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Field id="shared-maint-cost" label="Cost (₹, optional)">
              <Input
                id="shared-maint-cost"
                type="number"
                inputMode="decimal"
                min={0}
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            </Field>
            <Field id="shared-maint-odometer" label="Odometer (km, optional)">
              <Input
                id="shared-maint-odometer"
                type="number"
                inputMode="numeric"
                min={0}
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
              />
            </Field>
            <Field id="shared-maint-provider" label="Workshop (optional)">
              <Input
                id="shared-maint-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!ready} loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Flag, MapPin, NotebookPen, Package } from 'lucide-react';
import { toast } from 'sonner';
import {
  MaterialUnit,
  Permission,
  TruckType,
  formatCurrency,
  formatNumber,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { MaterialSummary, OrderSummary, Paginated, TransportMatch } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { UnauthorizedState, LoadingState, EmptyState } from '@/components/common/states';
import {
  FormWizard,
  WizardField,
  type WizardStep,
} from '@/components/common/form-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Post a transport requirement, then compare the transport VorldX Saarthi can find.
 *
 * The matching panel beside the form is live: it re-queries as the capacity,
 * body type and either endpoint change, so the customer can see what a wider
 * body type or a slightly larger truck does to availability *before* they
 * commit to the requirement. Splitting the form into pickup and delivery steps
 * keeps that panel meaningful — each step changes one end of the route, and
 * the answer updates against it.
 */

interface Place {
  addressLine: string;
  latitude: number;
  longitude: number;
}

type FieldKey =
  | 'quantity'
  | 'capacity'
  | 'originAddress'
  | 'originLatitude'
  | 'originLongitude'
  | 'destinationAddress'
  | 'destinationLatitude'
  | 'destinationLongitude';

type FieldErrors = Partial<Record<FieldKey, string>>;

/** A coordinate the API will accept. */
function withinRange(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

export function NewOrderPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [materialId, setMaterialId] = React.useState('');
  const [quantity, setQuantity] = React.useState(20);
  const [capacity, setCapacity] = React.useState(20);
  const [truckType, setTruckType] = React.useState<string>('any');
  const [origin, setOrigin] = React.useState<Place>({
    addressLine: '',
    latitude: 26.8351,
    longitude: 75.9843,
  });
  const [destination, setDestination] = React.useState<Place>({
    addressLine: '',
    latitude: 28.4089,
    longitude: 77.0789,
  });
  const [notes, setNotes] = React.useState('');
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);

  const clearError = (key: FieldKey): void =>
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));

  const materials = useQuery({
    queryKey: ['materials', 'available'],
    queryFn: () =>
      api.get<Paginated<MaterialSummary>>('/marketplace/materials', {
        availableOnly: true,
        pageSize: 100,
      }),
    enabled: can(Permission.ORDERS_CREATE),
  });

  const selected = (materials.data?.items ?? []).find((entry) => entry.id === materialId);

  React.useEffect(() => {
    // Default the pickup point to the supplier yard once a material is chosen.
    if (!selected) return;
    setOrigin((previous) => ({
      addressLine: selected.pickupAddress ?? previous.addressLine,
      latitude: selected.pickupLatitude ?? previous.latitude,
      longitude: selected.pickupLongitude ?? previous.longitude,
    }));
  }, [selected]);

  const matches = useQuery({
    queryKey: ['orders', 'match', capacity, truckType, origin.latitude, destination.latitude],
    queryFn: () =>
      api.post<TransportMatch[]>('/orders/match', {
        originLatitude: origin.latitude,
        originLongitude: origin.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
        requiredCapacityTons: capacity,
        ...(truckType !== 'any' ? { requiredTruckType: truckType } : {}),
      }),
    enabled: capacity > 0,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<OrderSummary>('/orders', {
        ...(materialId ? { materialId } : { materialName: 'Customer-supplied goods' }),
        quantity,
        unit: selected?.unit ?? MaterialUnit.TON,
        origin,
        destination,
        requiredCapacityTons: capacity,
        ...(truckType !== 'any' ? { requiredTruckType: truckType } : {}),
        ...(notes ? { notes } : {}),
      }),
    onSuccess: (order) => {
      toast.success('Requirement posted', { description: 'Fleets can now quote for it.' });
      navigate(`/orders/${order.id}`);
    },
    onError: (error) =>
      toast.error('Could not post the requirement', { description: errorMessage(error) }),
  });

  const rulesFor = (stepId: string): FieldErrors => {
    const found: FieldErrors = {};

    if (stepId === 'load') {
      if (!(quantity > 0)) found.quantity = 'How much needs moving?';
      if (!(capacity > 0)) found.capacity = 'Enter the truck size this needs.';
    }

    if (stepId === 'pickup') {
      if (origin.addressLine.trim().length < 3)
        found.originAddress = 'Enter where the load is collected.';
      if (!withinRange(origin.latitude, 90))
        found.originLatitude = 'Enter a latitude between -90 and 90.';
      if (!withinRange(origin.longitude, 180))
        found.originLongitude = 'Enter a longitude between -180 and 180.';
    }

    if (stepId === 'delivery') {
      if (destination.addressLine.trim().length < 3)
        found.destinationAddress = 'Enter where the load is delivered.';
      if (!withinRange(destination.latitude, 90))
        found.destinationLatitude = 'Enter a latitude between -90 and 90.';
      if (!withinRange(destination.longitude, 180))
        found.destinationLongitude = 'Enter a longitude between -180 and 180.';
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

  if (!can(Permission.ORDERS_CREATE)) return <UnauthorizedState />;

  const steps: WizardStep[] = [
    {
      id: 'load',
      title: 'The load',
      description: 'What needs moving.',
      icon: Package,
      content: (
        <>
          <WizardField
            label="Material from the marketplace"
            hint={
              selected
                ? `${selected.supplierName} · ${formatNumber(selected.availableQuantity)} available · minimum ${selected.minimumOrderQty}`
                : 'Optional — leave it blank to move goods you already own.'
            }
          >
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger>
                <SelectValue placeholder="Optional — or move goods you already own" />
              </SelectTrigger>
              <SelectContent>
                {(materials.data?.items ?? []).map((material) => (
                  <SelectItem key={material.id} value={material.id}>
                    {material.name} · {formatCurrency(material.pricePerUnit)}/
                    {humanizeEnum(material.unit).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField label="Quantity" htmlFor="order-quantity" required error={errors.quantity}>
              <Input
                id="order-quantity"
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
            <WizardField
              label="Truck capacity needed (tonnes)"
              htmlFor="order-capacity"
              required
              error={errors.capacity}
            >
              <Input
                id="order-capacity"
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

          <WizardField label="Body type" hint="Widening this usually finds more transport.">
            <Select value={truckType} onValueChange={setTruckType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any suitable body</SelectItem>
                {Object.values(TruckType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanizeEnum(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </WizardField>
        </>
      ),
    },
    {
      id: 'pickup',
      title: 'Pickup',
      description: 'Where it is collected.',
      icon: MapPin,
      content: (
        <>
          <WizardField
            label="Pickup address"
            htmlFor="order-origin"
            required
            error={errors.originAddress}
          >
            <Input
              id="order-origin"
              value={origin.addressLine}
              aria-invalid={Boolean(errors.originAddress) || undefined}
              onChange={(event) => {
                setOrigin({ ...origin, addressLine: event.target.value });
                clearError('originAddress');
              }}
              placeholder="Bassi Industrial Area, Jaipur"
            />
          </WizardField>

          <div className="grid grid-cols-2 gap-3">
            <WizardField
              label="Latitude"
              htmlFor="order-origin-lat"
              error={errors.originLatitude}
            >
              <Input
                id="order-origin-lat"
                type="number"
                step="0.0001"
                value={origin.latitude}
                aria-invalid={Boolean(errors.originLatitude) || undefined}
                onChange={(event) => {
                  setOrigin({ ...origin, latitude: Number(event.target.value) });
                  clearError('originLatitude');
                }}
              />
            </WizardField>
            <WizardField
              label="Longitude"
              htmlFor="order-origin-lng"
              error={errors.originLongitude}
            >
              <Input
                id="order-origin-lng"
                type="number"
                step="0.0001"
                value={origin.longitude}
                aria-invalid={Boolean(errors.originLongitude) || undefined}
                onChange={(event) => {
                  setOrigin({ ...origin, longitude: Number(event.target.value) });
                  clearError('originLongitude');
                }}
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'delivery',
      title: 'Delivery',
      description: 'Where it has to arrive.',
      icon: Flag,
      content: (
        <>
          <WizardField
            label="Delivery address"
            htmlFor="order-destination"
            required
            error={errors.destinationAddress}
          >
            <Input
              id="order-destination"
              value={destination.addressLine}
              aria-invalid={Boolean(errors.destinationAddress) || undefined}
              onChange={(event) => {
                setDestination({ ...destination, addressLine: event.target.value });
                clearError('destinationAddress');
              }}
              placeholder="Sector 62, Gurugram"
            />
          </WizardField>

          <div className="grid grid-cols-2 gap-3">
            <WizardField
              label="Latitude"
              htmlFor="order-destination-lat"
              error={errors.destinationLatitude}
            >
              <Input
                id="order-destination-lat"
                type="number"
                step="0.0001"
                value={destination.latitude}
                aria-invalid={Boolean(errors.destinationLatitude) || undefined}
                onChange={(event) => {
                  setDestination({ ...destination, latitude: Number(event.target.value) });
                  clearError('destinationLatitude');
                }}
              />
            </WizardField>
            <WizardField
              label="Longitude"
              htmlFor="order-destination-lng"
              error={errors.destinationLongitude}
            >
              <Input
                id="order-destination-lng"
                type="number"
                step="0.0001"
                value={destination.longitude}
                aria-invalid={Boolean(errors.destinationLongitude) || undefined}
                onChange={(event) => {
                  setDestination({ ...destination, longitude: Number(event.target.value) });
                  clearError('destinationLongitude');
                }}
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'notes',
      title: 'Notes',
      description: 'Anything the fleet should know.',
      icon: NotebookPen,
      optional: true,
      content: (
        <WizardField
          label="Notes for the fleet"
          htmlFor="order-notes"
          hint="Site access hours, weighbridge requirements, anything that affects the run."
        >
          <Textarea
            id="order-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder="Site access hours, weighbridge requirements…"
          />
        </WizardField>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/orders')}>
        <ArrowLeft className="size-4" />
        All orders
      </Button>

      <PageHeader
        title="Post a transport requirement"
        description="Tell Saarthi what needs moving; verified fleets will quote for it."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <FormWizard
          steps={steps}
          title="Your requirement"
          description="Four steps. Nothing is posted until the last one."
          onValidateStep={validateStep}
          onSubmit={() => create.mutate()}
          submitting={create.isPending}
          submitLabel={
            <>
              <Package className="size-4" />
              Post requirement
            </>
          }
          erroredStepIds={erroredStepIds}
        />

        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Transport VorldX Saarthi can find"
              description="Ranked by distance, capacity fit, driver score and availability."
            />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {matches.isLoading ? (
              <LoadingState label="Finding transport…" />
            ) : (matches.data ?? []).length === 0 ? (
              <EmptyState
                title="No matching transport yet"
                description="No verified truck of this size is close enough right now. Posting the requirement still lets fleets quote."
                className="min-h-40 border-0"
              />
            ) : (
              (matches.data ?? []).map((match) => (
                <div key={match.truckId} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{match.registrationNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {match.fleetName} · {match.capacityTons}T {humanizeEnum(match.truckType)}
                      </p>
                    </div>
                    <Badge variant="default" className="tabular shrink-0">
                      {match.matchScore}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{match.distanceToPickupKm} km away</span>
                    <span>~{match.estimatedPickupMinutes} min to pickup</span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(match.estimatedPrice)}
                    </span>
                  </div>
                  {match.reasons.length > 0 ? (
                    <ul className="mt-2 space-y-0.5">
                      {match.reasons.map((reason) => (
                        <li key={reason} className="text-xs text-muted-foreground">
                          • {reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default NewOrderPage;

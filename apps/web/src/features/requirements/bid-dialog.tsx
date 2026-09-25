import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { toast } from 'sonner';
import {
  BID_SCOPE_LABELS,
  Permission,
  RequirementBidScope,
  RequirementKind,
  VehicleType,
  formatCurrency,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type {
  BoardRequirement,
  Paginated,
  RequirementBidSummary,
  TruckSummary,
} from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { WizardField } from '@/components/common/form-wizard';
import { SourcedMaterialField } from './sourced-material-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Place or revise a bid.
 *
 * One dialog for every scope a bidder may offer, because what a bidder is
 * doing is the same in each case — naming a price and saying what it covers.
 * A transport bid must name a vehicle, since accepting it creates a trip; on a
 * material requirement it must also name the seller listing the fleet will
 * source from, because the fleet delivers the goods itself; a travel bid names
 * a vehicle type and what is included.
 */
export function BidDialog({
  requirement,
  scope,
  open,
  onOpenChange,
  onPlaced,
}: {
  requirement: BoardRequirement;
  scope: RequirementBidScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlaced: () => void;
}) {
  const { can } = useAuth();
  const existing = requirement.myBid?.scope === scope ? requirement.myBid : null;

  const [price, setPrice] = React.useState(existing ? String(existing.price) : '');
  const [priceBreakdown, setPriceBreakdown] = React.useState(existing?.priceBreakdown ?? '');
  const [message, setMessage] = React.useState(existing?.message ?? '');

  // Transport
  const [vehicleId, setVehicleId] = React.useState(existing?.vehicle?.id ?? '');
  const [driverId, setDriverId] = React.useState(existing?.driver?.id ?? '');
  // A material requirement is answered only by a fleet that sources the goods
  // from a seller listing and delivers them.
  const mustSource =
    scope === RequirementBidScope.TRANSPORT && requirement.kind === RequirementKind.MATERIAL_SUPPLY;
  const [sourceMaterialId, setSourceMaterialId] = React.useState(existing?.sourceMaterialId ?? '');

  // Travel
  const [offeredVehicleType, setOfferedVehicleType] = React.useState<string>(
    existing?.offeredVehicleType ?? requirement.preferredVehicleType ?? VehicleType.CAR,
  );
  const [inclusionsText, setInclusionsText] = React.useState(
    existing?.inclusions.join('\n') ?? requirement.requiredInclusions.join('\n'),
  );
  const [exclusionsText, setExclusionsText] = React.useState(existing?.exclusions.join('\n') ?? '');
  const [itinerarySummary, setItinerarySummary] = React.useState(existing?.itinerarySummary ?? '');
  const [driverIncluded, setDriverIncluded] = React.useState(existing?.driverIncluded ?? true);
  const [fuelIncluded, setFuelIncluded] = React.useState(existing?.fuelIncluded ?? true);

  const [error, setError] = React.useState<string | null>(null);

  const vehicles = useQuery({
    queryKey: ['trucks', 'biddable'],
    queryFn: () =>
      api.get<Paginated<TruckSummary>>('/trucks', { pageSize: 100, status: 'AVAILABLE,IDLE' }),
    enabled: open && scope === RequirementBidScope.TRANSPORT && can(Permission.TRUCKS_READ),
  });

  const place = useMutation({
    mutationFn: () =>
      api.post<RequirementBidSummary>(`/requirements/${requirement.id}/bids`, {
        scope,
        price: Number(price),
        ...(priceBreakdown ? { priceBreakdown } : {}),
        ...(message ? { message } : {}),
        ...(scope === RequirementBidScope.TRANSPORT
          ? {
              vehicleId,
              ...(driverId ? { driverId } : {}),
              ...(mustSource && sourceMaterialId ? { sourceMaterialId } : {}),
            }
          : {}),
        ...(scope === RequirementBidScope.TRAVEL
          ? {
              offeredVehicleType,
              inclusions: inclusionsText
                .split(/[\n,]/)
                .map((entry) => entry.trim())
                .filter(Boolean),
              exclusions: exclusionsText
                .split(/[\n,]/)
                .map((entry) => entry.trim())
                .filter(Boolean),
              ...(itinerarySummary ? { itinerarySummary } : {}),
              driverIncluded,
              fuelIncluded,
            }
          : {}),
      }),
    onSuccess: () => {
      toast.success(existing ? 'Bid revised' : 'Bid placed', {
        description: 'The customer has been notified.',
      });
      onPlaced();
    },
    onError: (caught) => {
      setError(errorMessage(caught));
      toast.error('Could not place the bid', { description: errorMessage(caught) });
    },
  });

  const submit = (): void => {
    setError(null);

    const amount = Number(price);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter the price you are offering.');
      return;
    }
    if (scope === RequirementBidScope.TRANSPORT && !vehicleId) {
      setError('Choose the vehicle you are offering. Accepting your bid creates a trip for it.');
      return;
    }
    if (mustSource && !sourceMaterialId) {
      setError('Choose the seller listing you will source the material from.');
      return;
    }

    place.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? 'Revise your bid' : `Bid for ${BID_SCOPE_LABELS[scope].toLowerCase()}`}
          </DialogTitle>
          <DialogDescription>
            {requirement.title}
            {requirement.budgetAmount !== null
              ? ` · customer budget ${formatCurrency(requirement.budgetAmount)}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <WizardField label="Your price (₹)" htmlFor="bid-price" required>
            <Input
              id="bid-price"
              type="number"
              min={1}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="42000"
            />
          </WizardField>

          <WizardField
            label="What does that cover?"
            htmlFor="bid-breakdown"
            hint="A price with a breakdown wins more often than one without."
          >
            <Input
              id="bid-breakdown"
              value={priceBreakdown}
              onChange={(event) => setPriceBreakdown(event.target.value)}
              placeholder="All-inclusive: fuel, toll, driver allowance"
            />
          </WizardField>

          {scope === RequirementBidScope.TRANSPORT ? (
            <>
              <WizardField
                label="Vehicle"
                required
                hint="Awarding this bid dispatches the vehicle, so it has to be a real one."
              >
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {(vehicles.data?.items ?? []).map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.registrationNumber} · {vehicle.capacityTons}T
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </WizardField>

              <WizardField
                label="Driver"
                hint="Optional - the vehicle's assigned driver is used if you leave this blank."
              >
                <Input
                  value={driverId}
                  onChange={(event) => setDriverId(event.target.value)}
                  placeholder="Driver id (optional)"
                />
              </WizardField>

              {mustSource ? (
                <SourcedMaterialField
                  requirement={requirement}
                  materialId={sourceMaterialId}
                  onMaterialChange={setSourceMaterialId}
                  price={Number(price) || 0}
                  open={open}
                />
              ) : null}
            </>
          ) : null}

          {scope === RequirementBidScope.TRAVEL ? (
            <>
              <WizardField label="Vehicle you are offering" required>
                <Select value={offeredVehicleType} onValueChange={setOfferedVehicleType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      VehicleType.CAR,
                      VehicleType.SUV,
                      VehicleType.TAXI,
                      VehicleType.VAN,
                      VehicleType.TEMPO,
                      VehicleType.BUS,
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {humanizeEnum(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </WizardField>

              <WizardField
                label="Included in the price"
                htmlFor="bid-inclusions"
                hint="One per line. Pre-filled with what the customer asked for."
              >
                <Textarea
                  id="bid-inclusions"
                  value={inclusionsText}
                  onChange={(event) => setInclusionsText(event.target.value)}
                  rows={3}
                />
              </WizardField>

              <WizardField label="Not included" htmlFor="bid-exclusions" hint="One per line.">
                <Textarea
                  id="bid-exclusions"
                  value={exclusionsText}
                  onChange={(event) => setExclusionsText(event.target.value)}
                  rows={2}
                  placeholder={'Entry tickets\nMeals'}
                />
              </WizardField>

              <WizardField
                label="Itinerary outline"
                htmlFor="bid-itinerary"
                hint="Day by day, if it is a tour. This is what the customer compares on."
              >
                <Textarea
                  id="bid-itinerary"
                  value={itinerarySummary}
                  onChange={(event) => setItinerarySummary(event.target.value)}
                  rows={4}
                />
              </WizardField>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Switch
                    id="bid-driver"
                    checked={driverIncluded}
                    onCheckedChange={setDriverIncluded}
                  />
                  <label htmlFor="bid-driver" className="cursor-pointer text-sm font-medium">
                    Driver included
                  </label>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Switch id="bid-fuel" checked={fuelIncluded} onCheckedChange={setFuelIncluded} />
                  <label htmlFor="bid-fuel" className="cursor-pointer text-sm font-medium">
                    Fuel included
                  </label>
                </div>
              </div>
            </>
          ) : null}

          <WizardField label="Message to the customer" htmlFor="bid-message">
            <Textarea
              id="bid-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              placeholder="Anything that makes your offer easier to say yes to."
            />
          </WizardField>

          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={place.isPending}>
            <Gavel className="size-4" />
            {existing ? 'Revise bid' : 'Place bid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

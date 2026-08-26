import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package } from 'lucide-react';
import { toast } from 'sonner';
import { MaterialUnit, Permission, TruckType, formatCurrency, formatNumber, humanizeEnum } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { MaterialSummary, OrderSummary, Paginated, TransportMatch } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { UnauthorizedState, LoadingState, EmptyState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Post a transport requirement, then compare the transport VorldX Saarthi can find. */
export function NewOrderPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [materialId, setMaterialId] = React.useState('');
  const [quantity, setQuantity] = React.useState(20);
  const [capacity, setCapacity] = React.useState(20);
  const [truckType, setTruckType] = React.useState<string>('any');
  const [origin, setOrigin] = React.useState({ addressLine: '', latitude: 26.8351, longitude: 75.9843 });
  const [destination, setDestination] = React.useState({ addressLine: '', latitude: 28.4089, longitude: 77.0789 });
  const [notes, setNotes] = React.useState('');

  const materials = useQuery({
    queryKey: ['materials', 'available'],
    queryFn: () => api.get<Paginated<MaterialSummary>>('/marketplace/materials', { availableOnly: true, pageSize: 100 }),
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
    onError: (error) => toast.error('Could not post the requirement', { description: errorMessage(error) }),
  });

  if (!can(Permission.ORDERS_CREATE)) return <UnauthorizedState />;

  const valid = origin.addressLine.length > 2 && destination.addressLine.length > 2 && quantity > 0;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/orders')}>
        <ArrowLeft className="size-4" />All orders
      </Button>

      <PageHeader title="Post a transport requirement" description="Tell Saarthi what needs moving; verified fleets will quote for it." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader className="pb-3"><SectionHeader title="Requirement" /></CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="space-y-1.5">
              <Label>Material from the marketplace</Label>
              <Select value={materialId} onValueChange={setMaterialId}>
                <SelectTrigger><SelectValue placeholder="Optional — or move goods you already own" /></SelectTrigger>
                <SelectContent>
                  {(materials.data?.items ?? []).map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.name} · {formatCurrency(material.pricePerUnit)}/{humanizeEnum(material.unit).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  {selected.supplierName} · {formatNumber(selected.availableQuantity)} available · minimum {selected.minimumOrderQty}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required>Quantity</Label>
                <Input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label required>Truck capacity needed (tonnes)</Label>
                <Input type="number" min={1} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Body type</Label>
              <Select value={truckType} onValueChange={setTruckType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any suitable body</SelectItem>
                  {Object.values(TruckType).map((type) => (
                    <SelectItem key={type} value={type}>{humanizeEnum(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label required>Pickup address</Label>
              <Input value={origin.addressLine} onChange={(event) => setOrigin({ ...origin, addressLine: event.target.value })} placeholder="Bassi Industrial Area, Jaipur" />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" step="0.0001" value={origin.latitude} onChange={(event) => setOrigin({ ...origin, latitude: Number(event.target.value) })} aria-label="Pickup latitude" />
                <Input type="number" step="0.0001" value={origin.longitude} onChange={(event) => setOrigin({ ...origin, longitude: Number(event.target.value) })} aria-label="Pickup longitude" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label required>Delivery address</Label>
              <Input value={destination.addressLine} onChange={(event) => setDestination({ ...destination, addressLine: event.target.value })} placeholder="Sector 62, Gurugram" />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" step="0.0001" value={destination.latitude} onChange={(event) => setDestination({ ...destination, latitude: Number(event.target.value) })} aria-label="Delivery latitude" />
                <Input type="number" step="0.0001" value={destination.longitude} onChange={(event) => setDestination({ ...destination, longitude: Number(event.target.value) })} aria-label="Delivery longitude" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes for the fleet</Label>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Site access hours, weighbridge requirements…" />
            </div>

            <Button className="w-full" disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>
              <Package className="size-4" />Post requirement
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <SectionHeader title="Transport VorldX Saarthi can find" description="Ranked by distance, capacity fit, driver score and availability." />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {matches.isLoading ? (
              <LoadingState label="Finding transport…" />
            ) : (matches.data ?? []).length === 0 ? (
              <EmptyState title="No matching transport yet" description="No verified truck of this size is close enough right now. Posting the requirement still lets fleets quote." className="min-h-40 border-0" />
            ) : (
              (matches.data ?? []).map((match) => (
                <div key={match.truckId} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{match.registrationNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">{match.fleetName} · {match.capacityTons}T {humanizeEnum(match.truckType)}</p>
                    </div>
                    <Badge variant="default" className="tabular shrink-0">{match.matchScore}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{match.distanceToPickupKm} km away</span>
                    <span>~{match.estimatedPickupMinutes} min to pickup</span>
                    <span className="font-medium text-foreground">{formatCurrency(match.estimatedPrice)}</span>
                  </div>
                  {match.reasons.length > 0 ? (
                    <ul className="mt-2 space-y-0.5">
                      {match.reasons.map((reason) => (
                        <li key={reason} className="text-xs text-muted-foreground">• {reason}</li>
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

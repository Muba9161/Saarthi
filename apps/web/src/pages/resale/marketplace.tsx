import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Car, Filter, Gauge, MapPin, ShieldAlert, Store, X } from 'lucide-react';
import {
  Feature,
  Permission,
  VEHICLE_CONDITION_LABELS,
  VehicleCondition,
  VehicleType,
  formatRegistrationNumber,
  humanizeEnum,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import {
  EmptyState,
  ErrorState,
  FeatureLockedState,
  LoadingState,
  UnauthorizedState,
} from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ListingPhoto } from '@/features/resale/listing-photo';

/**
 * The used-vehicle marketplace.
 *
 * Every listing here is backed by a vehicle Saarthi has been recording, so the
 * odometer and condition are not seller claims typed into a classified advert.
 * That is the whole reason this exists inside the platform rather than beside
 * it, and the cards say so.
 */

interface MarketplaceListing {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  askingPrice: number;
  negotiable: boolean;
  condition: VehicleCondition;
  odometerKm: number;
  ownershipCount: number;
  accidentHistory: boolean;
  city: string | null;
  state: string | null;
  publishedAt: string | null;
  isOwnListing: boolean;
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    truckType: string;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    fuelType: string;
    capacityTons: number | null;
    passengerCapacity: number | null;
  };
  photoCount: number;
  coverPhotoId: string | null;
}

const PRICE_FORMAT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const KM_FORMAT = new Intl.NumberFormat('en-IN');

function ListingCard({ listing }: { listing: MarketplaceListing }) {
  const spec = [
    listing.vehicle.year ? String(listing.vehicle.year) : null,
    listing.vehicle.manufacturer,
    listing.vehicle.model,
  ]
    .filter(Boolean)
    .join(' ');

  const place = [listing.city, listing.state].filter(Boolean).join(', ');

  return (
    <Card variant="glass" className="overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lifted">
      <div className="relative aspect-[4/3] bg-muted">
        <ListingPhoto photoId={listing.coverPhotoId} alt={listing.title} />
        {listing.isOwnListing ? (
          <Badge variant="muted" size="sm" className="absolute left-2 top-2">
            Your listing
          </Badge>
        ) : null}
        {listing.photoCount > 1 ? (
          <Badge variant="muted" size="sm" className="absolute right-2 top-2">
            {listing.photoCount} photos
          </Badge>
        ) : null}
      </div>

      <CardContent className="space-y-2 p-3">
        <div className="space-y-0.5">
          <p className="truncate text-sm font-medium" title={listing.title}>
            {listing.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {spec || formatRegistrationNumber(listing.vehicle.registrationNumber)}
          </p>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-semibold">{PRICE_FORMAT.format(listing.askingPrice)}</span>
          {listing.negotiable ? (
            <span className="text-[11px] text-muted-foreground">Negotiable</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Fixed price</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" size="sm">
            {humanizeEnum(listing.vehicle.vehicleType)}
          </Badge>
          <Badge variant="muted" size="sm">
            {VEHICLE_CONDITION_LABELS[listing.condition]}
          </Badge>
          {listing.vehicle.capacityTons ? (
            <Badge variant="muted" size="sm">
              {listing.vehicle.capacityTons} t
            </Badge>
          ) : null}
          {listing.vehicle.passengerCapacity ? (
            <Badge variant="muted" size="sm">
              {listing.vehicle.passengerCapacity} seats
            </Badge>
          ) : null}
          {listing.accidentHistory ? (
            <Badge variant="warning" size="sm">
              Accident history
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Gauge className="size-3.5" />
            {KM_FORMAT.format(Math.round(listing.odometerKm))} km
          </span>
          {place ? (
            <span className="inline-flex items-center gap-1 truncate" title={place}>
              <MapPin className="size-3.5" />
              {place}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ResaleMarketplacePage() {
  const { can, hasFeature } = useAuth();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [vehicleType, setVehicleType] = React.useState('');
  const [condition, setCondition] = React.useState('');
  const [maxPrice, setMaxPrice] = React.useState('');
  const [maxOdometerKm, setMaxOdometerKm] = React.useState('');
  const [city, setCity] = React.useState('');
  const [sortBy, setSortBy] = React.useState('publishedAt');

  const allowed = can(Permission.RESALE_BROWSE);

  const listings = useQuery({
    queryKey: [
      'resale-marketplace',
      page,
      search,
      vehicleType,
      condition,
      maxPrice,
      maxOdometerKm,
      city,
      sortBy,
    ],
    queryFn: () =>
      api.get<Paginated<MarketplaceListing>>('/resale/listings', {
        page,
        pageSize: 24,
        sortBy,
        sortOrder: sortBy === 'askingPrice' || sortBy === 'odometerKm' ? 'asc' : 'desc',
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(vehicleType ? { vehicleType } : {}),
        ...(condition ? { condition } : {}),
        ...(maxPrice ? { maxPrice: Number(maxPrice) } : {}),
        ...(maxOdometerKm ? { maxOdometerKm: Number(maxOdometerKm) } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
      }),
    enabled: allowed && hasFeature(Feature.RESALE_MARKETPLACE),
    placeholderData: keepPreviousData,
  });

  if (!allowed) return <UnauthorizedState />;
  if (!hasFeature(Feature.RESALE_MARKETPLACE)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Vehicle marketplace" />
        <FeatureLockedState feature="Vehicle resale marketplace" requiredPlan="Pro" />
      </div>
    );
  }

  const items = listings.data?.items ?? [];
  const pagination = listings.data?.pagination;
  const hasFilters = Boolean(
    search || vehicleType || condition || maxPrice || maxOdometerKm || city,
  );

  const clear = (): void => {
    setSearch('');
    setVehicleType('');
    setCondition('');
    setMaxPrice('');
    setMaxOdometerKm('');
    setCity('');
    setPage(1);
  };

  const onFilterChange = <T,>(setter: (value: T) => void) => (value: T): void => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Marketplace"
        title="Vehicles for sale"
        description="Used trucks and passenger vehicles listed by Saarthi operators. Odometer and condition come from platform records, not seller claims."
        actions={
          pagination ? (
            <Badge variant="secondary" className="gap-1.5">
              <Store className="size-3.5" />
              {pagination.total} listed
            </Badge>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="marketplace-search">Search</Label>
            <Input
              id="marketplace-search"
              value={search}
              onChange={(event) => onFilterChange(setSearch)(event.target.value)}
              placeholder="Make, model or registration"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={vehicleType || 'ALL'}
              onValueChange={(value) => onFilterChange(setVehicleType)(value === 'ALL' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any type</SelectItem>
                {Object.values(VehicleType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanizeEnum(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Condition</Label>
            <Select
              value={condition || 'ALL'}
              onValueChange={(value) => onFilterChange(setCondition)(value === 'ALL' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any condition</SelectItem>
                {Object.values(VehicleCondition).map((value) => (
                  <SelectItem key={value} value={value}>
                    {VEHICLE_CONDITION_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="marketplace-price">Max price (₹)</Label>
            <Input
              id="marketplace-price"
              type="number"
              min={0}
              value={maxPrice}
              onChange={(event) => onFilterChange(setMaxPrice)(event.target.value)}
              placeholder="Any"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="marketplace-km">Max km</Label>
            <Input
              id="marketplace-km"
              type="number"
              min={0}
              value={maxOdometerKm}
              onChange={(event) => onFilterChange(setMaxOdometerKm)(event.target.value)}
              placeholder="Any"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="marketplace-city">City</Label>
            <Input
              id="marketplace-city"
              value={city}
              onChange={(event) => onFilterChange(setCity)(event.target.value)}
              placeholder="Anywhere"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Sort by</Label>
            <Select value={sortBy} onValueChange={onFilterChange(setSortBy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="publishedAt">Newest first</SelectItem>
                <SelectItem value="askingPrice">Lowest price</SelectItem>
                <SelectItem value="odometerKm">Lowest km</SelectItem>
                <SelectItem value="year">Newest model</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasFilters ? (
            <div className="flex items-end">
              <Button variant="outline" onClick={clear} className="w-full">
                <X className="size-4" />
                Clear
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {listings.isLoading ? (
        <LoadingState label="Loading listings…" />
      ) : listings.error ? (
        <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Filter : Car}
          title={hasFilters ? 'No vehicles match those filters' : 'Nothing listed for sale yet'}
          description={
            hasFilters
              ? 'Try widening the price or distance range.'
              : 'When an operator lists a vehicle it will appear here. You can list your own from a vehicle’s Sell tab.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            ) : (
              <Button variant="secondary" asChild>
                <Link to="/fleet/trucks">Go to my vehicles</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>

          {pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasPreviousPage}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasNextPage}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        Saarthi publishes what its own records show. Inspect any vehicle before buying — a listing
        is a starting point for a conversation, not a warranty.
      </p>
    </div>
  );
}

export default ResaleMarketplacePage;

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, MapPin, Search, ShieldCheck, Star, Users } from 'lucide-react';
import { Feature, Permission, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { PackageSummary } from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, FilterBar } from '@/components/common/page-header';
import {
  EmptyState,
  ErrorState,
  FeatureLockedState,
  LoadingState,
  UnauthorizedState,
} from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Stagger, StaggerItem } from '@/components/motion';

/**
 * Customer travel search.
 *
 * Same account, same shell, same navigation as the freight side — a customer
 * who buys sand and a customer who books a tour are the same person with the
 * same login, which is the whole premise of section 2 of the expansion spec.
 */

const SERVICE_KINDS = [
  'LOCAL_SIGHTSEEING',
  'INTERCITY',
  'MULTI_DAY_TOUR',
  'AIRPORT_TRANSFER',
  'PILGRIMAGE',
  'CUSTOM_TRIP',
] as const;

function PackageCard({ pkg }: { pkg: PackageSummary }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <Badge variant="secondary" size="sm">
              {humanizeEnum(pkg.serviceKind)}
            </Badge>
            <h3 className="truncate text-base font-semibold leading-snug">{pkg.title}</h3>
          </div>
          {pkg.ratingCount > 0 ? (
            <div className="flex shrink-0 items-center gap-1 text-sm">
              <Star className="h-3.5 w-3.5 fill-warning text-warning" />
              <span className="font-medium">{pkg.ratingAverage.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({pkg.ratingCount})</span>
            </div>
          ) : null}
        </div>

        <p className="line-clamp-2 text-sm text-muted-foreground">{pkg.summary}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {pkg.durationDays} day{pkg.durationDays === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            up to {pkg.maxPassengers}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            from {pkg.startLocation}
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {pkg.destinations.slice(0, 4).map((destination) => (
            <Badge key={destination} variant="outline" size="sm">
              {destination}
            </Badge>
          ))}
          {pkg.destinations.length > 4 ? (
            <Badge variant="outline" size="sm">
              +{pkg.destinations.length - 4}
            </Badge>
          ) : null}
        </div>

        <div className="mt-auto space-y-3 pt-1">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">
                {pkg.pricingModel === 'PER_PERSON' ? 'From, per person' : 'From'}
              </p>
              <p className="text-lg font-semibold">{formatCurrency(pkg.fromPrice)}</p>
              <p className="text-2xs text-muted-foreground">Includes the VorldX Saarthi booking fee</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p className="truncate font-medium text-foreground">
                {pkg.provider?.displayName ?? 'Saarthi provider'}
              </p>
              {pkg.provider?.verificationStatus === 'VERIFIED' ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <ShieldCheck className="h-3 w-3" /> Verified
                </span>
              ) : null}
            </div>
          </div>

          <Button asChild className="w-full">
            <Link to={`/travel/packages/${pkg.id}`}>View details</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TravelSearchPage() {
  const { can, hasFeature } = useAuth();
  const [destination, setDestination] = React.useState('');
  const [passengers, setPassengers] = React.useState('');
  const [serviceKind, setServiceKind] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'createdAt' | 'price' | 'rating' | 'duration'>(
    'createdAt',
  );
  const [page, setPage] = React.useState(1);

  // Debounced so typing a destination does not fire a query per keystroke.
  const [appliedDestination, setAppliedDestination] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedDestination(destination.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [destination]);

  const canBrowse = can(Permission.TRAVEL_BROWSE) || can(Permission.TRAVEL_PACKAGES_READ);

  const packages = useQuery({
    queryKey: ['travel', 'search', appliedDestination, passengers, serviceKind, sortBy, page],
    queryFn: () =>
      api.get<Paginated<PackageSummary>>('/travel/packages', {
        page,
        pageSize: 12,
        sortBy,
        sortOrder: sortBy === 'price' || sortBy === 'duration' ? 'asc' : 'desc',
        ...(appliedDestination ? { destination: appliedDestination } : {}),
        ...(passengers ? { passengers: Number(passengers) } : {}),
        ...(serviceKind ? { serviceKind } : {}),
      }),
    enabled: canBrowse && hasFeature(Feature.TRAVEL_BOOKINGS),
  });

  if (!canBrowse) return <UnauthorizedState />;
  if (!hasFeature(Feature.TRAVEL_BOOKINGS)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Travel" />
        <FeatureLockedState feature="Travel booking" requiredPlan="Basic" />
      </div>
    );
  }

  const hasFilters = Boolean(appliedDestination || passengers || serviceKind);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Travel"
        title="Find a trip"
        description="Taxis, intercity transfers and multi-day tours from verified Saarthi providers."
      />

      <FilterBar>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="destination">Where to</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="destination"
              className="pl-8"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Ayodhya, Nainital, airport…"
            />
          </div>
        </div>

        <div className="w-[130px] space-y-1.5">
          <Label htmlFor="passengers">Passengers</Label>
          <Input
            id="passengers"
            type="number"
            min={1}
            max={80}
            value={passengers}
            onChange={(event) => {
              setPassengers(event.target.value);
              setPage(1);
            }}
            placeholder="Any"
          />
        </div>

        <div className="w-[190px] space-y-1.5">
          <Label>Trip type</Label>
          <Select
            value={serviceKind || 'ALL'}
            onValueChange={(value) => {
              setServiceKind(value === 'ALL' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any type</SelectItem>
              {SERVICE_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {humanizeEnum(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[160px] space-y-1.5">
          <Label>Sort by</Label>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Newest</SelectItem>
              <SelectItem value="price">Price, lowest</SelectItem>
              <SelectItem value="rating">Best rated</SelectItem>
              <SelectItem value="duration">Shortest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      {packages.isLoading ? (
        <LoadingState label="Searching trips…" />
      ) : packages.error ? (
        <ErrorState error={packages.error} onRetry={() => void packages.refetch()} />
      ) : (packages.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={Search}
          title={hasFilters ? 'No trips match those filters' : 'No trips published yet'}
          description={
            hasFilters
              ? 'Try a wider search — fewer passengers, or any trip type.'
              : 'Travel providers publish packages here. Check back shortly.'
          }
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setDestination('');
                  setPassengers('');
                  setServiceKind('');
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {packages.data!.items.map((pkg) => (
              <StaggerItem key={pkg.id}>
                <PackageCard pkg={pkg} />
              </StaggerItem>
            ))}
          </Stagger>

          {packages.data!.pagination.totalPages > 1 ? (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {packages.data!.pagination.page} of {packages.data!.pagination.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= packages.data!.pagination.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default TravelSearchPage;

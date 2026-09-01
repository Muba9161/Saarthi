import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, Plane, Star, Users } from 'lucide-react';
import { Feature, Permission, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { PackageSummary, ProviderSummary } from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CreatePackageDialog } from '@/features/travel/create-package-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Provider package management.
 *
 * A provider profile is a capability on an existing organization, so this screen
 * sits inside the same fleet shell — a truck operator who starts running tours
 * does not change account, only what they sell.
 */

export function ProviderPackagesPage() {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);

  const canRead = can(Permission.TRAVEL_PACKAGES_READ);
  const canManage = can(Permission.TRAVEL_PACKAGES_MANAGE);

  const profile = useQuery({
    queryKey: ['travel', 'profile'],
    queryFn: () => api.get<ProviderSummary | null>('/travel/me/profile'),
    enabled: can(Permission.PROVIDER_READ),
  });

  const packages = useQuery({
    queryKey: ['travel', 'my-packages', page],
    queryFn: () => api.get<Paginated<PackageSummary>>('/travel/me/packages', { page, pageSize: 20 }),
    enabled: canRead && Boolean(profile.data),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/travel/me/packages/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['travel'] }),
  });

  if (!canRead) return <UnauthorizedState />;
  if (!hasFeature(Feature.TRAVEL_SERVICES)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Travel packages" />
        <FeatureLockedState feature="Travel and tours" requiredPlan="Basic" />
      </div>
    );
  }

  if (profile.isSuccess && !profile.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Saarthi Travel"
          title="Travel packages"
          description="Sell taxi transfers, intercity trips and multi-day tours alongside your existing business."
        />
        <EmptyState
          icon={Plane}
          title="Set up your provider profile first"
          description="Tell customers who you are, which services you offer and the cities you work from. Your vehicles, drivers and account stay exactly as they are — this only adds what you sell."
          action={
            can(Permission.PROVIDER_MANAGE) ? (
              <Button asChild>
                <Link to="/settings/profile">Open your profile</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const columns: Column<PackageSummary>[] = [
    {
      key: 'package',
      header: 'Package',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {humanizeEnum(row.serviceKind)} · {row.destinations.slice(0, 3).join(', ')}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge
          variant={
            row.status === 'PUBLISHED'
              ? 'success'
              : row.status === 'DRAFT'
                ? 'warning'
                : 'secondary'
          }
          size="sm"
        >
          {humanizeEnum(row.status)}
        </Badge>
      ),
    },
    {
      key: 'shape',
      header: 'Trip',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.durationDays}d · {humanizeEnum(row.vehicleType)} ·{' '}
          <Users className="inline h-3 w-3" /> {row.maxPassengers}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'From',
      numeric: true,
      cell: (row) => formatCurrency(row.fromPrice),
    },
    {
      key: 'demand',
      header: 'Demand',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm">
          <p>{row.bookingCount} booked</p>
          {row.ratingCount > 0 ? (
            <p className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground">
              <Star className="h-2.5 w-2.5 fill-warning text-warning" />
              {row.ratingAverage.toFixed(1)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'action',
      header: '',
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={`/travel/packages/${row.id}`}>
              <Eye className="h-3.5 w-3.5" />
              View
            </Link>
          </Button>
          {canManage ? (
            <Button
              variant="ghost"
              size="sm"
              loading={setStatus.isPending}
              onClick={() =>
                setStatus.mutate({
                  id: row.id,
                  status: row.status === 'PUBLISHED' ? 'PAUSED' : 'PUBLISHED',
                })
              }
            >
              {row.status === 'PUBLISHED' ? 'Pause' : 'Publish'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Travel"
        title="Travel packages"
        description="What you offer, and how it is performing."
        actions={can(Permission.TRAVEL_PACKAGES_MANAGE) ? <CreatePackageDialog /> : undefined}
      />

      {profile.data ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader title={profile.data.displayName} />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Services</p>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {profile.data.serviceTypes.map((type) => (
                  <Badge key={type} variant="secondary" size="sm">
                    {humanizeEnum(type)}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Rating</p>
              <p className="font-medium">
                {profile.data.ratingCount > 0
                  ? `${profile.data.ratingAverage.toFixed(1)} (${profile.data.ratingCount})`
                  : 'No reviews yet'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
              <p className="font-medium">{profile.data.bookingsCompleted} trips</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Published</p>
              <p className="font-medium">{profile.data.publishedPackages} packages</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {packages.data && packages.data.items.length === 0 ? (
        <EmptyState
          icon={Plane}
          title="No packages yet"
          description="Publish a trip and it becomes discoverable to every Saarthi customer searching for travel."
          action={can(Permission.TRAVEL_PACKAGES_MANAGE) ? <CreatePackageDialog /> : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={packages.data?.items}
          rowKey={(row) => row.id}
          isLoading={packages.isLoading}
          error={packages.error}
          pagination={packages.data?.pagination}
          onPageChange={setPage}
          emptyTitle="No packages"
          emptyDescription="Nothing published yet."
        />
      )}
    </div>
  );
}

export default ProviderPackagesPage;

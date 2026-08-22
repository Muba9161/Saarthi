import { useQuery } from '@tanstack/react-query';
import { Building2, LifeBuoy, ShieldCheck, Truck, Users } from 'lucide-react';
import { Permission, formatNumber, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCardsSkeleton } from '@/components/ui/skeleton';

export function AdminOverviewPage() {
  const { can } = useAuth();

  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get<any>('/admin/overview'),
    enabled: can(Permission.ADMIN_PLATFORM),
    refetchInterval: 60_000,
  });

  if (!can(Permission.ADMIN_PLATFORM)) return <UnauthorizedState />;

  const data = overview.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Platform overview" description="Saarthi operations across every tenant." />

      {overview.isLoading ? <StatCardsSkeleton /> : overview.error ? <ErrorState error={overview.error} onRetry={() => void overview.refetch()} /> : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Users" value={formatNumber(data.users)} icon={Users} />
            <StatCard label="Trucks" value={formatNumber(data.trucks)} icon={Truck} />
            <StatCard label="Active trips" value={formatNumber(data.activeTrips)} icon={Truck} />
            <StatCard label="Active SOS" value={formatNumber(data.activeSos)} icon={LifeBuoy} tone={data.activeSos > 0 ? 'destructive' : 'default'} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-3"><SectionHeader title="Organizations" /></CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                {Object.entries(data.organizations ?? {}).map(([type, count]) => (
                  <div key={type} className="flex justify-between"><span className="text-muted-foreground">{humanizeEnum(type)}</span><span className="tabular font-medium">{String(count)}</span></div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><SectionHeader title="Verification queue" /></CardHeader>
              <CardContent className="pt-0">
                <p className="tabular text-3xl font-semibold">{data.pendingVerifications}</p>
                <p className="text-xs text-muted-foreground">submissions waiting for review</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><SectionHeader title="Providers" description="What this environment is wired to." /></CardHeader>
              <CardContent className="space-y-1.5 pt-0 text-sm">
                {Object.entries(data.platform?.providers ?? {}).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{humanizeEnum(name)}</span>
                    <Badge variant={String(value) === 'production' ? 'success' : 'muted'} size="sm">{String(value)}</Badge>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">Realtime clients</span>
                  <span className="tabular font-medium">{data.platform?.realtimeClients ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Demo mode</span>
                  <Badge variant={data.platform?.demoMode ? 'warning' : 'success'} size="sm">{data.platform?.demoMode ? 'on' : 'off'}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
      {void [Building2, ShieldCheck, LoadingState]}
    </div>
  );
}

export default AdminOverviewPage;

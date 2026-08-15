import { useQuery } from '@tanstack/react-query';
import { Feature } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { DriverScoreDetail } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, FeatureLockedState, LoadingState } from '@/components/common/states';
import { ScoreBreakdown } from '@/features/drivers/score-breakdown';

export function DriverScorePage() {
  const { session, hasFeature } = useAuth();
  const driverId = session?.driver?.id;

  const score = useQuery({
    queryKey: ['driver', driverId, 'score'],
    queryFn: () => api.get<DriverScoreDetail>(`/drivers/${driverId}/score`),
    enabled: Boolean(driverId) && hasFeature(Feature.DRIVER_SCORING),
  });

  if (!driverId) return <EmptyState title="No driver profile" description="This account is not linked to a driver profile." />;
  if (!hasFeature(Feature.DRIVER_SCORING)) {
    return (<div className="space-y-5"><PageHeader title="My score" /><FeatureLockedState feature="Driver scoring" requiredPlan="Pro" /></div>);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="My score" description="Every point is explained — nothing is hidden from you." />
      {score.isLoading ? <LoadingState /> : score.data ? <ScoreBreakdown score={score.data} driverId={driverId} /> : null}
    </div>
  );
}

export default DriverScorePage;

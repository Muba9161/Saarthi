import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award, Route as RouteIcon, ShieldCheck, TrendingUp } from 'lucide-react';
import { Feature, Permission, formatDistanceKm, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { DriverScoreDetail, DriverSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DemoVerifyButton } from '@/features/verification/demo-verify-button';
import { StatCard } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, FeatureLockedState, LoadingState } from '@/components/common/states';
import { ScoreBreakdown } from '@/features/drivers/score-breakdown';
import { DocumentPanel } from '@/features/documents/document-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AchievementRow {
  code: string;
  earned: boolean;
  progress: number;
  earnedAt: string | null;
}

export function DriverDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, hasFeature } = useAuth();

  const driver = useQuery({
    queryKey: ['driver', id],
    queryFn: () => api.get<DriverSummary>(`/drivers/${id}`),
    enabled: Boolean(id),
  });

  const score = useQuery({
    queryKey: ['driver', id, 'score'],
    queryFn: () => api.get<DriverScoreDetail>(`/drivers/${id}/score`),
    enabled: Boolean(id) && hasFeature(Feature.DRIVER_SCORING) && can(Permission.DRIVERS_SCORE_READ),
  });

  const achievements = useQuery({
    queryKey: ['driver', id, 'achievements'],
    queryFn: () => api.get<AchievementRow[]>(`/drivers/${id}/achievements`),
    enabled: Boolean(id) && hasFeature(Feature.DRIVER_ACHIEVEMENTS),
  });

  if (driver.isLoading) return <LoadingState label="Loading driver…" />;
  if (driver.error) return <ErrorState error={driver.error} onRetry={() => void driver.refetch()} />;
  if (!driver.data) return <EmptyState title="Driver not found" />;

  const person = driver.data;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/fleet/drivers')}>
        <ArrowLeft className="size-4" />
        All drivers
      </Button>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {person.fullName}
            <StatusBadge status={person.availability} />
            <StatusBadge status={person.verificationStatus} size="sm" />
          </span>
        }
        description={`${person.email}${person.phone ? ` · ${person.phone}` : ''}`}
        actions={
          <DemoVerifyButton
            subjectType="driver"
            subjectId={person.id}
            verified={person.verificationStatus === 'VERIFIED'}
            invalidateKeys={[['driver', person.id], ['drivers']]}
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Driver score"
          value={person.overallScore ?? '—'}
          icon={ShieldCheck}
          tone={
            person.overallScore === null
              ? 'default'
              : person.overallScore >= 85
                ? 'success'
                : person.overallScore >= 70
                  ? 'default'
                  : 'warning'
          }
          hint={score.data ? humanizeEnum(score.data.band) : undefined}
        />
        <StatCard label="Completed trips" value={person.totalTrips} icon={RouteIcon} />
        <StatCard
          label="Distance driven"
          value={formatDistanceKm(person.totalDistanceKm)}
          icon={TrendingUp}
        />
        <StatCard
          label="Experience"
          value={`${person.experienceYears} yr`}
          icon={Award}
          hint={person.currentTruck ? `Driving ${person.currentTruck.registrationNumber}` : 'No truck assigned'}
        />
      </div>

      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="achievements">Achievements</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="performance">
          {!hasFeature(Feature.DRIVER_SCORING) ? (
            <FeatureLockedState feature="Driver scoring" requiredPlan="Pro" />
          ) : score.isLoading ? (
            <LoadingState />
          ) : score.data ? (
            <ScoreBreakdown score={score.data} driverId={id} />
          ) : null}
        </TabsContent>

        <TabsContent value="achievements">
          {!hasFeature(Feature.DRIVER_ACHIEVEMENTS) ? (
            <FeatureLockedState feature="Driver achievements" requiredPlan="Pro" />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Career badges"
                  description="Earned from recorded operational facts, never awarded manually."
                />
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2">
                {(achievements.data ?? []).map((achievement) => (
                  <div
                    key={achievement.code}
                    className={`rounded-lg border p-3 ${
                      achievement.earned ? 'border-success/30 bg-success/5' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{humanizeEnum(achievement.code)}</p>
                      {achievement.earned ? (
                        <Badge variant="success" size="sm">
                          Earned
                        </Badge>
                      ) : (
                        <span className="tabular text-xs text-muted-foreground">
                          {Math.round(achievement.progress * 100)}%
                        </span>
                      )}
                    </div>
                    {!achievement.earned ? (
                      <Progress value={achievement.progress * 100} className="mt-2 h-1.5" />
                    ) : achievement.earnedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(achievement.earnedAt).toLocaleDateString('en-IN')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documents">
          <DocumentPanel ownerType="DRIVER" ownerId={id} ownerLabel={person.fullName} />
        </TabsContent>
      </Tabs>

      {person.currentTruck ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Assigned truck</p>
              <Link
                to={`/fleet/trucks/${person.currentTruck.id}`}
                className="text-sm font-medium hover:underline"
              >
                {person.currentTruck.registrationNumber}
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default DriverDetailPage;

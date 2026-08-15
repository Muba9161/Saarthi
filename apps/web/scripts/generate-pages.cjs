/* eslint-disable */
/** Generator for the remaining page modules. Run once, then edit files directly. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'src', 'pages');
const files = {};

files['sos/incident-detail.tsx'] = `import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Phone, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Permission, RealtimeChannel, RealtimeEvent, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { SosIncidentDetail } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { FleetMap } from '@/features/maps/fleet-map';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function SosIncidentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can, session } = useAuth();
  const queryClient = useQueryClient();
  const [resolution, setResolution] = React.useState('');

  useChannels(id ? [RealtimeChannel.sos(id)] : []);

  const incident = useQuery({
    queryKey: ['sos', id],
    queryFn: () => api.get<SosIncidentDetail>(\`/sos/\${id}\`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  useRealtimeEvent(RealtimeEvent.SOS_UPDATED, (message) => {
    if (message.payload.incidentId === id) void queryClient.invalidateQueries({ queryKey: ['sos', id] });
  });

  const respond = useMutation({
    mutationFn: (action: string) => api.post(\`/sos/\${id}/respond\`, { action }),
    onSuccess: () => { toast.success('Response recorded'); void queryClient.invalidateQueries({ queryKey: ['sos', id] }); },
    onError: (error) => toast.error('Could not respond', { description: errorMessage(error) }),
  });

  const resolve = useMutation({
    mutationFn: () => api.post(\`/sos/\${id}/resolve\`, { resolutionNote: resolution }),
    onSuccess: () => { toast.success('Incident resolved'); void queryClient.invalidateQueries({ queryKey: ['sos'] }); },
    onError: (error) => toast.error('Could not resolve', { description: errorMessage(error) }),
  });

  if (incident.isLoading) return <LoadingState label="Loading incident…" />;
  if (incident.error) return <ErrorState error={incident.error} onRetry={() => void incident.refetch()} />;
  if (!incident.data) return <EmptyState title="Incident not found" />;

  const data = incident.data;
  const isResolved = data.status === 'RESOLVED' || data.status === 'CANCELLED';
  const myResponder = data.responders.find((responder) => responder.driverId === session?.driver?.id);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/sos')}><ArrowLeft className="size-4" />All incidents</Button>

      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2.5">{data.reference}<StatusBadge status={data.status} /><StatusBadge status={data.type} size="sm" /></span>}
        description={data.description ?? \`\${humanizeEnum(data.type)} emergency reported \${relativeTimeFrom(data.triggeredAt)}\`}
      />

      {!isResolved ? (
        <Alert variant="warning">
          <ShieldCheck className="size-4" />
          <AlertTitle>Peer assistance, not an emergency service</AlertTitle>
          <AlertDescription>
            Saarthi alerts nearby drivers who may be able to help. For medical or police emergencies, call the official
            emergency numbers directly — 112 in India.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <FleetMap
            markers={[{ id: 'incident', latitude: data.latitude, longitude: data.longitude, label: data.address ?? data.reference, kind: 'incident' }]}
            trucks={data.responders.filter((responder) => responder.sameFleet).map((responder) => ({
              id: responder.truckId, registrationNumber: responder.registrationNumber,
              latitude: data.latitude, longitude: data.longitude, status: 'AVAILABLE', speedKph: 0, heading: 0,
            }))}
            height="340px"
          />

          <Card>
            <CardHeader className="pb-3"><SectionHeader title={\`Responders (\${data.responderCount})\`} description="Nearby Saarthi trucks alerted in expanding rings." /></CardHeader>
            <CardContent className="space-y-2 pt-0">
              {data.responders.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No responders were within range.</p>
              ) : data.responders.map((responder) => (
                <div key={responder.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{responder.registrationNumber}</p>
                    <p className="truncate text-xs text-muted-foreground">{responder.driverName} · {responder.distanceKm} km away</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {responder.driverPhone ? (
                      <Button size="icon-sm" variant="outline" asChild aria-label="Call responder">
                        <a href={\`tel:\${responder.driverPhone}\`}><Phone className="size-4" /></a>
                      </Button>
                    ) : null}
                    <StatusBadge status={responder.status} size="sm" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {myResponder && !isResolved ? (
            <Card>
              <CardHeader className="pb-3"><SectionHeader title="Can you help?" /></CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {myResponder.status === 'NOTIFIED' ? (
                  <>
                    <Button className="flex-1" loading={respond.isPending} onClick={() => respond.mutate('ACKNOWLEDGE')}>I am going</Button>
                    <Button variant="outline" className="flex-1" onClick={() => respond.mutate('DECLINE')}>Cannot help</Button>
                  </>
                ) : myResponder.status === 'ACKNOWLEDGED' ? (
                  <Button className="w-full" loading={respond.isPending} onClick={() => respond.mutate('ARRIVED')}>I have arrived</Button>
                ) : myResponder.status === 'ARRIVED' ? (
                  <Button className="w-full" variant="success" loading={respond.isPending} onClick={() => respond.mutate('COMPLETE')}>Assistance complete</Button>
                ) : <StatusBadge status={myResponder.status} />}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3"><SectionHeader title="Timeline" /></CardHeader>
            <CardContent className="pt-0">
              <ol className="relative space-y-3 border-l border-border pl-5">
                {data.events.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-destructive" />
                    <p className="text-sm">{event.description ?? humanizeEnum(event.eventType)}</p>
                    <p className="text-xs text-muted-foreground">{relativeTimeFrom(event.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {!isResolved && can(Permission.SOS_MANAGE, Permission.SOS_TRIGGER) ? (
            <Card>
              <CardHeader className="pb-3"><SectionHeader title="Resolve incident" /></CardHeader>
              <CardContent className="space-y-3 pt-0">
                <Textarea rows={3} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="What happened and how it was resolved." />
                <Button className="w-full" disabled={resolution.trim().length < 5} loading={resolve.isPending} onClick={() => resolve.mutate()}>Mark resolved</Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default SosIncidentDetailPage;
`;

files['driver/sos.tsx'] = `import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LifeBuoy, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { SosType, humanizeEnum } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const TYPES = [SosType.BREAKDOWN, SosType.TYRE, SosType.FUEL, SosType.MEDICAL, SosType.ACCIDENT, SosType.SECURITY, SosType.OTHER];

/** One-tap SOS. Large targets, minimal steps, no scrolling to reach the button. */
export function DriverSosPage() {
  const navigate = useNavigate();
  const [type, setType] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState('');
  const [position, setPosition] = React.useState<{ latitude: number; longitude: number } | null>(null);

  React.useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (result) => setPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const trigger = useMutation({
    mutationFn: () => {
      if (!position) throw new Error('Waiting for your location. Enable location access and try again.');
      return api.post<{ id: string }>('/sos', { type, latitude: position.latitude, longitude: position.longitude, ...(description ? { description } : {}) });
    },
    onSuccess: (incident) => {
      toast.success('Help is being called', { description: 'Nearby Saarthi drivers are being alerted.' });
      navigate(\`/driver/sos/\${incident.id}\`);
    },
    onError: (error) => toast.error('Could not raise the SOS', { description: errorMessage(error) }),
  });

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader title="Emergency help" description="Tell us what happened. Nearby Saarthi drivers will be alerted." />

      <Alert variant="destructive">
        <Phone className="size-4" />
        <AlertTitle>For a life-threatening emergency, call 112 first</AlertTitle>
        <AlertDescription>Saarthi alerts nearby drivers who may be able to help. It does not replace emergency services.</AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3">
        {TYPES.map((entry) => (
          <Button key={entry} size="xl" variant={type === entry ? 'destructive' : 'outline'} className="h-20 flex-col gap-1" onClick={() => setType(entry)}>
            <LifeBuoy className="size-5" />
            <span className="text-sm">{humanizeEnum(entry)}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Anything that helps the person coming to you (optional)." />
          <p className="text-xs text-muted-foreground">
            {position ? \`Location ready: \${position.latitude.toFixed(4)}, \${position.longitude.toFixed(4)}\` : 'Getting your location…'}
          </p>
          <Button size="xl" variant="destructive" className="w-full" disabled={!type || !position} loading={trigger.isPending} onClick={() => trigger.mutate()}>
            <LifeBuoy className="size-5" />Send SOS now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default DriverSosPage;
`;

files['driver/home.tsx'] = `import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LifeBuoy, MapPin, Navigation, Play } from 'lucide-react';
import { toast } from 'sonner';
import { RealtimeChannel, TripStatus, formatDistanceKm, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { TripSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels } from '@/hooks/use-realtime';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, LoadingState } from '@/components/common/states';
import { StatusBadge, ScoreBadge } from '@/components/common/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/** Driver home: current trip, big actions, one-tap SOS. */
export function DriverHomePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const driverId = session?.driver?.id;

  useChannels(driverId ? [RealtimeChannel.driver(driverId)] : []);

  const trip = useQuery({
    queryKey: ['trips', 'current'],
    queryFn: () => api.get<TripSummary | null>('/trips/current'),
    refetchInterval: 30_000,
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TripStatus }) => api.post(\`/trips/\${id}/transition\`, { status }),
    onSuccess: () => { toast.success('Trip updated'); void queryClient.invalidateQueries({ queryKey: ['trips'] }); },
    onError: (error) => toast.error('Could not update the trip', { description: errorMessage(error) }),
  });

  const current = trip.data;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={\`Hello, \${session?.user.firstName}\`}
        description={current ? 'Your current trip' : 'No trip assigned right now'}
        actions={<Button variant="destructive" size="lg" onClick={() => navigate('/driver/sos')}><LifeBuoy className="size-5" />SOS</Button>}
      />

      {session?.driver ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Your score</p>
              <div className="mt-1 flex items-center gap-2"><ScoreBadge score={session.driver.overallScore} /><Link to="/driver/score" className="text-sm text-primary hover:underline">See breakdown</Link></div>
            </div>
            <StatusBadge status={session.driver.verificationStatus} />
          </CardContent>
        </Card>
      ) : null}

      {trip.isLoading ? <LoadingState /> : !current ? (
        <EmptyState icon={Navigation} title="No active trip" description="Your fleet will assign your next trip here." />
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{current.reference}</p>
                <p className="text-sm text-muted-foreground">{current.truck?.registrationNumber}</p>
              </div>
              <StatusBadge status={current.status} />
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 size-4 shrink-0 text-success" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Pickup</p><p className="text-sm font-medium">{current.originAddress}</p></div></div>
              <div className="flex items-start gap-2.5"><MapPin className="mt-0.5 size-4 shrink-0 text-destructive" /><div className="min-w-0"><p className="text-xs text-muted-foreground">Delivery</p><p className="text-sm font-medium">{current.destinationAddress}</p></div></div>
            </div>

            <div>
              <Progress value={current.progressPercent} className="h-2" />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span className="tabular">{current.progressPercent}% · {formatDistanceKm(current.actualDistanceKm)}</span>
                {current.etaAt ? <span className="flex items-center gap-1"><Clock className="size-3" />ETA {relativeTimeFrom(current.etaAt)}</span> : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {current.status === TripStatus.ASSIGNED ? (
                <Button size="lg" className="flex-1" loading={transition.isPending} onClick={() => transition.mutate({ id: current.id, status: TripStatus.STARTED })}><Play className="size-5" />Start trip</Button>
              ) : null}
              {current.status === TripStatus.IN_TRANSIT || current.status === TripStatus.STARTED ? (
                <Button size="lg" className="flex-1" loading={transition.isPending} onClick={() => transition.mutate({ id: current.id, status: TripStatus.ARRIVED })}>I have arrived</Button>
              ) : null}
              {current.status === TripStatus.ARRIVED ? (
                <Button size="lg" variant="success" className="flex-1" loading={transition.isPending} onClick={() => transition.mutate({ id: current.id, status: TripStatus.COMPLETED })}>Complete delivery</Button>
              ) : null}
              <Button size="lg" variant="outline" onClick={() => navigate('/driver/nearby')}><MapPin className="size-5" />Nearby</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {void humanizeEnum}
    </div>
  );
}

export default DriverHomePage;
`;

files['driver/score.tsx'] = `import { useQuery } from '@tanstack/react-query';
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
    queryFn: () => api.get<DriverScoreDetail>(\`/drivers/\${driverId}/score\`),
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
`;

files['driver/documents.tsx'] = `import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/states';
import { DocumentPanel } from '@/features/documents/document-panel';

export function DriverDocumentsPage() {
  const { session } = useAuth();
  const driverId = session?.driver?.id;

  if (!driverId) {
    return <EmptyState title="No driver profile" description="This account is not linked to a driver profile." />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="My documents" description="Keep your licence and identity documents current to stay compliant." />
      <DocumentPanel ownerType="DRIVER" ownerId={driverId} ownerLabel={session?.user.fullName} />
    </div>
  );
}

export default DriverDocumentsPage;
`;

files['settings/settings.tsx'] = `import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { humanizeEnum } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export function SettingsPage() {
  const { session, refreshSession } = useAuth();
  const [firstName, setFirstName] = React.useState(session?.user.firstName ?? '');
  const [lastName, setLastName] = React.useState(session?.user.lastName ?? '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/auth/me', { firstName, lastName }),
    onSuccess: async () => { toast.success('Profile updated'); await refreshSession(); },
    onError: (error) => toast.error('Could not save', { description: errorMessage(error) }),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => { toast.success('Password changed', { description: 'Other devices have been signed out.' }); setCurrentPassword(''); setNewPassword(''); },
    onError: (error) => toast.error('Could not change password', { description: errorMessage(error) }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" description="Your profile, security and organization." />

      <Card>
        <CardHeader className="pb-3"><SectionHeader title="Profile" /></CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>First name</Label><Input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Last name</Label><Input value={lastName} onChange={(event) => setLastName(event.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={session?.user.email ?? ''} disabled /></div>
          <Button loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save profile</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><SectionHeader title="Password" description="Changing your password signs out every other device." /></CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="space-y-1.5"><Label>Current password</Label><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></div>
          <div className="space-y-1.5"><Label>New password</Label><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></div>
          <Button disabled={!currentPassword || newPassword.length < 10} loading={changePassword.isPending} onClick={() => changePassword.mutate()}>Change password</Button>
        </CardContent>
      </Card>

      {session?.organization ? (
        <Card>
          <CardHeader className="pb-3"><SectionHeader title="Organization" /></CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{session.organization.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{humanizeEnum(session.organization.type)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Your role</span><span>{humanizeEnum(session.organization.membershipRole)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Verification</span><Badge variant={session.organization.verificationStatus === 'VERIFIED' ? 'success' : 'warning'} size="sm">{humanizeEnum(session.organization.verificationStatus)}</Badge></div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default SettingsPage;
`;

files['settings/subscription.tsx'] = `import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { FEATURE_CATALOGUE, PLAN_CATALOGUE, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function SubscriptionPage() {
  const { session } = useAuth();

  const subscription = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get<any>('/organizations/current/subscription'),
    enabled: Boolean(session?.organization),
  });

  const currentTier = session?.subscription?.planTier;
  const held = new Set(session?.subscription?.features ?? []);

  return (
    <div className="space-y-5">
      <PageHeader title="Subscription" description="What your plan includes, and what the next tier unlocks." />

      {subscription.isLoading ? <LoadingState /> : (
        <div className="grid gap-4 lg:grid-cols-4">
          {PLAN_CATALOGUE.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            return (
              <Card key={plan.tier} className={cn(isCurrent && 'border-primary ring-1 ring-primary')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {isCurrent ? <Badge variant="default" size="sm">Current</Badge> : null}
                  </div>
                  <p className="text-2xl font-semibold">
                    {plan.priceMonthly === null ? 'Custom' : formatCurrency(plan.priceMonthly)}
                    {plan.priceMonthly !== null ? <span className="text-sm font-normal text-muted-foreground">/month</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{plan.description}</p>
                </CardHeader>
                <CardContent className="space-y-1.5 pt-0">
                  {plan.features.slice(0, 10).map((feature) => {
                    const definition = FEATURE_CATALOGUE.find((entry) => entry.key === feature);
                    return (
                      <p key={feature} className={cn('flex items-start gap-1.5 text-xs', held.has(feature) ? 'text-foreground' : 'text-muted-foreground')}>
                        <Check className="mt-0.5 size-3 shrink-0" />
                        {definition?.name ?? humanizeEnum(feature)}
                      </p>
                    );
                  })}
                  {plan.features.length > 10 ? <p className="text-xs text-muted-foreground">+{plan.features.length - 10} more</p> : null}
                  <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                    <p>{plan.limits.maxTrucks === null ? 'Unlimited trucks' : \`Up to \${plan.limits.maxTrucks} trucks\`}</p>
                    <p>{plan.limits.trackingHistoryDays} days of tracking history</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Plan changes run through the payment provider abstraction. Locally this uses the mock provider, so no real
        payment is taken.
      </p>
    </div>
  );
}

export default SubscriptionPage;
`;

files['admin/overview.tsx'] = `import { useQuery } from '@tanstack/react-query';
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Users" value={formatNumber(data.users)} icon={Users} />
            <StatCard label="Trucks" value={formatNumber(data.trucks)} icon={Truck} />
            <StatCard label="Active trips" value={formatNumber(data.activeTrips)} icon={Truck} />
            <StatCard label="Active SOS" value={formatNumber(data.activeSos)} icon={LifeBuoy} tone={data.activeSos > 0 ? 'destructive' : 'default'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
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
`;

for (const [file, content] of Object.entries(files)) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log('wrote', file);
}

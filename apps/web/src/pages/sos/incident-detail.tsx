import * as React from 'react';
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
    queryFn: () => api.get<SosIncidentDetail>(`/sos/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  useRealtimeEvent(RealtimeEvent.SOS_UPDATED, (message) => {
    if (message.payload.incidentId === id) void queryClient.invalidateQueries({ queryKey: ['sos', id] });
  });

  const respond = useMutation({
    mutationFn: (action: string) => api.post(`/sos/${id}/respond`, { action }),
    onSuccess: () => { toast.success('Response recorded'); void queryClient.invalidateQueries({ queryKey: ['sos', id] }); },
    onError: (error) => toast.error('Could not respond', { description: errorMessage(error) }),
  });

  const resolve = useMutation({
    mutationFn: () => api.post(`/sos/${id}/resolve`, { resolutionNote: resolution }),
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
        description={data.description ?? `${humanizeEnum(data.type)} emergency reported ${relativeTimeFrom(data.triggeredAt)}`}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <FleetMap
            markers={[{ id: 'incident', latitude: data.latitude, longitude: data.longitude, label: data.address ?? data.reference, kind: 'incident' }]}
            trucks={data.responders.filter((responder) => responder.sameFleet).map((responder) => ({
              id: responder.truckId, registrationNumber: responder.registrationNumber,
              latitude: data.latitude, longitude: data.longitude, status: 'AVAILABLE', speedKph: 0, heading: 0,
            }))}
            height="340px"
            allow3D
          />

          <Card>
            <CardHeader className="pb-3"><SectionHeader title={`Responders (${data.responderCount})`} description="Nearby Saarthi trucks alerted in expanding rings." /></CardHeader>
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
                        <a href={`tel:${responder.driverPhone}`}><Phone className="size-4" /></a>
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

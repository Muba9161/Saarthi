import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Siren,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { Permission, humanizeEnum } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import type { AssociationAlertDetail } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { FleetMap, type MapMarkerPoint } from '@/features/maps';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * One emergency, as the association sees it.
 *
 * The screen is built around a single idea: contact details are sealed until
 * somebody takes the case. Before acknowledgement the driver's name and number
 * are absent from the API response entirely, and the UI says so plainly rather
 * than showing empty fields. Acknowledging is a named, audited act — which is
 * what turns "an association can browse driver phone numbers" into "the
 * responder who took this case can call the driver".
 */

const SEVERITY_TONE = {
  CRITICAL: 'destructive',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export function AssociationAlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [note, setNote] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [escalation, setEscalation] = React.useState('');
  const [responderKind, setResponderKind] = React.useState<'MEMBER' | 'EXTERNAL'>('EXTERNAL');
  const [responderName, setResponderName] = React.useState('');
  const [responderPhone, setResponderPhone] = React.useState('');
  const [responderOrg, setResponderOrg] = React.useState('');
  const [responderEta, setResponderEta] = React.useState('');
  const [actionError, setActionError] = React.useState<string | null>(null);

  const canRespond = can(Permission.ASSOCIATION_ALERTS_RESPOND);

  const alert = useQuery({
    queryKey: ['association', 'alert', id],
    queryFn: () => api.get<AssociationAlertDetail>(`/associations/alerts/${id}`),
    enabled: Boolean(id) && can(Permission.ASSOCIATION_ALERTS_READ),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['association'] });
  }

  function onError(error: unknown) {
    setActionError(
      error instanceof ApiError ? error.message : 'That action could not be completed.',
    );
  }

  const acknowledge = useMutation({
    mutationFn: () =>
      api.post(`/associations/alerts/${id}/acknowledge`, { note: note.trim() || undefined }),
    onSuccess: () => {
      setNote('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const assignResponder = useMutation({
    mutationFn: () =>
      api.post(`/associations/alerts/${id}/responders`, {
        kind: responderKind,
        name: responderName.trim() || undefined,
        phone: responderPhone.trim() || undefined,
        organisation: responderOrg.trim() || undefined,
        etaMinutes: responderEta ? Number(responderEta) : undefined,
      }),
    onSuccess: () => {
      setResponderName('');
      setResponderPhone('');
      setResponderOrg('');
      setResponderEta('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const addNote = useMutation({
    mutationFn: () => api.post(`/associations/alerts/${id}/notes`, { note: note.trim() }),
    onSuccess: () => {
      setNote('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const escalate = useMutation({
    mutationFn: () =>
      api.post(`/associations/alerts/${id}/escalate`, { reason: escalation.trim() }),
    onSuccess: () => {
      setEscalation('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  const resolve = useMutation({
    mutationFn: () =>
      api.post(`/associations/alerts/${id}/resolve`, {
        outcome: outcome.trim(),
        assistanceProvided: true,
      }),
    onSuccess: () => {
      setOutcome('');
      setActionError(null);
      invalidate();
    },
    onError,
  });

  if (!can(Permission.ASSOCIATION_ALERTS_READ)) return <UnauthorizedState />;
  if (alert.isLoading) return <LoadingState label="Loading the alert…" />;
  if (alert.error) return <ErrorState error={alert.error} onRetry={() => void alert.refetch()} />;
  if (!alert.data) return <ErrorState error={new Error('Alert not found')} />;

  const data = alert.data;
  const acknowledged = data.status !== 'NOTIFIED';
  const closed = data.status === 'RESOLVED' || data.status === 'CLOSED';

  const markers: MapMarkerPoint[] = [
    {
      id: data.id,
      latitude: data.latitude,
      longitude: data.longitude,
      label: data.vehicleRegistration ?? 'Incident',
      kind: 'incident',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/association" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Emergency queue
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {humanizeEnum(data.incidentType)}
            <Badge variant={SEVERITY_TONE[data.severity]} size="sm">
              {data.severity.toLowerCase()}
            </Badge>
            <Badge variant={closed ? 'success' : 'info'} size="sm">
              {humanizeEnum(data.status)}
            </Badge>
          </span>
        }
        description={`${data.reference} · raised ${new Date(data.notifiedAt).toLocaleString('en-IN')}`}
        actions={
          canRespond && !acknowledged ? (
            <Button
              onClick={() => acknowledge.mutate()}
              loading={acknowledge.isPending}
              className="gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              Acknowledge and take this case
            </Button>
          ) : null
        }
      />

      {actionError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">{actionError}</CardContent>
        </Card>
      ) : null}

      {!acknowledged ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Siren className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                Waiting {data.ageMinutes} minute{data.ageMinutes === 1 ? '' : 's'} for
                acknowledgement
              </p>
              <p className="text-muted-foreground">
                The driver&rsquo;s name and phone number are withheld until someone acknowledges
                this alert. Acknowledging records who took the case and unseals their contact
                details so you can call them.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <FleetMap markers={markers} height="320px" autoFit />
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Incident" />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</p>
                <p className="font-medium">{data.vehicleRegistration ?? 'Not reported'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
                <p className="font-medium">
                  {data.vehicleType ? humanizeEnum(data.vehicleType) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Fleet</p>
                <p className="font-medium">{data.fleetName ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">District</p>
                <p className="font-medium">{data.district ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  From coverage centre
                </p>
                <p className="font-medium">
                  {data.distanceKm === null ? '—' : `${data.distanceKm} km`}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Location</p>
                <p className="font-medium">
                  {data.latitude.toFixed(4)}, {data.longitude.toFixed(4)}
                </p>
              </div>
              {data.address ? (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Address</p>
                  <p className="font-medium">{data.address}</p>
                </div>
              ) : null}
              {data.description ? (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Driver&rsquo;s description
                  </p>
                  <p>{data.description}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Activity" description="Every action on this alert, in order." />
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-3">
                {data.events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{humanizeEnum(event.eventType)}</p>
                      {event.description ? (
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Contact" />
            </CardHeader>
            <CardContent className="space-y-3 pt-0 text-sm">
              {acknowledged ? (
                <>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Driver</p>
                    <p className="font-medium">{data.driverName ?? 'Not reported'}</p>
                  </div>
                  {data.driverPhone ? (
                    <Button asChild variant="secondary" className="w-full gap-1.5">
                      <a href={`tel:${data.driverPhone}`}>
                        <Phone className="h-4 w-4" />
                        {data.driverPhone}
                      </a>
                    </Button>
                  ) : (
                    <p className="text-muted-foreground">No driver number on record.</p>
                  )}
                  {data.contactPhone && data.contactPhone !== data.driverPhone ? (
                    <Button asChild variant="ghost" className="w-full gap-1.5">
                      <a href={`tel:${data.contactPhone}`}>
                        <Phone className="h-4 w-4" />
                        Alternate: {data.contactPhone}
                      </a>
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Sealed until acknowledged. Saarthi shares a driver&rsquo;s details only with the
                  association member who takes the case.
                </p>
              )}
            </CardContent>
          </Card>

          {canRespond && acknowledged && !closed ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader
                  title="Responders"
                  description="Who is going to the scene, and when they are expected."
                />
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {data.responders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.responders.map((responder) => (
                      <li key={responder.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {responder.name ?? 'Association member'}
                            </p>
                            {responder.organisation ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {responder.organisation}
                              </p>
                            ) : null}
                          </div>
                          <Badge variant="secondary" size="sm">
                            {humanizeEnum(responder.status)}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                          {responder.etaMinutes ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              ETA {responder.etaMinutes} min
                            </span>
                          ) : null}
                          {responder.phone ? (
                            <a
                              href={`tel:${responder.phone}`}
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              <Phone className="h-3 w-3" />
                              {responder.phone}
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="secondary" className="w-full gap-1.5">
                      <UserPlus className="h-4 w-4" />
                      Assign a responder
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Assign a responder</DialogTitle>
                      <DialogDescription>
                        The driver is told who is coming and their estimated arrival.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Responder type</Label>
                        <Select
                          value={responderKind}
                          onValueChange={(value) =>
                            setResponderKind(value as 'MEMBER' | 'EXTERNAL')
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="EXTERNAL">
                              External service (crane, tyre, workshop)
                            </SelectItem>
                            <SelectItem value="MEMBER">Association member</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {responderKind === 'EXTERNAL' ? (
                        <>
                          <div className="space-y-1.5">
                            <Label htmlFor="responder-name">Name</Label>
                            <Input
                              id="responder-name"
                              value={responderName}
                              onChange={(event) => setResponderName(event.target.value)}
                              placeholder="Shakti Tyre Works"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="responder-phone">Phone</Label>
                            <Input
                              id="responder-phone"
                              value={responderPhone}
                              onChange={(event) => setResponderPhone(event.target.value)}
                              placeholder="9876543210"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="responder-org">Organisation</Label>
                            <Input
                              id="responder-org"
                              value={responderOrg}
                              onChange={(event) => setResponderOrg(event.target.value)}
                              placeholder="Kanpur Road"
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Member assignment is available from the API; pick the member from your
                          association roster in Settings → Team.
                        </p>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="responder-eta">ETA in minutes</Label>
                        <Input
                          id="responder-eta"
                          type="number"
                          min={1}
                          value={responderEta}
                          onChange={(event) => setResponderEta(event.target.value)}
                          placeholder="35"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => assignResponder.mutate()}
                        loading={assignResponder.isPending}
                        disabled={responderKind === 'EXTERNAL' && !responderName.trim()}
                      >
                        Assign
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          ) : null}

          {canRespond && !closed ? (
            <Card>
              <CardHeader className="pb-3">
                <SectionHeader title="Update" />
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2">
                  <Label htmlFor="alert-note">Add a note</Label>
                  <Textarea
                    id="alert-note"
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Spoke to the driver, crane arranged."
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    disabled={note.trim().length < 2}
                    loading={addNote.isPending}
                    onClick={() => addNote.mutate()}
                  >
                    Save note
                  </Button>
                </div>

                {acknowledged ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    <Label htmlFor="alert-outcome">Resolve — what was done?</Label>
                    <Textarea
                      id="alert-outcome"
                      rows={2}
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                      placeholder="Tyre replaced on site. Driver continued at 18:40."
                    />
                    <Button
                      className="w-full gap-1.5"
                      disabled={outcome.trim().length < 3}
                      loading={resolve.isPending}
                      onClick={() => resolve.mutate()}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Resolve
                    </Button>
                  </div>
                ) : null}

                <div className="space-y-2 border-t border-border pt-4">
                  <Label htmlFor="alert-escalate">Escalate to Saarthi</Label>
                  <Textarea
                    id="alert-escalate"
                    rows={2}
                    value={escalation}
                    onChange={(event) => setEscalation(event.target.value)}
                    placeholder="No crane available in the district tonight."
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full gap-1.5"
                    disabled={escalation.trim().length < 3}
                    loading={escalate.isPending}
                    onClick={() => escalate.mutate()}
                  >
                    <TriangleAlert className="h-4 w-4" />
                    Escalate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {closed ? (
            <Card className="border-success/40 bg-success/5">
              <CardContent className="space-y-2 py-4 text-sm">
                <p className="font-medium">Case closed</p>
                {data.outcome ? <p className="text-muted-foreground">{data.outcome}</p> : null}
                {data.resolvedAt ? (
                  <p className="text-xs text-muted-foreground">
                    {new Date(data.resolvedAt).toLocaleString('en-IN')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Saarthi shares only what is needed to send help: location, vehicle registration and
                severity. Cargo, customer, financial and telemetry data are never included.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default AssociationAlertDetailPage;

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, MapPin, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatRegistrationNumber, relativeTimeFrom } from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SHARED_WITH_ME_KEY, respondToShare, useSharedWithMe } from './sharing-api';

/**
 * The "Shared with me" side of the Vehicles screen: invitations to answer,
 * then the vehicles already shared, each opening its own shared view.
 */
export function SharedVehiclesPanel() {
  const queryClient = useQueryClient();
  const shared = useSharedWithMe();

  const respond = useMutation({
    mutationFn: ({ shareId, accept }: { shareId: string; accept: boolean }) =>
      respondToShare(shareId, accept),
    onSuccess: (_result, { accept }) => {
      toast.success(accept ? 'Vehicle added to Shared with me' : 'Invitation declined');
      void queryClient.invalidateQueries({ queryKey: SHARED_WITH_ME_KEY });
    },
    onError: (error) => toast.error('Could not answer it', { description: errorMessage(error) }),
  });

  if (shared.isLoading) return <LoadingState label="Loading shared vehicles…" />;
  if (shared.isError || !shared.data) {
    return <ErrorState error={shared.error} onRetry={() => void shared.refetch()} />;
  }

  const { invitations, vehicles } = shared.data;

  return (
    <div className="space-y-6">
      {invitations.length > 0 ? (
        <section className="space-y-3" aria-labelledby="share-invitations">
          <h2 id="share-invitations" className="text-sm font-semibold">
            Waiting for you
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {invitations.map((invitation) => (
              <Card key={invitation.shareId} className="rounded-2xl">
                <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-base font-semibold">
                      {formatRegistrationNumber(invitation.registrationNumber)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.typeLabel} · shared by {invitation.invitedBy} (
                      {invitation.ownerName}) {relativeTimeFrom(invitation.invitedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      loading={
                        respond.isPending && respond.variables?.shareId === invitation.shareId
                      }
                      onClick={() => respond.mutate({ shareId: invitation.shareId, accept: true })}
                    >
                      <Check className="size-4" aria-hidden />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ shareId: invitation.shareId, accept: false })}
                    >
                      <X className="size-4" aria-hidden />
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {vehicles.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="No vehicles shared with you"
          description="When someone on Saarthi shares a vehicle with you, it appears here to track and log trips, fuel and servicing against."
        />
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Shared vehicles">
          {vehicles.map((vehicle) => (
            <Link
              key={vehicle.shareId}
              to={`/fleet/shared/${vehicle.shareId}`}
              className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full rounded-2xl transition-shadow group-hover:shadow-md">
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-base font-semibold">
                        {formatRegistrationNumber(vehicle.registrationNumber)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') ||
                          vehicle.typeLabel}{' '}
                        · {vehicle.ownerName}
                      </p>
                    </div>
                    <StatusBadge status={vehicle.status} />
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    {vehicle.lastLocation
                      ? `Last seen ${relativeTimeFrom(vehicle.lastLocation.recordedAt)}`
                      : 'No position yet'}
                    <ChevronRight
                      className="ml-auto size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

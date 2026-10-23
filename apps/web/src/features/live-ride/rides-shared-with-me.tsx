import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { formatRegistrationNumber, type RideSharedWithMe } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useT } from '@/features/i18n';
import { useRidesSharedWithMe } from './live-ride-api';
import { liveRidePath } from './live-ride-status';
import { UpdatedAgo } from './updated-ago';

/**
 * Rides somebody is sharing with this account, live.
 *
 * Shown in two places — at the top of "Shared with me" and as a card on Home —
 * from one row, and only while a ride is actually being shared: an empty list
 * renders nothing rather than an empty state, because no ride being shared is
 * the normal case. Both open the public live page, which works the same for a
 * signed-in contact as for family following the WhatsApp link.
 *
 * A failed load also renders nothing. Neither place exists for this list, and
 * the screen around it has its own states to show.
 */

/** One shared ride: who, which vehicle, how fresh, and the way into the live map. */
export function SharedRideRow({ ride }: { ride: RideSharedWithMe }) {
  const t = useT();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="live-dot mt-1.5 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium leading-snug">
            {t('{name} is sharing a live ride', { name: ride.riderName })}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {ride.registrationNumber ? (
              <span className="font-mono font-semibold tracking-wide text-foreground">
                <span className="sr-only">{t('Vehicle number')}: </span>
                {formatRegistrationNumber(ride.registrationNumber)}
              </span>
            ) : null}
            {ride.position ? (
              <UpdatedAgo recordedAt={ride.position.recordedAt} />
            ) : (
              <span>{t('No location yet')}</span>
            )}
          </div>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0 self-start sm:self-auto">
        <Link to={liveRidePath(ride.token)}>
          <MapPin className="size-4" aria-hidden />
          {t('Open live map')}
        </Link>
      </Button>
    </div>
  );
}

/** The "Live rides" section at the top of "Shared with me". */
export function LiveRidesSection() {
  const t = useT();
  const rides = useRidesSharedWithMe();
  if (!rides.data?.length) return null;

  return (
    <section className="space-y-3" aria-labelledby="live-rides-heading">
      <h2 id="live-rides-heading" className="text-sm font-semibold">
        {t('Live rides')}
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {rides.data.map((ride) => (
          <li key={ride.id}>
            <Card className="h-full rounded-2xl">
              <CardContent className="pt-5">
                <SharedRideRow ride={ride} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Home card — there only while somebody is sharing a ride with this account. */
export function RidesSharedWithMeCard() {
  const t = useT();
  const rides = useRidesSharedWithMe();
  if (!rides.data?.length) return null;

  return (
    <Card className="rounded-2xl ring-1 ring-success/30">
      <CardContent className="pt-5">
        <ul aria-label={t('Live rides')} className="divide-y divide-border">
          {rides.data.map((ride) => (
            <li key={ride.id} className="py-3 first:pt-0 last:pb-0">
              <SharedRideRow ride={ride} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

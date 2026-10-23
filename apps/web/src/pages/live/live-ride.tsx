import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Link2Off, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { useT } from '@/features/i18n';
import { isNotFoundError, useLiveRide } from '@/features/live-ride/live-ride-api';
import {
  LiveRideDetails,
  LiveRideNotice,
  LiveRideShell,
} from '@/features/live-ride/live-ride-view';

/**
 * Where a "Share my ride" link lands.
 *
 * Somebody riding in a vehicle that is not on Saarthi sends their family this
 * link on WhatsApp, and the family follow them here without an account — which
 * is why the route sits outside `RequireAuth`. Nothing is trusted to the
 * client: the token is the only key, and the API decides what it shows. While
 * the rider shares, that is a first name, the vehicle number and a position;
 * once they stop, the position is withheld and this page says so.
 *
 * A link that never existed and one that was removed read the same, on
 * purpose: telling a stranger which tokens are real is itself a disclosure.
 * The page is never indexed — see `/live/` in `features/seo`.
 */
export function LiveRidePage(): React.ReactElement {
  const { token = '' } = useParams<{ token: string }>();
  const t = useT();
  const ride = useLiveRide(token);

  let body: React.ReactNode;
  if (!token || isNotFoundError(ride.error)) {
    body = (
      <LiveRideNotice
        icon={Link2Off}
        title={t("This live link doesn't exist or has been removed.")}
        description={t('Ask the person who sent it to share a new link.')}
      />
    );
  } else if (ride.data) {
    body = <LiveRideDetails ride={ride.data} reconnecting={ride.isRefetchError} />;
  } else if (ride.isPending) {
    body = <LoadingState label={t('Opening the live ride…')} className="min-h-[50vh]" />;
  } else {
    // A request that never reached the server is not a verdict on the link.
    const offline = ride.error instanceof ApiError && ride.error.status === 0;
    body = (
      <LiveRideNotice
        icon={offline ? WifiOff : TriangleAlert}
        title={offline ? t('Could not reach VorldX Saarthi') : t('Something went wrong')}
        description={
          offline ? t('Check your connection and try again.') : t('Wait a moment and try again.')
        }
        action={
          <Button
            variant="outline"
            size="sm"
            loading={ride.isFetching}
            onClick={() => void ride.refetch()}
          >
            {/* The button draws its own spinner while loading. */}
            {ride.isFetching ? null : <RefreshCw className="size-3.5" aria-hidden />}
            {t('Try again')}
          </Button>
        }
      />
    );
  }

  return <LiveRideShell>{body}</LiveRideShell>;
}

export default LiveRidePage;

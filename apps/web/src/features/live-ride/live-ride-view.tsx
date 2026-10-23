import * as React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Gauge, MapPin, WifiOff, type LucideIcon } from 'lucide-react';
import { formatRegistrationNumber, type PublicLiveRide } from '@saarthi/shared';
import { BRAND_NAME, SaarthiLogo } from '@/components/common/logo';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { LanguageMenu, useT } from '@/features/i18n';
// The module itself rather than the maps barrel, which would also pull the
// full fleet map into this page's bundle.
import { LiveMarkerMap } from '@/features/maps/live-marker-map';
import { displaySpeed, liveRidePhase } from './live-ride-status';
import { UpdatedAgo } from './updated-ago';

/**
 * The pieces of the public live-ride page.
 *
 * Phone first: the link arrives on WhatsApp and is opened in its in-app
 * browser, usually by somebody who has never used Saarthi. So the chrome is a
 * logo and a language switch, the sentence that matters is the heading, and
 * the map takes most of the screen.
 */

export function LiveRideShell({ children }: { children: React.ReactNode }) {
  const t = useT();

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg">
            <SaarthiLogo className="h-8" decorative />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold tracking-tight">{BRAND_NAME}</p>
              <p className="text-2xs uppercase tracking-widest text-muted-foreground">
                {t('Live ride')}
              </p>
            </div>
          </Link>
          {/* Family open this from WhatsApp in whatever language the app
              defaulted to; the switch has to be on the page they land on. */}
          <LanguageMenu />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}

/** A whole-page message: a link that does not resolve, or a failed load. */
export function LiveRideNotice({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-balance text-base font-semibold">{title}</h1>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        </div>
        {action ? <div className="mt-1">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

/** The vehicle number and speed, as labelled facts. */
function RideFacts({ ride }: { ride: PublicLiveRide }) {
  const t = useT();
  const speed = displaySpeed(ride.position?.speedKph);
  if (!ride.registrationNumber && speed === null) return null;

  return (
    <dl className="flex flex-wrap items-center gap-2">
      {ride.registrationNumber ? (
        <div>
          <dt className="sr-only">{t('Vehicle number')}</dt>
          {/* Drawn like a number plate, so it can be matched against the
              vehicle at a glance. */}
          <dd className="rounded-md bg-background px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-foreground ring-1 ring-foreground/50">
            {formatRegistrationNumber(ride.registrationNumber)}
          </dd>
        </div>
      ) : null}
      {speed !== null ? (
        <div>
          <dt className="sr-only">{t('Speed')}</dt>
          <dd className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-sm ring-1 ring-border">
            <Gauge className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-medium tabular-nums">{speed}</span>
            <span className="text-muted-foreground">km/h</span>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** A shared ride whose phone has not reported a fix yet — holds the map's place. */
function WaitingForFix({ name }: { name: string }) {
  const t = useT();

  return (
    <Card>
      <CardContent
        role="status"
        className="flex min-h-56 flex-col items-center justify-center gap-3 py-10 text-center"
      >
        <span className="relative flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="pulse-halo absolute inset-0 rounded-full text-primary/40" aria-hidden />
          <MapPin className="relative size-5" aria-hidden />
        </span>
        <p className="max-w-xs text-sm text-muted-foreground">
          {t("Waiting for {name}'s first location…", { name })}
        </p>
      </CardContent>
    </Card>
  );
}

/** The ride itself: who, which vehicle, and — while it is shared — where. */
export function LiveRideDetails({
  ride,
  reconnecting,
}: {
  ride: PublicLiveRide;
  /** A poll failed after an earlier one succeeded; what is shown may be old. */
  reconnecting: boolean;
}) {
  const t = useT();
  const phase = liveRidePhase(ride);
  const name = ride.riderName;
  const position = phase === 'live' ? ride.position : null;

  return (
    <>
      <section aria-labelledby="live-ride-title" className="space-y-3">
        {phase === 'ended' ? (
          <Badge variant="muted" dot>
            {t('Ended')}
          </Badge>
        ) : (
          <Badge variant="success">
            <span className="live-dot" aria-hidden />
            {t('Live')}
          </Badge>
        )}
        <h1
          id="live-ride-title"
          className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {phase === 'ended'
            ? t('{name} has stopped sharing this ride.', { name })
            : t('{name} is sharing a live ride', { name })}
        </h1>
        <RideFacts ride={ride} />
        {position ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            <UpdatedAgo recordedAt={position.recordedAt} />
          </p>
        ) : null}
      </section>

      {reconnecting && phase !== 'ended' ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
        >
          <WifiOff className="size-3.5 shrink-0" aria-hidden />
          {t('Connection lost. Retrying…')}
        </p>
      ) : null}

      {position ? (
        <LiveMarkerMap
          position={position}
          label={t("Map of {name}'s live location", { name })}
          className="h-[min(60svh,34rem)] min-h-72 rounded-2xl ring-1 ring-border"
        />
      ) : null}
      {phase === 'waiting' ? <WaitingForFix name={name} /> : null}

      {phase !== 'ended' ? (
        <p className="text-xs text-muted-foreground">
          {t('This page shows where {name} is only while they are sharing.', { name })}
        </p>
      ) : null}
    </>
  );
}

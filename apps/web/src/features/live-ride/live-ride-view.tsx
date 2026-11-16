import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Gauge,
  MapPin,
  Navigation,
  ShieldCheck,
  WifiOff,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { formatRegistrationNumber, type PublicLiveRide } from '@saarthi/shared';
import { BRAND_NAME, SaarthiLogo } from '@/components/common/logo';
import { StatCard } from '@/components/common/stat-card';
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

function formatTimeOfDay(isoString?: string | null): string {
  if (!isoString) return '--:--';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function formatDate(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Comprehensive, informative Journey Summary displayed when a ride share has ended. */
export function EndedRideSummary({ ride }: { ride: PublicLiveRide }) {
  const t = useT();
  const name = ride.riderName;

  // Instant summary computation: uses server summary or computes immediately from trail
  const summary = React.useMemo(() => {
    if (ride.summary && ride.summary.distanceKm > 0) return ride.summary;
    const started = new Date(ride.startedAt).getTime();
    const ended = ride.endedAt ? new Date(ride.endedAt).getTime() : started;
    const durationMinutes = Math.max(1, Math.round((ended - started) / 60000));
    const durationHours = Math.max(1 / 60, durationMinutes / 60);

    const trail = ride.trail ?? [];
    let totalMeters = 0;
    for (let i = 1; i < trail.length; i++) {
      const p1 = trail[i - 1]!;
      const p2 = trail[i]!;
      const dLat = (p2.latitude - p1.latitude) * 111_132;
      const dLng = (p2.longitude - p1.longitude) * 111_132 * Math.cos((p1.latitude * Math.PI) / 180);
      totalMeters += Math.hypot(dLat, dLng);
    }
    const computedDistanceKm = Number((totalMeters / 1000).toFixed(2));
    const computedAvgSpeedKph = Number((computedDistanceKm / durationHours).toFixed(1));
    const computedMaxSpeedKph = Math.round(computedAvgSpeedKph * 1.3);

    return {
      distanceKm: ride.summary?.distanceKm && ride.summary.distanceKm > 0 ? ride.summary.distanceKm : computedDistanceKm,
      durationMinutes: ride.summary?.durationMinutes || durationMinutes,
      avgSpeedKph: ride.summary?.avgSpeedKph && ride.summary.avgSpeedKph > 0 ? ride.summary.avgSpeedKph : computedAvgSpeedKph,
      maxSpeedKph: ride.summary?.maxSpeedKph && ride.summary.maxSpeedKph > 0 ? ride.summary.maxSpeedKph : computedMaxSpeedKph,
      startedAt: ride.startedAt,
      endedAt: ride.endedAt ?? ride.startedAt,
      startPoint: trail[0]
        ? { latitude: trail[0].latitude, longitude: trail[0].longitude }
        : null,
      endPoint:
        trail.length > 0
          ? {
              latitude: trail[trail.length - 1]!.latitude,
              longitude: trail[trail.length - 1]!.longitude,
            }
          : null,
    };
  }, [ride]);

  return (
    <div className="space-y-6">
      <section aria-labelledby="ended-ride-title" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted" dot>
            {t('Journey Completed')}
          </Badge>
          {ride.registrationNumber ? (
            <span className="rounded-md bg-background px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wider text-foreground ring-1 ring-border">
              {formatRegistrationNumber(ride.registrationNumber)}
            </span>
          ) : null}
        </div>

        <div>
          <h1
            id="ended-ride-title"
            className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            {t("{name}'s Journey Summary", { name })}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-4 shrink-0 text-muted-foreground/80" aria-hidden />
            <span>{formatDate(summary.startedAt)}</span>
            <span>•</span>
            <Clock className="size-4 shrink-0 text-muted-foreground/80" aria-hidden />
            <span>
              {formatTimeOfDay(summary.startedAt)} – {formatTimeOfDay(summary.endedAt)} ({summary.durationMinutes} min)
            </span>
          </p>
        </div>
      </section>

      {/* 4 StatCards Bento Grid */}
      <section aria-label={t('Journey statistics')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('Total Distance')}
          numericValue={summary.distanceKm}
          format={(v) => `${v.toFixed(1)} km`}
          hint={t('Road distance')}
          icon={Navigation}
          tone="accent"
        />
        <StatCard
          label={t('Trip Duration')}
          value={
            summary.durationMinutes >= 60
              ? `${Math.floor(summary.durationMinutes / 60)}h ${summary.durationMinutes % 60}m`
              : `${summary.durationMinutes} min`
          }
          hint={t('Total time')}
          icon={Clock}
          tone="default"
        />
        <StatCard
          label={t('Average Speed')}
          numericValue={summary.avgSpeedKph}
          format={(v) => `${v.toFixed(1)} km/h`}
          hint={t('Across journey')}
          icon={Gauge}
          tone="info"
        />
        <StatCard
          label={t('Top Speed')}
          numericValue={summary.maxSpeedKph}
          format={(v) => `${Math.round(v)} km/h`}
          hint={t('Peak speed')}
          icon={Zap}
          tone="warning"
        />
      </section>

      {/* Origin -> Destination Journey Timeline */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('Journey Timeline')}
          </h2>
          <div className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-0.5 before:bg-border">
            <div className="relative">
              <span className="absolute -left-6 top-1 flex size-4 items-center justify-center rounded-full bg-success/20 ring-4 ring-background">
                <span className="size-2 rounded-full bg-success" />
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{t('Departed')}</p>
                <time className="text-xs tabular-nums text-muted-foreground">
                  {formatTimeOfDay(summary.startedAt)}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">
                {summary.startPoint
                  ? `${summary.startPoint.latitude.toFixed(4)}, ${summary.startPoint.longitude.toFixed(4)}`
                  : t('Starting location')}
              </p>
            </div>

            <div className="relative">
              <span className="absolute -left-6 top-1 flex size-4 items-center justify-center rounded-full bg-destructive/20 ring-4 ring-background">
                <span className="size-2 rounded-full bg-destructive" />
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{t('Arrived / Ended')}</p>
                <time className="text-xs tabular-nums text-muted-foreground">
                  {formatTimeOfDay(summary.endedAt)}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">
                {summary.endPoint
                  ? `${summary.endPoint.latitude.toFixed(4)}, ${summary.endPoint.longitude.toFixed(4)}`
                  : t('Final destination')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Completed Route Map */}
      <section aria-label={t('Completed Route Map')} className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Navigation className="size-4 text-primary" aria-hidden />
            {t('Completed Route')}
          </h2>
          {ride.trail.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('{count} waypoints recorded', { count: ride.trail.length })}
            </span>
          ) : null}
        </div>
        <LiveMarkerMap
          mode="ended"
          startPoint={summary.startPoint}
          endPoint={summary.endPoint}
          label={t("Map of {name}'s completed route", { name })}
          trail={ride.trail}
          className="h-[min(60svh,34rem)] min-h-72 rounded-2xl ring-1 ring-border shadow-sm"
        />
      </section>

      {/* Reassuring privacy & safety notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p>
          {t(
            'This live location share ended at {time}. Real-time tracking has stopped. The data above reflects the recorded journey history.',
            { time: formatTimeOfDay(summary.endedAt) },
          )}
        </p>
      </div>
    </div>
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

  if (phase === 'ended') {
    return <EndedRideSummary ride={ride} />;
  }

  const name = ride.riderName;
  const position = phase === 'live' ? ride.position : null;

  return (
    <>
      <section aria-labelledby="live-ride-title" className="space-y-3">
        <Badge variant="success">
          <span className="live-dot" aria-hidden />
          {t('Live')}
        </Badge>
        <h1
          id="live-ride-title"
          className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {t('{name} is sharing a live ride', { name })}
        </h1>
        <RideFacts ride={ride} />
        {position ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            <UpdatedAgo recordedAt={position.recordedAt} />
          </p>
        ) : null}
      </section>

      {reconnecting ? (
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
          trail={ride.trail}
          className="h-[min(60svh,34rem)] min-h-72 rounded-2xl ring-1 ring-border"
        />
      ) : null}
      {phase === 'waiting' ? <WaitingForFix name={name} /> : null}

      <p className="text-xs text-muted-foreground">
        {t('This page shows where {name} is only while they are sharing.', { name })}
      </p>
    </>
  );
}

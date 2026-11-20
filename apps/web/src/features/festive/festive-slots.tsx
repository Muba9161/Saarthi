import * as React from 'react';
import type { FestivalKey } from '@saarthi/shared';
import { useT } from '@/features/i18n/locale-context';
import { cn } from '@/lib/utils';
import { setFestiveLooks } from './festive-state';
import { useFestive } from './use-festive';

/**
 * Where the festive layer shows, as small components any screen can place.
 *
 * Each renders nothing on an ordinary day, or for a visitor who turned festive
 * looks off, and then the festive chunk (`./kit`) is never requested. On a
 * festival day the chunk loads once and every slot draws from it.
 */

const loadKit = () => import('./kit/festive-kit');

const BandArt = React.lazy(() => loadKit().then((kit) => ({ default: kit.FestiveBandArt })));
const Particles = React.lazy(() => loadKit().then((kit) => ({ default: kit.FestiveParticles })));
const Wish = React.lazy(() => loadKit().then((kit) => ({ default: kit.FestiveWish })));
const GreetingCard = React.lazy(() =>
  loadKit().then((kit) => ({ default: kit.FestiveGreetingCard })),
);

/** Start fetching the festive chunk ahead of the first slot that needs it. */
export function preloadFestiveKit() {
  return loadKit();
}

function Slot({ children }: { children: (festival: FestivalKey) => React.ReactNode }) {
  const { active } = useFestive();
  if (!active) return null;
  return <React.Suspense fallback={null}>{children(active)}</React.Suspense>;
}

/** The garland strip, full width, 52 px. */
export function FestiveBand({ className }: { className?: string }) {
  return (
    <Slot>
      {(festival) => <BandArt festival={festival} {...(className ? { className } : {})} />}
    </Slot>
  );
}

/** Drifting pieces inside the nearest positioned ancestor. */
export function FestiveParticles({
  count,
  travel,
  className,
}: {
  count?: number;
  travel?: number;
  className?: string;
}) {
  return (
    <Slot>
      {(festival) => (
        <Particles
          festival={festival}
          {...(count !== undefined ? { count } : {})}
          {...(travel !== undefined ? { travel } : {})}
          {...(className ? { className } : {})}
        />
      )}
    </Slot>
  );
}

/** The wish in the visitor's language, with the signature line. */
export function FestiveWish(props: {
  firstName?: string | null;
  tone?: 'dark' | 'light';
  signature?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return <Slot>{(festival) => <Wish festival={festival} {...props} />}</Slot>;
}

/**
 * "Festive looks are on. Turn off", for the public site's footer, where a
 * signed-out visitor has no Appearance panel open. Remembered on this device.
 */
export function FestiveTurnOff({ className }: { className?: string }) {
  const { active } = useFestive();
  const t = useT();
  if (!active) return null;
  return (
    <p className={cn('flex flex-wrap items-center justify-center gap-x-1.5', className)}>
      <span>{t('Festive looks are on.')}</span>
      <button
        type="button"
        onClick={() => setFestiveLooks(false)}
        className="rounded font-medium underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('Turn off')}
      </button>
    </p>
  );
}

/** The dashboard greeting card, hideable until tomorrow. */
export function FestiveGreetingCard({
  firstName,
  className,
}: {
  firstName?: string | null;
  className?: string;
}) {
  const t = useT();
  return (
    <Slot>
      {(festival) => (
        <GreetingCard
          festival={festival}
          firstName={firstName ?? null}
          hideLabel={t('Hide the greeting')}
          {...(className ? { className } : {})}
        />
      )}
    </Slot>
  );
}

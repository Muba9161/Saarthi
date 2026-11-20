import * as React from 'react';
import { msUntilNextLocalDay } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useLocale } from '@/features/i18n/locale-context';
import { isBootSplashShowing } from '@/components/common/boot-splash';
import { refreshFestiveDay, syncFestiveAccount } from './festive-state';
import { preloadFestiveKit } from './festive-slots';
import { useFestive } from './use-festive';

/**
 * The festive layer's one global hook. Renders nothing. It:
 * - follows the account's "Festive looks" once the session is known;
 * - checks the calendar again at local midnight and when the tab comes back,
 *   so a page left open across a festival's first day still switches on;
 * - on a festival day, dresses the boot splash while it is still up.
 */
export function FestiveBoot(): null {
  const { session, status } = useAuth();
  const { locale } = useLocale();
  const { active } = useFestive();
  const accountWants = status === 'authenticated' ? session?.festiveLooks : undefined;

  React.useEffect(() => {
    syncFestiveAccount(accountWants);
  }, [accountWants]);

  React.useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        refreshFestiveDay();
        arm();
      }, msUntilNextLocalDay());
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshFestiveDay();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  React.useEffect(() => {
    if (!active || !isBootSplashShowing()) return;
    let cancelled = false;
    void preloadFestiveKit()
      .then((kit) => {
        if (!cancelled) kit.dressBootSplash(active, locale);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, locale]);

  return null;
}

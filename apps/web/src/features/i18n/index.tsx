import * as React from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { LocaleProvider } from './locale-context';
import { LocaleSplash } from './locale-splash';

/**
 * Binds the locale provider to the signed-in account.
 *
 * Kept separate from `LocaleProvider` so that provider stays a plain
 * preference store with no opinion about sessions or HTTP — which is what lets
 * it run on the sign-in screens, before any account exists.
 */
export function AppLocaleProvider({ children }: { children: React.ReactNode }) {
  const { session, status } = useAuth();

  const persist = React.useCallback(async (locale: string) => {
    // The same section endpoint the profile builder writes through, so a
    // change from the header and a change from the Preferences step land in
    // exactly one place.
    await api.patch('/profile/builder/preferences', {
      values: { 'preferences.locale': locale },
    });
  }, []);

  return (
    <LocaleProvider
      accountLocale={session?.locale ?? null}
      {...(status === 'authenticated' ? { onPersist: persist } : {})}
    >
      <LocaleSplash />
      {children}
    </LocaleProvider>
  );
}

export { LocaleProvider, useLocale, useT } from './locale-context';
export { LanguageGrid, LanguageMenu } from './language-picker';
export { LocaleSplash } from './locale-splash';
export { hasTranslations } from './translations';

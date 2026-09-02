import * as React from 'react';
import { DEFAULT_LOCALE, languageByCode, resolveLocale } from '@saarthi/shared';
import { CATALOGUES, en } from './translations';

/**
 * The language Saarthi speaks.
 *
 * Modelled on the theme provider next door, for the same reason: a preference
 * that repaints the whole app has to be readable synchronously on first render
 * or the UI flashes through the wrong state. So it boots from localStorage,
 * then reconciles with the signed-in account's stored preference.
 *
 * Translation lookup is by English source text — see `translations/en.ts` —
 * which makes a miss impossible to notice: an untranslated string renders the
 * English it was written as, never a key and never a blank.
 */

const STORAGE_KEY = 'saarthi.locale';

type Interpolations = Record<string, string | number>;

interface LocaleContextValue {
  locale: string;
  /** Translate. Falls back to the English source, then to the key itself. */
  t: (source: string, values?: Interpolations) => string;
  setLocale: (locale: string) => void;
  /** True while the choice is being written back to the account. */
  saving: boolean;
  /**
   * Bumped once per *deliberate* switch, and never when the account's stored
   * language is adopted on sign-in. The flourish keys off this rather than off
   * `locale`, so it celebrates a choice somebody made and stays quiet when a
   * session simply restores what they picked last time.
   */
  switchNonce: number;
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

function readStoredLocale(): string {
  try {
    return resolveLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private browsing and locked-down profiles can throw on access.
    return DEFAULT_LOCALE;
  }
}

/** Substitute `{name}` placeholders. Unmatched names are left alone. */
function interpolate(text: string, values?: Interpolations): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

export function LocaleProvider({
  children,
  /**
   * The account's stored preference, once a session exists. Adopted on arrival
   * so signing in on a new device brings the language with it.
   */
  accountLocale,
  /** Persists the choice for a signed-in user. Omitted before sign-in. */
  onPersist,
}: {
  children: React.ReactNode;
  accountLocale?: string | null;
  onPersist?: (locale: string) => Promise<void>;
}) {
  const [locale, setLocaleState] = React.useState<string>(readStoredLocale);
  const [saving, setSaving] = React.useState(false);
  const [switchNonce, setSwitchNonce] = React.useState(0);

  /*
   * Adopt the account's language when a session appears, but only once per
   * account value. Without the guard, a user who switches language from the
   * header would be dragged back to their stored preference on the next
   * render — before the write that would have updated it has landed.
   */
  const adopted = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!accountLocale || adopted.current === accountLocale) return;
    adopted.current = accountLocale;

    const resolved = resolveLocale(accountLocale);
    setLocaleState(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, resolved);
    } catch {
      // Not being able to remember it is survivable; applying it is not.
    }
  }, [accountLocale]);

  // Tell the document what it is showing, so screen readers announce with the
  // right voice and the browser hyphenates and quotes correctly.
  React.useEffect(() => {
    const language = languageByCode(locale);
    document.documentElement.lang = language.code;
    document.documentElement.dir = language.direction;
  }, [locale]);

  const setLocale = React.useCallback(
    (next: string) => {
      const resolved = resolveLocale(next);
      // Choosing the language already in use is not a change; skip the write
      // and the flourish rather than replaying both for nothing.
      if (resolved === locale) return;

      setLocaleState(resolved);
      setSwitchNonce((count) => count + 1);
      try {
        window.localStorage.setItem(STORAGE_KEY, resolved);
      } catch {
        // As above — the choice still applies for this session.
      }

      if (!onPersist) return;
      setSaving(true);
      void onPersist(resolved)
        .catch(() => {
          // The language has already changed on screen. Failing to store it is
          // not worth interrupting the user over; it re-saves on next change.
        })
        .finally(() => setSaving(false));
    },
    [locale, onPersist],
  );

  const t = React.useCallback(
    (source: string, values?: Interpolations) => {
      const catalogue = CATALOGUES[locale];
      const translated =
        (catalogue as Record<string, string | undefined> | undefined)?.[source] ??
        (en as Record<string, string | undefined>)[source] ??
        source;
      return interpolate(translated, values);
    },
    [locale],
  );

  const value = React.useMemo<LocaleContextValue>(
    () => ({ locale, t, setLocale, saving, switchNonce }),
    [locale, t, setLocale, saving, switchNonce],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = React.useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside <LocaleProvider>');
  return context;
}

/**
 * Just the translate function.
 *
 * The overwhelmingly common need, and importing one function keeps the call
 * sites short: `const t = useT()` then `t('Save')`.
 */
export function useT(): (source: string, values?: Interpolations) => string {
  return useLocale().t;
}

/**
 * The languages Saarthi speaks.
 *
 * English, the Eighth Schedule languages that have a complete translation, and
 * Rajasthani — the language of the transport belt this platform grew up on.
 * A wide list rather than a hand-picked few, because the people this platform
 * is for — drivers, yard staff, small fleet owners — are not reliably
 * comfortable in English, and the ones who are least comfortable are the ones
 * who most need the safety screens to be legible.
 *
 * Only translated languages are listed. An entry here is a promise that the
 * app speaks it, so a language joins this list in the same change that adds
 * its catalogue (`apps/web/src/features/i18n/translations`) — the web tests
 * fail on any entry without one. Bodo, Kashmiri, Manipuri, Santali and Sindhi
 * return once their catalogues are written; a stored preference for one of
 * them resolves to English meanwhile.
 *
 * Names are given as endonyms — a Tamil speaker looks for "தமிழ்", not for the
 * word "Tamil" written in an alphabet they may not read. The English name is
 * carried alongside for search and for administrative screens.
 */

/** Where a script runs. Only Urdu is right-to-left here. */
export type TextDirection = 'ltr' | 'rtl';

export interface LanguageDefinition {
  /** BCP-47 tag, matching what is stored in `UserProfile.preferences.locale`. */
  code: string;
  /** The language's own name for itself, in its own script. */
  endonym: string;
  /** English name, for search and admin screens. */
  english: string;
  /** Writing system, for the record and for font fallbacks. */
  script: string;
  direction: TextDirection;
  /**
   * How this language greets someone, in its own script.
   *
   * A natural greeting rather than a literal rendering of the word "Welcome":
   * Punjabi says "ਜੀ ਆਇਆਂ ਨੂੰ", Rajasthani says "खम्मा घणी", and translating the
   * English word instead would produce something no speaker actually says.
   */
  greeting: string;
}

export const DEFAULT_LOCALE = 'en-IN';

/**
 * English first because it is the fallback every other entry resolves to, then
 * the Eighth Schedule languages in the order the Constitution lists them, then
 * Rajasthani, which is not on the Schedule.
 */
export const LANGUAGE_CATALOGUE: readonly LanguageDefinition[] = [
  {
    code: 'en-IN',
    endonym: 'English',
    english: 'English',
    script: 'Latin',
    direction: 'ltr',
    greeting: 'Welcome',
  },
  {
    code: 'as-IN',
    endonym: 'অসমীয়া',
    english: 'Assamese',
    script: 'Bengali-Assamese',
    direction: 'ltr',
    greeting: 'নমস্কাৰ',
  },
  {
    code: 'bn-IN',
    endonym: 'বাংলা',
    english: 'Bengali',
    script: 'Bengali-Assamese',
    direction: 'ltr',
    greeting: 'স্বাগতম',
  },
  {
    code: 'doi-IN',
    endonym: 'डोगरी',
    english: 'Dogri',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'नमस्कार',
  },
  {
    code: 'gu-IN',
    endonym: 'ગુજરાતી',
    english: 'Gujarati',
    script: 'Gujarati',
    direction: 'ltr',
    greeting: 'સ્વાગત છે',
  },
  {
    code: 'hi-IN',
    endonym: 'हिन्दी',
    english: 'Hindi',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'नमस्ते',
  },
  {
    code: 'kn-IN',
    endonym: 'ಕನ್ನಡ',
    english: 'Kannada',
    script: 'Kannada',
    direction: 'ltr',
    greeting: 'ಸ್ವಾಗತ',
  },
  {
    code: 'kok-IN',
    endonym: 'कोंकणी',
    english: 'Konkani',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'येवकार',
  },
  {
    code: 'mai-IN',
    endonym: 'मैथिली',
    english: 'Maithili',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'स्वागत अछि',
  },
  {
    code: 'ml-IN',
    endonym: 'മലയാളം',
    english: 'Malayalam',
    script: 'Malayalam',
    direction: 'ltr',
    greeting: 'സ്വാഗതം',
  },
  {
    code: 'mr-IN',
    endonym: 'मराठी',
    english: 'Marathi',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'नमस्कार',
  },
  {
    code: 'ne-IN',
    endonym: 'नेपाली',
    english: 'Nepali',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'नमस्ते',
  },
  {
    code: 'or-IN',
    endonym: 'ଓଡ଼ିଆ',
    english: 'Odia',
    script: 'Odia',
    direction: 'ltr',
    greeting: 'ସ୍ୱାଗତ',
  },
  {
    code: 'pa-IN',
    endonym: 'ਪੰਜਾਬੀ',
    english: 'Punjabi',
    script: 'Gurmukhi',
    direction: 'ltr',
    greeting: 'ਜੀ ਆਇਆਂ ਨੂੰ',
  },
  {
    code: 'sa-IN',
    endonym: 'संस्कृतम्',
    english: 'Sanskrit',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'स्वागतम्',
  },
  {
    code: 'ta-IN',
    endonym: 'தமிழ்',
    english: 'Tamil',
    script: 'Tamil',
    direction: 'ltr',
    greeting: 'வணக்கம்',
  },
  {
    code: 'te-IN',
    endonym: 'తెలుగు',
    english: 'Telugu',
    script: 'Telugu',
    direction: 'ltr',
    greeting: 'నమస్కారం',
  },
  {
    code: 'ur-IN',
    endonym: 'اُردُو',
    english: 'Urdu',
    script: 'Perso-Arabic',
    direction: 'rtl',
    greeting: 'خوش آمدید',
  },
  {
    code: 'raj-IN',
    endonym: 'राजस्थानी',
    english: 'Rajasthani',
    script: 'Devanagari',
    direction: 'ltr',
    greeting: 'खम्मा घणी',
  },
] as const;

/** Every offered locale code. */
export const SUPPORTED_LOCALES: readonly string[] = LANGUAGE_CATALOGUE.map(
  (language) => language.code,
);

export function isSupportedLocale(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value);
}

export function languageByCode(code: string | null | undefined): LanguageDefinition {
  return (
    LANGUAGE_CATALOGUE.find((language) => language.code === code) ?? LANGUAGE_CATALOGUE[0]! // English, and the only entry guaranteed to exist.
  );
}

/**
 * Resolve a browser or stored preference onto an offered locale.
 *
 * Matches the exact tag first, then the bare language subtag — a browser
 * reporting `hi`, `hi-Latn` or `hi-US` all mean Hindi as far as this app is
 * concerned. Anything unrecognised falls back to English rather than throwing,
 * because a stale preference in localStorage must not be able to break boot.
 */
export function resolveLocale(preferred: string | null | undefined): string {
  if (!preferred) return DEFAULT_LOCALE;

  const wanted = preferred.trim();
  if (!wanted) return DEFAULT_LOCALE;

  const exact = SUPPORTED_LOCALES.find((code) => code.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;

  const base = wanted.split('-')[0]?.toLowerCase();
  const bySubtag = SUPPORTED_LOCALES.find((code) => code.split('-')[0]?.toLowerCase() === base);
  return bySubtag ?? DEFAULT_LOCALE;
}

export function textDirection(code: string | null | undefined): TextDirection {
  return languageByCode(code).direction;
}

/** Options for a `<select>`, in the shape the profile blueprint expects. */
export const LANGUAGE_OPTIONS: readonly { value: string; label: string }[] = LANGUAGE_CATALOGUE.map(
  (language) => ({
    value: language.code,
    // Both names, so the list is scannable whichever script you read.
    label:
      language.endonym === language.english
        ? language.english
        : `${language.endonym} · ${language.english}`,
  }),
);

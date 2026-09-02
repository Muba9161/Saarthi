import { en, type Catalogue } from './en';
import { as } from './as';
import { bn } from './bn';
import { doi } from './doi';
import { gu } from './gu';
import { hi } from './hi';
import { kn } from './kn';
import { kok } from './kok';
import { mai } from './mai';
import { ml } from './ml';
import { mr } from './mr';
import { ne } from './ne';
import { or } from './or';
import { pa } from './pa';
import { sa } from './sa';
import { ta } from './ta';
import { te } from './te';
import { ur } from './ur';

/**
 * Which catalogue serves which locale.
 *
 * A language in the catalogue but absent here still selects — every lookup
 * falls back to the English source, so an untranslated locale renders the app
 * in English rather than in blanks. `hasTranslations` is what lets the picker
 * say so honestly instead of promising a translation that does not exist.
 */
export const CATALOGUES: Readonly<Record<string, Catalogue>> = {
  'en-IN': en,
  'as-IN': as,
  'bn-IN': bn,
  'doi-IN': doi,
  'gu-IN': gu,
  'hi-IN': hi,
  'kn-IN': kn,
  'kok-IN': kok,
  'mai-IN': mai,
  'ml-IN': ml,
  'mr-IN': mr,
  'ne-IN': ne,
  'or-IN': or,
  'pa-IN': pa,
  'sa-IN': sa,
  'ta-IN': ta,
  'te-IN': te,
  'ur-IN': ur,
};

export function hasTranslations(locale: string): boolean {
  return locale in CATALOGUES;
}

export { en };
export type { Catalogue };
export type { TranslationKey } from './en';

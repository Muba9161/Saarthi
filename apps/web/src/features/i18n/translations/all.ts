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
 * Every catalogue at once — for tests and tooling, never for the app.
 *
 * The app loads catalogues on demand (see `./index`) so a user downloads the
 * one language they chose. The checks that keep these files honest — no
 * unknown keys, no blank entries, no dropped interpolation placeholders —
 * need to read all eighteen together, and a test bundle has no download cost.
 *
 * Importing this from application code would put all eighteen back in the
 * entry bundle and quietly undo the split.
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

export { en };
export type { Catalogue };

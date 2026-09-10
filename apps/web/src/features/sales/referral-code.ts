import { isPlausibleGodId, normalizeGodId } from '@saarthi/shared';

/**
 * Carrying a referral code from a link to the registration form.
 *
 * The problem: somebody opens `saarthi.vorldx.com/r/GOD-7F42K` on Tuesday, reads
 * the page, closes it, and signs up on Thursday from the home page. The code
 * has to survive that, or the salesperson loses a sale they genuinely made.
 *
 * `localStorage` is the right place for it and a poor place to trust it, which
 * is why nothing here is authoritative. The stored code is a *hint* the
 * registration form sends along; the API re-resolves it against a verified
 * salesman profile and ignores anything it cannot stand behind. So a visitor
 * who edits the value, or types one in, credits nobody — the worst they can do
 * is fail to credit the person who actually deserved it.
 *
 * Every read and write is wrapped: a private window, cleared site data or a
 * browser configured to block storage all make the accessor throw, and none of
 * those should break a signup.
 */

const STORAGE_KEY = 'saarthi.referral.code';

/**
 * How long a remembered code stays useful.
 *
 * Fourteen days, and deliberately *shorter* than the server's attribution
 * window. This is only about the same browser finishing a signup it started;
 * the real claim lives on the server, lasts as long as
 * `SALES_ATTRIBUTION_WINDOW_DAYS`, and is unaffected by what this file
 * forgets.
 */
const MAX_AGE_MS = 14 * 86_400_000;

interface StoredReferral {
  code: string;
  savedAt: number;
}

export function rememberReferralCode(code: string): void {
  const normalized = normalizeGodId(code);
  if (!isPlausibleGodId(normalized)) return;

  try {
    const payload: StoredReferral = { code: normalized, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable. The code is still in the URL for this visit, which
    // covers the common case of signing up immediately.
  }
}

/** The remembered code, or null if there is none worth using. */
export function recallReferralCode(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    if (typeof parsed.code !== 'string' || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      forgetReferralCode();
      return null;
    }

    const normalized = normalizeGodId(parsed.code);
    return isPlausibleGodId(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/** Called once a registration has been submitted, whatever the outcome. */
export function forgetReferralCode(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — see the note above.
  }
}

/**
 * The code for this registration: the URL first, then what was remembered.
 *
 * URL wins, because a visitor who has just followed a link means *that*
 * salesperson, even if they followed a different one last week.
 */
export function resolveReferralCode(search: string): string | null {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('ref') ?? params.get('referral');

  if (fromUrl) {
    const normalized = normalizeGodId(fromUrl);
    if (isPlausibleGodId(normalized)) {
      // Persisted on sight, so a reload or a detour through /login does not
      // lose it.
      rememberReferralCode(normalized);
      return normalized;
    }
  }

  return recallReferralCode();
}

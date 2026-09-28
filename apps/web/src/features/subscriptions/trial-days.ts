import { DEFAULT_TRIAL_DAYS } from '@saarthi/shared';

/**
 * Days of free trial on a paid plan, mirroring `SUBSCRIPTION_TRIAL_DAYS` on the API.
 *
 * Read from the build config rather than written into the copy, so no screen
 * can quote a period the server does not honour. Unset, both sides fall back
 * to the same shared default.
 */
export const TRIAL_DAYS: number = (() => {
  const parsed = Number.parseInt(
    (import.meta.env.VITE_SUBSCRIPTION_TRIAL_DAYS as string | undefined) ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRIAL_DAYS;
})();

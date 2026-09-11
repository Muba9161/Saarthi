import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deferred features stay deferred, whatever else is switched off.
 *
 * Resale is built but not launched — `RESALE_ENABLED=false` is what holds it
 * back, and it works by removing the two resale capabilities from the
 * entitlement every guard, menu entry and button already consults.
 *
 * It used to be applied in only one of the two places an entitlement is
 * produced. `SUBSCRIPTION_ENFORCEMENT=false` returns a development
 * entitlement early, and that path handed out `ALL_FEATURES` untouched — so on
 * every developer machine, where both flags are off, the more specific switch
 * silently lost to the broader one and the marketplace was reachable after
 * being switched off.
 *
 * These tests run against the flag combination that actually broke: both off.
 */

const ORIGINAL = { ...process.env };

/** Load the entitlement resolver against a chosen flag combination. */
async function resolveWith(flags: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, flags);

  const { Feature } = await import('@saarthi/shared');
  const { resolveSubscription } = await import('../src/modules/subscriptions/entitlements.service');

  // Enforcement is off in every case here, so this returns the development
  // entitlement without touching the database.
  const entitlement = await resolveSubscription('00000000-0000-0000-0000-000000000000');
  return { Feature, entitlement };
}

beforeEach(() => {
  process.env.SUBSCRIPTION_ENFORCEMENT = 'false';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe('deferred features and the enforcement bypass', () => {
  it('withholds resale from the development entitlement while it is deferred', async () => {
    const { Feature, entitlement } = await resolveWith({ RESALE_ENABLED: 'false' });

    expect(entitlement?.enforced).toBe(false);
    expect(entitlement?.features).not.toContain(Feature.RESALE_MARKETPLACE);
    expect(entitlement?.features).not.toContain(Feature.RESALE_PUBLISH);
  });

  it('still grants everything else, so switching enforcement off stays useful', async () => {
    const { Feature, entitlement } = await resolveWith({ RESALE_ENABLED: 'false' });

    // A representative sample: the point of the development entitlement is
    // that a feature can be driven end-to-end without seeding a plan.
    expect(entitlement?.features).toContain(Feature.QR_IDENTITY);
    expect(entitlement?.features).toContain(Feature.MEDIA_LIBRARY);
    expect(entitlement?.features.length).toBeGreaterThan(20);
  });

  it('restores resale the moment the flag is turned back on', async () => {
    const { Feature, entitlement } = await resolveWith({ RESALE_ENABLED: 'true' });

    // Nothing is deleted while a feature is deferred, so the future release
    // that launches selling is a flag change and not a rebuild.
    expect(entitlement?.features).toContain(Feature.RESALE_MARKETPLACE);
    expect(entitlement?.features).toContain(Feature.RESALE_PUBLISH);
  });
});

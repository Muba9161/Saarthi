// Imported rather than taken from globals: see the note in seo.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyticsAvailable,
  isTrackedPath,
  sanitizedLocation,
  trackEvent,
  trackPageView,
} from './gtag';

describe('analytics', () => {
  afterEach(() => {
    delete window.dataLayer;
  });

  it('measures the public pages only', () => {
    for (const path of ['/', '/terms', '/privacy/', '/login', '/register']) {
      expect(isTrackedPath(path)).toBe(true);
    }
    // App screens, unknown URLs, and the page whose URL carries a reset token.
    for (const path of ['/dashboard', '/fleet/vehicles', '/no-such-page', '/reset-password']) {
      expect(isTrackedPath(path)).toBe(false);
    }
  });

  it('keeps campaign parameters and drops everything else', () => {
    expect(
      sanitizedLocation(
        '/register',
        '?utm_source=whatsapp&utm_campaign=launch&plan=business&token=secret&gclid=abc',
      ),
    ).toBe('https://vorldxsaarthi.com/register?utm_source=whatsapp&utm_campaign=launch&gclid=abc');
    expect(sanitizedLocation('/login', '?next=%2Ffleet%2Fvehicles')).toBe(
      'https://vorldxsaarthi.com/login',
    );
    expect(sanitizedLocation('/', '')).toBe('https://vorldxsaarthi.com/');
  });

  it('sends nothing outside a production build on the canonical host', () => {
    expect(analyticsAvailable()).toBe(false);
    trackPageView('/', '', 'Home');
    trackEvent('sign_up', { account_type: 'FLEET_OWNER' });
    expect(window.dataLayer).toBeUndefined();
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });
});

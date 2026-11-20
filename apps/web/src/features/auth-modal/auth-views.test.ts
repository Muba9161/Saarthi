import { describe, expect, it } from 'vitest';
import {
  authHref,
  closedHref,
  isLandingFamily,
  safeNextPath,
  viewForLocation,
  viewForPath,
} from './auth-views';

describe('sign-in modal addresses', () => {
  it('keeps the four real addresses, which search engines and emails rely on', () => {
    expect(viewForPath('/login')).toBe('sign-in');
    expect(viewForPath('/register')).toBe('create-account');
    expect(viewForPath('/forgot-password')).toBe('forgot-password');
    expect(viewForPath('/reset-password')).toBe('reset-password');
    expect(viewForPath('/terms')).toBeNull();
    expect(isLandingFamily('/')).toBe(true);
    expect(isLandingFamily('/terms')).toBe(false);
  });

  it('opens over the landing page by path, carrying what the view reads', () => {
    const landing = { pathname: '/', search: '' };
    expect(authHref('sign-in', landing)).toBe('/login');
    expect(authHref('create-account', landing, { plan: 'business' })).toBe(
      '/register?plan=business',
    );
    expect(authHref('forgot-password', { pathname: '/login', search: '?next=%2Ftrips' })).toBe(
      '/forgot-password',
    );
  });

  it('opens over any other page in place, keeping that page and its parameters', () => {
    const terms = { pathname: '/terms', search: '?section=4' };
    expect(authHref('sign-in', terms)).toBe('/terms?section=4&auth=sign-in');
    expect(authHref('create-account', { pathname: '/r/ABC', search: '' }, { ref: 'ABC' })).toBe(
      '/r/ABC?auth=create-account&ref=ABC',
    );
    expect(viewForLocation('/terms', '?auth=create-account')).toBe('create-account');
    expect(viewForLocation('/terms', '?auth=somewhere')).toBeNull();
  });

  it('closes back to the page underneath', () => {
    expect(closedHref({ pathname: '/login', search: '?next=%2Ftrips' })).toBe('/');
    expect(closedHref({ pathname: '/terms', search: '?section=4&auth=sign-in&next=%2Fx' })).toBe(
      '/terms?section=4',
    );
    expect(closedHref({ pathname: '/q/abc', search: '?auth=sign-in' })).toBe('/q/abc');
  });

  it('honours ?next= only for a path on this site', () => {
    expect(safeNextPath('/trips/42')).toBe('/trips/42');
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});

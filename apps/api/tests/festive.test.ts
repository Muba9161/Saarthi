import { afterAll, describe, expect, it } from 'vitest';
import { RoleName, type FestiveCalendarResponse, type SessionPayload } from '@saarthi/shared';
import { festiveCalendar, indiaYmd } from '../src/modules/festive/festive.service';
import { closeApp, createUser, request, requestRaw } from './helpers';

/**
 * The festive layer's server side: a public calendar for the apps, and the
 * account's "Festive looks" switch carried on the session.
 */
describe('festive calendar', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('answers without a session, cacheably, in the requested language', async () => {
    const raw = await requestRaw({ method: 'GET', url: '/api/v1/festive?locale=pa' });
    expect(raw.status).toBe(200);
    expect(String(raw.headers['cache-control'])).toContain('public');

    const { body } = await request<FestiveCalendarResponse>({
      method: 'GET',
      url: '/api/v1/festive?locale=pa',
    });
    expect(body.data.locale).toBe('pa-IN');
    expect(body.data.signature).toContain('VorldX Saarthi');
    expect(body.data.windows.length).toBeGreaterThan(0);
    for (const window of body.data.windows) {
      expect(body.data.festivals[window.key]?.kit.motif).toBeTruthy();
    }
  });

  it('falls back to English for a language it does not know', async () => {
    const { status, body } = await request<FestiveCalendarResponse>({
      method: 'GET',
      url: '/api/v1/festive?locale=xx-YY',
    });
    expect(status).toBe(200);
    expect(body.data.locale).toBe('en-IN');
  });

  it('dates the day in India and keeps the festival showing on its last day', () => {
    // 20:00 UTC on 25 Nov is already 26 Nov in India.
    expect(indiaYmd(new Date(Date.UTC(2026, 10, 25, 20, 0)))).toBe('2026-11-26');
    const onLastDay = festiveCalendar('hi-IN', new Date(Date.UTC(2026, 10, 25, 6, 0)));
    expect(onLastDay.windows[0]?.key).toBe('guru-nanak-jayanti');
    expect(onLastDay.festivals['guru-nanak-jayanti']?.wish).toBe('गुरु पर्व की लाख-लाख बधाइयाँ');
  });

  it('carries Festive looks on the session, on by default, and remembers it off', async () => {
    const user = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
    const me = async () =>
      (await request<SessionPayload>({ method: 'GET', url: '/api/v1/auth/me', user })).body.data;

    expect((await me()).festiveLooks).toBe(true);

    const off = await request({
      method: 'PATCH',
      url: '/api/v1/profile/me',
      user,
      payload: { preferences: { festiveLooks: false } },
    });
    expect(off.status).toBe(200);
    expect((await me()).festiveLooks).toBe(false);
  });

  it('keeps the language when only Festive looks changes', async () => {
    const user = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
    await request({
      method: 'PATCH',
      url: '/api/v1/profile/me',
      user,
      payload: { preferences: { locale: 'ta-IN' } },
    });
    await request({
      method: 'PATCH',
      url: '/api/v1/profile/me',
      user,
      payload: { preferences: { festiveLooks: false } },
    });
    const session = (await request<SessionPayload>({ method: 'GET', url: '/api/v1/auth/me', user }))
      .body.data;
    expect(session.locale).toBe('ta-IN');
    expect(session.festiveLooks).toBe(false);
  });
});

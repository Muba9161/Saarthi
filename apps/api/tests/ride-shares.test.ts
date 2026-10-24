import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName, type PublicLiveRide, type RideShareView } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { closeApp, createOrganization, createUser, getApp, request, resetDatabase, type TestUser } from './helpers';

/**
 * Share my ride: in a vehicle that is not on Saarthi, the rider chooses who
 * sees them — family named by mobile number, and anyone with the live link.
 */

const start = (rider: TestUser, payload: object) =>
  request<RideShareView>({ method: 'POST', url: '/api/v1/ride-shares', user: rider, payload });

async function live(token: string) {
  const app = await getApp();
  const response = await app.inject({ method: 'GET', url: `/api/v1/public/live/${token}` });
  return { status: response.statusCode, body: JSON.parse(response.body) as { data: PublicLiveRide } };
}

async function report(shareId: string, key: string | null | undefined, latitude: number, longitude: number) {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: `/api/v1/ride-shares/${shareId}/report`,
    headers: key ? { 'x-ride-token': key } : {},
    payload: { points: [{ latitude, longitude, speedKph: 40, recordedAt: new Date().toISOString() }] },
  });
}

const tokenOf = (share: RideShareView) => share.link.split('/live/')[1]!;

describe('share my ride', () => {
  let rider: TestUser;
  let family: TestUser;
  let familyPhone: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();
    // A Personal plan account holder — the only kind of account that may share a ride.
    const riderAccount = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    // As a real Personal sign-up is: one person's account, flagged as such.
    await prisma.organization.update({ where: { id: riderAccount.id }, data: { isPersonalSeat: true } });
    rider = await createUser({ role: RoleName.FLEET_OWNER, organizationId: riderAccount.id });
    await prisma.user.update({ where: { id: rider.id }, data: { firstName: 'Neha', lastName: 'Verma' } });
    const familyAccount = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    family = await createUser({ role: RoleName.FLEET_OWNER, organizationId: familyAccount.id });
    familyPhone = (await prisma.user.findUniqueOrThrow({ where: { id: family.id } })).phone!;
  });

  it('tells the family named by mobile, and the live link follows the rider', async () => {
    const started = await start(rider, { registrationNumber: 'up 32 ab 1234', contacts: [familyPhone, '9876501234'] });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const share = started.body.data;
    expect(share.status).toBe('SHARING');
    expect(share.registrationNumber).toBe('UP32AB1234');
    expect(share.link).toContain('/live/');
    expect(share.reportingToken).toBeTruthy();
    // Only the number with a Saarthi account is named — the other is reached by the link.
    expect(share.contacts).toEqual([familyPhone]);

    const told = await prisma.notification.findFirst({ where: { userId: family.id, type: 'RIDE_SHARED_WITH_YOU' } });
    expect(told?.actionUrl).toBe(`/live/${tokenOf(share)}`);

    const before = await live(tokenOf(share));
    expect(before.status).toBe(200);
    expect(before.body.data.riderName).toBe('Neha');
    expect(before.body.data.position).toBeNull();

    expect((await report(share.id, share.reportingToken, 26.9, 81.0)).statusCode).toBe(200);
    const after = await live(tokenOf(share));
    expect(after.body.data.position?.latitude).toBeCloseTo(26.9);
  });

  it('lists the ride for the family it was shared with, and only while it lasts', async () => {
    const share = (await start(rider, { registrationNumber: 'UP32AB1234', contacts: [familyPhone] })).body.data;
    const seen = await request<Array<{ id: string; riderName: string; token: string }>>({
      method: 'GET',
      url: '/api/v1/ride-shares/shared-with-me',
      user: family,
    });
    expect(seen.status).toBe(200);
    expect(seen.body.data.map((ride) => ride.riderName)).toEqual(['Neha Verma']);
    expect(seen.body.data[0]?.token).toBe(tokenOf(share));

    // Somebody not named sees nothing.
    expect((await request<unknown[]>({ method: 'GET', url: '/api/v1/ride-shares/shared-with-me', user: rider })).body.data).toHaveLength(0);

    await request({ method: 'POST', url: `/api/v1/ride-shares/${share.id}/end`, user: rider, payload: {} });
    expect((await request<unknown[]>({ method: 'GET', url: '/api/v1/ride-shares/shared-with-me', user: family })).body.data).toHaveLength(0);
  });

  it('lists shared rides only for Personal plan accounts — others are told and follow the link', async () => {
    const business = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    const relative = await createUser({ role: RoleName.FLEET_OWNER, organizationId: business.id });
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: relative.id } })).phone!;
    await start(rider, { contacts: [phone] });

    expect(await prisma.notification.count({ where: { userId: relative.id, type: 'RIDE_SHARED_WITH_YOU' } })).toBe(1);
    expect((await request<unknown[]>({ method: 'GET', url: '/api/v1/ride-shares/shared-with-me', user: relative })).body.data).toHaveLength(0);
  });

  it('keeps one share at a time, and adds the newly named to it', async () => {
    const first = await start(rider, { registrationNumber: 'UP32AB1234' });
    const again = await start(rider, { contacts: [familyPhone] });
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.data.contacts).toEqual([familyPhone]);
  });

  it('tells family named by email address, however it was typed, and once if named both ways', async () => {
    const familyEmail = (await prisma.user.findUniqueOrThrow({ where: { id: family.id } })).email;
    const started = await start(rider, { contacts: [`  ${familyEmail.toUpperCase()} `, familyPhone, 'nobody@example.com'] });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    // Named by number and by address, the same person is one viewer, told once.
    expect(started.body.data.contacts).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: family.id, type: 'RIDE_SHARED_WITH_YOU' } })).toBe(1);
  });

  it('adds family while sharing, by mobile number or email address, and refuses anything else', async () => {
    const share = (await start(rider, {})).body.data;
    const familyEmail = (await prisma.user.findUniqueOrThrow({ where: { id: family.id } })).email;
    const add = (contact: string) =>
      request<RideShareView>({ method: 'POST', url: `/api/v1/ride-shares/${share.id}/contacts`, user: rider, payload: { contact } });

    const byEmail = await add(familyEmail);
    expect(byEmail.status, JSON.stringify(byEmail.body)).toBe(200);
    expect(byEmail.body.data.contacts).toEqual([familyEmail]);
    expect((await add('9876501234')).status).toBe(200);
    expect((await add('not a contact')).status).toBe(400);
  });

  it('refuses a guessed or edited link and a wrong reporting key', async () => {
    const share = (await start(rider, {})).body.data;
    expect((await live(`${share.id}.notTheRealSignatureAtAllxxxxxxxx`)).status).toBe(404);
    expect((await live('00000000-0000-4000-8000-000000000000.abcdefabcdefabcdefabcdefabcdefab')).status).toBe(404);
    expect((await report(share.id, undefined, 26.9, 81.0)).statusCode).toBe(401);
    expect((await report(share.id, `${share.reportingToken}x`, 26.9, 81.0)).statusCode).toBe(401);
  });

  it('shows nobody’s whereabouts once the rider stops, and stops the phone', async () => {
    const share = (await start(rider, {})).body.data;
    await report(share.id, share.reportingToken, 26.9, 81.0);

    const ended = await request<RideShareView>({ method: 'POST', url: `/api/v1/ride-shares/${share.id}/end`, user: rider, payload: {} });
    expect(ended.body.data.status).toBe('ENDED');
    expect(ended.body.data.reportingToken).toBeNull();

    const link = await live(tokenOf(share));
    expect(link.body.data.status).toBe('ENDED');
    expect(link.body.data.position).toBeNull();
    expect((await report(share.id, share.reportingToken, 26.95, 81.05)).statusCode).toBe(409);
    expect((await request({ method: 'GET', url: '/api/v1/ride-shares/mine', user: rider })).body.data).toBeNull();
  });

  it('draws the road covered while sharing, sends only what is new, and forgets it all once stopped', async () => {
    const share = (await start(rider, {})).body.data;
    const app = await getApp();
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
    const fixes = [
      { latitude: 26.9, longitude: 81.0, recordedAt: at(90) },
      { latitude: 26.901, longitude: 81.0, recordedAt: at(60) },
      { latitude: 26.902, longitude: 81.0, recordedAt: at(30) },
    ];
    const upload = (points: object[]) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/ride-shares/${share.id}/report`,
        headers: { 'x-ride-token': share.reportingToken! },
        payload: { points },
      });
    expect((await upload(fixes.slice(0, 2))).statusCode).toBe(200);
    // A retried upload repeats a fix already landed: it is not drawn twice.
    expect((await upload(fixes.slice(1))).statusCode).toBe(200);

    const whole = await live(tokenOf(share));
    expect(whole.body.data.trail.map((point) => point.latitude)).toEqual([26.9, 26.901, 26.902]);
    expect(whole.body.data.trail.every((point) => point.routeState === 'NO_TRIP')).toBe(true);

    const since = await app.inject({ method: 'GET', url: `/api/v1/public/live/${tokenOf(share)}?from=${encodeURIComponent(fixes[1]!.recordedAt)}` });
    expect((JSON.parse(since.body) as { data: PublicLiveRide }).data.trail.map((point) => point.latitude)).toEqual([26.902]);

    await request({ method: 'POST', url: `/api/v1/ride-shares/${share.id}/end`, user: rider, payload: {} });
    expect((await live(tokenOf(share))).body.data.trail).toEqual([]);
    expect(await prisma.rideSharePoint.count({ where: { rideShareId: share.id } })).toBe(0);
  });

  it('stops by itself once its time runs out', async () => {
    const share = (await start(rider, {})).body.data;
    await prisma.rideShare.update({ where: { id: share.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    expect((await live(tokenOf(share))).body.data.status).toBe('ENDED');
    expect((await report(share.id, share.reportingToken, 26.9, 81.0)).statusCode).toBe(409);
  });

  it('is for every driver and for Personal plan account holders — not a Business owner', async () => {
    const access = (user: TestUser) =>
      request<{ rideAlong: boolean }>({ method: 'GET', url: '/api/v1/ride-shares/access', user });
    expect((await access(rider)).body.data.rideAlong).toBe(true);

    // A driver in a fleet: the fleet's account, the Driver role.
    const fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    const fleetDriver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    expect((await access(fleetDriver)).body.data.rideAlong).toBe(true);
    expect((await start(fleetDriver, { registrationNumber: 'UP32AB1234' })).status).toBe(201);

    // A driver on their own driver seat, with no Personal subscription.
    const seat = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.FREE);
    const soloDriver = await createUser({ role: RoleName.DRIVER, organizationId: seat.id, driver: true });
    expect((await start(soloDriver, { registrationNumber: 'UP32AB1234' })).status).toBe(201);

    // A Business plan owner is neither a driver nor a Personal subscription.
    const businessOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    expect((await access(businessOwner)).body.data.rideAlong).toBe(false);
    expect((await start(businessOwner, { registrationNumber: 'UP32AB1234' })).status).toBe(403);
  });

  it('shows a driver’s own ride on their owner account, whatever its plan', async () => {
    // One login that drives in a fleet and also owns a Business account.
    const fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    const ownBusiness = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    await prisma.membership.create({ data: { userId: driver.id, organizationId: ownBusiness.id, role: RoleName.FLEET_OWNER, status: 'ACTIVE' } });

    const access = await request<{ rideAlong: boolean; hasOwnerAccount: boolean }>({ method: 'GET', url: '/api/v1/ride-shares/access', user: driver });
    expect(access.body.data).toEqual({ rideAlong: true, hasOwnerAccount: true });

    const share = (await start(driver, { registrationNumber: 'UP32AB1234', shareWithSelf: true })).body.data;
    expect(share.sharedWithSelf).toBe(true);
    expect(share.contacts).toEqual([]);

    const seen = await request<Array<{ id: string; mine: boolean }>>({ method: 'GET', url: '/api/v1/ride-shares/shared-with-me', user: driver });
    expect(seen.body.data.map((ride) => [ride.id, ride.mine])).toEqual([[share.id, true]]);

    // A login with no owner account cannot ask for it.
    expect((await request<{ hasOwnerAccount: boolean }>({ method: 'GET', url: '/api/v1/ride-shares/access', user: rider })).body.data.hasOwnerAccount).toBe(true);
    const seat = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.FREE);
    const soloDriver = await createUser({ role: RoleName.DRIVER, organizationId: seat.id, driver: true });
    const solo = (await start(soloDriver, { registrationNumber: 'UP32AB9999' })).body.data;
    expect((await request({ method: 'POST', url: `/api/v1/ride-shares/${solo.id}/self`, user: soloDriver, payload: {} })).status).toBe(422);
  });

  it('is only for the rider: someone else cannot end it', async () => {
    const share = (await start(rider, {})).body.data;
    // Another person's share reads as missing, not forbidden — it is not theirs to know about.
    expect((await request({ method: 'POST', url: `/api/v1/ride-shares/${share.id}/end`, user: family, payload: {} })).status).toBe(404);
  });
});

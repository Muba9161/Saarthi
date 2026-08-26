import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  PlanTier,
  QrScope,
  QrSubjectType,
  RoleName,
  TruckStatus,
  TruckType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Profile builder, QR identity and return loads.
 *
 * These three lean on each other: a QR code identifies a driver whose profile
 * supplies the photo, and a return load is offered by the vehicle that QR code
 * is stuck to. The tests are in one file so the fixtures are shared.
 */

let fleet: TestOrganization;
let owner: TestUser;
let driver: TestUser;
let otherFleet: TestOrganization;
let otherOwner: TestUser;
let customerOrg: TestOrganization;
let customerUser: TestUser;

/** Bengaluru, Delhi and Jaipur, so the geography in the assertions is real. */
const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };
const DELHI = { latitude: 28.6139, longitude: 77.209 };
const JAIPUR = { latitude: 26.9124, longitude: 75.7873 };

/**
 * Read a paginated envelope.
 *
 * `paginated()` sends `{ items, pagination }` rather than a bare array. Reading
 * it with an `Array.isArray` fallback made several assertions pass vacuously,
 * so the shape is asserted here instead of guessed.
 */
function pageItems<T>(data: unknown): T[] {
  expect(data).toBeTruthy();
  const envelope = data as { items?: T[]; pagination?: unknown };
  expect(Array.isArray(envelope.items)).toBe(true);
  expect(envelope.pagination).toBeTruthy();
  return envelope.items!;
}

async function createTruck(
  organizationId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; registrationNumber: string }> {
  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: unique('KA01AB').toUpperCase().slice(0, 14),
      truckType: TruckType.OPEN_BODY,
      capacityTons: 20,
      status: TruckStatus.AVAILABLE,
      verificationStatus: VerificationStatus.VERIFIED,
      homeBaseAddress: 'Bengaluru yard',
      homeBaseLatitude: BENGALURU.latitude,
      homeBaseLongitude: BENGALURU.longitude,
      ...overrides,
    },
  });
  return { id: truck.id, registrationNumber: truck.registrationNumber };
}

async function createOpenOrder(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; reference: string }> {
  const customer = await prisma.customer.upsert({
    where: { organizationId: customerOrg.id },
    create: {
      organizationId: customerOrg.id,
      verificationStatus: VerificationStatus.VERIFIED,
    },
    update: {},
  });

  const order = await prisma.order.create({
    data: {
      reference: unique('SO-T-'),
      customerId: customer.id,
      customerOrganizationId: customerOrg.id,
      materialName: 'M-sand',
      quantity: 18,
      unit: 'TON',
      originAddress: 'Pickup point',
      originLatitude: origin.latitude,
      originLongitude: origin.longitude,
      destinationAddress: 'Drop point',
      destinationLatitude: destination.latitude,
      destinationLongitude: destination.longitude,
      requiredCapacityTons: 18,
      status: 'REQUESTED',
      budget: 90_000,
      createdById: customerUser.id,
      ...overrides,
    },
  });
  return { id: order.id, reference: order.reference };
}

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();

  fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  driver = await createUser({
    role: RoleName.DRIVER,
    organizationId: fleet.id,
    driver: true,
  });

  otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
  otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });

  customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BASIC);
  customerUser = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
});

// ===========================================================================
// Profile builder
// ===========================================================================

describe('Profile builder', () => {
  it('returns the driver blueprint with a completion score', async () => {
    const { status, body } = await request<{
      audience: string;
      sections: Array<{ key: string; fields: Array<{ key: string }> }>;
      values: Record<string, unknown>;
      completion: { percent: number; nextBestAction: { sectionKey: string } | null };
    }>({ method: 'GET', url: '/api/v1/profile/builder', user: driver });

    expect(status).toBe(200);
    expect(body.data.audience).toBe('DRIVER');
    expect(body.data.sections.some((section) => section.key === 'licence')).toBe(true);
    expect(body.data.completion.percent).toBeGreaterThanOrEqual(0);
    expect(body.data.completion.percent).toBeLessThan(100);
  });

  it('gives a fleet owner the fleet blueprint instead', async () => {
    const { body } = await request<{ audience: string; sections: Array<{ key: string }> }>({
      method: 'GET',
      url: '/api/v1/profile/builder',
      user: owner,
    });
    expect(body.data.audience).toBe('FLEET');
    expect(body.data.sections.some((section) => section.key === 'business')).toBe(true);
  });

  it('fans a section patch out to the right tables', async () => {
    const { status, body } = await request<{ updatedFields: string[] }>({
      method: 'PATCH',
      url: '/api/v1/profile/builder/identity',
      user: driver,
      payload: {
        values: {
          firstName: 'Ramesh',
          lastName: 'Kumar',
          headline: 'Long-haul driver, 12 years',
          languages: ['Hindi', 'Kannada'],
        },
      },
    });

    expect(status).toBe(200);
    expect(body.data.updatedFields).toContain('headline');

    // firstName lands on `users`, headline and languages on `user_profiles`.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(user.firstName).toBe('Ramesh');

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: driver.id } });
    expect(profile.headline).toBe('Long-haul driver, 12 years');
    expect(profile.languages).toEqual(['Hindi', 'Kannada']);
  });

  it('writes driver fields to the driver record', async () => {
    const { status } = await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/licence',
      user: driver,
      payload: {
        values: {
          licenseNumber: 'KA0120240001234',
          licenseClass: 'HMV',
          licenseExpiryDate: '2030-01-01',
          experienceYears: 12,
          bloodGroup: 'O+',
        },
      },
    });

    expect(status).toBe(200);
    const record = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId! } });
    expect(record.licenseClass).toBe('HMV');
    expect(record.experienceYears).toBe(12);
    expect(record.bloodGroup).toBe('O+');
  });

  it('rejects a field the section does not declare', async () => {
    const { status, body } = await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/identity',
      user: driver,
      payload: { values: { salary: 100000 } },
    });

    // Rejected rather than silently dropped.
    expect(status).toBe(400);
    expect(body.error?.message).toContain('salary');
  });

  it('rejects an unknown section', async () => {
    const { status } = await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/not-a-section',
      user: driver,
      payload: { values: { firstName: 'X' } },
    });
    expect(status).toBe(404);
  });

  it('refuses to accept an image through the form', async () => {
    const { status, body } = await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/photo',
      user: driver,
      payload: { values: { avatar: 'some-media-id' } },
    });
    expect(status).toBe(400);
    expect(body.error?.message).toContain('uploader');
  });

  it('validates a value against its declared kind', async () => {
    const { status, body } = await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/licence',
      user: driver,
      payload: {
        values: {
          licenseNumber: 'KA0120240001234',
          licenseClass: 'HMV',
          licenseExpiryDate: '2030-01-01',
          experienceYears: 900,
        },
      },
    });
    expect(status).toBe(400);
    expect(body.error?.message).toContain('60');
  });

  it('stops a driver writing business fields', async () => {
    // The driver blueprint has no business section at all, so the section
    // itself is unreachable for them — the strongest form of the guard.
    const { status } = await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/business',
      user: driver,
      payload: { values: { name: 'Hijacked Logistics' } },
    });
    expect(status).toBe(404);

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: fleet.id } });
    expect(organization.name).not.toBe('Hijacked Logistics');
  });

  it('merges preference keys rather than replacing the whole column', async () => {
    await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/preferences',
      user: driver,
      payload: { values: { locale: 'hi-IN' } },
    });
    await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/preferences',
      user: driver,
      payload: { values: { theme: 'dark' } },
    });

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: driver.id } });
    const preferences = profile.preferences as Record<string, unknown>;
    // The second patch must not have wiped the first.
    expect(preferences.locale).toBe('hi-IN');
    expect(preferences.theme).toBe('dark');
  });

  it('raises the completion score as sections are filled', async () => {
    const before = await request<{ percent: number }>({
      method: 'GET',
      url: '/api/v1/profile/completion',
      user: driver,
    });

    await request({
      method: 'PATCH',
      url: '/api/v1/profile/builder/licence',
      user: driver,
      payload: {
        values: {
          licenseNumber: 'KA0120240001234',
          licenseClass: 'HMV',
          licenseExpiryDate: '2030-01-01',
          experienceYears: 12,
        },
      },
    });

    const after = await request<{ percent: number }>({
      method: 'GET',
      url: '/api/v1/profile/completion',
      user: driver,
    });

    expect(after.body.data.percent).toBeGreaterThan(before.body.data.percent);
  });

  it('refuses a duplicate profile address', async () => {
    const first = await request({
      method: 'POST',
      url: '/api/v1/profile/slug',
      user: driver,
      payload: { slug: 'ramesh-kumar', target: 'user' },
    });
    expect(first.status).toBe(200);

    const second = await request({
      method: 'POST',
      url: '/api/v1/profile/slug',
      user: owner,
      payload: { slug: 'ramesh-kumar', target: 'user' },
    });
    expect(second.status).toBe(409);
  });

  it('refuses a reserved profile address', async () => {
    const { status } = await request({
      method: 'POST',
      url: '/api/v1/profile/slug',
      user: driver,
      payload: { slug: 'admin', target: 'user' },
    });
    expect(status).toBe(400);
  });

  it('does not list another tenant in the people directory', async () => {
    const { body } = await request({
      method: 'GET',
      url: '/api/v1/profile/directory?kind=people',
      user: owner,
    });

    const items = pageItems<{ id: string }>(body.data);
    expect(items.some((entry) => entry.id === otherOwner.id)).toBe(false);
  });
});

// ===========================================================================
// QR identity
// ===========================================================================

describe('QR identity', () => {
  it('creates a code for a vehicle on first ask and reuses it after', async () => {
    const truck = await createTruck(fleet.id);

    const first = await request<{ id: string; targetUrl: string; shortLabel: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    expect(first.status).toBe(200);
    expect(first.body.data.targetUrl).toContain('/q/');
    expect(first.body.data.shortLabel).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const second = await request<{ id: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('never returns the raw token in an API response', async () => {
    const truck = await createTruck(fleet.id);
    const { body } = await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });

    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });
    // The token appears only inside the target URL the code encodes, never as
    // a field of its own.
    expect(JSON.stringify(body.data)).not.toContain(`"token"`);
    expect((body.data as { targetUrl: string }).targetUrl).toContain(code.token);
  });

  it('renders an SVG and a printable badge', async () => {
    const truck = await createTruck(fleet.id);
    const { body } = await request<{ id: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });

    const app = await getApp();

    const svg = await app.inject({
      method: 'GET',
      url: `/api/v1/qr/${body.data.id}/image.svg`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('<svg');

    const badge = await app.inject({
      method: 'GET',
      url: `/api/v1/qr/${body.data.id}/badge.svg?preset=vehicle-sticker`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(badge.statusCode).toBe(200);
    // Sized in millimetres so it prints at true physical size.
    expect(badge.body).toContain('mm"');
    expect(badge.body).toContain(truck.registrationNumber);
  });

  /*
   * A QR code encodes an absolute URL, and `FRONTEND_URL` is pinned to
   * localhost in every checkout — so a code generated while working through a
   * dev tunnel or from a phone on the LAN used to be unscannable anywhere but
   * the machine that produced it. Outside production the request's own origin
   * decides.
   */
  it('points the code at the host the request came from, not at localhost', async () => {
    const truck = await createTruck(fleet.id);
    const tunnel = 'https://q7x2ab-5173.inc1.devtunnels.ms';

    const viaTunnel = await request<{ targetUrl: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
      headers: { origin: tunnel },
    });
    expect(viaTunnel.body.data.targetUrl.startsWith(`${tunnel}/q/`)).toBe(true);

    // A same-origin GET carries no Origin at all, only a Referer.
    const viaReferer = await request<{ targetUrl: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
      headers: { referer: `${tunnel}/fleet/trucks/${truck.id}` },
    });
    expect(viaReferer.body.data.targetUrl.startsWith(`${tunnel}/q/`)).toBe(true);

    // Nothing to go on falls back to the configured URL.
    const plain = await request<{ targetUrl: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    expect(plain.body.data.targetUrl.startsWith('http://localhost:5173/q/')).toBe(true);
  });

  it('encodes that same host into the rendered image and the sticker', async () => {
    const truck = await createTruck(fleet.id);
    const { body } = await request<{ id: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });

    const app = await getApp();
    const render = (path: string, origin?: string) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/qr/${body.data.id}/${path}`,
        headers: {
          authorization: `Bearer ${owner.accessToken}`,
          ...(origin ? { origin } : {}),
        },
      });

    for (const path of ['image.svg', 'badge.svg?preset=vehicle-sticker']) {
      const [local, tunnel, other] = await Promise.all([
        render(path),
        render(path, 'https://q7x2ab-5173.inc1.devtunnels.ms'),
        render(path, 'https://zz9plz-5173.inc1.devtunnels.ms'),
      ]);

      // The URL lives in the modules, not in any text node, so the proof that
      // it followed the request is that the artwork itself changes with it.
      expect(tunnel.body, path).not.toBe(local.body);
      expect(other.body, path).not.toBe(tunnel.body);
    }
  });

  it('gives the owning fleet the full scope set on a scan', async () => {
    const truck = await createTruck(fleet.id);
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    const { status, body } = await request<{
      scopesGranted: string[];
      vehicle?: { registrationNumber: string };
    }>({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}`,
      user: owner,
    });

    expect(status).toBe(200);
    expect(body.data.scopesGranted).toContain(QrScope.VEHICLE_SUMMARY);
    expect(body.data.vehicle?.registrationNumber).toBe(truck.registrationNumber);
  });

  it('reduces an unrelated tenant to identity only', async () => {
    const truck = await createTruck(fleet.id);
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    const { status, body } = await request<{
      scopesGranted: string[];
      vehicle?: unknown;
      scopesWithheld: Array<{ scope: string; reason: string }>;
    }>({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}`,
      user: otherOwner,
    });

    expect(status).toBe(200);
    expect(body.data.scopesGranted).toEqual([QrScope.IDENTITY]);
    expect(body.data.vehicle).toBeUndefined();
    // The stranger is told what was withheld and why, rather than seeing gaps.
    expect(body.data.scopesWithheld.length).toBeGreaterThan(0);
    expect(body.data.scopesWithheld[0]?.reason.length).toBeGreaterThan(0);
  });

  it('withholds emergency details when there is no active incident', async () => {
    await prisma.driver.update({
      where: { id: driver.driverId! },
      data: { bloodGroup: 'B+', emergencyContactPhone: '+919876543210' },
    });

    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/driver/${driver.driverId}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({
      where: { subjectId: driver.driverId! },
    });

    // Another tenant, no incident: emergency data must not be released.
    const { body } = await request<{ emergency?: unknown; scopesGranted: string[] }>({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}`,
      user: otherOwner,
    });

    expect(body.data.emergency).toBeUndefined();
    expect(body.data.scopesGranted).not.toContain(QrScope.EMERGENCY);
  });

  it('refuses an anonymous scan and logs the attempt', async () => {
    const truck = await createTruck(fleet.id);
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}`,
    });

    // Reported as not-found so an anonymous scanner cannot confirm the token.
    expect(response.statusCode).toBe(404);

    const scans = await prisma.qrScan.findMany({ where: { qrCodeId: code.id } });
    expect(scans.some((scan) => scan.result === 'DENIED')).toBe(true);
  });

  it('stops resolving a revoked code and records the attempt', async () => {
    const truck = await createTruck(fleet.id);
    const { body } = await request<{ id: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    const revoked = await request({
      method: 'POST',
      url: `/api/v1/qr/${body.data.id}/revoke`,
      user: owner,
      payload: { reason: 'Sticker was photographed' },
    });
    expect(revoked.status).toBe(200);

    const resolved = await request({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}`,
      user: owner,
    });
    expect(resolved.status).toBe(422);

    const scans = await prisma.qrScan.findMany({ where: { qrCodeId: code.id } });
    expect(scans.some((scan) => scan.result === 'REVOKED')).toBe(true);
  });

  it('invalidates the old token when a code is rotated', async () => {
    const truck = await createTruck(fleet.id);
    const { body } = await request<{ id: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const original = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    const rotated = await request<{ id: string; version: number }>({
      method: 'POST',
      url: `/api/v1/qr/${body.data.id}/rotate`,
      user: owner,
      payload: { keepScopes: true, reason: 'Replaced the sticker' },
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.version).toBe(2);

    const old = await request({
      method: 'GET',
      url: `/api/v1/qr/resolve/${original.token}`,
      user: owner,
    });
    expect(old.status).toBe(422);

    const fresh = await prisma.qrCode.findUniqueOrThrow({ where: { id: rotated.body.data.id } });
    expect(fresh.token).not.toBe(original.token);

    const resolved = await request({
      method: 'GET',
      url: `/api/v1/qr/resolve/${fresh.token}`,
      user: owner,
    });
    expect(resolved.status).toBe(200);
  });

  it('refuses to make a code for another tenant vehicle', async () => {
    const truck = await createTruck(otherFleet.id);
    const { status } = await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    expect(status).toBe(404);
  });

  it('scopes a driver QR list to their own subjects', async () => {
    const truck = await createTruck(fleet.id);
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/driver/${driver.driverId}`,
      user: owner,
    });

    const { body } = await request({
      method: 'GET',
      url: '/api/v1/qr',
      user: driver,
    });

    const items = pageItems<{ subjectId: string }>(body.data);
    // The driver's own code is present; the fleet's vehicle code is not.
    expect(items.some((entry) => entry.subjectId === driver.driverId)).toBe(true);
    expect(items.every((entry) => entry.subjectId !== truck.id)).toBe(true);
  });

  it('records every scan with its granted scopes', async () => {
    const truck = await createTruck(fleet.id);
    const { body } = await request<{ id: string }>({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    await request({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}?purpose=CHECKPOINT&latitude=12.97&longitude=77.59`,
      user: owner,
    });

    const scans = await request({
      method: 'GET',
      url: `/api/v1/qr/${body.data.id}/scans`,
      user: owner,
    });

    const items = pageItems<{ purpose: string; scopesGranted: string[] }>(scans.body.data);
    const checkpoint = items.find((scan) => scan.purpose === 'CHECKPOINT');
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.scopesGranted.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Return loads
// ===========================================================================

describe('Return loads', () => {
  async function openRequest(truckId: string, overrides: Record<string, unknown> = {}) {
    return request<{ id: string; reference: string; status: string; matchCount: number }>({
      method: 'POST',
      url: '/api/v1/return-loads',
      user: owner,
      payload: {
        truckId,
        // Truck becomes free in Delhi, wants to get back to Bengaluru.
        originAddress: 'Delhi unload point',
        originLatitude: DELHI.latitude,
        originLongitude: DELHI.longitude,
        destinationAddress: 'Bengaluru yard',
        destinationLatitude: BENGALURU.latitude,
        destinationLongitude: BENGALURU.longitude,
        availableFrom: new Date(Date.now() + 3_600_000).toISOString(),
        availableUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        capacityTons: 20,
        detourToleranceKm: 300,
        acceptsPartialLoad: true,
        autoMatch: true,
        ...overrides,
      },
    });
  }

  it('creates a request and matches a homeward load', async () => {
    const truck = await createTruck(fleet.id);
    // A Delhi -> Bengaluru load: exactly the way the truck is going.
    await createOpenOrder(DELHI, BENGALURU, {
      pickupAt: new Date(Date.now() + 4 * 3_600_000),
    });

    const { status, body } = await openRequest(truck.id);
    expect(status).toBe(201);
    expect(body.data.reference).toMatch(/^RL-\d{4}-\d{5}$/);
    expect(body.data.matchCount).toBeGreaterThan(0);
    expect(body.data.status).toBe('MATCHED');
  });

  it('explains each match with its component scores', async () => {
    const truck = await createTruck(fleet.id);
    await createOpenOrder(DELHI, BENGALURU, {
      pickupAt: new Date(Date.now() + 4 * 3_600_000),
    });
    const created = await openRequest(truck.id);

    const { body } = await request({
      method: 'GET',
      url: `/api/v1/return-loads/${created.body.data.id}/matches`,
      user: owner,
    });

    const items = pageItems<{
      score: number;
      detourKm: number;
      reasons: string[];
      emptyKmSaved: number | null;
    }>(body.data);
    expect(items.length).toBeGreaterThan(0);
    const best = items[0]!;
    expect(best.score).toBeGreaterThan(45);
    expect(best.detourKm).toBeLessThan(50);
    // The reasons are what make the ranking trustworthy to a dispatcher.
    expect(best.reasons.length).toBeGreaterThan(2);
    expect(best.emptyKmSaved).toBeGreaterThan(0);
  });

  it('does not match a load running the wrong way', async () => {
    const truck = await createTruck(fleet.id);
    // Pickup near Delhi but heading further away from Bengaluru, well past the
    // detour tolerance.
    await createOpenOrder(DELHI, { latitude: 34.0837, longitude: 74.7973 });

    const created = await openRequest(truck.id, { detourToleranceKm: 50 });
    expect(created.body.data.matchCount).toBe(0);
  });

  it('does not match a load that exceeds the payload', async () => {
    const truck = await createTruck(fleet.id, { capacityTons: 9 });
    await createOpenOrder(DELHI, BENGALURU, { requiredCapacityTons: 25 });

    const created = await openRequest(truck.id, { capacityTons: 9 });
    expect(created.body.data.matchCount).toBe(0);
  });

  it('does not match a load whose pickup is far from the free point', async () => {
    const truck = await createTruck(fleet.id);
    // Pickup in Jaipur while the truck unloads in Delhi — over 250 km away.
    await createOpenOrder(JAIPUR, BENGALURU);

    const created = await openRequest(truck.id);
    expect(created.body.data.matchCount).toBe(0);
  });

  it('refuses a second open request for the same vehicle', async () => {
    const truck = await createTruck(fleet.id);
    await openRequest(truck.id);

    const second = await openRequest(truck.id);
    expect(second.status).toBe(409);
    expect(second.body.error?.message).toContain('already has an open');
  });

  it('refuses a request for a vehicle that has opted out', async () => {
    const truck = await createTruck(fleet.id, { acceptsReturnLoads: false });
    const { status, body } = await openRequest(truck.id);
    expect(status).toBe(422);
    expect(body.error?.message).toContain('not to accept return loads');
  });

  it('refuses a request for another tenant vehicle', async () => {
    const truck = await createTruck(otherFleet.id);
    const { status } = await openRequest(truck.id);
    expect(status).toBe(404);
  });

  it('rejects an inverted availability window', async () => {
    const truck = await createTruck(fleet.id);
    const { status } = await openRequest(truck.id, {
      availableFrom: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      availableUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(status).toBe(400);
  });

  it('turns an accepted match into a real quote on the order', async () => {
    const truck = await createTruck(fleet.id);
    const order = await createOpenOrder(DELHI, BENGALURU, {
      pickupAt: new Date(Date.now() + 4 * 3_600_000),
    });
    const created = await openRequest(truck.id);

    const matches = await request({
      method: 'GET',
      url: `/api/v1/return-loads/${created.body.data.id}/matches`,
      user: owner,
    });
    const matchId = pageItems<{ id: string }>(matches.body.data)[0]!.id;

    const quoted = await request<{ quoteId: string; orderId: string }>({
      method: 'POST',
      url: `/api/v1/return-loads/matches/${matchId}/quote`,
      user: owner,
      payload: { price: 72_000, message: 'Already returning this way.' },
    });

    expect(quoted.status).toBe(201);

    // The quote enters the ordinary order pipeline, not a parallel one.
    const quote = await prisma.orderQuote.findUniqueOrThrow({
      where: { id: quoted.body.data.quoteId },
    });
    expect(quote.orderId).toBe(order.id);
    expect(quote.fleetOrganizationId).toBe(fleet.id);
    expect(quote.truckId).toBe(truck.id);
    expect(Number(quote.price)).toBe(72_000);

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('QUOTED');
    expect(updatedOrder.isReturnLoad).toBe(true);
    expect(updatedOrder.returnLoadRequestId).toBe(created.body.data.id);
  });

  it('refuses to quote the same match twice', async () => {
    const truck = await createTruck(fleet.id);
    await createOpenOrder(DELHI, BENGALURU, { pickupAt: new Date(Date.now() + 4 * 3_600_000) });
    const created = await openRequest(truck.id);

    const matches = await request({
      method: 'GET',
      url: `/api/v1/return-loads/${created.body.data.id}/matches`,
      user: owner,
    });
    const matchId = pageItems<{ id: string }>(matches.body.data)[0]!.id;

    await request({
      method: 'POST',
      url: `/api/v1/return-loads/matches/${matchId}/quote`,
      user: owner,
      payload: { price: 72_000 },
    });

    const again = await request({
      method: 'POST',
      url: `/api/v1/return-loads/matches/${matchId}/quote`,
      user: owner,
      payload: { price: 70_000 },
    });
    expect(again.status).toBe(422);
  });

  it('re-verifies the match before quoting on a stale score', async () => {
    const truck = await createTruck(fleet.id);
    const order = await createOpenOrder(DELHI, BENGALURU, {
      pickupAt: new Date(Date.now() + 4 * 3_600_000),
    });
    const created = await openRequest(truck.id);

    const matches = await request({
      method: 'GET',
      url: `/api/v1/return-loads/${created.body.data.id}/matches`,
      user: owner,
    });
    const matchId = pageItems<{ id: string }>(matches.body.data)[0]!.id;

    // The order grows beyond the truck between scoring and quoting.
    await prisma.order.update({
      where: { id: order.id },
      data: { requiredCapacityTons: 40 },
    });

    const quoted = await request({
      method: 'POST',
      url: `/api/v1/return-loads/matches/${matchId}/quote`,
      user: owner,
      payload: { price: 72_000 },
    });

    expect(quoted.status).toBe(422);
    expect(quoted.body.error?.message).toContain('no longer fits');
  });

  it('cancels a request and expires its open matches', async () => {
    const truck = await createTruck(fleet.id);
    await createOpenOrder(DELHI, BENGALURU, { pickupAt: new Date(Date.now() + 4 * 3_600_000) });
    const created = await openRequest(truck.id);

    const cancelled = await request<{ status: string }>({
      method: 'POST',
      url: `/api/v1/return-loads/${created.body.data.id}/cancel`,
      user: owner,
      payload: { reason: 'Truck reassigned' },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const matches = await prisma.returnLoadMatch.findMany({
      where: { returnLoadRequestId: created.body.data.id },
    });
    expect(matches.every((match) => match.status === 'EXPIRED')).toBe(true);
  });

  it('does not list another tenant requests', async () => {
    const mine = await createTruck(fleet.id);
    await openRequest(mine.id);

    const { body } = await request({
      method: 'GET',
      url: '/api/v1/return-loads',
      user: otherOwner,
    });
    expect(pageItems<{ organizationId: string }>(body.data)).toHaveLength(0);
  });

  it('returns 404 rather than 403 for another tenant request', async () => {
    const truck = await createTruck(fleet.id);
    const created = await openRequest(truck.id);

    const { status } = await request({
      method: 'GET',
      url: `/api/v1/return-loads/${created.body.data.id}`,
      user: otherOwner,
    });
    expect(status).toBe(404);
  });

  it('blocks a customer from creating a return-load request', async () => {
    const truck = await createTruck(fleet.id);
    const { status } = await request({
      method: 'POST',
      url: '/api/v1/return-loads',
      user: customerUser,
      payload: { truckId: truck.id },
    });
    // Customers hold neither the permission nor the entitlement.
    expect([402, 403]).toContain(status);
  });

  it('lets a driver read but not create', async () => {
    const truck = await createTruck(fleet.id);
    await openRequest(truck.id);

    const read = await request({
      method: 'GET',
      url: '/api/v1/return-loads',
      user: driver,
    });
    expect(read.status).toBe(200);

    const write = await request({
      method: 'POST',
      url: '/api/v1/return-loads',
      user: driver,
      payload: { truckId: truck.id },
    });
    expect(write.status).toBe(403);
  });

  it('flags trips arriving with no return load lined up', async () => {
    const truck = await createTruck(fleet.id);

    await prisma.trip.create({
      data: {
        reference: unique('TR-T-'),
        organizationId: fleet.id,
        truckId: truck.id,
        driverId: driver.driverId!,
        originAddress: 'Bengaluru yard',
        originLatitude: BENGALURU.latitude,
        originLongitude: BENGALURU.longitude,
        destinationAddress: 'Delhi drop',
        destinationLatitude: DELHI.latitude,
        destinationLongitude: DELHI.longitude,
        status: 'IN_TRANSIT',
        etaAt: new Date(Date.now() + 6 * 3_600_000),
        createdById: owner.id,
      },
    });

    const { status, body } = await request<
      Array<{ hasReturnLoad: boolean; emptyReturnKm: number | null; truckId: string }>
    >({
      method: 'GET',
      url: '/api/v1/return-loads/empty-risk?horizonHours=48',
      user: owner,
    });

    expect(status).toBe(200);
    const rows = Array.isArray(body.data) ? body.data : [];
    const row = rows.find((entry) => entry.truckId === truck.id);
    expect(row).toBeDefined();
    expect(row?.hasReturnLoad).toBe(false);
    // Delhi to Bengaluru is roughly 1700 km as the crow flies.
    expect(row?.emptyReturnKm).toBeGreaterThan(1500);
  });

  it('surfaces which of my trucks could take an open order', async () => {
    const truck = await createTruck(fleet.id);
    await openRequest(truck.id);
    const order = await createOpenOrder(DELHI, BENGALURU, {
      pickupAt: new Date(Date.now() + 4 * 3_600_000),
    });

    const { status, body } = await request<
      Array<{ truckId: string; score: number; emptyKmSaved: number }>
    >({
      method: 'GET',
      url: `/api/v1/orders/${order.id}/return-candidates`,
      user: owner,
    });

    expect(status).toBe(200);
    const rows = Array.isArray(body.data) ? body.data : [];
    expect(rows.some((entry) => entry.truckId === truck.id)).toBe(true);
  });

  it('gates the whole surface behind the plan feature', async () => {
    // Basic does not include RETURN_LOADS.
    const basicFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
    const basicOwner = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: basicFleet.id,
    });

    const { status } = await request({
      method: 'GET',
      url: '/api/v1/return-loads',
      user: basicOwner,
    });
    expect([402, 403]).toContain(status);
  });
});

// ===========================================================================
// Cross-feature
// ===========================================================================

describe('QR and return loads together', () => {
  it('resolves a vehicle QR that is carrying a return load', async () => {
    const truck = await createTruck(fleet.id);
    await createOpenOrder(DELHI, BENGALURU, { pickupAt: new Date(Date.now() + 4 * 3_600_000) });
    await request({
      method: 'POST',
      url: '/api/v1/return-loads',
      user: owner,
      payload: {
        truckId: truck.id,
        originAddress: 'Delhi unload point',
        originLatitude: DELHI.latitude,
        originLongitude: DELHI.longitude,
        destinationAddress: 'Bengaluru yard',
        destinationLatitude: BENGALURU.latitude,
        destinationLongitude: BENGALURU.longitude,
        availableFrom: new Date(Date.now() + 3_600_000).toISOString(),
        availableUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        capacityTons: 20,
        detourToleranceKm: 300,
        acceptsPartialLoad: true,
        autoMatch: true,
      },
    });

    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });

    const { status, body } = await request<{ vehicle?: { registrationNumber: string } }>({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}?purpose=PICKUP`,
      user: owner,
    });

    expect(status).toBe(200);
    expect(body.data.vehicle?.registrationNumber).toBe(truck.registrationNumber);
  });

  it('shows a driver photo on their QR scan once uploaded', async () => {
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/driver/${driver.driverId}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({
      where: { subjectId: driver.driverId! },
    });

    // Stand in for the upload path, which has its own coverage.
    await prisma.mediaAsset.create({
      data: {
        organizationId: fleet.id,
        ownerType: 'USER',
        ownerId: driver.id,
        purpose: 'AVATAR',
        visibility: 'PLATFORM',
        storageKey: 'media/test/avatar.webp',
        fileName: 'avatar.webp',
        mimeType: 'image/webp',
        fileSize: 2048,
        isPrimary: true,
        uploadedById: driver.id,
      },
    });

    const { body } = await request<{ identity: { imageUrl: string | null } }>({
      method: 'GET',
      url: `/api/v1/qr/resolve/${code.token}`,
      user: owner,
    });

    expect(body.data.identity.imageUrl).toContain('/media/');
  });
});

export { QrSubjectType };

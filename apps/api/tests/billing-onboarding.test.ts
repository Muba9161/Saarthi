import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationType, PlanTier, RoleName, VehicleType } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { paymentProvider } from '../src/providers/payments';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  uniquePhone,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Paying at the right moment: registration, the ₹99 vehicle slot, autopay.
 *
 * Runs on the mock gateway, which settles in-process. Where the gateway has to
 * misbehave, its own method is stood in for.
 */

let fleet: TestOrganization;
let owner: TestUser;

let sequence = 0;
/** A distinct, well-formed plate per call. */
const plate = (): string => {
  sequence += 1;
  return `UP32AB${String(1000 + sequence).slice(-4)}`;
};

const truckPayload = (registrationNumber = plate()) => ({
  registrationNumber,
  vehicleType: VehicleType.TRUCK,
  capacityTons: 12,
});

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();
  // No fixture top-ups: these tests are about the one vehicle the plan covers.
  fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, { vehicleTopUps: 0 });
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('still creates the account when the add-on payment cannot be opened', async () => {
    vi.spyOn(paymentProvider, 'createIntent').mockRejectedValue(new Error('Gateway unreachable'));
    const email = `${unique('signup').toLowerCase()}@saarthi.test`;

    const response = await request<{ session: { organization: { id: string } | null } }>({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        firstName: 'Anil',
        lastName: 'Verma',
        email,
        phone: uniquePhone(),
        password: 'Monsoon2026road',
        role: RoleName.FLEET_OWNER,
        organizationName: unique('Verma Transport '),
        acceptedTerms: true,
        planTier: PlanTier.BUSINESS,
        planVehicles: 3,
        planTrackers: 0,
      },
    });

    expect(response.status).toBe(201);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(response.body.data.session.organization?.id).toBeTruthy();
  });
});

describe('the ₹99 vehicle slot', () => {
  it('runs a slot bought mid-period to the plan’s own renewal date, so no day is paid twice', async () => {
    const renewal = new Date(Date.now() + 10 * 86_400_000);
    await prisma.subscription.update({ where: { organizationId: fleet.id }, data: { endsAt: renewal } });

    const response = await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });
    expect(response.status).toBe(201);

    const topUp = await prisma.vehicleSubscriptionTopUp.findFirstOrThrow({
      where: { organizationId: fleet.id, status: 'ACTIVE' },
    });
    expect(topUp.expiresAt?.getTime()).toBe(renewal.getTime());
  });

  it('says a vehicle is addable before the slot is paid for, though the plan is full', async () => {
    // Fill the one vehicle the plan covers.
    const first = await request({ method: 'POST', url: '/api/v1/fleet/vehicles', user: owner, payload: truckPayload() });
    expect(first.status).toBe(201);

    const candidate = truckPayload();
    const check = await request<{ addable: boolean }>({
      method: 'POST',
      url: '/api/v1/fleet/vehicles/check',
      user: owner,
      payload: candidate,
    });
    expect(check.status).toBe(200);
    expect(check.body.data.addable).toBe(true);

    // The check writes nothing, and the add itself is still refused until paid.
    const refused = await request({ method: 'POST', url: '/api/v1/fleet/vehicles', user: owner, payload: candidate });
    expect(refused.status).toBe(403);

    await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });
    const added = await request({ method: 'POST', url: '/api/v1/fleet/vehicles', user: owner, payload: candidate });
    expect(added.status).toBe(201);
  });

  it('refuses a plate already on Saarthi before anything is paid', async () => {
    const taken = truckPayload();
    await request({ method: 'POST', url: '/api/v1/fleet/vehicles', user: owner, payload: taken });

    const check = await request({ method: 'POST', url: '/api/v1/fleet/vehicles/check', user: owner, payload: taken });
    expect(check.status).toBe(409);
  });

  it('refuses a Personal account holder without a verified Aadhaar before anything is paid', async () => {
    const personal = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    await prisma.organization.update({ where: { id: personal.id }, data: { isPersonalSeat: true } });
    const person = await createUser({ role: RoleName.FLEET_OWNER, organizationId: personal.id });
    const car = () => ({ registrationNumber: plate(), vehicleType: VehicleType.CAR, passengerCapacity: 4 });

    // The vehicle the plan includes goes on without it.
    const first = await request({ method: 'POST', url: '/api/v1/fleet/vehicles', user: person, payload: car() });
    expect(first.status).toBe(201);

    const check = await request<unknown>({
      method: 'POST',
      url: '/api/v1/fleet/vehicles/check',
      user: person,
      payload: car(),
    });
    expect(check.status).toBe(403);
    expect(check.body.error?.code).toBe('IDENTITY_VERIFICATION_REQUIRED');
  });
});

describe('autopay', () => {
  it('accepts only the known return screens', async () => {
    const refused = await request({
      method: 'POST',
      url: '/api/v1/subscriptions/billing/autopay',
      user: owner,
      payload: { returnTo: 'https://example.com' },
    });
    expect(refused.status).toBe(400);

    const mandate = vi.spyOn(paymentProvider, 'createMandate');
    const accepted = await request({
      method: 'POST',
      url: '/api/v1/subscriptions/billing/autopay',
      user: owner,
      payload: { returnTo: 'activation' },
    });
    expect(accepted.status).toBe(200);
    expect(mandate.mock.calls[0]?.[0].returnPath).toBe('/activate');
  });
});

describe('driver app invitations', () => {
  it('reports which drivers have already been asked to install the app', async () => {
    const driverUser = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });

    const before = await request<{ invitedDriverIds: string[]; driverCount: number }>({
      method: 'GET',
      url: '/api/v1/drivers/app-invites',
      user: owner,
    });
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ invitedDriverIds: [], driverCount: 1 });

    await request({
      method: 'POST',
      url: '/api/v1/drivers/app-invites',
      user: owner,
      payload: { driverIds: [driverUser.driverId] },
    });

    const after = await request<{ invitedDriverIds: string[] }>({
      method: 'GET',
      url: '/api/v1/drivers/app-invites',
      user: owner,
    });
    expect(after.body.data.invitedDriverIds).toEqual([driverUser.driverId]);
  });
});

describe('payment history', () => {
  interface History {
    upcoming: { title: string; amount: number | null }[];
    entries: { kind: string; category: string; title: string; amount: number | null; status: string | null }[];
  }

  it('lists what was paid and what changed, newest first, with what comes next', async () => {
    await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });
    await request({ method: 'POST', url: '/api/v1/subscriptions/billing/autopay', user: owner, payload: {} });

    const response = await request<History>({ method: 'GET', url: '/api/v1/subscriptions/billing/history', user: owner });
    expect(response.status).toBe(200);

    const { entries, upcoming } = response.body.data;
    expect(entries).toContainEqual(
      expect.objectContaining({ kind: 'PAYMENT', category: 'ADD_ONS', title: 'Extra vehicle', amount: 99, status: 'PAID' }),
    );
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'EVENT', title: 'Autopay set up' }));
    // The account's first event is the oldest one.
    expect(entries.at(-1)?.title).toBe('Account created');
    expect(upcoming.length).toBeGreaterThan(0);
  });

  it('shows an organization only its own payments', async () => {
    await request({ method: 'POST', url: '/api/v1/subscriptions/topups', user: owner, payload: {} });
    const other = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, { vehicleTopUps: 0 });
    const otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: other.id });

    const response = await request<History>({ method: 'GET', url: '/api/v1/subscriptions/billing/history', user: otherOwner });
    expect(response.body.data.entries.filter((entry) => entry.kind === 'PAYMENT')).toHaveLength(0);
  });
});

describe('one payment for a new vehicle', () => {
  it('charges the slot and the tracker together, as one final amount', async () => {
    // Fill the vehicle the plan covers, so the next one needs a slot.
    await request({ method: 'POST', url: '/api/v1/fleet/vehicles', user: owner, payload: truckPayload() });

    const order = await request<{ trackerId: string | null; total: number }>({
      method: 'POST',
      url: '/api/v1/subscriptions/vehicle-order',
      user: owner,
      payload: { slot: true, trackerProduct: 'OBD_BLUETOOTH' },
    });
    expect(order.status).toBe(201);
    // ₹99 slot + ₹709 OBD (₹599 + 18% GST, rounded up to end in 9).
    expect(order.body.data.total).toBe(808);
    expect(order.body.data.trackerId).toBeTruthy();

    const payments = await prisma.payment.findMany({ where: { organizationId: fleet.id, reference: { startsWith: 'VEHICLE-' } } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]?.amount)).toBe(808);

    // Both went live on the one payment: the vehicle can now be added, and its tracker fitted.
    const added = await request<{ id: string }>({ method: 'POST', url: '/api/v1/fleet/vehicles', user: owner, payload: truckPayload() });
    expect(added.status).toBe(201);
    const fitted = await request({
      method: 'POST',
      url: `/api/v1/subscriptions/trackers/${order.body.data.trackerId}/assign`,
      user: owner,
      payload: { truckId: added.body.data.id },
    });
    expect(fitted.status).toBe(200);
  });

  it('sells a tracker with the first vehicle, before the vehicle exists', async () => {
    const order = await request<{ total: number }>({
      method: 'POST',
      url: '/api/v1/subscriptions/vehicle-order',
      user: owner,
      payload: { slot: false, trackerProduct: 'CONNECTED_4G' },
    });
    expect(order.status).toBe(201);
    expect(order.body.data.total).toBe(2359);
  });

  it('refuses an empty order', async () => {
    const order = await request({ method: 'POST', url: '/api/v1/subscriptions/vehicle-order', user: owner, payload: { slot: false } });
    expect(order.status).toBe(400);
  });
});

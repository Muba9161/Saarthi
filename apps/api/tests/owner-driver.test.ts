import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  PlanTier,
  RoleName,
  TerminalSessionStatus,
  TruckType,
  VehicleType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type SessionPayload,
  type TestUser,
} from './helpers';

/**
 * An account holder who drives one of the account's own vehicles.
 *
 * Assigning yourself a vehicle adds you to your own driver list, and that
 * profile brings the driver's permissions with it: raising an SOS, signing on
 * to the vehicle, running the driver app. The owner's own sign-on is approved
 * by the owner — he is the person the approval asks for — while anybody else
 * who drives still waits in the queue.
 */

const plate = (): string => `UP16AB${Math.floor(1000 + Math.random() * 8999)}`;

async function addVehicle(user: TestUser, tier: PlanTier): Promise<{ id: string; registrationNumber: string }> {
  const registrationNumber = plate();
  const response = await request<{ id: string }>({
    method: 'POST',
    url: tier === PlanTier.PERSONAL ? '/api/v1/fleet/vehicles' : '/api/v1/trucks',
    user,
    payload:
      tier === PlanTier.PERSONAL
        ? { registrationNumber, vehicleType: VehicleType.CAR, fuelType: 'PETROL', passengerCapacity: 5 }
        : { registrationNumber, vehicleType: VehicleType.TRUCK, truckType: TruckType.TIPPER, capacityTons: 12 },
  });
  expect(response.status).toBe(201);
  return { id: response.body.data.id, registrationNumber };
}

async function signOn(user: TestUser, registrationNumber: string) {
  return request<{ id: string; status: string }>({
    method: 'POST',
    url: '/api/v1/terminal/assignments/request',
    user,
    payload: { registrationNumber },
  });
}

async function permissionsOf(user: TestUser): Promise<string[]> {
  const me = await request<SessionPayload>({ method: 'GET', url: '/api/v1/auth/me', user });
  return me.body.data.permissions;
}

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('an owner who drives their own vehicle', () => {
  for (const tier of [PlanTier.PERSONAL, PlanTier.BUSINESS]) {
    describe(`on ${tier}`, () => {
      let owner: TestUser;
      let vehicle: { id: string; registrationNumber: string };

      beforeEach(async () => {
        const org = await createOrganization(OrganizationType.FLEET_OWNER, tier);
        if (tier === PlanTier.PERSONAL) {
          await prisma.organization.update({ where: { id: org.id }, data: { isPersonalSeat: true } });
        }
        owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: org.id, driver: true });
        vehicle = await addVehicle(owner, tier);
      });

      it('gets the driver permissions and keeps the owner ones', async () => {
        const permissions = await permissionsOf(owner);
        expect(permissions).toEqual(
          expect.arrayContaining(['sos.trigger', 'terminal.drive', 'trips.drive', 'terminal.approve']),
        );
      });

      it('can raise an SOS', async () => {
        const sos = await request({
          method: 'POST',
          url: '/api/v1/sos',
          user: owner,
          payload: { type: 'BREAKDOWN', latitude: 28.61, longitude: 77.2 },
        });
        expect(sos.status).toBe(201);
      });

      it('is signed on straight away, approved by themselves', async () => {
        const response = await signOn(owner, vehicle.registrationNumber);
        expect(response.status).toBe(201);
        expect(response.body.data.status).toBe(TerminalSessionStatus.APPROVED);

        const session = await prisma.terminalSession.findUniqueOrThrow({
          where: { id: response.body.data.id },
          include: { events: true },
        });
        expect(session.decidedById).toBe(owner.id);
        expect(session.events.map((event) => event.eventType)).toEqual(
          expect.arrayContaining(['REQUESTED', 'APPROVED']),
        );

        const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
        expect(truck.currentDriverId).toBe(owner.driverId);
      });
    });
  }

  it('does not gain driver permissions without a driver profile', async () => {
    const org = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    const owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: org.id });
    const vehicle = await addVehicle(owner, PlanTier.BUSINESS);

    expect(await permissionsOf(owner)).not.toContain('sos.trigger');
    expect((await signOn(owner, vehicle.registrationNumber)).status).toBe(403);
  });
});

describe('everybody else who drives still waits for approval', () => {
  let org: { id: string };
  let owner: TestUser;
  let vehicle: { id: string; registrationNumber: string };

  beforeEach(async () => {
    org = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: org.id });
    vehicle = await addVehicle(owner, PlanTier.BUSINESS);
  });

  it('keeps a manager who drives in the queue', async () => {
    const manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: org.id, driver: true });
    expect(await permissionsOf(manager)).toContain('sos.trigger');

    const response = await signOn(manager, vehicle.registrationNumber);
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe(TerminalSessionStatus.DRIVER_IDENTIFIED);
  });

  it('keeps an employed driver in the queue', async () => {
    const driver = await createUser({ role: RoleName.DRIVER, organizationId: org.id, driver: true });

    const response = await signOn(driver, vehicle.registrationNumber);
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe(TerminalSessionStatus.DRIVER_IDENTIFIED);
  });

  it('never lets an owner sign on to another account’s vehicle', async () => {
    const other = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    const otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: other.id, driver: true });

    expect((await signOn(otherOwner, vehicle.registrationNumber)).status).toBe(404);
  });
});

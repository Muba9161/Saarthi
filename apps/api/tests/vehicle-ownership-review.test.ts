import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  RoleName,
  TruckType,
  VehicleOwnershipStatus,
  VehicleType,
  type OwnershipReviewSummary,
  type OwnershipReviewView,
  type VehicleOwnershipView,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  authHeaders,
  closeApp,
  createOrganization,
  createUser,
  getApp,
  multipart,
  request,
  resetDatabase,
  sampleJpeg,
  type ApiErrorBody,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Ownership confirmed by the Saarthi team, when the RC owner's name cannot be
 * matched automatically: a name romanised beyond the matcher, a married name, a
 * vehicle in a relative's name, no RC to hand.
 *
 * An approval moves a vehicle between accounts, so the tests worth having are
 * who may ask, who may decide, and that an approval does exactly what a name
 * match does: confirm the account's own vehicle, or let a plate another
 * account holds unconfirmed move when it is added again.
 */

const PLATE = 'UP32AB1234';
const MESSAGE = 'The RC is in my name as SMT. BHAWNA PANDEY; my PAN spells it BHAVANA PANDEY.';

let fleet: TestOrganization;
let otherFleet: TestOrganization;
let owner: TestUser;
let otherOwner: TestUser;
let admin: TestUser;

/** Send a request as a browser would: multipart, with the RC only if given. */
async function askForReview(
  user: TestUser,
  fields: Record<string, string>,
  file?: { content: Buffer; contentType: string; fileName?: string },
) {
  const body = multipart(
    { message: MESSAGE, ...fields },
    file
      ? {
          fieldName: 'file',
          fileName: file.fileName ?? 'rc.jpg',
          contentType: file.contentType,
          content: file.content,
        }
      : undefined,
  );
  const response = await (await getApp()).inject({
    method: 'POST',
    url: '/api/v1/fleet/ownership-reviews',
    payload: body.payload,
    headers: { ...authHeaders(user), ...body.headers },
  });
  return {
    status: response.statusCode,
    body: response.json() as { data: OwnershipReviewView; error?: ApiErrorBody },
  };
}

const decide = (user: TestUser, id: string, payload: Record<string, unknown>) =>
  request<OwnershipReviewView>({
    method: 'POST',
    url: `/api/v1/admin/ownership-reviews/${id}/decision`,
    user,
    payload,
  });

const addVehicle = (user: TestUser) =>
  request<{ id: string; ownership: VehicleOwnershipView }>({
    method: 'POST',
    url: '/api/v1/fleet/vehicles',
    user,
    payload: {
      registrationNumber: PLATE,
      vehicleType: VehicleType.TRUCK,
      truckType: TruckType.OPEN_BODY,
      capacityTons: 25,
      fuelType: 'DIESEL',
    },
  });

const holdPlate = (organizationId: string, ownershipStatus = VehicleOwnershipStatus.PENDING) =>
  prisma.truck.create({
    data: { organizationId, registrationNumber: PLATE, capacityTons: 12, ownershipStatus },
    select: { id: true },
  });

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();
  fleet = await createOrganization(OrganizationType.FLEET_OWNER);
  otherFleet = await createOrganization(OrganizationType.FLEET_OWNER);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
  admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
});

describe("the account's own vehicle", () => {
  it('is confirmed the moment the team approves, with only a message and no RC', async () => {
    const truck = await holdPlate(fleet.id);

    const asked = await askForReview(owner, { vehicleId: truck.id });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect(asked.body.data).toMatchObject({ kind: 'OWN_VEHICLE', status: 'PENDING', hasAttachment: false });

    const queue = await request<{ items: OwnershipReviewSummary[] }>({
      method: 'GET',
      url: '/api/v1/admin/ownership-reviews',
      user: admin,
    });
    expect(queue.body.data.items.map((item) => item.id)).toContain(asked.body.data.id);

    const decided = await decide(admin, asked.body.data.id, { decision: 'APPROVED' });
    expect(decided.status).toBe(200);

    const confirmed = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(confirmed.ownershipStatus).toBe(VehicleOwnershipStatus.VERIFIED);
    const event = await prisma.truckEvent.findFirstOrThrow({
      where: { truckId: truck.id, type: 'OWNERSHIP_VERIFIED' },
    });
    expect(event.description).toMatch(/Saarthi team/);
  });

  it('tells the owner why when the team rejects, and lets them ask again', async () => {
    const truck = await holdPlate(fleet.id);
    const asked = await askForReview(owner, { vehicleId: truck.id });

    // A rejection must say why: the owner reads it.
    expect((await decide(admin, asked.body.data.id, { decision: 'REJECTED' })).status).toBe(400);
    const rejected = await decide(admin, asked.body.data.id, {
      decision: 'REJECTED',
      note: 'The RC uploaded is for a different vehicle.',
    });
    expect(rejected.status).toBe(200);

    const latest = await request<OwnershipReviewView>({
      method: 'GET',
      url: `/api/v1/fleet/ownership-reviews/latest?vehicleId=${truck.id}`,
      user: owner,
    });
    expect(latest.body.data).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'The RC uploaded is for a different vehicle.',
    });
    const still = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(still.ownershipStatus).toBe(VehicleOwnershipStatus.PENDING);

    expect((await askForReview(owner, { vehicleId: truck.id })).status).toBe(201);
  });

  it('keeps one request at a time per vehicle', async () => {
    const truck = await holdPlate(fleet.id);
    await askForReview(owner, { vehicleId: truck.id });

    const again = await askForReview(owner, { vehicleId: truck.id });

    expect(again.status).toBe(409);
  });
});

describe('a plate another account holds unconfirmed', () => {
  it('moves to the requester once approved, when they add it again', async () => {
    const held = await holdPlate(otherFleet.id);

    const refused = await addVehicle(owner);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.details).toMatchObject({ reviewable: true, reviewPending: false });

    const asked = await askForReview(
      owner,
      { registrationNumber: PLATE },
      { content: sampleJpeg(2048), contentType: 'image/jpeg' },
    );
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect(asked.body.data).toMatchObject({ kind: 'CLAIM', hasAttachment: true });

    // While it waits, adding again says so rather than repeating the refusal.
    const waiting = await addVehicle(owner);
    expect(waiting.status).toBe(409);
    expect(waiting.body.error?.details).toMatchObject({ reviewPending: true });
    expect(waiting.body.error?.message).toMatch(/waiting/);

    await decide(admin, asked.body.data.id, { decision: 'APPROVED' });
    const added = await addVehicle(owner);

    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.data.ownership.status).toBe(VehicleOwnershipStatus.VERIFIED);
    const released = await prisma.truck.findUniqueOrThrow({ where: { id: held.id } });
    expect(released.ownershipStatus).toBe(VehicleOwnershipStatus.RELEASED);
  });

  it('is not reviewed once the holder has confirmed it', async () => {
    await holdPlate(otherFleet.id, VehicleOwnershipStatus.VERIFIED);

    const asked = await askForReview(owner, { registrationNumber: PLATE });

    expect(asked.status).toBe(422);
    expect(await prisma.vehicleOwnershipReview.count()).toBe(0);
  });
});

describe('who may ask, and who may decide', () => {
  it("will not review another account's vehicle", async () => {
    const theirs = await holdPlate(otherFleet.id);

    const asked = await askForReview(owner, { vehicleId: theirs.id });

    expect(asked.status).toBe(404);
  });

  it('lets only the Saarthi team see or decide requests', async () => {
    const truck = await holdPlate(fleet.id);
    const asked = await askForReview(owner, { vehicleId: truck.id });

    const list = await request({ method: 'GET', url: '/api/v1/admin/ownership-reviews', user: owner });
    const decision = await decide(otherOwner, asked.body.data.id, { decision: 'APPROVED' });

    expect(list.status).toBe(403);
    expect(decision.status).toBe(403);
    const still = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(still.ownershipStatus).toBe(VehicleOwnershipStatus.PENDING);
  });

  it('refuses an attachment that is not a photo or a PDF', async () => {
    const truck = await holdPlate(fleet.id);

    const asked = await askForReview(
      owner,
      { vehicleId: truck.id },
      { content: Buffer.from('#!/bin/sh\necho hi\n'), contentType: 'image/jpeg', fileName: 'rc.jpg' },
    );

    expect(asked.status).toBe(415);
    expect(await prisma.vehicleOwnershipReview.count()).toBe(0);
  });
});

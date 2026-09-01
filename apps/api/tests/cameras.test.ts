import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName, TruckType } from '@saarthi/shared';
import bcrypt from 'bcryptjs';
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
 * Multi-camera devices (YC06).
 *
 * The assertions here are mostly about accountability. A camera in a cab points
 * at a person, so what matters is that every view is recorded, that a refused
 * view is recorded too, and that moving a recorder between vehicles moves its
 * cameras without rewriting any history.
 */
describe('Vehicle cameras', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let owner: TestUser;
  let otherOwner: TestUser;
  let admin: TestUser;
  let vehicle: { id: string; registrationNumber: string };
  let device: { id: string; deviceIdentifier: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
    admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP32AB').toUpperCase().slice(0, 12),
        truckType: TruckType.TIPPER,
        capacityTons: 25,
      },
    });
    vehicle = { id: truck.id, registrationNumber: truck.registrationNumber };

    const recorder = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('YC06-').toUpperCase().slice(0, 16),
        provider: 'YC06',
        deviceType: 'MULTI_CAMERA',
        serialNumber: unique('SN-'),
        secretHash: await bcrypt.hash('device-secret', 4),
        status: 'ACTIVE',
        supportedMetrics: [],
        observedMetrics: [],
      },
    });
    device = { id: recorder.id, deviceIdentifier: recorder.deviceIdentifier };

    await prisma.deviceAssignment.create({
      data: {
        deviceId: recorder.id,
        vehicleId: truck.id,
        organizationId: fleet.id,
        status: 'ACTIVE',
      },
    });
  });

  interface CameraBody {
    id: string;
    channel: number;
    position: string;
    label: string | null;
    enabled: boolean;
    vehicleId: string | null;
    registrationNumber: string | null;
  }

  const registerCamera = (payload: Record<string, unknown>, user: TestUser = admin) =>
    request<CameraBody>({
      method: 'POST',
      url: `/api/v1/devices/${device.id}/cameras`,
      user,
      payload,
    });

  async function registerFourCameras(): Promise<CameraBody[]> {
    const positions = ['FRONT', 'CABIN', 'LEFT', 'REAR'];
    const cameras: CameraBody[] = [];

    for (let channel = 1; channel <= 4; channel += 1) {
      const response = await registerCamera({
        channel,
        position: positions[channel - 1],
        label: `Camera ${channel}`,
      });
      cameras.push(response.body.data);
    }
    return cameras;
  }

  // -------------------------------------------------------------------------

  /*
   * Run a block with live viewing switched off.
   *
   * These tests are about what happens on a deployment with no camera
   * infrastructure, and they used to establish that by assuming the
   * developer's own `.env` had none — so they passed until somebody
   * configured a gateway locally, and then failed for a reason that had
   * nothing to do with the code under test.
   *
   * `supportsLive` is a plain readonly property rather than a getter, so it
   * is redefined and restored instead of spied on.
   */
  async function withoutGateway<T>(body: () => Promise<T>): Promise<T> {
    const { videoProvider } = await import('../src/providers/video');
    const live = videoProvider.supportsLive;
    const publish = videoProvider.supportsPublishing;
    Object.defineProperty(videoProvider, 'supportsLive', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(videoProvider, 'supportsPublishing', {
      value: false,
      configurable: true,
    });
    try {
      return await body();
    } finally {
      Object.defineProperty(videoProvider, 'supportsLive', {
        value: live,
        configurable: true,
      });
      Object.defineProperty(videoProvider, 'supportsPublishing', {
        value: publish,
        configurable: true,
      });
    }
  }

  describe('registration', () => {
    it('registers all four channels of a YC06', async () => {
      const cameras = await registerFourCameras();

      expect(cameras).toHaveLength(4);
      expect(cameras.map((camera) => camera.channel)).toEqual([1, 2, 3, 4]);
      expect(cameras[1]?.position).toBe('CABIN');
    });

    it('replaces the lens on a channel rather than adding a second one', async () => {
      await registerCamera({ channel: 1, position: 'FRONT', label: 'Original' });
      const replaced = await registerCamera({ channel: 1, position: 'REAR', label: 'Replacement' });

      expect(replaced.status).toBe(201);
      expect(replaced.body.data.position).toBe('REAR');

      // A channel is a physical socket: fitting a new lens to socket 1 replaces
      // what was there, it does not create a second camera 1.
      const rows = await prisma.deviceCamera.findMany({ where: { deviceId: device.id } });
      expect(rows).toHaveLength(1);
    });

    it('refuses a channel the recorder does not have', async () => {
      const response = await registerCamera({ channel: 9, position: 'FRONT' });
      expect(response.status).toBe(422);
    });

    it('does not let a fleet register hardware itself', async () => {
      // Telematics and camera units are provisioned and fitted by Saarthi, so
      // DEVICES_MANAGE sits with platform staff. A fleet owner reads their
      // devices and watches their cameras; they do not commission them.
      const response = await registerCamera({ channel: 1 }, owner);
      expect(response.status).toBe(403);
    });

    it('does not let another fleet reach this device at all', async () => {
      const response = await request({
        method: 'GET',
        url: `/api/v1/devices/${device.id}/cameras`,
        user: otherOwner,
      });
      // Reported as not-found rather than forbidden, so the id cannot be probed.
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------

  describe('resolving cameras to a vehicle', () => {
    it('lists the cameras currently pointed at a vehicle', async () => {
      await registerFourCameras();

      const response = await request<CameraBody[]>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/cameras`,
        user: owner,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(4);
      expect(response.body.data[0]?.registrationNumber).toBe(vehicle.registrationNumber);
    });

    it('moves the cameras with the recorder, without touching the camera rows', async () => {
      await registerFourCameras();

      const secondTruck = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: unique('UP32CD').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 25,
        },
      });

      // Refit the recorder: close the old assignment, open a new one.
      await prisma.deviceAssignment.updateMany({
        where: { deviceId: device.id, status: 'ACTIVE' },
        data: { status: 'ENDED', unassignedAt: new Date() },
      });
      await prisma.deviceAssignment.create({
        data: {
          deviceId: device.id,
          vehicleId: secondTruck.id,
          organizationId: fleet.id,
          status: 'ACTIVE',
        },
      });

      const oldVehicle = await request<CameraBody[]>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/cameras`,
        user: owner,
      });
      const newVehicle = await request<CameraBody[]>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${secondTruck.id}/cameras`,
        user: owner,
      });

      expect(oldVehicle.body.data).toHaveLength(0);
      expect(newVehicle.body.data).toHaveLength(4);

      // The camera rows themselves never changed — that is the point of hanging
      // them off the device rather than the vehicle.
      const rows = await prisma.deviceCamera.findMany({ where: { deviceId: device.id } });
      expect(rows).toHaveLength(4);
    });

    it('returns nothing for a vehicle with no recorder fitted', async () => {
      const bare = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: unique('UP32EF').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 20,
        },
      });

      const response = await request<CameraBody[]>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${bare.id}/cameras`,
        user: owner,
      });
      expect(response.body.data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------

  describe('live viewing', () => {
    it('explains that no gateway is configured rather than failing obscurely', async () => {
      const cameras = await registerFourCameras();

      const response = await withoutGateway(() =>
        request({
          method: 'POST',
          url: `/api/v1/cameras/${cameras[0]!.id}/live`,
          user: owner,
        }),
      );

      // A deployment with no camera infrastructure says so, rather than
      // handing back a ticket that leads nowhere.
      expect(response.status).toBe(503);
      expect(response.body.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
    });

    it('records the attempt even when it is refused', async () => {
      const cameras = await registerFourCameras();

      await withoutGateway(() =>
        request({
          method: 'POST',
          url: `/api/v1/cameras/${cameras[0]!.id}/live`,
          user: owner,
        }),
      );

      // A refused view is still somebody trying to watch a driver, so it is
      // logged exactly like a successful one.
      const sessions = await prisma.videoStreamSession.findMany({
        where: { cameraId: cameras[0]!.id },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.status).toBe('DENIED');
      expect(sessions[0]?.requestedById).toBe(owner.id);
    });

    it('refuses a camera that has been switched off, and records that too', async () => {
      const cameras = await registerFourCameras();

      await request({
        method: 'PATCH',
        url: `/api/v1/cameras/${cameras[1]!.id}`,
        user: admin,
        payload: { enabled: false },
      });

      const response = await request({
        method: 'POST',
        url: `/api/v1/cameras/${cameras[1]!.id}/live`,
        user: owner,
      });

      expect(response.status).toBe(422);

      const sessions = await prisma.videoStreamSession.findMany({
        where: { cameraId: cameras[1]!.id },
      });
      expect(sessions[0]?.reason).toContain('disabled');
    });

    it('does not let another tenant open a view', async () => {
      const cameras = await registerFourCameras();

      const response = await request({
        method: 'POST',
        url: `/api/v1/cameras/${cameras[0]!.id}/live`,
        user: otherOwner,
      });
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------

  describe('access log', () => {
    it('shows who tried to watch, and when', async () => {
      const cameras = await registerFourCameras();

      await withoutGateway(() =>
        request({
          method: 'POST',
          url: `/api/v1/cameras/${cameras[0]!.id}/live`,
          user: owner,
        }),
      );

      const response = await request<
        { watchedBy: string; status: string; requestedAt: string }[]
      >({
        method: 'GET',
        url: `/api/v1/cameras/${cameras[0]!.id}/access-log`,
        user: admin,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]?.status).toBe('DENIED');
      expect(response.body.data[0]?.watchedBy.length).toBeGreaterThan(0);
    });

    it('keeps one fleet access log out of another', async () => {
      const cameras = await registerFourCameras();

      const response = await request({
        method: 'GET',
        url: `/api/v1/cameras/${cameras[0]!.id}/access-log`,
        user: otherOwner,
      });
      expect([403, 404]).toContain(response.status);
    });
  });

  // -------------------------------------------------------------------------

  describe('device separation', () => {
    it('keeps the camera recorder distinct from the telemetry source', async () => {
      // A vehicle can carry both a Freematics and a YC06. The recorder is not
      // a position source even if it has a GPS receiver, because two devices
      // reporting slightly different positions is unresolvable in support.
      const freematics = await prisma.hardwareDevice.create({
        data: {
          organizationId: fleet.id,
          deviceIdentifier: unique('FRM-').toUpperCase().slice(0, 16),
          provider: 'FREEMATICS',
          deviceType: 'OBD_TELEMATICS',
          serialNumber: unique('SN-'),
          secretHash: await bcrypt.hash('device-secret', 4),
          status: 'ACTIVE',
          supportedMetrics: ['speedKph', 'rpm'],
          observedMetrics: [],
        },
      });
      await prisma.deviceAssignment.create({
        data: {
          deviceId: freematics.id,
          vehicleId: vehicle.id,
          organizationId: fleet.id,
          status: 'ACTIVE',
        },
      });

      await registerFourCameras();

      const cameras = await request<CameraBody[]>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/cameras`,
        user: owner,
      });

      // Four cameras, all from the recorder — the telemetry unit contributes
      // none, and the vehicle carries both devices at once.
      expect(cameras.body.data).toHaveLength(4);
      expect(
        cameras.body.data.every((camera) => camera.registrationNumber === vehicle.registrationNumber),
      ).toBe(true);

      const assignments = await prisma.deviceAssignment.count({
        where: { vehicleId: vehicle.id, status: 'ACTIVE' },
      });
      expect(assignments).toBe(2);
    });
  });
});

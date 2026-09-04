import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceSimulationMode,
  OrganizationType,
  PlanTier,
  RoleName,
  TelemetryMetric,
  TruckType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { readLiveState } from '../src/modules/tracking/live-state.service';
import { readDeviceStatus } from '../src/modules/devices/device-status.service';
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
 * Ingestion from the Saarthi Device app.
 *
 * The questions worth asking here are about honesty and about repetition.
 *
 * Honesty: a phone reports a real position and an invented RPM in the same
 * frame, and the stored reading has to say which is which. If it cannot, either
 * a real position gets branded as fake and vanishes from the map, or a
 * fabricated coolant temperature is presented as a measurement and somebody
 * takes a truck off the road to look for a fault that was never there.
 *
 * Repetition: a phone that loses signal buffers events and replays them on
 * reconnect, which means the same frame legitimately arrives more than once.
 * Storing it twice corrupts the history; refusing it as a fault fills the
 * device's log with alarms that describe correct behaviour.
 */
describe('Saarthi Device ingestion', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let vehicle: { id: string; registrationNumber: string };
  let device: { deviceIdentifier: string; secret: string; token: string; deviceId: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  function deviceAuth(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  let eventCounter = 0;
  function nextEventId(): string {
    eventCounter += 1;
    return `evt-${String(eventCounter).padStart(12, '0')}`;
  }

  /** Enrol a phone and pair it, returning working device credentials. */
  async function pairedDevice() {
    const enrolled = await request<{
      deviceIdentifier: string;
      secret: string;
      token: { accessToken: string };
    }>({
      method: 'POST',
      url: '/api/v1/device-gateway/enroll',
      payload: {
        installationId: unique('install-0000000000000000'),
        platform: 'ANDROID',
        deviceModel: 'Pixel 7a',
        appVersion: '1.0.0',
      },
    });

    const issued = await request<{ token: string }>({
      method: 'POST',
      url: `/api/v1/fleet/vehicles/${vehicle.id}/pairing-token`,
      user: owner,
      payload: { deviceType: 'MOBILE_TEST_DEVICE' },
    });

    const paired = await request<{
      identity: { deviceId: string };
      token: { accessToken: string };
    }>({
      method: 'POST',
      url: '/api/v1/device-gateway/pair',
      headers: deviceAuth(enrolled.body.data.token.accessToken),
      payload: { token: issued.body.data.token },
    });

    return {
      deviceIdentifier: enrolled.body.data.deviceIdentifier,
      secret: enrolled.body.data.secret,
      token: paired.body.data.token.accessToken,
      deviceId: paired.body.data.identity.deviceId,
    };
  }

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: 'UP32AB0001',
        truckType: TruckType.TIPPER,
        capacityTons: 25,
      },
    });
    vehicle = { id: truck.id, registrationNumber: truck.registrationNumber };
    device = await pairedDevice();
  });

  // -------------------------------------------------------------------------
  // GPS
  // -------------------------------------------------------------------------

  describe('location', () => {
    it('stores a fix and feeds the existing tracking pipeline', async () => {
      const response = await request<{ accepted: number; rejected: number; duplicates: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId: nextEventId(),
              latitude: 28.6139,
              longitude: 77.209,
              speedKph: 48.2,
              heading: 82,
              accuracy: 5,
              recordedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.accepted).toBe(1);
      expect(response.body.data.rejected).toBe(0);

      const reading = await prisma.telemetryReading.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });
      expect(reading.vehicleId).toBe(vehicle.id);
      expect(reading.latitude).toBeCloseTo(28.6139, 4);
      expect(reading.speedKph).toBeCloseTo(48.2, 1);

      // A phone's GPS is a real measurement of a real vehicle.
      expect(reading.simulated).toBe(false);
      expect(reading.simulatedMetrics).toEqual([]);

      // The same pipeline the simulator and the driver app use, so the fleet map
      // needs no knowledge that a phone exists.
      const track = await prisma.truckLocation.findFirst({ where: { truckId: vehicle.id } });
      expect(track).not.toBeNull();
      expect(track?.simulated).toBe(false);

      const live = await readLiveState(vehicle.id);
      expect(live?.lat).toBeCloseTo(28.6139, 4);
      expect(live?.simulated).toBe(false);
    });

    it('records only the fields a fix actually carried', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId: nextEventId(),
              latitude: 28.61,
              longitude: 77.2,
              recordedAt: new Date().toISOString(),
            },
          ],
        },
      });

      const reading = await prisma.telemetryReading.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });

      // An indoor fix has no bearing and a cold start has no speed. Reporting
      // either as zero would corrupt the series the harsh-driving rules run on.
      expect(reading.metrics).toContain(TelemetryMetric.LOCATION);
      expect(reading.metrics).not.toContain(TelemetryMetric.SPEED);
      expect(reading.metrics).not.toContain(TelemetryMetric.HEADING);
      expect(reading.speedKph).toBeNull();
      expect(reading.heading).toBeNull();
    });

    it('refuses a physically implausible speed', async () => {
      const response = await request<{ accepted: number; rejected: number; reasons: string[] }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId: nextEventId(),
              latitude: 28.61,
              longitude: 77.2,
              speedKph: 380,
              recordedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.body.data.accepted).toBe(0);
      expect(response.body.data.rejected).toBe(1);
      expect(response.body.data.reasons.join(' ')).toContain('not physically plausible');
      expect(await prisma.telemetryReading.count()).toBe(0);
    });

    it('refuses a reading dated in the future', async () => {
      const response = await request<{ accepted: number; rejected: number; reasons: string[] }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId: nextEventId(),
              latitude: 28.61,
              longitude: 77.2,
              recordedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
            },
          ],
        },
      });

      expect(response.body.data.rejected).toBe(1);
      expect(response.body.data.reasons.join(' ')).toContain('device clock');
    });

    it('never lets a device write for a vehicle it is not fitted to', async () => {
      // The payload has no vehicle field at all — the schema does not accept one
      // — so the only vehicle a device can reach is the one it is assigned to.
      const otherTruck = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: 'UP32AB0002',
          truckType: TruckType.TIPPER,
          capacityTons: 25,
        },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId: nextEventId(),
              latitude: 28.61,
              longitude: 77.2,
              recordedAt: new Date().toISOString(),
              vehicleId: otherTruck.id,
              truckId: otherTruck.id,
            },
          ],
        },
      });

      const readings = await prisma.telemetryReading.findMany();
      expect(readings).toHaveLength(1);
      expect(readings[0]?.vehicleId).toBe(vehicle.id);
    });
  });

  // -------------------------------------------------------------------------
  // Measured engine data, from an OBD adapter
  // -------------------------------------------------------------------------

  /**
   * The other half of the simulated/measured split.
   *
   * A terminal with an OBD adapter reads the same fields the simulator invents,
   * and the frame carries them in a separate `vehicle` block precisely so the
   * two can never be confused. Storing a measured coolant temperature under
   * `simulatedMetrics` would be section 19's failure in reverse: a real reading
   * labelled as fabricated, dismissed by every consumer downstream.
   */
  describe('measured vehicle telemetry', () => {
    it('stores real engine data as measured, never as simulated', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209, speedKph: 52, heading: 90 },
              vehicle: {
                rpm: 1726,
                coolantTemperature: 88,
                intakeTemperature: 41,
                fuelLevel: 62,
                fuelRate: 18.4,
                batteryVoltage: 27.4,
                odometerKm: 128_450,
                vin: 'MAT445023N4C12345',
                diagnostics: [{ code: 'P0143', description: null }],
              },
            },
          ],
        },
      });

      const reading = await prisma.telemetryReading.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });

      expect(reading.rpm).toBe(1726);
      expect(reading.coolantTemperature).toBe(88);
      expect(reading.intakeTemperature).toBe(41);
      expect(reading.fuelRate).toBe(18.4);
      expect(reading.odometerKm).toBe(128_450);
      expect(reading.vin).toBe('MAT445023N4C12345');

      expect(reading.metrics).toEqual(
        expect.arrayContaining([
          TelemetryMetric.RPM,
          TelemetryMetric.COOLANT_TEMPERATURE,
          TelemetryMetric.INTAKE_TEMPERATURE,
          TelemetryMetric.FUEL_RATE,
          TelemetryMetric.ODOMETER,
          TelemetryMetric.VIN,
          TelemetryMetric.DTC,
        ]),
      );

      // The whole point: none of it is branded invented.
      expect(reading.simulatedMetrics).toHaveLength(0);
      expect(reading.simulated).toBe(false);
    });

    it('replaces a wrong stored odometer with the vehicle own reading', async () => {
      /*
       * The correction that could not happen before.
       *
       * A vehicle is onboarded with a rough figure typed by hand, and the ECU
       * later reports its real total. The gap is routinely tens of thousands of
       * kilometres — far past the 1,500 km guard that protects the accumulated
       * odometer from a corrupt frame — so the only trustworthy reading in the
       * system was being rejected as implausible.
       */
      await prisma.truck.update({
        where: { id: vehicle.id },
        data: { odometerKm: 50_000 },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { odometerKm: 128_450 },
            },
          ],
        },
      });

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.odometerKm).toBe(128_450);
    });

    it('corrects an odometer downwards when the vehicle says so', async () => {
      // The stored figure can be too high as easily as too low — a transposed
      // digit at onboarding — and the vehicle is the authority either way.
      await prisma.truck.update({
        where: { id: vehicle.id },
        data: { odometerKm: 900_000 },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { odometerKm: 90_000 },
            },
          ],
        },
      });

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.odometerKm).toBe(90_000);
    });

    it('never lets a simulated odometer rewrite the vehicle mileage', async () => {
      /*
       * The counterpart, and the reason the authoritative path is gated on the
       * metric rather than on the reading. A frame can carry both blocks; only
       * the measured one is the vehicle speaking. An invented total driving
       * maintenance intervals and resale valuations is precisely what section 19
       * exists to prevent.
       */
      await prisma.truck.update({
        where: { id: vehicle.id },
        data: { odometerKm: 70_000 },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              simulated: { mode: DeviceSimulationMode.NORMAL, odometerKm: 999_999 },
            },
          ],
        },
      });

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.odometerKm).toBe(70_000);
    });

    it('records an ECU fault code as confirmed', async () => {
      // A code read out of the ECU's stored-code memory is a fault the vehicle
      // itself recorded — unlike a simulated one, where no lamp was involved.
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { diagnostics: [{ code: 'P0217', description: null }] },
            },
          ],
        },
      });

      const code = await prisma.telemetryDiagnosticCode.findFirstOrThrow({
        where: { code: 'P0217' },
      });
      expect(code.confirmed).toBe(true);
    });

    it('explains a fault code the device could not', async () => {
      /*
       * The device sends a code and no description — it has no dictionary and no
       * business carrying one. Translating on ingestion means every reader gets
       * the meaning: the dashboard, the assistant, a report written next year.
       */
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { diagnostics: [{ code: 'P0301', description: null }] },
            },
          ],
        },
      });

      const code = await prisma.telemetryDiagnosticCode.findFirstOrThrow({
        where: { code: 'P0301' },
      });
      expect(code.description).toBe('Misfire, cylinder 1');
    });

    it('keeps a description the device supplied', async () => {
      // A vendor that decodes its own manufacturer codes knows more about that
      // vehicle than a generic table ever will.
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: {
                diagnostics: [{ code: 'P1234', description: 'Vendor: injector trim drift' }],
              },
            },
          ],
        },
      });

      const code = await prisma.telemetryDiagnosticCode.findFirstOrThrow({
        where: { code: 'P1234' },
      });
      expect(code.description).toBe('Vendor: injector trim drift');
    });

    it('records the VIN the vehicle reports about itself', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { vin: 'MAT445023N4C12345' },
            },
          ],
        },
      });

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.vin).toBe('MAT445023N4C12345');
    });

    it('does not overwrite a known VIN when the adapter reports a different one', async () => {
      /*
       * An OBD adapter is a plug, and moving it to another vehicle takes ten
       * seconds. Once moved, every reading is filed against a truck that was not
       * moving — and nothing else in the system would notice.
       *
       * The stored VIN is what the fleet believes; a conflicting one must not
       * quietly replace it, or the evidence of the swap disappears with it.
       */
      await prisma.truck.update({
        where: { id: vehicle.id },
        data: { vin: 'MAT445023N4C12345' },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { vin: 'MAT999999N9C99999' },
            },
          ],
        },
      });

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(truck.vin).toBe('MAT445023N4C12345');
    });

    it('never lets a simulated value overwrite a measured one', async () => {
      /*
       * Both blocks in one frame, disagreeing.
       *
       * A terminal can legitimately send both — an adapter answering coolant
       * while the simulator fills a fuel level the vehicle does not expose. The
       * measured value has to win, and the simulated one must not even be
       * declared for that metric, or the reading claims to be invented and
       * measured at once.
       */
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209 },
              vehicle: { coolantTemperature: 88 },
              simulated: {
                mode: DeviceSimulationMode.NORMAL,
                coolantTemperature: 40,
                fuelLevel: 55,
              },
            },
          ],
        },
      });

      const reading = await prisma.telemetryReading.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });

      expect(reading.coolantTemperature).toBe(88);
      expect(reading.simulatedMetrics).not.toContain(TelemetryMetric.COOLANT_TEMPERATURE);
      // The gap the simulator genuinely filled is still labelled as filled.
      expect(reading.fuelLevel).toBe(55);
      expect(reading.simulatedMetrics).toContain(TelemetryMetric.FUEL_LEVEL);
    });
  });

  // -------------------------------------------------------------------------
  // Simulated engine data
  // -------------------------------------------------------------------------

  describe('simulated vehicle telemetry', () => {
    it('marks fabricated engine values without branding the real position', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.6139, longitude: 77.209, speedKph: 52, heading: 90 },
              motion: { accelerationX: 0.1, accelerationY: 0.02, accelerationZ: 0.98 },
              health: { signalStrength: -78, batteryPercent: 64, networkType: 'CELLULAR' },
              simulated: {
                mode: DeviceSimulationMode.NORMAL,
                rpm: 1850,
                fuelLevel: 64,
                coolantTemperature: 87,
                batteryVoltage: 27.3,
              },
            },
          ],
        },
      });

      const reading = await prisma.telemetryReading.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });

      // Both kinds of value are present...
      expect(reading.metrics).toEqual(
        expect.arrayContaining([
          TelemetryMetric.LOCATION,
          TelemetryMetric.SPEED,
          TelemetryMetric.ACCELEROMETER,
          TelemetryMetric.SIGNAL_STRENGTH,
          TelemetryMetric.RPM,
          TelemetryMetric.FUEL_LEVEL,
          TelemetryMetric.COOLANT_TEMPERATURE,
        ]),
      );

      // ...but only the engine ones are marked as invented.
      expect(reading.simulatedMetrics).toEqual(
        expect.arrayContaining([
          TelemetryMetric.RPM,
          TelemetryMetric.FUEL_LEVEL,
          TelemetryMetric.COOLANT_TEMPERATURE,
          TelemetryMetric.BATTERY_VOLTAGE,
        ]),
      );
      expect(reading.simulatedMetrics).not.toContain(TelemetryMetric.LOCATION);
      expect(reading.simulatedMetrics).not.toContain(TelemetryMetric.SPEED);
      expect(reading.simulatedMetrics).not.toContain(TelemetryMetric.ACCELEROMETER);

      // The reading as a whole came from a real device in a real vehicle, so it
      // is not a simulator run and belongs on the map.
      expect(reading.simulated).toBe(false);
      const live = await readLiveState(vehicle.id);
      expect(live?.simulated).toBe(false);
    });

    /**
     * The distinction has to survive the read path, not just the write.
     *
     * Storing `simulatedMetrics` correctly and then dropping it on the way out
     * is the same bug as never storing it: the gauge still shows an invented
     * RPM as a measurement. This asserts against the API response rather than
     * the row, because the row was never the part that was wrong.
     */
    it('reports which metrics were invented through the API, not only in the database', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.61, longitude: 77.2, speedKph: 42 },
              simulated: {
                mode: DeviceSimulationMode.NORMAL,
                rpm: 1850,
                coolantTemperature: 87,
              },
            },
          ],
        },
      });

      const latest = await request<{
        rpm: number | null;
        speedKph: number | null;
        metrics: string[];
        simulatedMetrics: string[];
      }>({
        method: 'GET',
        url: `/api/v1/telemetry/vehicles/${vehicle.id}/latest`,
        user: owner,
      });

      expect(latest.status).toBe(200);
      expect(latest.body.data?.rpm).toBe(1850);
      expect(latest.body.data?.speedKph).toBe(42);

      // The engine figures are flagged; the position and speed the phone
      // genuinely measured are not.
      expect(latest.body.data?.simulatedMetrics).toEqual(
        expect.arrayContaining([
          TelemetryMetric.RPM,
          TelemetryMetric.COOLANT_TEMPERATURE,
        ]),
      );
      expect(latest.body.data?.simulatedMetrics).not.toContain(TelemetryMetric.LOCATION);
      expect(latest.body.data?.simulatedMetrics).not.toContain(TelemetryMetric.SPEED);
    });

    it('sends no engine block at all when simulation is off', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.61, longitude: 77.2 },
              simulated: { mode: DeviceSimulationMode.OFF, rpm: 1850 },
            },
          ],
        },
      });

      const reading = await prisma.telemetryReading.findFirstOrThrow({
        where: { deviceId: device.deviceId },
      });
      expect(reading.rpm).toBeNull();
      expect(reading.metrics).not.toContain(TelemetryMetric.RPM);
      expect(reading.simulatedMetrics).toEqual([]);
    });

    it('never marks a simulated fault as confirmed by a warning lamp', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: deviceAuth(device.token),
        payload: {
          frames: [
            {
              eventId: nextEventId(),
              recordedAt: new Date().toISOString(),
              location: { latitude: 28.61, longitude: 77.2 },
              simulated: {
                mode: DeviceSimulationMode.ENGINE_WARNING,
                diagnostics: [{ code: 'P0128', description: 'Simulated thermostat fault' }],
              },
            },
          ],
        },
      });

      const code = await prisma.telemetryDiagnosticCode.findFirstOrThrow({});
      expect(code.code).toBe('P0128');
      // No malfunction indicator lamp was involved, because there is no engine.
      expect(code.confirmed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Offline buffering
  // -------------------------------------------------------------------------

  describe('offline replay', () => {
    it('accepts a buffered batch in the order it was recorded', async () => {
      const base = Date.now() - 10 * 60_000;
      const points = Array.from({ length: 5 }, (_, index) => ({
        eventId: nextEventId(),
        latitude: 28.61 + index * 0.001,
        longitude: 77.2 + index * 0.001,
        speedKph: 40 + index,
        recordedAt: new Date(base + index * 60_000).toISOString(),
      }));

      const response = await request<{ accepted: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: { points },
      });

      expect(response.body.data.accepted).toBe(5);

      const readings = await prisma.telemetryReading.findMany({
        where: { deviceId: device.deviceId },
        orderBy: { recordedAt: 'asc' },
      });
      expect(readings).toHaveLength(5);
      // Replayed oldest first, so derived state is computed in real order.
      expect(readings[0]?.speedKph).toBe(40);
      expect(readings[4]?.speedKph).toBe(44);
    });

    it('stores a retried batch exactly once', async () => {
      const points = [
        {
          eventId: nextEventId(),
          latitude: 28.61,
          longitude: 77.2,
          recordedAt: new Date().toISOString(),
        },
        {
          eventId: nextEventId(),
          latitude: 28.62,
          longitude: 77.21,
          recordedAt: new Date().toISOString(),
        },
      ];

      const first = await request<{ accepted: number; duplicates: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: { points },
      });
      expect(first.body.data.accepted).toBe(2);
      expect(first.body.data.duplicates).toBe(0);

      // The upload "timed out" as far as the device knows, so it retries.
      const retry = await request<{ accepted: number; duplicates: number; rejected: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: { points },
      });

      expect(retry.status).toBe(200);
      expect(retry.body.data.accepted).toBe(0);
      // Reported as duplicates, never as rejections — the device did the right
      // thing, and calling it a fault would fill its log with false alarms.
      expect(retry.body.data.duplicates).toBe(2);
      expect(retry.body.data.rejected).toBe(0);

      expect(await prisma.telemetryReading.count()).toBe(2);
    });

    it('holds the idempotency guarantee in the database, not only in the cache', async () => {
      const eventId = nextEventId();
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId,
              latitude: 28.61,
              longitude: 77.2,
              recordedAt: new Date().toISOString(),
            },
          ],
        },
      });

      // A device retrying a day-old buffer arrives after the cache entry has
      // gone. The unique index has to be what stops the duplicate.
      const { cache } = await import('../src/infra/cache');
      await cache.clear();

      const retry = await request<{ accepted: number; duplicates: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(device.token),
        payload: {
          points: [
            {
              eventId,
              latitude: 28.61,
              longitude: 77.2,
              recordedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(retry.body.data.duplicates).toBe(1);
      expect(await prisma.telemetryReading.count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  describe('heartbeat', () => {
    it('records device health and echoes the cadence Saarthi wants', async () => {
      const response = await request<{
        acknowledgedAt: string;
        nextHeartbeatInSeconds: number;
        reportingIntervalSeconds: number;
        pendingCommands: number;
      }>({
        method: 'POST',
        url: '/api/v1/device-gateway/heartbeat',
        headers: deviceAuth(device.token),
        payload: {
          batteryPercent: 64,
          batteryCharging: true,
          networkType: 'CELLULAR',
          gpsStatus: 'OK',
          cameraStatus: 'PERMISSION_DENIED',
          bufferedEvents: 17,
          appVersion: '1.0.0',
          deviceTime: new Date().toISOString(),
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.nextHeartbeatInSeconds).toBeGreaterThan(0);
      expect(response.body.data.pendingCommands).toBe(0);

      const stored = await prisma.hardwareDevice.findUniqueOrThrow({
        where: { id: device.deviceId },
      });
      expect(stored.batteryPercent).toBe(64);
      expect(stored.batteryCharging).toBe(true);
      expect(stored.networkType).toBe('CELLULAR');
      // The device's own verdict, not an inference. "The user tapped Deny" and
      // "there is no camera" are different problems.
      expect(stored.cameraStatus).toBe('PERMISSION_DENIED');
      expect(stored.bufferedEvents).toBe(17);
      expect(stored.lastHeartbeatAt).not.toBeNull();
    });

    it('publishes a live snapshot the dashboard can read without a query', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/heartbeat',
        headers: deviceAuth(device.token),
        payload: { batteryPercent: 12, networkType: 'WIFI', gpsStatus: 'OK', bufferedEvents: 3 },
      });

      const snapshot = await readDeviceStatus(device.deviceId);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.batteryPercent).toBe(12);
      expect(snapshot?.bufferedEvents).toBe(3);
      expect(snapshot?.vehicleId).toBe(vehicle.id);
    });

    it('brings a device that had gone offline back to active', async () => {
      await prisma.hardwareDevice.update({
        where: { id: device.deviceId },
        data: { status: 'OFFLINE' },
      });

      // The token still carries the previous state, so this also proves the
      // heartbeat path reads the device fresh rather than trusting the token.
      const fresh = await request<{ accessToken: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/heartbeat',
        headers: deviceAuth(fresh.body.data.accessToken),
        payload: { networkType: 'CELLULAR', gpsStatus: 'OK' },
      });

      const stored = await prisma.hardwareDevice.findUniqueOrThrow({
        where: { id: device.deviceId },
      });
      expect(stored.status).toBe('ACTIVE');

      const event = await prisma.deviceEvent.findFirst({
        where: { deviceId: device.deviceId, eventType: 'ONLINE' },
      });
      expect(event).not.toBeNull();
    });

    it('refuses a heartbeat from a device that is not paired', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.token),
      });

      const fresh = await request<{ accessToken: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/heartbeat',
        headers: deviceAuth(fresh.body.data.accessToken),
        payload: { networkType: 'CELLULAR' },
      });
      expect(response.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // After unpairing
  // -------------------------------------------------------------------------

  describe('after unpairing', () => {
    it('stops accepting telemetry for the vehicle it left', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/unpair',
        headers: deviceAuth(device.token),
      });

      const fresh = await request<{ accessToken: string }>({
        method: 'POST',
        url: '/api/v1/device-gateway/token',
        headers: {
          'x-device-id': device.deviceIdentifier,
          'x-device-secret': device.secret,
        },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/location',
        headers: deviceAuth(fresh.body.data.accessToken),
        payload: {
          points: [
            {
              eventId: nextEventId(),
              latitude: 28.61,
              longitude: 77.2,
              recordedAt: new Date().toISOString(),
            },
          ],
        },
      });

      // Refused because unpairing left the unit inactive, and an inactive
      // device does not report.
      expect(response.status).toBe(403);
      expect(await prisma.telemetryReading.count()).toBe(0);

      // And the attempt is recorded against the device rather than discarded. A
      // phone still trying to report for a truck it was removed from is worth
      // seeing on its event log.
      const rejection = await prisma.deviceEvent.findFirst({
        where: { deviceId: device.deviceId, eventType: 'REJECTED_PAYLOAD' },
      });
      expect(rejection).not.toBeNull();
      const refreshed = await prisma.hardwareDevice.findUniqueOrThrow({
        where: { id: device.deviceId },
      });
      expect(refreshed.rejectedCount).toBeGreaterThan(0);
    });
  });
});

import { expect } from 'vitest';
import {
  DeviceType,
  QrSubjectType,
  TerminalSessionStatus,
  TruckType,
  VehicleType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { request, unique, type TestUser } from './helpers';

/**
 * A driver's phone signed on to a fleet vehicle, the way the app does it.
 *
 * Pairing, the approved assignment and the safety check, through the real
 * endpoints, so a case can start from "the driver is on the vehicle" and test
 * what happens after.
 */

export interface EnrolledTerminal {
  deviceIdentifier: string;
  token: string;
}

const CHECKLIST_PASS = [
  'TYRES', 'COOLANT', 'ENGINE_OIL', 'BRAKES', 'LIGHTS',
  'BATTERY', 'FUEL', 'MIRRORS', 'EMERGENCY_EQUIPMENT', 'DOCUMENTS',
].map((code) => ({ code, status: 'OK' }));

export function terminalAuth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** `createTrip` refuses an unverified driver; a dispatched case starts after that check. */
export async function verifyDriver(driver: TestUser): Promise<void> {
  await prisma.driver.update({
    where: { id: driver.driverId! },
    data: { verificationStatus: VerificationStatus.VERIFIED },
  });
}

export async function createFleetVehicle(organizationId: string): Promise<{ id: string; registration: string }> {
  const registration = unique('UP32').toUpperCase().slice(-12);
  const truck = await prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: registration,
      vehicleType: VehicleType.TRUCK,
      truckType: TruckType.OPEN_BODY,
      capacityTons: 20,
      odometerKm: 184_230,
    },
  });
  return { id: truck.id, registration };
}

export async function passChecklist(terminal: EnrolledTerminal): Promise<void> {
  const submitted = await request({
    method: 'POST',
    url: '/api/v1/device-gateway/terminal/checklist',
    headers: terminalAuth(terminal.token),
    payload: { items: CHECKLIST_PASS },
  });
  expect(submitted.status).toBe(201);
}

/** A paired phone with an approved driver on it, ready for a checklist. */
export async function signOnDriver(
  owner: TestUser,
  driver: TestUser,
  vehicleId: string,
): Promise<EnrolledTerminal> {
  const terminal = await pairTerminal(owner, vehicleId);

  await request({
    method: 'GET',
    url: '/api/v1/device-gateway/terminal/vehicle-qr',
    headers: terminalAuth(terminal.token),
  });
  const code = await prisma.qrCode.findFirstOrThrow({
    where: { subjectType: QrSubjectType.VEHICLE, subjectId: vehicleId },
  });

  const created = await request<{ id: string }>({
    method: 'POST',
    url: '/api/v1/terminal/assignments/request',
    user: driver,
    payload: { qrToken: code.token },
  });
  await prisma.terminalSession.update({
    where: { id: created.body.data.id },
    data: {
      status: TerminalSessionStatus.SELFIE_SUBMITTED,
      selfieMediaId: crypto.randomUUID(),
      selfieCapturedAt: new Date(),
    },
  });
  await request({
    method: 'POST',
    url: `/api/v1/terminal/assignments/${created.body.data.id}/submit`,
    user: driver,
    payload: {},
  });
  await request({
    method: 'POST',
    url: `/api/v1/terminal/assignments/${created.body.data.id}/approve`,
    user: owner,
    payload: { assignVehicle: true },
  });

  return terminal;
}

async function pairTerminal(owner: TestUser, vehicleId: string): Promise<EnrolledTerminal> {
  const issued = await request<{ pairingCode: string }>({
    method: 'POST',
    url: `/api/v1/fleet/vehicles/${vehicleId}/terminal-pairing`,
    user: owner,
    payload: {},
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);

  const enrolled = await request<{ deviceIdentifier: string; token: { accessToken: string } }>({
    method: 'POST',
    url: '/api/v1/device-gateway/enroll',
    payload: {
      installationId: unique('terminal-000000000000'),
      platform: 'ANDROID',
      deviceModel: 'Redmi 13',
      osVersion: '16',
      appVersion: '1.0.0',
      deviceType: DeviceType.VEHICLE_TERMINAL,
    },
  });

  const paired = await request<{ token: { accessToken: string } }>({
    method: 'POST',
    url: '/api/v1/device-gateway/terminal/pair',
    headers: terminalAuth(enrolled.body.data.token.accessToken),
    payload: { pairingCode: issued.body.data.pairingCode },
  });

  return {
    deviceIdentifier: enrolled.body.data.deviceIdentifier,
    token: paired.body.data.token.accessToken,
  };
}

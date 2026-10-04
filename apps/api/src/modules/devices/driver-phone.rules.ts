import {
  AUTHORIZED_TERMINAL_SESSION_STATUSES,
  AssignmentStatus,
  DeviceAssignmentStatus,
  DeviceProvider,
  DeviceRole,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';

/**
 * The rules for a driver's own phone on a vehicle.
 *
 * The Saarthi Driver app is how a driver signs on, and their phone is the
 * vehicle's data source until a tracker takes over:
 *
 *   * the vehicle's **assigned** driver pairs by scanning the vehicle QR, and the
 *     phone stays paired across shifts until the owner unassigns or reassigns
 *     them;
 *   * any other driver pairs only for the shift they were approved for;
 *   * with a **Saarthi OBD** the phone stays the source and relays the engine;
 *   * with a fitted **4G tracker** the phone stays paired for the app but its
 *     position is not recorded — the tracker is the vehicle's only source.
 *
 * And, whichever the case, a driver phone's readings are recorded only during
 * that driver's approved shift. The app reports whenever it has location
 * permission, so a phone that stays paired would otherwise put a driver's home
 * and their own car on the vehicle's map.
 *
 * Queries only, no side effects, so the pairing, ingestion and terminal modules
 * can all read them without importing each other.
 */

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Whether this driver is the vehicle's standing driver — assigned by the owner,
 * rather than for a single approved shift.
 *
 * An approval that puts a different driver on the vehicle opens an assignment of
 * its own and names it on the session; that one ends at sign-off and so does not
 * count. The distinction is what lets an assigned driver's phone stay paired.
 */
export async function holdsStandingAssignment(
  vehicleId: string,
  driverId: string,
  db: Db = prisma,
): Promise<boolean> {
  const assignment = await db.truckAssignment.findFirst({
    where: { truckId: vehicleId, driverId, status: AssignmentStatus.ACTIVE },
    select: { id: true },
  });
  if (!assignment) return false;

  const shiftOnly = await db.terminalSession.findFirst({
    where: { truckAssignmentId: assignment.id },
    select: { id: true },
  });
  return !shiftOnly;
}

/** Vehicle-powered telemetry hardware — a 4G tracker — rather than a phone or tablet. */
export function isFittedTracker(provider: DeviceProvider, role: DeviceRole): boolean {
  return role === DeviceRole.TELEMETRY && provider !== DeviceProvider.MOBILE;
}

/** A fitted tracker reporting for this vehicle. */
function fittedTrackerOn(vehicleId: string): Prisma.DeviceAssignmentWhereInput {
  return {
    vehicleId,
    status: DeviceAssignmentStatus.ACTIVE,
    driverId: null,
    device: { role: DeviceRole.TELEMETRY, provider: { not: DeviceProvider.MOBILE } },
  };
}

/**
 * The role a driver's phone takes on this vehicle.
 *
 * Telemetry, unless a fitted tracker already reports for it — then auxiliary, so
 * the phone stays paired for the driver without competing for the vehicle's one
 * telemetry slot.
 */
export async function driverPhoneRole(vehicleId: string, db: Db = prisma): Promise<DeviceRole> {
  const fitted = await db.deviceAssignment.findFirst({
    where: fittedTrackerOn(vehicleId),
    select: { id: true },
  });
  return fitted ? DeviceRole.AUXILIARY : DeviceRole.TELEMETRY;
}

/**
 * Step every driver phone on this vehicle aside for fitted hardware, or back.
 *
 * Called when a 4G tracker is fitted (`AUXILIARY`) and when it is removed
 * (`TELEMETRY`). The phones stay paired either way; only what they count for
 * changes.
 */
export async function setDriverPhoneRoles(
  vehicleId: string,
  role: DeviceRole,
  db: Db = prisma,
): Promise<void> {
  await db.hardwareDevice.updateMany({
    where: {
      assignments: {
        some: { vehicleId, status: DeviceAssignmentStatus.ACTIVE, driverId: { not: null } },
      },
    },
    data: { role },
  });
}

export type DriverPhoneReport = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether a reading from this device may be recorded right now.
 *
 * Always yes for anything that is not a driver's phone. For a driver's phone:
 * only while it counts as the vehicle's telemetry source, and only during that
 * driver's approved shift.
 */
export async function driverPhoneMayReport(deviceId: string): Promise<DriverPhoneReport> {
  const assignment = await prisma.deviceAssignment.findFirst({
    where: { deviceId, status: DeviceAssignmentStatus.ACTIVE },
    select: { vehicleId: true, driverId: true, device: { select: { role: true } } },
  });
  if (!assignment?.driverId) return { allowed: true };

  if (assignment.device.role !== DeviceRole.TELEMETRY) {
    return {
      allowed: false,
      reason:
        'This vehicle reports from its fitted tracker, so the phone’s position is not recorded.',
    };
  }

  const onShift = await prisma.terminalSession.findFirst({
    where: {
      vehicleId: assignment.vehicleId,
      driverId: assignment.driverId,
      status: { in: AUTHORIZED_TERMINAL_SESSION_STATUSES },
    },
    select: { id: true },
  });
  return onShift
    ? { allowed: true }
    : {
        allowed: false,
        reason:
          'Not on an approved shift: a driver’s phone reports only while its driver is signed on.',
      };
}

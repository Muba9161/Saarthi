import type { TerminalSessionView, TerminalVehicleSetup } from '@saarthi/shared';
import { holdsStandingAssignment } from '../devices/driver-phone.rules';
import { trackerProductFor } from '../subscriptions/tracker.service';

/**
 * What the driver app needs to set the phone up for the vehicle it scanned:
 * whether the owner assigned this driver to it (pair now, stay paired) and
 * which Saarthi tracker it has (connect the OBD adapter, or let the 4G unit
 * report).
 */
export async function vehicleSetupFor(
  vehicleId: string,
  driverId: string,
): Promise<TerminalVehicleSetup> {
  const [assignedToYou, tracker] = await Promise.all([
    holdsStandingAssignment(vehicleId, driverId),
    trackerProductFor(vehicleId),
  ]);
  return { assignedToYou, tracker };
}

/** A driver's own view of their request, with the vehicle setup attached. */
export async function withVehicleSetup(
  view: TerminalSessionView,
  driverId: string,
): Promise<TerminalSessionView> {
  return { ...view, vehicleSetup: await vehicleSetupFor(view.vehicleId, driverId) };
}

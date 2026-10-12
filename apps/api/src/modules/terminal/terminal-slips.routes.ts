import type { FastifyInstance } from 'fastify';
import {
  MediaOwnerType,
  MediaPurpose,
  MediaVisibility,
  terminalExpenseSlipSchema,
  terminalFuelSlipSchema,
} from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { created, parseBody } from '../../lib/http';
import { authenticateDeviceRequest } from '../devices/device-auth';
import { uploadMedia } from '../media/media.service';
import { discardExpense, recordExpense } from '../expenses/expense.service';
import { driverAuthForSession, requireTerminal } from './terminal.service';
import { authorizedSessionForTerminal } from './session.service';
import { discardFuelSlip, recordFuelSlip } from './driver-extras.service';
import { readTerminalUpload, terminalLimit, type TerminalUploadFile } from './terminal-http';
import type { AuthContext } from '../../auth/context';

/**
 * Expense slips from the road: fuel, and everything else a driver pays.
 *
 * Drivers carry paper. A till roll goes in a shirt pocket, survives a week of
 * diesel and sunlight, and reaches the office as an argument — because filling
 * in a form beside a running engine is worse than keeping the receipt. So each
 * slip is the figures printed largest on it plus the photograph as the
 * evidence for the rest, in **one** request.
 *
 * One request, and one outcome: a record whose photograph could not be stored
 * is removed again, because a slip without its evidence, or a photograph with
 * no slip, is a reconciliation somebody has to unpick by hand.
 */

const PHOTO_REQUIRED =
  'Saarthi needs a photograph of the slip. It is the evidence for the figures.';

/** Attach the slip's photograph, or undo the slip if it cannot be attached. */
async function attachPhoto(
  auth: AuthContext,
  ownerType: typeof MediaOwnerType.FUEL_RECORD | typeof MediaOwnerType.EXPENSE,
  ownerId: string,
  file: TerminalUploadFile,
  discard: (id: string) => Promise<void>,
): Promise<void> {
  try {
    await uploadMedia(
      auth,
      {
        ownerType,
        ownerId,
        purpose: MediaPurpose.ATTACHMENT,
        visibility: MediaVisibility.ORGANIZATION,
      },
      { file },
    );
  } catch (error) {
    await discard(ownerId);
    throw error;
  }
}

export async function terminalSlipRoutes(app: FastifyInstance): Promise<void> {
  /**
   * A fuel slip: litres and the total, the two numbers on every till roll.
   * The price per litre is derived, not asked for.
   */
  app.post('/fuel', { config: terminalLimit(12) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const auth = await driverAuthForSession(session);

    const { fields, file } = await readTerminalUpload(request);
    const input = parseBody(terminalFuelSlipSchema, {
      litres: fields.litres,
      totalCost: fields.totalCost,
      odometerKm: fields.odometerKm,
      stationName: fields.stationName,
      latitude: fields.latitude,
      longitude: fields.longitude,
    });
    if (!file) throw errors.validation(PHOTO_REQUIRED);

    const record = await recordFuelSlip({
      organizationId: terminal.organizationId,
      vehicleId: terminal.vehicleId,
      driverId: session.driverId ?? null,
      createdById: session.driverUserId ?? null,
      litres: input.litres,
      totalCost: input.totalCost,
      odometerKm: input.odometerKm ?? null,
      stationName: input.stationName ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });
    await attachPhoto(auth, MediaOwnerType.FUEL_RECORD, record.id, file, discardFuelSlip);

    return created(reply, { id: record.id });
  });

  /**
   * Any other slip: a toll paid in cash, parking, a puncture, a meal, loading
   * charges, a challan. Filed against the trip under way, so it lands in that
   * trip's expenses on the fleet's screen.
   */
  app.post('/expense', { config: terminalLimit(12) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const auth = await driverAuthForSession(session);

    const { fields, file } = await readTerminalUpload(request);
    const input = parseBody(terminalExpenseSlipSchema, {
      category: fields.category,
      amount: fields.amount,
      vendorName: fields.vendorName,
      notes: fields.notes,
      latitude: fields.latitude,
      longitude: fields.longitude,
    });
    if (!file) throw errors.validation(PHOTO_REQUIRED);

    const record = await recordExpense({
      organizationId: terminal.organizationId,
      vehicleId: terminal.vehicleId,
      driverId: session.driverId ?? null,
      createdById: session.driverUserId ?? null,
      category: input.category,
      amount: input.amount,
      vendorName: input.vendorName ?? null,
      notes: input.notes ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });
    await attachPhoto(auth, MediaOwnerType.EXPENSE, record.id, file, discardExpense);

    return created(reply, { id: record.id });
  });
}

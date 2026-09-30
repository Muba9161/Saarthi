import type { AddDriverLicenceInput } from '@saarthi/shared';
import { type Db, isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../auth/context';

/**
 * A driver's own driving licence number.
 *
 * Registration lets a driver skip the licence ("I'll do it later"), so a
 * driver row may carry none. This is how the driver adds it afterwards from
 * their own app, and where the one rule both paths share lives: a licence may
 * appear only once in an organization.
 */

const DUPLICATE_LICENCE_MESSAGE = 'This licence number is already registered with the fleet.';

const LICENCE_ALREADY_RECORDED_MESSAGE =
  'Your driving licence number is already on record. To correct it, ask your fleet owner to update it.';

function duplicateLicenceError() {
  return errors.duplicate(DUPLICATE_LICENCE_MESSAGE, {
    fields: { licenseNumber: [DUPLICATE_LICENCE_MESSAGE] },
  });
}

/**
 * Refuse a licence another driver in this organization already holds.
 *
 * Compared without regard to case: `dl0420110149646` and `DL0420110149646`
 * are one licence. Raised with the same message and field as registration,
 * so the app shows the same error whichever screen the number was typed on.
 */
export async function assertLicenceFreeInOrganization(
  db: Db,
  organizationId: string,
  licenseNumber: string,
): Promise<void> {
  const clash = await db.driver.findFirst({
    where: { organizationId, licenseNumber: { equals: licenseNumber, mode: 'insensitive' } },
    select: { id: true },
  });
  if (clash) throw duplicateLicenceError();
}

export interface AddOwnLicenceResult {
  driverId: string;
  organizationId: string;
  licenseNumber: string;
}

/**
 * The signed-in driver adding the licence they skipped at registration.
 *
 * Sets a missing licence only. A licence already on record is the fleet's to
 * change (`updateDriver`), because it is what their compliance checks and the
 * registry verification were run against — a driver quietly swapping it would
 * leave those answers describing somebody else's card.
 *
 * Nothing else is triggered: registration creates no licence-specific records
 * either. The QR badge reads the licence live when scanned, and registry
 * verification is started by the driver or the fleet through Pay & Verify.
 */
export async function addOwnLicence(
  auth: AuthContext,
  input: AddDriverLicenceInput,
): Promise<AddOwnLicenceResult> {
  const driver = await prisma.driver.findUnique({
    where: { userId: auth.user.id },
    select: { id: true, organizationId: true, licenseNumber: true, archivedAt: true },
  });
  if (!driver || driver.archivedAt) {
    throw errors.forbidden('Only a driver account can add a driving licence here.');
  }
  if (driver.licenseNumber) throw errors.conflict(LICENCE_ALREADY_RECORDED_MESSAGE);

  await assertLicenceFreeInOrganization(prisma, driver.organizationId, input.licenseNumber);

  try {
    // Conditional on the licence still being empty, so two requests racing
    // each other cannot both succeed and the second overwrite the first.
    const { count } = await prisma.driver.updateMany({
      where: { id: driver.id, licenseNumber: null },
      data: { licenseNumber: input.licenseNumber },
    });
    if (count === 0) throw errors.conflict(LICENCE_ALREADY_RECORDED_MESSAGE);
  } catch (error) {
    // Another driver in the fleet saved the same number between the check
    // above and this write; the unique index caught it.
    if (isUniqueViolation(error)) throw duplicateLicenceError();
    throw error;
  }

  logger.info({ driverId: driver.id }, 'Driver added their driving licence number');

  return {
    driverId: driver.id,
    organizationId: driver.organizationId,
    licenseNumber: input.licenseNumber,
  };
}

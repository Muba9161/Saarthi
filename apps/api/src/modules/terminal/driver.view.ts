import {
  DocumentVerificationStatus,
  resolveDocumentValidity,
  type TerminalDriverView,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { primaryUrlsFor } from '../media/media.service';

/**
 * The driver, as a terminal and an approver see them.
 *
 * Its own module because two things need it and they must not import each
 * other: the terminal state view, and the session projection the approval queue
 * and the realtime broadcast are built from.
 *
 * What is deliberately absent is as important as what is here. There is no
 * licence number, no address, no date of birth and no phone number. An approver
 * deciding whether somebody may take a truck out needs to know the licence is
 * current and the profile is verified; the licence number adds nothing to that
 * decision while being precisely the field that should not be sitting on a
 * screen bolted inside a cab.
 */

/** Bands rather than the exact score. A terminal is not a performance review. */
function scoreBand(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 85) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 50) return 'FAIR';
  return 'NEEDS_ATTENTION';
}

export async function terminalDriver(driverId: string): Promise<TerminalDriverView> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      userId: true,
      licenseClass: true,
      licenseExpiryDate: true,
      verificationStatus: true,
      experienceYears: true,
      totalTrips: true,
      overallScore: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!driver) throw errors.notFound('Driver');

  const photos = await primaryUrlsFor('DRIVER', [driver.id]);

  /*
   * Map the driver's *profile* verification onto document verification.
   *
   * They are different things, and the mapping is deliberate. A driver whose
   * profile Saarthi has verified has had their licence checked, so the expiry
   * date on file can be trusted. One whose profile is still pending has a
   * self-declared date, and the honest answer is PENDING_VERIFICATION rather
   * than a confident VALID — an approver reading "valid" off an unchecked
   * self-declaration is the failure this mapping exists to prevent.
   */
  const { validity } = resolveDocumentValidity({
    expiryDate: driver.licenseExpiryDate,
    verificationStatus:
      driver.verificationStatus === 'VERIFIED'
        ? DocumentVerificationStatus.VERIFIED
        : driver.verificationStatus === 'REJECTED'
          ? DocumentVerificationStatus.REJECTED
          : DocumentVerificationStatus.PENDING_VERIFICATION,
  });

  return {
    driverId: driver.id,
    userId: driver.userId,
    name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
    photoUrl: photos.get(driver.id) ?? null,
    licenseClass: driver.licenseClass,
    licenseValidity: validity,
    licenseExpiresAt: driver.licenseExpiryDate?.toISOString() ?? null,
    verificationStatus: driver.verificationStatus,
    experienceYears: driver.experienceYears,
    totalTrips: driver.totalTrips,
    scoreBand: scoreBand(driver.overallScore),
  };
}

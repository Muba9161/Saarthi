import { IdentityDocumentKind, PlanTier, VerificationSubjectType } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { config } from '../../config/env';
import type { AuthContext } from '../../auth/context';

/**
 * The Personal plan's identity requirement, at the point it actually bites.
 *
 * A Personal subscription is sold to a person rather than to a business, so
 * what Saarthi asks of them before they put a vehicle on the road is their own
 * Aadhaar — not the registration certificate, GSTIN and bank mandate a business
 * files, and not the four documents a driver clears.
 *
 * ## Where this runs, and why only there
 *
 * On the paths that *add* a vehicle or a tracker, and nowhere else. Not on
 * reads, not on telemetry, not on the trips or documents of a vehicle already
 * on the account. That placement is the whole design rather than an
 * optimisation: a rule introduced after somebody signed up must not reach back
 * and switch off a fleet they are already running. An owner with three cars on
 * the road keeps all three, keeps their live location and keeps their history,
 * and meets this only when they come to add a fourth.
 *
 * ## Who it does not apply to
 *
 * Everybody else. A Free account runs no vehicle at all, so there is nothing to
 * gate. A Supplier is a business that proves itself with business documents. A
 * Fleet Owner and a Mobility Provider are businesses too, verified as
 * businesses, and gating their fleets on one person's Aadhaar would be
 * answering the wrong question about the wrong subject. A Driver is not on a
 * plan and does not add vehicles; they are cleared to *drive* one through the
 * driver checks, which this neither reads nor touches.
 *
 * ## What it is not
 *
 * It is not the driver flow and shares nothing with it. `USER_AADHAAR` and
 * `DRIVER_AADHAAR` are separate documents against separate subjects recorded in
 * separate places, and satisfying one never satisfies the other. Somebody on
 * Personal who also drives one of their own vehicles has both obligations and
 * meets each on its own terms: this one before the vehicle goes on the account,
 * the driver checks before they may be assigned to it.
 */

/** Where a Personal account holder completes this check. */
const VERIFY_URL = '/settings/profile';

export interface PersonalIdentityStanding {
  /** Whether the rule applies to this account at all. */
  required: boolean;
  /** Whether the account holder has already confirmed their Aadhaar. */
  verified: boolean;
  /**
   * An account that predates the cutover.
   *
   * Purely about what they are told. The gate is the same either way, because
   * it only ever guards an addition — what grandfathering protects is the fleet
   * they already run, and that is protected by where this runs rather than by
   * this flag.
   */
  grandfathered: boolean;
  /** The account holder this check belongs to, when there is one. */
  userId: string | null;
}

/**
 * Whether this account is subject to the rule, and where it stands.
 *
 * Read rather than thrown, so a screen can show the requirement before somebody
 * has spent five minutes filling in a vehicle form only to be refused at the
 * end. `assertPersonalIdentityVerified` is the enforcing half.
 */
export async function personalIdentityStanding(
  auth: AuthContext,
  organizationId: string,
): Promise<PersonalIdentityStanding> {
  const notRequired: PersonalIdentityStanding = {
    required: false,
    verified: true,
    grandfathered: false,
    userId: null,
  };

  // Support acting on a tenant's behalf is not the account holder, and must not
  // be stopped by a check that is not about them.
  if (auth.isPlatformAdmin) return notRequired;

  // Personal and nothing else. Read from the resolved subscription, which is
  // the same figure every other plan rule in the system reads.
  if (auth.subscription?.planTier !== PlanTier.PERSONAL) return notRequired;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      createdAt: true,
      memberships: {
        where: { status: 'ACTIVE', isPrimary: true },
        select: { user: { select: { id: true, aadhaarVerifiedAt: true } } },
        take: 1,
      },
    },
  });

  // No organization, or one with no primary member, is not a state this rule
  // can say anything useful about — and refusing on it would block an account
  // for a reason its owner cannot act on.
  const holder = organization?.memberships[0]?.user;
  if (!organization || !holder) return notRequired;

  const cutover = config.identity.personalAadhaarRequiredFrom;

  return {
    required: true,
    verified: holder.aadhaarVerifiedAt !== null,
    // Blank cutover means no existing customers to protect — see the env
    // schema — so every account is treated as new.
    grandfathered: cutover !== undefined && organization.createdAt < cutover,
    userId: holder.id,
  };
}

/**
 * Refuse to add a vehicle or a tracker until the account holder is verified.
 *
 * Throws `IDENTITY_VERIFICATION_REQUIRED` rather than a plain 403, because the
 * remedy is neither a permission to be granted nor capacity to be bought: it is
 * a check the person can complete themselves, and the client routes this code
 * straight to the screen where they do it.
 *
 * The two messages are different on purpose. Somebody who already runs vehicles
 * needs to be told, in the same breath, that nothing they have is affected —
 * otherwise a refusal on the Add button reads as the account being suspended.
 */
export async function assertPersonalIdentityVerified(
  auth: AuthContext,
  organizationId: string,
  action: 'vehicle' | 'tracker',
): Promise<void> {
  const standing = await personalIdentityStanding(auth, organizationId);
  if (!standing.required || standing.verified) return;

  const subject = action === 'vehicle' ? 'a vehicle' : 'a tracker';

  const message = standing.grandfathered
    ? `Your Saarthi Personal account needs your Aadhaar verified before you can add ${subject}. ` +
      'Nothing you already run is affected - your vehicles, their tracking and their history ' +
      `carry on exactly as they are. Verify your Aadhaar at ${VERIFY_URL} and add ${subject} straight afterwards.`
    : `Saarthi Personal is an account for you as an individual, so please verify your Aadhaar ` +
      `before adding ${subject}. It takes a minute at ${VERIFY_URL}, and you will not be asked ` +
      'for business documents.';

  throw errors.identityVerificationRequired(message, {
    subjectType: VerificationSubjectType.USER,
    kind: IdentityDocumentKind.AADHAAR,
    grandfathered: standing.grandfathered,
  });
}

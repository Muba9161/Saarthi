import {
  DRIVER_JOINABLE_ORGANIZATION_TYPES,
  MembershipStatus,
  RoleName,
  type OrganizationType,
} from '@saarthi/shared';
import { type Db, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';

/**
 * Resolving a fleet invite code to the organization behind it.
 *
 * Two paths need this and must answer identically: registration, where a
 * driver may name their employer as they sign up, and the driver's own
 * "join a fleet" action afterwards. Keeping the checks in one place is what
 * stops the later path from being the lenient one — and the field name in
 * every thrown error is `fleetInviteCode`, because that is the input the
 * person is looking at either way.
 *
 * Takes an optional client, following `recordAudit`, so registration can
 * resolve the code inside the transaction that creates the account.
 */

export interface JoinableFleet {
  id: string;
  name: string;
  type: OrganizationType;
}

const invalidCode = () =>
  errors.validation('That fleet invite code is not valid.', {
    fields: { fleetInviteCode: ['That fleet invite code is not valid.'] },
  });

const notAnEmployer = () =>
  errors.validation('That invite code does not belong to an employer of drivers.', {
    fields: { fleetInviteCode: ['That invite code does not belong to an employer of drivers.'] },
  });

/**
 * Whether an organization has anybody in it who could employ a driver.
 *
 * Deliberately about people rather than the organization's type: a driver who
 * registered without an invite code sits alone in an organization that carries
 * a FLEET_OWNER type just as a real fleet does, so the type cannot tell the
 * two apart, but the membership can — a real fleet has its owner or a manager
 * in it, and a driver's own seat has nobody but the driver.
 *
 * One predicate, and two questions that must never disagree: whether a driver
 * is free to join a fleet, and whether their home screen should be asking them
 * for a code at all.
 *
 * Not asked of the fleet being joined. It would be the wrong question there:
 * an owner suspended mid-dispute leaves a real fleet with real trucks and real
 * drivers momentarily failing this test, and refusing their next driver's code
 * over that would be a worse fault than the one it guards against. The seat a
 * codeless driver sits in has an invite code no driver can read — `GET
 * /organizations/current/invite-code` needs ORG_MEMBERS_MANAGE, which a driver
 * membership does not carry — and mixing two of them, which needs a code
 * nobody can obtain, resolves itself: an organization of only drivers is still
 * nobody's employer, so both may leave it for a real fleet.
 */
export async function hasEmployer(organizationId: string, db: Db = prisma): Promise<boolean> {
  const employers = await db.membership.count({
    where: {
      organizationId,
      status: MembershipStatus.ACTIVE,
      role: { not: RoleName.DRIVER },
    },
  });
  return employers > 0;
}

/**
 * The organization a driver may join with `code`, or a validation error saying
 * why they may not.
 */
export async function resolveJoinableFleet(
  code: string,
  db: Db = prisma,
): Promise<JoinableFleet> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw invalidCode();

  const fleet = await db.organization.findUnique({ where: { inviteCode: normalized } });
  if (!fleet || fleet.archivedAt) throw invalidCode();

  // A taxi or tour operator employs drivers exactly as a freight fleet does,
  // so its invite code is honoured here too — see
  // DRIVER_JOINABLE_ORGANIZATION_TYPES.
  if (!DRIVER_JOINABLE_ORGANIZATION_TYPES.includes(fleet.type)) throw notAnEmployer();

  return { id: fleet.id, name: fleet.name, type: fleet.type };
}

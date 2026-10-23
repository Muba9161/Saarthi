import { OPERATOR_OWNER_ROLES, PlanTier, RoleName } from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { errors } from '../../lib/errors';

/**
 * Who may ride along and share the ride with family.
 *
 * Every driver — in a fleet or on their own — and the holder of a Personal
 * subscription (the owner of a Personal-plan account). Nobody is asked and
 * nothing about a vehicle is checked: the rider only names the vehicle so
 * their family knows which one they are in. Decided here from the signed-in
 * account — the plan and the role, not `isPersonalSeat`, which a Personal-plan
 * sign-up carries too — never by the phone, which only asks.
 */
export function mayRideAlong(auth: AuthContext): boolean {
  const role = auth.organization?.membershipRole;
  if (role === RoleName.DRIVER || auth.user.roles.includes(RoleName.DRIVER)) return true;
  return auth.subscription?.planTier === PlanTier.PERSONAL && role !== undefined && OPERATOR_OWNER_ROLES.includes(role);
}

export function assertMayRideAlong(auth: AuthContext): void {
  if (!mayRideAlong(auth)) {
    throw errors.forbidden('Riding along is for drivers and Personal plan account holders.');
  }
}

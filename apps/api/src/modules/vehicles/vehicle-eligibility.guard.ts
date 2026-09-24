import {
  vehicleTypeRefusal,
  type OrganizationType,
  type PlanTier,
  type VehicleType,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';

/**
 * Refuse a vehicle type this account may not onboard — a truck on Personal, a
 * car on a fleet owner, a truck on a mobility provider, anything on a supplier.
 *
 * Read from the stored subscription and organization rather than from the
 * resolved entitlement. The rule is about what the account is, not what it has
 * paid for, and the development entitlement (enforcement off) reports every
 * tenant as Business, which would put a Personal owner's car behind the fleet
 * rule.
 *
 * An organization with no subscription has no plan context and is not checked,
 * matching the capacity check beside it.
 */
export async function assertVehicleTypeAllowed(
  organizationId: string,
  vehicleType: VehicleType,
): Promise<void> {
  const [subscription, organization] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId },
      select: { plan: { select: { tier: true } } },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } }),
  ]);
  if (!subscription) return;

  const refusal = vehicleTypeRefusal(
    {
      tier: subscription.plan.tier as PlanTier,
      organizationType: (organization?.type as OrganizationType | undefined) ?? null,
    },
    vehicleType,
  );
  if (refusal) throw errors.businessRule(refusal, { vehicleType });
}

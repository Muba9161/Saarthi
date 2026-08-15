import {
  FEATURE_CATALOGUE,
  PLAN_CATALOGUE,
  ROLE_NAMES,
  RoleName,
  type Feature,
} from '@saarthi/shared';
import { type PrismaClient } from '@prisma/client';

/**
 * Reference data — roles, subscription plans and feature entitlements.
 *
 * Idempotent: safe to run on every deploy. The shared catalogue is the source
 * of truth; PostgreSQL holds the runtime copy so plans can be tuned by an
 * administrator without a code change.
 */

const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  [RoleName.PLATFORM_ADMIN]: 'Saarthi platform administrator with full operational oversight.',
  [RoleName.FLEET_OWNER]: 'Owns a fleet organization: trucks, drivers, orders and billing.',
  [RoleName.FLEET_MANAGER]: 'Manages day-to-day fleet operations without billing control.',
  [RoleName.DISPATCHER]: 'Assigns trucks and drivers to orders and monitors trips.',
  [RoleName.DRIVER]: 'Drives an assigned truck and operates trips in the field.',
  [RoleName.SUPPLIER]: 'Sells materials and coordinates dispatch from a yard or depot.',
  [RoleName.CUSTOMER]: 'Raises transport requirements and tracks deliveries.',
  [RoleName.SUPPORT_AGENT]: 'Saarthi support: verification review and incident assistance.',
};

export async function seedRoles(prisma: PrismaClient): Promise<void> {
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({
      where: { name },
      create: { name, description: ROLE_DESCRIPTIONS[name] },
      update: { description: ROLE_DESCRIPTIONS[name] },
    });
  }
}

export async function seedPlansAndFeatures(prisma: PrismaClient): Promise<void> {
  const featureIds = new Map<Feature, string>();

  for (const definition of FEATURE_CATALOGUE) {
    const record = await prisma.featureDefinition.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
      },
      update: { name: definition.name, description: definition.description },
    });
    featureIds.set(definition.key, record.id);
  }

  for (const [index, plan] of PLAN_CATALOGUE.entries()) {
    const record = await prisma.subscriptionPlan.upsert({
      where: { tier: plan.tier },
      create: {
        tier: plan.tier,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        sortOrder: index,
        active: true,
      },
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        sortOrder: index,
      },
    });

    // Re-sync the plan's feature grants so removals in the catalogue apply too.
    await prisma.planFeature.deleteMany({ where: { planId: record.id } });
    await prisma.planFeature.createMany({
      data: plan.features
        .map((feature) => featureIds.get(feature))
        .filter((id): id is string => Boolean(id))
        .map((featureId) => ({
          planId: record.id,
          featureId,
          limits: plan.limits as unknown as object,
        })),
      skipDuplicates: true,
    });
  }
}

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  await seedRoles(prisma);
  await seedPlansAndFeatures(prisma);
}

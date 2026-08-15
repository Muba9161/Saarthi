import type { FastifyInstance } from 'fastify';
import {
  MembershipStatus,
  Permission,
  organizationUpdateSchema,
  PLAN_CATALOGUE,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { ok, parseBody } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import { resolveSubscription } from '../subscriptions/entitlements.service';

/**
 * Organization profile, members and subscription state for the active tenant.
 */
export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/current', { preHandler: requirePermission(Permission.ORG_READ) }, async (request, reply) => {
    const organizationId = requireOrganizationId(request);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw errors.notFound('Organization');

    const [memberCount, truckCount, driverCount] = await Promise.all([
      prisma.membership.count({ where: { organizationId, status: MembershipStatus.ACTIVE } }),
      prisma.truck.count({ where: { organizationId, archivedAt: null } }),
      prisma.driver.count({ where: { organizationId, archivedAt: null } }),
    ]);

    return ok(reply, {
      ...organization,
      counts: { members: memberCount, trucks: truckCount, drivers: driverCount },
    });
  });

  app.patch(
    '/current',
    { preHandler: requirePermission(Permission.ORG_UPDATE) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const input = parseBody(organizationUpdateSchema, request.body);
      const before = await prisma.organization.findUnique({ where: { id: organizationId } });

      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.registrationNumber !== undefined
            ? { registrationNumber: input.registrationNumber }
            : {}),
          ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });

      await auditFromRequest(request, {
        action: AuditAction.ORGANIZATION_UPDATED,
        entityType: 'Organization',
        entityId: organizationId,
        before: { name: before?.name },
        after: { name: organization.name },
      });

      return ok(reply, organization);
    },
  );

  app.get(
    '/current/members',
    { preHandler: requirePermission(Permission.ORG_MEMBERS_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const memberships = await prisma.membership.findMany({
        where: { organizationId, status: { not: MembershipStatus.REMOVED } },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              status: true,
              lastLoginAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return ok(
        reply,
        memberships.map((membership) => ({
          id: membership.id,
          role: membership.role,
          status: membership.status,
          isPrimary: membership.isPrimary,
          joinedAt: membership.joinedAt.toISOString(),
          user: membership.user,
        })),
      );
    },
  );

  app.get(
    '/current/subscription',
    { preHandler: requirePermission(Permission.SUBSCRIPTION_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const subscription = await prisma.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });
      const resolved = await resolveSubscription(organizationId);

      return ok(reply, {
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              startsAt: subscription.startsAt.toISOString(),
              endsAt: subscription.endsAt?.toISOString() ?? null,
              plan: {
                tier: subscription.plan.tier,
                name: subscription.plan.name,
                description: subscription.plan.description,
                priceMonthly: subscription.plan.priceMonthly
                  ? Number(subscription.plan.priceMonthly)
                  : null,
                priceYearly: subscription.plan.priceYearly
                  ? Number(subscription.plan.priceYearly)
                  : null,
              },
            }
          : null,
        entitlements: resolved,
        catalogue: PLAN_CATALOGUE,
      });
    },
  );

  // The invite code drivers use to join this fleet.
  app.get(
    '/current/invite-code',
    { preHandler: requirePermission(Permission.ORG_MEMBERS_MANAGE) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { inviteCode: true },
      });
      if (!organization) throw errors.notFound('Organization');
      return ok(reply, { inviteCode: organization.inviteCode });
    },
  );

  app.get('/mine', async (request, reply) => {
    const auth = requireAuth(request);
    const memberships = await prisma.membership.findMany({
      where: { userId: auth.user.id, status: MembershipStatus.ACTIVE },
      include: { organization: true },
    });
    return ok(
      reply,
      memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        type: membership.organization.type,
        role: membership.role,
        isPrimary: membership.isPrimary,
        verificationStatus: membership.organization.verificationStatus,
      })),
    );
  });
}

import type { FastifyInstance } from 'fastify';
import {
  MembershipStatus,
  Permission,
  UserStatus,
  idParamSchema,
  buildPaginationMeta,
  paginationSchema,
} from '@saarthi/shared';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { ok, paginated, parseBody, parseParams, parseQuery, skipTake } from '../../lib/http';
import { requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import { connectedClientCount } from '../../realtime/websocket.routes';
import { config } from '../../config/env';

/**
 * Platform administration: user oversight, organization directory, audit trail
 * and system health. Every route requires a platform-admin permission.
 */

const userListQuerySchema = paginationSchema.extend({
  search: z.string().max(120).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  role: z.string().max(40).optional(),
});

const auditQuerySchema = paginationSchema.extend({
  action: z.string().max(80).optional(),
  entityType: z.string().max(80).optional(),
  entityId: z.string().max(80).optional(),
  actorUserId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const updateUserStatusSchema = z.object({
  status: z.nativeEnum(UserStatus),
  reason: z.string().min(3).max(500),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/overview',
    { preHandler: requirePermission(Permission.ADMIN_PLATFORM) },
    async (_request, reply) => {
      const [
        users,
        organizations,
        trucks,
        drivers,
        activeTrips,
        activeSos,
        pendingVerifications,
        subscriptions,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.organization.groupBy({ by: ['type'], _count: { _all: true } }),
        prisma.truck.count({ where: { archivedAt: null } }),
        prisma.driver.count({ where: { archivedAt: null } }),
        prisma.trip.count({
          where: {
            status: { in: ['ASSIGNED', 'LOADING', 'STARTED', 'IN_TRANSIT', 'DELAYED', 'ARRIVED', 'UNLOADING'] },
          },
        }),
        prisma.sosIncident.count({
          where: {
            status: { in: ['TRIGGERED', 'BROADCASTING', 'ACKNOWLEDGED', 'HELP_ASSIGNED', 'ASSISTANCE_ARRIVED'] },
          },
        }),
        prisma.verificationCase.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
        prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);

      return ok(reply, {
        users,
        organizations: Object.fromEntries(
          organizations.map((entry) => [entry.type, entry._count._all]),
        ),
        trucks,
        drivers,
        activeTrips,
        activeSos,
        pendingVerifications,
        subscriptions: Object.fromEntries(
          subscriptions.map((entry) => [entry.status, entry._count._all]),
        ),
        platform: {
          environment: config.env,
          demoMode: config.demo.enabled,
          realtimeClients: connectedClientCount(),
          providers: {
            storage: config.storage.provider,
            gps: config.providers.gps,
            notifications: config.providers.notification,
            payments: config.providers.payment,
            ai: config.ai.provider,
          },
        },
      });
    },
  );

  app.get(
    '/users',
    { preHandler: requirePermission(Permission.ADMIN_USERS) },
    async (request, reply) => {
      const query = parseQuery(userListQuerySchema, request.query);

      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.role ? { roles: { some: { role: { name: query.role as never } } } } : {}),
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' as const } },
                { firstName: { contains: query.search, mode: 'insensitive' as const } },
                { lastName: { contains: query.search, mode: 'insensitive' as const } },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      };

      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          include: {
            roles: { include: { role: true } },
            memberships: { include: { organization: { select: { id: true, name: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          ...skipTake(query.page, query.pageSize),
        }),
      ]);

      return paginated(
        reply,
        users.map((user) => ({
          id: user.id,
          email: user.email,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          status: user.status,
          roles: user.roles.map((entry) => entry.role.name),
          organizations: user.memberships.map((membership) => ({
            id: membership.organization.id,
            name: membership.organization.name,
            role: membership.role,
            status: membership.status,
          })),
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        })),
        buildPaginationMeta(query.page, query.pageSize, total),
      );
    },
  );

  app.post(
    '/users/:id/status',
    { preHandler: requirePermission(Permission.ADMIN_USERS) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateUserStatusSchema, request.body);

      const before = await prisma.user.findUnique({ where: { id } });
      if (!before) throw errors.notFound('User');

      const user = await prisma.user.update({ where: { id }, data: { status: input.status } });

      // Suspending an account must terminate its live sessions immediately.
      if (input.status !== UserStatus.ACTIVE) {
        await prisma.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await auditFromRequest(request, {
        action: AuditAction.USER_STATUS_CHANGED,
        entityType: 'User',
        entityId: id,
        before: { status: before.status },
        after: { status: input.status, reason: input.reason },
      });

      return ok(reply, { id: user.id, status: user.status });
    },
  );

  app.get(
    '/organizations',
    { preHandler: requirePermission(Permission.ADMIN_ORGANIZATIONS) },
    async (request, reply) => {
      const query = parseQuery(paginationSchema, request.query);

      const [total, organizations] = await Promise.all([
        prisma.organization.count(),
        prisma.organization.findMany({
          include: {
            memberships: { where: { status: MembershipStatus.ACTIVE }, select: { id: true } },
          },
          orderBy: { createdAt: 'desc' },
          ...skipTake(query.page, query.pageSize),
        }),
      ]);

      const counts = await prisma.truck.groupBy({
        by: ['organizationId'],
        where: { archivedAt: null },
        _count: { _all: true },
      });
      const truckMap = new Map(counts.map((entry) => [entry.organizationId, entry._count._all]));

      return paginated(
        reply,
        organizations.map((organization) => ({
          id: organization.id,
          name: organization.name,
          type: organization.type,
          verificationStatus: organization.verificationStatus,
          city: organization.city,
          state: organization.state,
          inviteCode: organization.inviteCode,
          memberCount: organization.memberships.length,
          truckCount: truckMap.get(organization.id) ?? 0,
          createdAt: organization.createdAt.toISOString(),
        })),
        buildPaginationMeta(query.page, query.pageSize, total),
      );
    },
  );

  app.get(
    '/audit',
    { preHandler: requirePermission(Permission.ADMIN_AUDIT) },
    async (request, reply) => {
      const query = parseQuery(auditQuerySchema, request.query);

      const where = {
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      };

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: {
            actor: { select: { id: true, firstName: true, lastName: true, email: true } },
            organization: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          ...skipTake(query.page, query.pageSize),
        }),
      ]);

      return paginated(
        reply,
        logs.map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          actor: log.actor
            ? {
                id: log.actor.id,
                name: `${log.actor.firstName} ${log.actor.lastName}`.trim(),
                email: log.actor.email,
              }
            : null,
          organization: log.organization,
          beforeData: log.beforeData,
          afterData: log.afterData,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt.toISOString(),
        })),
        buildPaginationMeta(query.page, query.pageSize, total),
      );
    },
  );
}

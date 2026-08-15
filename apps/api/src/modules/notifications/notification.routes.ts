import type { FastifyInstance } from 'fastify';
import {
  buildPaginationMeta,
  markNotificationsSchema,
  notificationListQuerySchema,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { ok, paginated, parseBody, parseQuery, skipTake } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import * as notificationService from './notification.service';

/**
 * Notification inbox. A user only ever sees their own notifications, so no
 * additional tenant filter is required beyond the user id.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(notificationListQuerySchema, request.query);

    const where = { userId: auth.user.id, ...(query.unreadOnly ? { readAt: null } : {}) };

    const [total, notifications, unread] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query.page, query.pageSize),
      }),
      notificationService.unreadCount(auth.user.id),
    ]);

    const items = notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      priority: notification.priority,
      data: notification.data,
      actionUrl: notification.actionUrl,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    }));

    return reply.code(200).send({
      success: true,
      data: {
        items,
        pagination: buildPaginationMeta(query.page, query.pageSize, total),
      },
      meta: { unreadCount: unread },
    });
  });

  app.get('/unread-count', async (request, reply) => {
    const auth = requireAuth(request);
    return ok(reply, { unreadCount: await notificationService.unreadCount(auth.user.id) });
  });

  app.post('/read', async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(markNotificationsSchema, request.body);
    const updated = await notificationService.markAsRead(auth.user.id, input.notificationIds);
    return ok(reply, { updated, unreadCount: await notificationService.unreadCount(auth.user.id) });
  });

  app.post('/read-all', async (request, reply) => {
    const auth = requireAuth(request);
    const updated = await notificationService.markAllAsRead(auth.user.id);
    return ok(reply, { updated, unreadCount: 0 });
  });

  app.get('/preferences', async (request, reply) => {
    const auth = requireAuth(request);
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
    });
    return ok(reply, preferences);
  });

  // Local delivery outbox: proves what email/SMS production would have sent.
  app.get('/deliveries', async (request, reply) => {
    const auth = requireAuth(request);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return ok(reply, deliveries);
  });

  void paginated;
}

import {
  NotificationChannel,
  NotificationPriority,
  type NotificationType,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { LocalNotificationProvider } from '../../providers/notifications/local-notification.provider';
import type {
  NotificationMessage,
  NotificationProvider,
} from '../../providers/notifications/notification.provider';

/**
 * Notification dispatch.
 *
 * Callers describe *what happened*; this service resolves recipients, honours
 * their channel preferences and hands delivery to the configured provider.
 * Delivery never blocks the operation that triggered it.
 */

function createProvider(): NotificationProvider {
  switch (config.providers.notification) {
    case 'production':
      throw new Error(
        'NOTIFICATION_PROVIDER=production requires email/SMS/push providers to be configured.',
      );
    case 'local':
    default:
      return new LocalNotificationProvider();
  }
}

export const notificationProvider: NotificationProvider = createProvider();

/** Channels used when the user has expressed no preference. */
const DEFAULT_CHANNELS: NotificationChannel[] = [NotificationChannel.IN_APP];

/** High-signal events additionally go out-of-band. */
const URGENT_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
  NotificationChannel.SMS,
];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  priority?: NotificationPriority;
  data?: Record<string, unknown> | null;
  actionUrl?: string | null;
  organizationId?: string | null;
  channels?: NotificationChannel[];
}

async function resolveChannels(
  userId: string,
  type: NotificationType,
  priority: NotificationPriority,
  requested?: NotificationChannel[],
): Promise<NotificationChannel[]> {
  if (requested && requested.length > 0) return requested;

  const preferences = await prisma.notificationPreference.findMany({
    where: { userId, eventType: type },
  });

  if (preferences.length > 0) {
    return preferences
      .filter((preference) => preference.enabled)
      .map((preference) => preference.channel as NotificationChannel);
  }

  return priority === NotificationPriority.CRITICAL ? URGENT_CHANNELS : DEFAULT_CHANNELS;
}

export async function notify(input: NotifyInput): Promise<void> {
  const priority = input.priority ?? NotificationPriority.NORMAL;

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, phone: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return;

  const message: NotificationMessage = {
    type: input.type,
    title: input.title,
    body: input.body,
    priority,
    data: input.data ?? null,
    actionUrl: input.actionUrl ?? null,
    organizationId: input.organizationId ?? null,
  };

  const channels = await resolveChannels(input.userId, input.type, priority, input.channels);
  const recipient = { userId: user.id, email: user.email, phone: user.phone };

  for (const channel of channels) {
    try {
      switch (channel) {
        case NotificationChannel.IN_APP:
          await notificationProvider.sendInApp(recipient, message);
          break;
        case NotificationChannel.EMAIL:
          await notificationProvider.sendEmail(recipient, message);
          break;
        case NotificationChannel.SMS:
          await notificationProvider.sendSms(recipient, message);
          break;
        case NotificationChannel.PUSH:
          await notificationProvider.sendPush(recipient, message);
          break;
      }
    } catch (error) {
      logger.error({ err: error, channel, userId: input.userId }, 'Notification delivery failed');
    }
  }
}

/** Fire-and-forget variant for use inside request handlers. */
export function notifyAsync(input: NotifyInput): void {
  void notify(input).catch((error) => {
    logger.error({ err: error, userId: input.userId }, 'Async notification failed');
  });
}

/** Notify every active member of an organization holding one of `roles`. */
export async function notifyOrganization(
  organizationId: string,
  input: Omit<NotifyInput, 'userId' | 'organizationId'> & { roles?: string[] },
): Promise<void> {
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      ...(input.roles ? { role: { in: input.roles as never } } : {}),
    },
    select: { userId: true },
  });

  await Promise.all(
    memberships.map((membership) =>
      notify({ ...input, userId: membership.userId, organizationId }),
    ),
  );
}

export async function markAsRead(userId: string, notificationIds: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, id: { in: notificationIds }, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

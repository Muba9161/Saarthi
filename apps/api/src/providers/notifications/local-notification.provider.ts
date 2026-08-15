import { NotificationChannel } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { broadcastNotification } from '../../realtime/realtime.service';
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationProvider,
  NotificationRecipient,
} from './notification.provider';

/**
 * Local notification provider.
 *
 * In-app notifications are genuinely delivered: a row is written and pushed to
 * the user's realtime channel. Email/SMS/push are captured in the delivery
 * outbox and logged, so the flows are fully exercisable without any paid
 * third-party account.
 */
export class LocalNotificationProvider implements NotificationProvider {
  readonly name = 'local';

  async sendInApp(
    recipient: NotificationRecipient,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: recipient.userId,
          organizationId: message.organizationId ?? null,
          type: message.type,
          title: message.title,
          body: message.body,
          priority: message.priority,
          data: (message.data ?? undefined) as never,
          actionUrl: message.actionUrl ?? null,
        },
      });

      await broadcastNotification({
        id: notification.id,
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        priority: notification.priority,
        data: (notification.data as Record<string, unknown> | null) ?? null,
        createdAt: notification.createdAt.toISOString(),
      });

      return { channel: NotificationChannel.IN_APP, success: true };
    } catch (error) {
      logger.error({ err: error, userId: recipient.userId }, 'In-app notification failed');
      return {
        channel: NotificationChannel.IN_APP,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async record(
    channel: NotificationChannel,
    recipient: NotificationRecipient,
    destination: string | null | undefined,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    if (!destination) {
      return { channel, success: false, error: 'No destination address on file' };
    }

    await prisma.notificationDelivery.create({
      data: {
        userId: recipient.userId,
        channel,
        destination,
        subject: message.title,
        body: message.body,
        provider: this.name,
        success: true,
      },
    });

    logger.info(
      { channel, destination, title: message.title },
      'Notification captured by the local provider (not actually sent)',
    );

    return { channel, success: true };
  }

  async sendEmail(
    recipient: NotificationRecipient,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    return this.record(NotificationChannel.EMAIL, recipient, recipient.email, message);
  }

  async sendSms(
    recipient: NotificationRecipient,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    return this.record(NotificationChannel.SMS, recipient, recipient.phone, message);
  }

  async sendPush(
    recipient: NotificationRecipient,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    return this.record(NotificationChannel.PUSH, recipient, recipient.userId, message);
  }
}

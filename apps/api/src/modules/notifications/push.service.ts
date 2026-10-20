import { NotificationChannel } from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationProvider,
  NotificationRecipient,
} from '../../providers/notifications/notification.provider';
import { FcmClient, type PushSender } from '../../providers/push/fcm.client';

/**
 * Push notifications to the phones a person has signed in on.
 *
 * Each install of the owner app registers its Firebase token after sign-in
 * and drops it on sign-out; a token Firebase reports as gone is forgotten. With
 * no Firebase key configured, a push is recorded in the outbox as before, so
 * every flow still runs without an account.
 */

let sender: PushSender | null | undefined;

function configuredSender(): PushSender | null {
  if (sender !== undefined) return sender;
  const path = config.push.serviceAccountPath;
  try {
    sender = path ? new FcmClient(path) : null;
  } catch (error) {
    logger.error({ err: error }, 'Push is off: the Firebase key file could not be read');
    sender = null;
  }
  return sender;
}

/** Tests stand in for Firebase here; `undefined` restores the configured one. */
export function setPushSender(next: PushSender | null | undefined): void {
  sender = next;
}

/**
 * Keep [token] on this person. A token belongs to one install, so a phone
 * signed into a different account moves to that account.
 */
export async function registerDevice(userId: string, token: string, app: string): Promise<void> {
  await prisma.pushDevice.upsert({
    where: { token },
    create: { userId, token, app },
    update: { userId, app, lastSeenAt: new Date() },
  });
}

/** Signing out: this phone stops receiving this person's pushes. */
export async function unregisterDevice(userId: string, token: string): Promise<void> {
  await prisma.pushDevice.deleteMany({ where: { userId, token } });
}

/** Strings only, as FCM's data payload takes them. */
function payloadOf(message: NotificationMessage): Record<string, string> {
  return {
    type: message.type,
    title: message.title,
    body: message.body,
    priority: message.priority,
    ...(message.actionUrl ? { actionUrl: message.actionUrl } : {}),
  };
}

export async function sendPush(
  recipient: NotificationRecipient,
  message: NotificationMessage,
  fallback: NotificationProvider,
): Promise<DeliveryResult> {
  const push = configuredSender();
  if (!push) return fallback.sendPush(recipient, message);

  const devices = await prisma.pushDevice.findMany({ where: { userId: recipient.userId }, select: { token: true } });
  if (devices.length === 0) {
    return { channel: NotificationChannel.PUSH, success: false, error: 'No phone registered for push' };
  }

  const data = payloadOf(message);
  const outcomes = await Promise.all(devices.map(async (device) => ({ token: device.token, outcome: await push.send(device.token, { data }) })));
  const gone = outcomes.filter((entry) => entry.outcome === 'unregistered').map((entry) => entry.token);
  if (gone.length > 0) await prisma.pushDevice.deleteMany({ where: { token: { in: gone } } });

  const sent = outcomes.filter((entry) => entry.outcome === 'sent').length;
  await prisma.notificationDelivery.create({
    data: {
      userId: recipient.userId,
      channel: NotificationChannel.PUSH,
      destination: `${sent} of ${devices.length} phones`,
      subject: message.title,
      body: message.body,
      provider: 'fcm',
      success: sent > 0,
      ...(sent === 0 ? { error: 'No phone accepted the push' } : {}),
    },
  });
  return { channel: NotificationChannel.PUSH, success: sent > 0 };
}

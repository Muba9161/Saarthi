import type { NotificationChannel, NotificationPriority, NotificationType } from '@saarthi/shared';

/**
 * Notification delivery abstraction.
 *
 * Locally, in-app notifications are real database rows delivered over the
 * WebSocket, and email/SMS/push are recorded in `notification_deliveries` —
 * a developer-visible outbox that proves what production would have sent.
 */
export interface NotificationRecipient {
  userId: string;
  email?: string | null;
  phone?: string | null;
}

export interface NotificationMessage {
  type: NotificationType;
  title: string;
  body: string;
  priority: NotificationPriority;
  data?: Record<string, unknown> | null;
  actionUrl?: string | null;
  organizationId?: string | null;
}

export interface DeliveryResult {
  channel: NotificationChannel;
  success: boolean;
  error?: string;
}

export interface NotificationProvider {
  readonly name: string;
  sendInApp(recipient: NotificationRecipient, message: NotificationMessage): Promise<DeliveryResult>;
  sendEmail(recipient: NotificationRecipient, message: NotificationMessage): Promise<DeliveryResult>;
  sendSms(recipient: NotificationRecipient, message: NotificationMessage): Promise<DeliveryResult>;
  sendPush(recipient: NotificationRecipient, message: NotificationMessage): Promise<DeliveryResult>;
}

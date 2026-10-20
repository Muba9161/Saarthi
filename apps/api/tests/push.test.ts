import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationPriority, NotificationType, OrganizationType, PlanTier, RoleName } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { notify } from '../src/modules/notifications/notification.service';
import { setPushSender } from '../src/modules/notifications/push.service';
import type { PushOutcome, PushPayload, PushSender } from '../src/providers/push/fcm.client';
import { closeApp, createOrganization, createUser, getApp, request, resetDatabase, type TestUser } from './helpers';

/**
 * Push notifications: the owner app registers its phone, and important news
 * reaches it when the app is closed — through Firebase when a key is set, into
 * the outbox when not.
 */

const TOKEN_A = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Firebase, as far as the server can tell: records what was sent, answers as told. */
class FakeFirebase implements PushSender {
  readonly sent: Array<{ token: string; payload: PushPayload }> = [];
  constructor(private readonly answers: Record<string, PushOutcome> = {}) {}
  async send(token: string, payload: PushPayload): Promise<PushOutcome> {
    this.sent.push({ token, payload });
    return this.answers[token] ?? 'sent';
  }
}

const register = (user: TestUser, token: string) =>
  request({ method: 'POST', url: '/api/v1/notifications/devices', user, payload: { token } });

describe('push notifications', () => {
  let owner: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    setPushSender(undefined);
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    const business = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: business.id });
  });

  afterEach(() => setPushSender(undefined));

  it('keeps a phone on the person who signed in on it, and lets it go on sign-out', async () => {
    expect((await register(owner, TOKEN_A)).status).toBe(200);
    // Registering again only refreshes it.
    expect((await register(owner, TOKEN_A)).status).toBe(200);
    expect(await prisma.pushDevice.count({ where: { userId: owner.id } })).toBe(1);

    // The same phone signed into another account belongs to that account now.
    const colleague = await createUser({ role: RoleName.FLEET_OWNER, organizationId: owner.organizationId });
    await register(colleague, TOKEN_A);
    expect((await prisma.pushDevice.findUniqueOrThrow({ where: { token: TOKEN_A } })).userId).toBe(colleague.id);

    await request({ method: 'POST', url: '/api/v1/notifications/devices/remove', user: colleague, payload: { token: TOKEN_A } });
    expect(await prisma.pushDevice.count()).toBe(0);
  });

  it('pushes important news to every phone, with what the app needs to open it', async () => {
    const firebase = new FakeFirebase();
    setPushSender(firebase);
    await register(owner, TOKEN_A);
    await register(owner, TOKEN_B);

    await notify({
      userId: owner.id,
      type: NotificationType.ORDER_CREATED,
      title: 'New booking',
      body: 'TB-2026-00009 is waiting for you',
      priority: NotificationPriority.HIGH,
      actionUrl: '/travel/provider/bookings/abc',
    });

    expect(firebase.sent.map((entry) => entry.token).sort()).toEqual([TOKEN_A, TOKEN_B]);
    expect(firebase.sent[0]!.payload.data).toMatchObject({
      title: 'New booking',
      body: 'TB-2026-00009 is waiting for you',
      priority: 'HIGH',
      actionUrl: '/travel/provider/bookings/abc',
    });
    // Still in the inbox as well.
    expect(await prisma.notification.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('forgets a phone Firebase says is gone', async () => {
    setPushSender(new FakeFirebase({ [TOKEN_B]: 'unregistered' }));
    await register(owner, TOKEN_A);
    await register(owner, TOKEN_B);

    await notify({ userId: owner.id, type: NotificationType.ORDER_CREATED, title: 'x', body: 'y', priority: NotificationPriority.CRITICAL });

    const left = await prisma.pushDevice.findMany({ where: { userId: owner.id } });
    expect(left.map((device) => device.token)).toEqual([TOKEN_A]);
  });

  it('leaves everyday news in the inbox only', async () => {
    const firebase = new FakeFirebase();
    setPushSender(firebase);
    await register(owner, TOKEN_A);

    await notify({ userId: owner.id, type: NotificationType.ORDER_CREATED, title: 'x', body: 'y', priority: NotificationPriority.NORMAL });

    expect(firebase.sent).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('records the push in the outbox when no Firebase key is set', async () => {
    setPushSender(null);
    await register(owner, TOKEN_A);

    await notify({ userId: owner.id, type: NotificationType.ORDER_CREATED, title: 'Outbox', body: 'y', priority: NotificationPriority.HIGH });

    const delivery = await prisma.notificationDelivery.findFirst({ where: { userId: owner.id, channel: 'PUSH' } });
    expect(delivery?.provider).toBe('local');
  });
});

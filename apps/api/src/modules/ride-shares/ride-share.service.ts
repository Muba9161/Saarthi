import crypto from 'node:crypto';
import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PlanTier,
  RIDE_SHARE_HOURS,
  RideShareStatus,
  formatRegistrationNumber,
  normalizeRegistrationNumber,
  type PublicLiveRide,
  type RidePointsInput,
  type RideShareView,
  type RideSharedWithMe,
  type StartRideShareInput,
} from '@saarthi/shared';
import type { Prisma } from '../../database/prisma';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import { notify } from '../notifications/notification.service';
import { logger } from '../../lib/logger';
import { assertMayRideAlong } from './ride-access';

/*
 * Share my ride: riding along in a vehicle that is not on Saarthi.
 *
 * Nobody owns that vehicle here, so nobody is asked — the rider chooses who
 * sees them: Saarthi users named by mobile number, who are told, and anyone
 * holding the live link. The link shows a first name, the typed number and the
 * position while sharing, and nothing once it ends.
 */

const shareInclude = {
  rider: { select: { id: true, firstName: true, lastName: true } },
  viewers: { select: { phone: true, viewerUserId: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.RideShareInclude;

type ShareRecord = Prisma.RideShareGetPayload<{ include: typeof shareInclude }>;

// ---------------------------------------------------------------------------
// Keys — derived from the share, so nothing is stored and an ended share
// takes its keys with it.
// ---------------------------------------------------------------------------

function signed(purpose: string, shareId: string): string {
  return crypto.createHmac('sha256', config.auth.accessSecret).update(`${purpose}:${shareId}`).digest('base64url');
}

function sameKey(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The live link's token: the share's id and a signature, so it cannot be guessed or edited. */
function linkToken(shareId: string): string {
  return `${shareId}.${signed('ride-share-link', shareId).slice(0, 32)}`;
}

function shareIdFromToken(token: string): string | null {
  const [id, signature] = token.split('.');
  if (!id || !signature) return null;
  return sameKey(signed('ride-share-link', id).slice(0, 32), signature) ? id : null;
}

const reportingKey = (shareId: string) => signed('ride-share-report', shareId);

const liveLink = (shareId: string) => `${config.server.frontendUrl.replace(/\/$/, '')}/live/${linkToken(shareId)}`;

// ---------------------------------------------------------------------------

/** A share past its time is over, whether or not anyone said so. */
async function closeIfExpired(share: ShareRecord, now = new Date()): Promise<ShareRecord> {
  if (share.status !== RideShareStatus.SHARING || share.expiresAt > now) return share;
  return prisma.rideShare.update({
    where: { id: share.id },
    data: { status: RideShareStatus.ENDED, endedAt: share.expiresAt },
    include: shareInclude,
  });
}

function location(share: ShareRecord) {
  return share.lastLatitude !== null && share.lastLongitude !== null && share.lastLocationAt
    ? {
        latitude: share.lastLatitude,
        longitude: share.lastLongitude,
        speedKph: share.lastSpeedKph,
        heading: share.lastHeading,
        recordedAt: share.lastLocationAt.toISOString(),
      }
    : null;
}

function shareView(share: ShareRecord): RideShareView {
  const sharing = share.status === RideShareStatus.SHARING;
  return {
    id: share.id,
    status: share.status as RideShareStatus,
    registrationNumber: share.registrationNumber,
    startedAt: share.startedAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    endedAt: share.endedAt?.toISOString() ?? null,
    link: liveLink(share.id),
    contacts: share.viewers.filter((viewer) => viewer.viewerUserId !== share.riderUserId).map((viewer) => viewer.phone),
    sharedWithSelf: share.viewers.some((viewer) => viewer.viewerUserId === share.riderUserId),
    reportingToken: sharing ? reportingKey(share.id) : null,
    lastLocation: location(share),
  };
}

const riderName = (share: ShareRecord) => `${share.rider.firstName} ${share.rider.lastName}`.trim();

/**
 * Name Saarthi users by mobile number and tell them. A number with no Saarthi
 * account is simply not told — the rider is not shown which numbers have one;
 * the live link reaches everybody.
 */
async function tellContacts(share: ShareRecord, phones: string[], riderUserId: string): Promise<void> {
  if (phones.length === 0) return;
  const users = await prisma.user.findMany({
    where: { phone: { in: phones }, id: { not: riderUserId }, status: 'ACTIVE' },
    select: { id: true, phone: true },
  });
  for (const user of users) {
    const added = await prisma.rideShareViewer
      .create({ data: { rideShareId: share.id, viewerUserId: user.id, phone: user.phone! } })
      .catch(() => null); // Named already on this share.
    if (!added) continue;
    // Told before the rider hears sharing has started; a failed notification never stops the share.
    await notify({
      userId: user.id,
      type: NotificationType.RIDE_SHARED_WITH_YOU,
      priority: NotificationPriority.HIGH,
      title: `${riderName(share)} shared a live ride with you`,
      body: share.registrationNumber
        ? `Travelling in ${formatRegistrationNumber(share.registrationNumber)}. Follow them live until they arrive.`
        : 'Follow them live until they arrive.',
      data: { rideShareId: share.id },
      actionUrl: `/live/${linkToken(share.id)}`,
    }).catch((error) => logger.error({ err: error, rideShareId: share.id }, 'Ride share notification failed'));
  }
}

async function activeShareOf(userId: string): Promise<ShareRecord | null> {
  const share = await prisma.rideShare.findFirst({
    where: { riderUserId: userId, status: RideShareStatus.SHARING },
    orderBy: { startedAt: 'desc' },
    include: shareInclude,
  });
  if (!share) return null;
  const current = await closeIfExpired(share);
  return current.status === RideShareStatus.SHARING ? current : null;
}

async function reload(shareId: string): Promise<ShareRecord> {
  return prisma.rideShare.findUniqueOrThrow({ where: { id: shareId }, include: shareInclude });
}

/**
 * Start sharing — or, already sharing, name the new people on the same share.
 * One share at a time: a rider is in one vehicle.
 */
export async function startRideShare(auth: AuthContext, input: StartRideShareInput, now = new Date()): Promise<RideShareView> {
  assertMayRideAlong(auth);
  const existing = await activeShareOf(auth.user.id);
  const share =
    existing ??
    (await prisma.rideShare.create({
      data: {
        riderUserId: auth.user.id,
        registrationNumber: input.registrationNumber ? normalizeRegistrationNumber(input.registrationNumber) : null,
        startedAt: now,
        expiresAt: new Date(now.getTime() + RIDE_SHARE_HOURS * 60 * 60_000),
      },
      include: shareInclude,
    }));
  await tellContacts(share, [...new Set(input.contacts)], auth.user.id);
  if (input.shareWithSelf) await showOnOwnAccount(auth, share.id);
  return shareView(await reload(share.id));
}

/** Whether this login also holds an owner account — where the owner app would show the ride. */
export async function hasOwnerAccount(auth: AuthContext): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { userId: auth.user.id, status: 'ACTIVE', role: { in: [...OPERATOR_OWNER_ROLES] as never } },
    select: { id: true },
  });
  return membership !== null;
}

/**
 * Show the ride on the rider's own owner account too: the same login in the
 * owner app, for someone who both drives and owns. The rider becomes a viewer
 * of their own share; nobody else is told.
 */
async function showOnOwnAccount(auth: AuthContext, shareId: string): Promise<void> {
  if (!(await hasOwnerAccount(auth))) throw errors.businessRule('This login has no owner account to show the ride on.');
  await prisma.rideShareViewer
    .create({ data: { rideShareId: shareId, viewerUserId: auth.user.id, phone: auth.user.phone ?? '' } })
    .catch(() => null); // Already showing there.
}

/** "Show on my owner app" while sharing. Saying it twice is fine. */
export async function shareWithOwnAccount(auth: AuthContext, shareId: string): Promise<RideShareView> {
  const share = await ownShare(auth, shareId);
  if (share.status !== RideShareStatus.SHARING) throw errors.conflict('This ride is no longer being shared.');
  await showOnOwnAccount(auth, share.id);
  return shareView(await reload(share.id));
}

export async function myRideShare(auth: AuthContext): Promise<RideShareView | null> {
  const share = await activeShareOf(auth.user.id);
  return share ? shareView(share) : null;
}

async function ownShare(auth: AuthContext, shareId: string): Promise<ShareRecord> {
  const share = await prisma.rideShare.findUnique({ where: { id: shareId }, include: shareInclude });
  if (!share || share.riderUserId !== auth.user.id) throw errors.notFound('Shared ride');
  return closeIfExpired(share);
}

export async function addRideShareContact(auth: AuthContext, shareId: string, phone: string): Promise<RideShareView> {
  const share = await ownShare(auth, shareId);
  if (share.status !== RideShareStatus.SHARING) throw errors.conflict('This ride is no longer being shared.');
  await tellContacts(share, [phone], auth.user.id);
  return shareView(await reload(share.id));
}

/** Stop sharing. Saying it twice is fine. */
export async function endRideShare(auth: AuthContext, shareId: string): Promise<RideShareView> {
  const share = await ownShare(auth, shareId);
  if (share.status !== RideShareStatus.SHARING) return shareView(share);
  const ended = await prisma.rideShare.update({
    where: { id: share.id },
    data: { status: RideShareStatus.ENDED, endedAt: new Date() },
    include: shareInclude,
  });
  return shareView(ended);
}

/** The rider's phone, with the share's reporting key. A wrong key reads as not signed in, so the phone stops. */
export async function reportRideShare(
  shareId: string,
  key: string | undefined,
  input: RidePointsInput,
  now = new Date(),
): Promise<{ accepted: number }> {
  if (!key || !sameKey(reportingKey(shareId), key)) throw errors.unauthenticated('This phone is not sharing that ride.');
  const found = await prisma.rideShare.findUnique({ where: { id: shareId }, include: shareInclude });
  if (!found) throw errors.unauthenticated('This phone is not sharing that ride.');
  const share = await closeIfExpired(found, now);
  if (share.status !== RideShareStatus.SHARING) throw errors.conflict('This ride is no longer being shared.');

  const latest = [...input.points]
    .filter((point) => point.recordedAt.getTime() <= now.getTime() + 60_000)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .at(-1);
  if (latest && (!share.lastLocationAt || latest.recordedAt > share.lastLocationAt)) {
    await prisma.rideShare.update({
      where: { id: share.id },
      data: {
        lastLatitude: latest.latitude,
        lastLongitude: latest.longitude,
        lastSpeedKph: latest.speedKph ?? null,
        lastHeading: latest.heading ?? null,
        lastLocationAt: latest.recordedAt,
      },
    });
  }
  return { accepted: input.points.length };
}

/**
 * Rides being shared with me right now, for "Shared with me" and the Home card:
 * those family shared by my mobile number — listed only on a Personal plan
 * account; anyone else named follows from the notification or the live link —
 * and my own ride from Humsafar, shown on my owner account whatever its plan.
 */
export async function ridesSharedWithMe(auth: AuthContext, now = new Date()): Promise<RideSharedWithMe[]> {
  const personal = auth.subscription?.planTier === PlanTier.PERSONAL;
  const shares = await prisma.rideShare.findMany({
    where: { status: RideShareStatus.SHARING, viewers: { some: { viewerUserId: auth.user.id } } },
    orderBy: { startedAt: 'desc' },
    take: 20,
    include: shareInclude,
  });
  const current = await Promise.all(shares.map((share) => closeIfExpired(share, now)));
  return current
    .filter((share) => share.status === RideShareStatus.SHARING)
    .filter((share) => personal || share.riderUserId === auth.user.id)
    .map((share) => ({
      id: share.id,
      token: linkToken(share.id),
      riderName: riderName(share),
      registrationNumber: share.registrationNumber,
      startedAt: share.startedAt.toISOString(),
      expiresAt: share.expiresAt.toISOString(),
      position: location(share),
      mine: share.riderUserId === auth.user.id,
    }));
}

/**
 * What the live link shows. A bad token is simply not found; an ended share
 * says so and shows no position.
 */
export async function publicLiveRide(token: string): Promise<PublicLiveRide> {
  const shareId = shareIdFromToken(token);
  const found = shareId ? await prisma.rideShare.findUnique({ where: { id: shareId }, include: shareInclude }) : null;
  if (!found) throw errors.notFound('Shared ride', 'This live link does not exist.');
  const share = await closeIfExpired(found);
  const sharing = share.status === RideShareStatus.SHARING;
  return {
    riderName: share.rider.firstName,
    registrationNumber: share.registrationNumber,
    status: share.status as RideShareStatus,
    startedAt: share.startedAt.toISOString(),
    endedAt: share.endedAt?.toISOString() ?? null,
    position: sharing ? location(share) : null,
  };
}

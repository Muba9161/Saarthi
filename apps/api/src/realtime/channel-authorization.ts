import { parseChannel } from '@saarthi/shared';
import { prisma } from '../database/prisma';
import type { AuthContext } from '../auth/context';

/**
 * Channel authorization for the realtime gateway.
 *
 * Every subscription is checked against the database before a socket is added
 * to a channel. A client asking for another tenant's `fleet:` stream is
 * rejected outright — nothing is ever "hidden" client-side.
 */
export async function canSubscribe(auth: AuthContext, channel: string): Promise<boolean> {
  const parsed = parseChannel(channel);
  if (!parsed) return false;

  const { kind, id } = parsed;

  if (kind === 'admin') return auth.isPlatformAdmin;
  if (!id) return false;

  switch (kind) {
    case 'user':
      return id === auth.user.id;

    case 'fleet':
      return auth.isPlatformAdmin || auth.organizationId === id;

    case 'driver': {
      if (auth.isPlatformAdmin) return true;
      if (auth.driverId === id) return true;
      if (!auth.organizationId) return false;
      const driver = await prisma.driver.findUnique({
        where: { id },
        select: { organizationId: true },
      });
      return driver?.organizationId === auth.organizationId;
    }

    case 'truck': {
      if (auth.isPlatformAdmin) return true;
      const truck = await prisma.truck.findUnique({
        where: { id },
        select: { organizationId: true, currentDriverId: true },
      });
      if (!truck) return false;
      if (auth.organizationId && truck.organizationId === auth.organizationId) return true;
      if (auth.driverId && truck.currentDriverId === auth.driverId) return true;

      // A customer may watch the truck carrying their in-flight order.
      if (auth.organizationId) {
        const order = await prisma.order.findFirst({
          where: {
            assignedTruckId: id,
            status: { in: ['ASSIGNED', 'PICKUP', 'IN_TRANSIT'] },
            OR: [
              { customerOrganizationId: auth.organizationId },
              { supplierOrganizationId: auth.organizationId },
            ],
          },
          select: { id: true },
        });
        if (order) return true;
      }
      return false;
    }

    case 'trip': {
      if (auth.isPlatformAdmin) return true;
      const trip = await prisma.trip.findUnique({
        where: { id },
        select: {
          organizationId: true,
          driverId: true,
          order: {
            select: { customerOrganizationId: true, supplierOrganizationId: true },
          },
        },
      });
      if (!trip) return false;
      if (auth.organizationId && trip.organizationId === auth.organizationId) return true;
      if (auth.driverId && trip.driverId === auth.driverId) return true;
      if (auth.organizationId && trip.order) {
        if (trip.order.customerOrganizationId === auth.organizationId) return true;
        if (trip.order.supplierOrganizationId === auth.organizationId) return true;
      }
      return false;
    }

    case 'order': {
      if (auth.isPlatformAdmin) return true;
      if (!auth.organizationId) return false;
      const order = await prisma.order.findUnique({
        where: { id },
        select: {
          customerOrganizationId: true,
          supplierOrganizationId: true,
          fleetOrganizationId: true,
        },
      });
      if (!order) return false;
      return (
        order.customerOrganizationId === auth.organizationId ||
        order.supplierOrganizationId === auth.organizationId ||
        order.fleetOrganizationId === auth.organizationId
      );
    }

    case 'sos': {
      if (auth.isPlatformAdmin) return true;
      const incident = await prisma.sosIncident.findUnique({
        where: { id },
        select: {
          organizationId: true,
          driverId: true,
          responders: { select: { driverId: true, organizationId: true } },
        },
      });
      if (!incident) return false;
      if (auth.organizationId && incident.organizationId === auth.organizationId) return true;
      if (auth.driverId && incident.driverId === auth.driverId) return true;
      return incident.responders.some(
        (responder) =>
          (auth.driverId && responder.driverId === auth.driverId) ||
          (auth.organizationId && responder.organizationId === auth.organizationId),
      );
    }

    default:
      return false;
  }
}

/** Channels a client is automatically joined to on connect. */
export function defaultChannels(auth: AuthContext): string[] {
  const channels = [`user:${auth.user.id}`];
  if (auth.organizationId) channels.push(`fleet:${auth.organizationId}`);
  if (auth.driverId) channels.push(`driver:${auth.driverId}`);
  if (auth.isPlatformAdmin) channels.push('admin:platform');
  return channels;
}

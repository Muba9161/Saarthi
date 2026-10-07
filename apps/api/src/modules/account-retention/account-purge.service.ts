import { MembershipStatus, SubscriptionStatus } from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { withLock } from '../../infra/lock';
import { storageProvider } from '../../providers/storage';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { releaseAllDriversOfFleet } from '../drivers/driver-release.service';

/**
 * Permanently deleting an archived account's own data.
 *
 * Runs only for an organization archived for non-payment whose 90 days are
 * up and which has still not renewed. What goes, and what must stay:
 *
 *   DELETED — the business's own operational data: vehicles and everything
 *   recorded against them (locations, telemetry, fuel, maintenance, loans,
 *   FASTag and toll), trips that served no customer, documents and media
 *   (with their stored files), materials and stock, travel packages nobody
 *   booked, geofences, alert rules, AI history, terminal records, lookups,
 *   notifications, its payout account and public profile, and team access.
 *
 *   KEPT — what the law or another party needs: payments, verification
 *   charges, invoices and the audit log; orders, bookings, requirements,
 *   bids and marketplace settlements; the customer records those orders point
 *   at. A vehicle or package another party's record points at is archived
 *   and stripped rather than deleted, so their history still opens.
 *
 *   RELEASED — drivers. A driver's profile and work history are theirs, so
 *   they are moved to a seat of their own, available for work, before
 *   anything is deleted.
 *
 * The organization row itself stays (payments reference it), marked
 * `dataPurgedAt`.
 */

const purgeLogger = logger.child({ module: 'account-retention:purge' });

export interface PurgeSummary {
  organizationId: string;
  driversReleased: number;
  vehiclesDeleted: number;
  vehiclesArchived: number;
  documentsDeleted: number;
  filesRemoved: number;
}

/** Whether this organization is due for deletion right now. */
async function isDue(organizationId: string, now: Date): Promise<boolean> {
  const [organization, subscription] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { billingArchivedAt: true, dataPurgeAt: true, dataPurgedAt: true },
    }),
    prisma.subscription.findUnique({ where: { organizationId }, select: { status: true } }),
  ]);
  if (!organization?.billingArchivedAt || !organization.dataPurgeAt || organization.dataPurgedAt) return false;
  if (organization.dataPurgeAt.getTime() > now.getTime()) return false;
  // A renewal that landed a moment ago wins over the purge.
  return subscription?.status !== SubscriptionStatus.ACTIVE && subscription?.status !== SubscriptionStatus.TRIALING;
}

export async function purgeAccountData(organizationId: string, now = new Date()): Promise<PurgeSummary | null> {
  return withLock(`account-retention:purge:${organizationId}`, 10 * 60_000, async () => {
    if (!(await isDue(organizationId, now))) return null;

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });

    // Drivers first, while their records still exist to be moved with them.
    const driversReleased = await releaseAllDriversOfFleet(organizationId, organization.name);

    // Files are removed after the rows, from the keys collected here.
    const [documentFiles, mediaFiles] = await Promise.all([
      prisma.documentVersion.findMany({
        where: { document: { organizationId } },
        select: { storageKey: true },
      }),
      prisma.mediaAsset.findMany({ where: { organizationId }, select: { storageKey: true } }),
    ]);
    const fileKeys = [
      ...documentFiles.map((row) => row.storageKey),
      ...mediaFiles.map((row) => row.storageKey),
    ];

    const counts = await prisma.$transaction(
      async (tx) => {
        const where = { organizationId };

        // Vehicles another party's trip points at are kept, archived and
        // stripped, so the customer's order still shows which truck ran it.
        const sharedTrips = await tx.trip.findMany({
          where: { organizationId, OR: [{ order: { isNot: null } }, { travelBooking: { isNot: null } }] },
          select: { truckId: true },
        });
        const keptVehicleIds = [...new Set(sharedTrips.map((trip) => trip.truckId))];

        // Recorded against the vehicles — gone for kept vehicles too.
        await tx.telemetryReading.deleteMany({ where });
        await tx.telemetryAlert.deleteMany({ where });
        await tx.telemetryDiagnosticCode.deleteMany({ where });
        await tx.telemetryAlertRule.deleteMany({ where });
        await tx.deviceEvent.deleteMany({ where });
        await tx.deviceCommand.deleteMany({ where });
        await tx.deviceAssignment.deleteMany({ where });
        await tx.devicePairingToken.deleteMany({ where });
        await tx.truckLocation.deleteMany({ where });
        await tx.truckEvent.deleteMany({ where });
        await tx.maintenanceRecord.deleteMany({ where });
        await tx.fuelRecord.deleteMany({ where });
        await tx.tollTransaction.deleteMany({ where });
        await tx.fastagAccount.deleteMany({ where });
        await tx.vehicleLoan.deleteMany({ where });
        await tx.truckAssignment.deleteMany({ where });

        // Trips that served no customer are the fleet's own.
        await tx.trip.deleteMany({ where: { organizationId, order: { is: null }, travelBooking: { is: null } } });

        const vehicles = await tx.truck.deleteMany({
          where: { organizationId, id: { notIn: keptVehicleIds } },
        });
        const archivedVehicles = await tx.truck.updateMany({
          where: { organizationId, id: { in: keptVehicleIds } },
          data: { archivedAt: now, status: 'OFFLINE', currentDriverId: null },
        });

        const documents = await tx.document.deleteMany({ where });
        await tx.mediaAsset.deleteMany({ where });

        // Materials: an order that used one keeps its own copy of the name
        // and price, so the listing itself can go.
        await tx.stockMovement.deleteMany({ where });
        await tx.stockReservation.deleteMany({ where });
        await tx.stockItem.deleteMany({ where });
        await tx.inventoryLocation.deleteMany({ where });
        await tx.material.deleteMany({ where });

        // Packages somebody booked are archived; the rest go.
        await tx.travelPackage.deleteMany({ where: { organizationId, bookings: { none: {} } } });
        await tx.travelPackage.updateMany({
          where,
          data: { status: 'ARCHIVED', archivedAt: now },
        });

        await tx.geofence.deleteMany({ where });
        await tx.aiConversation.deleteMany({ where });
        await tx.aiInsight.deleteMany({ where });
        await tx.simulation.deleteMany({ where });
        await tx.qrPrivacyPolicy.deleteMany({ where });
        await tx.vehicleLookup.deleteMany({ where });
        await tx.licenceLookup.deleteMany({ where });
        await tx.terminalChecklistSubmission.deleteMany({ where });
        await tx.terminalChecklistTemplate.deleteMany({ where });
        await tx.terminalIssueReport.deleteMany({ where });
        await tx.terminalSession.deleteMany({ where });
        await tx.vehicleListingWatch.deleteMany({ where });
        await tx.notification.deleteMany({ where });
        await tx.payoutAccount.deleteMany({ where });
        await tx.organizationProfile.deleteMany({ where });

        // Team access. Memberships are kept as the record of who worked
        // here; sessions are ended.
        await tx.membership.updateMany({
          where: { organizationId, status: { not: MembershipStatus.REMOVED } },
          data: { status: MembershipStatus.REMOVED, isPrimary: false },
        });
        await tx.session.updateMany({
          where: { organizationId, revokedAt: null },
          data: { revokedAt: now },
        });

        await tx.organization.update({
          where: { id: organizationId },
          data: { dataPurgedAt: now, logoUrl: null, description: null },
        });

        return {
          vehiclesDeleted: vehicles.count,
          vehiclesArchived: archivedVehicles.count,
          documentsDeleted: documents.count,
        };
      },
      { timeout: 120_000 },
    );

    let filesRemoved = 0;
    for (const key of fileKeys) {
      try {
        await storageProvider.remove(key);
        filesRemoved += 1;
      } catch (error) {
        // The rows are gone; an orphaned file is logged for cleanup rather
        // than failing a purge that has already happened.
        purgeLogger.warn({ organizationId, key, error }, 'Could not remove a purged file');
      }
    }

    await recordAudit({
      action: AuditAction.ACCOUNT_DATA_PURGED,
      entityType: 'Organization',
      entityId: organizationId,
      actorUserId: null,
      organizationId,
      after: { driversReleased, ...counts, filesRemoved },
    });

    const summary = { organizationId, driversReleased, filesRemoved, ...counts };
    purgeLogger.info(summary, 'Archived account data purged');
    return summary;
  });
}

/**
 * Purge every archived account whose 90 days are up.
 *
 * Not with enforcement off: the archive is not applied there (see
 * `effectiveArchive`), so an account it would purge is one its owner is using.
 */
export async function runAccountPurgeSweep(now = new Date()): Promise<{ purged: number }> {
  if (!config.subscription.enforced) return { purged: 0 };

  const due = await prisma.organization.findMany({
    where: {
      billingArchivedAt: { not: null },
      dataPurgedAt: null,
      dataPurgeAt: { lte: now },
    },
    select: { id: true },
    take: 50,
  });

  let purged = 0;
  for (const { id } of due) {
    try {
      if (await purgeAccountData(id, now)) purged += 1;
    } catch (error) {
      purgeLogger.error({ organizationId: id, error }, 'Account purge failed');
    }
  }
  return { purged };
}

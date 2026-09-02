import {
  AlertSeverity,
  MediaOwnerType,
  NotificationPriority,
  NotificationType,
  type TerminalIssueCategory,
  TerminalIssueStatus,
  buildPaginationMeta,
  defaultIssueSeverity,
  type Paginated,
  type ReportTerminalIssueInput,
  type TerminalIssueListQuery,
  type TerminalIssueView,
  type UpdateTerminalIssueInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import { notifyOrganization } from '../notifications/notification.service';
import type { SessionRecord } from './session.view';
import type { AuthContext } from '../../auth/context';

/**
 * Driver-reported vehicle problems.
 *
 * Deliberately *not* a `MaintenanceRecord`. A maintenance record is what a
 * workshop did to a vehicle, and it is read by service-history analysis, resale
 * valuations and warranty claims. This is what a driver noticed from the cab —
 * unverified, sometimes wrong, often the first sign of something real. Writing
 * one straight into the other would put "sounds funny" into the evidence pack a
 * buyer reads, and there would be no way to tell the two apart afterwards.
 *
 * Triage turns one into the other. `maintenanceRecordId` is the link.
 */

const issueLogger = logger.child({ module: 'terminal-issues' });

const issueInclude = {
  vehicle: { select: { registrationNumber: true } },
  driver: { select: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.TerminalIssueReportInclude;

type IssueRecord = Prisma.TerminalIssueReportGetPayload<{ include: typeof issueInclude }>;

function toView(issue: IssueRecord): TerminalIssueView {
  return {
    id: issue.id,
    category: issue.category as TerminalIssueCategory,
    status: issue.status as TerminalIssueStatus,
    severity: issue.severity as AlertSeverity,
    description: issue.description,
    // References, not bytes. The media endpoint applies each asset's own
    // visibility rules on top of whatever authorised this read.
    mediaUrls: issue.mediaIds.map((id) => `/api/v1/media/${id}/file`),
    latitude: issue.latitude,
    longitude: issue.longitude,
    odometerKm: issue.odometerKm,
    vehicleId: issue.vehicleId,
    registrationNumber: issue.vehicle.registrationNumber,
    driverName: issue.driver
      ? `${issue.driver.user.firstName} ${issue.driver.user.lastName}`.trim()
      : null,
    createdAt: issue.createdAt.toISOString(),
    acknowledgedAt: issue.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    resolutionNote: issue.resolutionNote,
  };
}

/**
 * Record a problem reported from a terminal.
 *
 * Photographs are referenced by id: the terminal uploads them through the
 * existing media endpoint under the driver's own account, and this stores the
 * references. That keeps one copy of each image, one set of retention rules,
 * and one place a photograph can be deleted from.
 *
 * The ids are checked against the vehicle they claim to be about, so a terminal
 * cannot attach another fleet's photograph to its own report.
 */
export async function reportIssue(
  session: SessionRecord,
  input: ReportTerminalIssueInput,
): Promise<TerminalIssueView> {
  const severity = defaultIssueSeverity(input.category);

  let mediaIds: string[] = [];
  if (input.mediaIds && input.mediaIds.length > 0) {
    const assets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: input.mediaIds },
        organizationId: session.organizationId,
        deletedAt: null,
        OR: [
          { ownerType: MediaOwnerType.VEHICLE, ownerId: session.vehicleId },
          { ownerType: MediaOwnerType.DRIVER, ownerId: session.driverId },
        ],
      },
      select: { id: true },
    });
    mediaIds = assets.map((asset) => asset.id);

    if (mediaIds.length !== input.mediaIds.length) {
      // Not fatal. The report is the thing that matters, and refusing it
      // because one photo upload failed would lose the report as well.
      issueLogger.warn(
        { sessionId: session.id, requested: input.mediaIds.length, matched: mediaIds.length },
        'Some issue photos could not be attached',
      );
    }
  }

  const issue = await prisma.terminalIssueReport.create({
    data: {
      organizationId: session.organizationId,
      sessionId: session.id,
      terminalDeviceId: session.terminalDeviceId,
      vehicleId: session.vehicleId,
      driverId: session.driverId,
      reportedByUserId: session.driverUserId,
      category: input.category,
      status: TerminalIssueStatus.OPEN,
      severity,
      description: input.description,
      mediaIds,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      odometerKm: input.odometerKm ?? null,
    },
    include: issueInclude,
  });

  issueLogger.info(
    {
      issueId: issue.id,
      vehicleId: session.vehicleId,
      category: input.category,
      severity,
    },
    'Vehicle issue reported from a terminal',
  );

  const driverName =
    `${session.driver.user.firstName} ${session.driver.user.lastName}`.trim();

  await notifyOrganization(session.organizationId, {
    type: NotificationType.TERMINAL_ISSUE_REPORTED,
    title: `${input.category.toLowerCase()} issue on ${session.vehicle.registrationNumber}`,
    body: `${driverName}: ${input.description.slice(0, 160)}`,
    // An accident is not a maintenance ticket, and the notification has to say
    // so before anybody has triaged it.
    priority:
      severity === AlertSeverity.CRITICAL
        ? NotificationPriority.CRITICAL
        : NotificationPriority.HIGH,
    actionUrl: `/fleet/vehicles/${session.vehicleId}?tab=issues`,
    roles: ['FLEET_OWNER', 'FLEET_MANAGER', 'MOBILITY_PROVIDER', 'DISPATCHER'],
  });

  return toView(issue);
}

export async function listIssues(
  auth: AuthContext,
  organizationId: string,
  query: TerminalIssueListQuery,
): Promise<Paginated<TerminalIssueView>> {
  const where: Prisma.TerminalIssueReportWhereInput = {
    organizationId,
    ...(query.status ? { status: { in: query.status as TerminalIssueStatus[] } } : {}),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.terminalIssueReport.count({ where }),
    prisma.terminalIssueReport.findMany({
      where,
      include: issueInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toView),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

/** The driver's own reports on the vehicle they are signed on to. */
export async function issuesForVehicle(
  vehicleId: string,
  limit = 20,
): Promise<TerminalIssueView[]> {
  const rows = await prisma.terminalIssueReport.findMany({
    where: { vehicleId, status: { not: TerminalIssueStatus.DISMISSED } },
    include: issueInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toView);
}

export async function updateIssue(
  auth: AuthContext,
  issueId: string,
  input: UpdateTerminalIssueInput,
): Promise<TerminalIssueView> {
  const existing = await prisma.terminalIssueReport.findUnique({
    where: { id: issueId },
    select: { organizationId: true, status: true },
  });
  if (!existing) throw errors.notFound('Issue report');
  assertTenantAccess(auth, existing.organizationId, 'Issue report');

  const now = new Date();
  const terminal =
    input.status === TerminalIssueStatus.RESOLVED ||
    input.status === TerminalIssueStatus.DISMISSED;

  const updated = await prisma.terminalIssueReport.update({
    where: { id: issueId },
    data: {
      status: input.status,
      // First acknowledgement only. Re-acknowledging would move the timestamp
      // and lose how long the driver actually waited for somebody to look.
      ...(existing.status === TerminalIssueStatus.OPEN &&
      input.status !== TerminalIssueStatus.OPEN
        ? { acknowledgedAt: now, acknowledgedById: auth.user.id }
        : {}),
      ...(terminal ? { resolvedAt: now } : { resolvedAt: null }),
      resolutionNote: input.resolutionNote ?? null,
    },
    include: issueInclude,
  });

  return toView(updated);
}

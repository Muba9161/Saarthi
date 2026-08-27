import { randomBytes } from 'node:crypto';
import {
  ACTIVE_SOS_STATUSES,
  DocumentValidity,
  MediaOwnerType,
  Permission,
  MediaPurpose,
  QrCodeStatus,
  QrScanPurpose,
  QrScanResult,
  QrScope,
  QrSubjectType,
  ScannerRelationship,
  buildPaginationMeta,
  defaultScopesFor,
  documentTypeDefinition,
  normalizeLicenceNumber,
  normalizeRegistrationNumber,
  publicResolveDefaultFor,
  qrTargetUrl,
  resolveDocumentValidity,
  resolveGrantedScopes,
  scopeFieldFlags,
  shortTokenLabel,
  type CreateQrCodeInput,
  type DrivingLicenceRecord,
  type Paginated,
  type QrListQuery,
  type QrScanListQuery,
  type ResolveQrQuery,
  type RotateQrCodeInput,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../auth/context';
import { primaryUrlsFor } from '../media/media.service';
import { applyPrivacyPolicy, getPrivacyPolicy, type ScanPrivacyReport } from './qr-privacy.service';

/**
 * QR identity.
 *
 * A Saarthi QR code is a capability token. The printed artefact carries only an
 * opaque random string; everything a scan discloses is decided server-side, at
 * scan time, from the intersection of what the code was issued for and what the
 * scanner's relationship to the subject entitles them to.
 *
 * That ordering matters. It means a sticker on a windscreen cannot be made to
 * leak more by anyone who photographs it, revoking a code closes it everywhere
 * at once, and every attempt — including the failures — leaves a record.
 */

const qrLogger = logger.child({ module: 'qr' });

/** 32 bytes, base64url. Not derived from the subject id, deliberately. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface QrCodeView {
  id: string;
  subjectType: QrSubjectType;
  subjectId: string;
  status: QrCodeStatus;
  scopes: QrScope[];
  label: string | null;
  version: number;
  allowPublicResolve: boolean;
  /** Short human-typeable form, for when a dirty sticker will not scan. */
  shortLabel: string;
  targetUrl: string;
  imageUrl: string;
  badgeUrl: string;
  expiresAt: string | null;
  lastScannedAt: string | null;
  scanCount: number;
  createdAt: string;
}

type QrRecord = Prisma.QrCodeGetPayload<Record<string, never>>;

/**
 * `frontendUrl` defaults to the configured value so existing callers are
 * unaffected; routes pass the request's own origin so the link the UI shows
 * matches the URL the printed code actually encodes.
 */
function toView(code: QrRecord, frontendUrl: string = config.server.frontendUrl): QrCodeView {
  return {
    id: code.id,
    subjectType: code.subjectType as QrSubjectType,
    subjectId: code.subjectId,
    status: code.status as QrCodeStatus,
    scopes: code.scopes as QrScope[],
    label: code.label,
    version: code.version,
    allowPublicResolve: code.allowPublicResolve,
    shortLabel: shortTokenLabel(code.token),
    targetUrl: qrTargetUrl(frontendUrl, code.token),
    imageUrl: `/api/v1/qr/${code.id}/image.svg`,
    badgeUrl: `/api/v1/qr/${code.id}/badge.svg`,
    expiresAt: code.expiresAt?.toISOString() ?? null,
    lastScannedAt: code.lastScannedAt?.toISOString() ?? null,
    scanCount: code.scanCount,
    createdAt: code.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Subject resolution
// ---------------------------------------------------------------------------

interface SubjectInfo {
  organizationId: string | null;
  /** Shown on the badge and in the scan result. */
  displayName: string;
  /** Registration, licence number or reference — the second line of a badge. */
  secondaryLabel: string | null;
}

async function resolveSubject(subjectType: QrSubjectType, subjectId: string): Promise<SubjectInfo> {
  switch (subjectType) {
    case QrSubjectType.DRIVER: {
      const driver = await prisma.driver.findUnique({
        where: { id: subjectId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!driver) throw errors.notFound('Driver');
      return {
        organizationId: driver.organizationId,
        displayName: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
        secondaryLabel: driver.licenseNumber,
      };
    }

    case QrSubjectType.VEHICLE: {
      const vehicle = await prisma.truck.findUnique({ where: { id: subjectId } });
      if (!vehicle) throw errors.notFound('Vehicle');
      return {
        organizationId: vehicle.organizationId,
        displayName: vehicle.registrationNumber,
        secondaryLabel:
          [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType,
      };
    }

    case QrSubjectType.USER: {
      const user = await prisma.user.findUnique({ where: { id: subjectId } });
      if (!user) throw errors.notFound('User');
      return {
        organizationId: null,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
        secondaryLabel: null,
      };
    }

    case QrSubjectType.TRIP: {
      const trip = await prisma.trip.findUnique({ where: { id: subjectId } });
      if (!trip) throw errors.notFound('Trip');
      return {
        organizationId: trip.organizationId,
        displayName: trip.reference,
        secondaryLabel: trip.destinationAddress,
      };
    }

    case QrSubjectType.ORDER: {
      const order = await prisma.order.findUnique({ where: { id: subjectId } });
      if (!order) throw errors.notFound('Order');
      return {
        organizationId: order.fleetOrganizationId ?? order.customerOrganizationId,
        displayName: order.reference,
        secondaryLabel: order.materialName,
      };
    }

    case QrSubjectType.VEHICLE_LISTING: {
      const listing = await prisma.vehicleListing.findUnique({ where: { id: subjectId } });
      if (!listing) throw errors.notFound('Listing');
      return {
        organizationId: listing.organizationId,
        displayName: listing.reference,
        secondaryLabel: listing.title,
      };
    }

    case QrSubjectType.INVENTORY_LOCATION: {
      const location = await prisma.inventoryLocation.findUnique({ where: { id: subjectId } });
      if (!location) throw errors.notFound('Inventory location');
      return {
        organizationId: location.organizationId,
        displayName: location.name,
        secondaryLabel: location.code,
      };
    }

    case QrSubjectType.TRANSFER_HUB: {
      const hub = await prisma.transferHub.findUnique({ where: { id: subjectId } });
      if (!hub) throw errors.notFound('Transfer hub');
      return {
        organizationId: hub.organizationId,
        displayName: hub.name,
        secondaryLabel: hub.code,
      };
    }

    case QrSubjectType.RELAY_DELIVERY: {
      const relay = await prisma.relayDelivery.findUnique({ where: { id: subjectId } });
      if (!relay) throw errors.notFound('Relay delivery');
      return {
        organizationId: relay.organizationId,
        displayName: relay.reference,
        secondaryLabel: relay.dropAddress,
      };
    }

    default:
      throw errors.validation('That kind of record cannot have a QR code.');
  }
}

/**
 * A driver may only manage codes for themselves and the vehicle they are
 * assigned to. Enforced here rather than by a permission, because the grant is
 * about *which* subject rather than which action.
 */
async function assertSubjectManageable(
  auth: AuthContext,
  subjectType: QrSubjectType,
  subjectId: string,
  subject: SubjectInfo,
): Promise<void> {
  if (auth.isPlatformAdmin) return;

  if (subject.organizationId !== null && subject.organizationId !== auth.organizationId) {
    throw errors.notFound('Record');
  }

  const isDriverOnly =
    auth.user.roles.includes('DRIVER' as never) && !auth.permissions.includes('qr.manage' as never);

  if (!isDriverOnly) return;

  if (subjectType === QrSubjectType.DRIVER && subjectId === auth.driverId) return;
  if (subjectType === QrSubjectType.USER && subjectId === auth.user.id) return;
  if (subjectType === QrSubjectType.VEHICLE && auth.driverId) {
    const assignment = await prisma.truckAssignment.findFirst({
      where: { truckId: subjectId, driverId: auth.driverId, status: 'ACTIVE' },
    });
    if (assignment) return;
  }
  throw errors.forbidden('You can only manage QR codes for yourself and your assigned vehicle.');
}

// ---------------------------------------------------------------------------
// Creation & lifecycle
// ---------------------------------------------------------------------------

export async function createQrCode(
  auth: AuthContext,
  input: CreateQrCodeInput,
  frontendUrl?: string,
): Promise<QrCodeView> {
  const subject = await resolveSubject(input.subjectType, input.subjectId);
  await assertSubjectManageable(auth, input.subjectType, input.subjectId, subject);

  const expiresAt =
    input.expiresAt ??
    (config.qr.defaultTtlDays > 0
      ? new Date(Date.now() + config.qr.defaultTtlDays * 86_400_000)
      : null);

  const code = await prisma.qrCode.create({
    data: {
      organizationId: subject.organizationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      token: generateToken(),
      scopes: input.scopes ?? defaultScopesFor(input.subjectType),
      label: input.label ?? subject.displayName,
      allowPublicResolve: input.allowPublicResolve ?? publicResolveDefaultFor(input.subjectType),
      expiresAt,
      createdById: auth.user.id,
    },
  });

  return toView(code, frontendUrl);
}

/**
 * The active code for a subject, creating one if there is none.
 *
 * Idempotent so the UI never has to think about provisioning: a truck detail
 * screen asks for the vehicle's QR and gets one.
 */
export async function ensureForSubject(
  auth: AuthContext,
  subjectType: QrSubjectType,
  subjectId: string,
  frontendUrl?: string,
): Promise<QrCodeView> {
  const subject = await resolveSubject(subjectType, subjectId);
  await assertSubjectManageable(auth, subjectType, subjectId, subject);

  const existing = await prisma.qrCode.findFirst({
    where: { subjectType, subjectId, status: QrCodeStatus.ACTIVE },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    // An expiry that has passed is a fact, not a state to be discovered later.
    if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
      const expired = await prisma.qrCode.update({
        where: { id: existing.id },
        data: { status: QrCodeStatus.EXPIRED },
      });
      void expired;
    } else {
      return toView(existing, frontendUrl);
    }
  }

  // No `allowPublicResolve` here on purpose: provisioning-on-demand should take
  // the same default as the create screen rather than quietly issuing a stricter
  // code than the operator would have got by asking for one.
  //
  // `frontendUrl` is forwarded, which the create path previously dropped: a code
  // provisioned through a dev tunnel came back pointing at localhost, so the
  // very first render of a new sticker encoded a URL that worked nowhere but the
  // machine that generated it. The lookup path above always passed it through,
  // which made the bug show up only on a subject's first ever scan.
  return createQrCode(auth, { subjectType, subjectId } as CreateQrCodeInput, frontendUrl);
}

export async function listQrCodes(
  auth: AuthContext,
  query: QrListQuery,
  frontendUrl?: string,
): Promise<Paginated<QrCodeView>> {
  const isDriverOnly =
    auth.user.roles.includes('DRIVER' as never) && !auth.permissions.includes('qr.manage' as never);

  const where: Prisma.QrCodeWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.subjectType ? { subjectType: query.subjectType } : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.search ? { label: { contains: query.search, mode: 'insensitive' } } : {}),
    // A driver's list is their own subjects, never the whole fleet's.
    ...(isDriverOnly
      ? {
          OR: [
            { subjectType: QrSubjectType.DRIVER, subjectId: auth.driverId ?? '__none__' },
            { subjectType: QrSubjectType.USER, subjectId: auth.user.id },
          ],
        }
      : {}),
  };

  const [total, codes] = await Promise.all([
    prisma.qrCode.count({ where }),
    prisma.qrCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: codes.map((code) => toView(code, frontendUrl)),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getQrCode(
  auth: AuthContext,
  id: string,
  frontendUrl?: string,
): Promise<QrCodeView> {
  const code = await loadOwnedCode(auth, id);
  return toView(code, frontendUrl);
}

async function loadOwnedCode(auth: AuthContext, id: string): Promise<QrRecord> {
  const code = await prisma.qrCode.findUnique({ where: { id } });
  if (!code) throw errors.notFound('QR code');

  if (
    !auth.isPlatformAdmin &&
    code.organizationId !== null &&
    code.organizationId !== auth.organizationId
  ) {
    throw errors.notFound('QR code');
  }
  return code;
}

/** Raw token, needed only to render the image. Never returned by the API. */
export async function loadTokenForRendering(
  auth: AuthContext,
  id: string,
): Promise<{ code: QrRecord; subject: SubjectInfo }> {
  const code = await loadOwnedCode(auth, id);
  const subject = await resolveSubject(code.subjectType as QrSubjectType, code.subjectId);
  return { code, subject };
}

export async function revokeQrCode(
  auth: AuthContext,
  id: string,
  reason: string,
  frontendUrl?: string,
): Promise<QrCodeView> {
  const code = await loadOwnedCode(auth, id);
  if (code.status === QrCodeStatus.REVOKED) {
    throw errors.businessRule('That QR code has already been revoked.');
  }

  const updated = await prisma.qrCode.update({
    where: { id },
    data: {
      status: QrCodeStatus.REVOKED,
      revokedAt: new Date(),
      revokedById: auth.user.id,
      revokeReason: reason,
    },
  });

  return toView(updated, frontendUrl);
}

/**
 * Revoke and reissue in one step.
 *
 * The old token stops resolving the moment this commits, which is the whole
 * point: a printed sticker that has been photographed is a credential in the
 * wild, and rotation is how it is retired.
 */
export async function rotateQrCode(
  auth: AuthContext,
  id: string,
  input: RotateQrCodeInput,
  frontendUrl?: string,
): Promise<QrCodeView> {
  const code = await loadOwnedCode(auth, id);

  const created = await prisma.$transaction(async (tx) => {
    await tx.qrCode.update({
      where: { id },
      data: {
        status: QrCodeStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: auth.user.id,
        revokeReason: input.reason ?? 'Rotated',
      },
    });

    return tx.qrCode.create({
      data: {
        organizationId: code.organizationId,
        subjectType: code.subjectType,
        subjectId: code.subjectId,
        token: generateToken(),
        version: code.version + 1,
        scopes: input.keepScopes
          ? code.scopes
          : defaultScopesFor(code.subjectType as QrSubjectType),
        label: code.label,
        allowPublicResolve: code.allowPublicResolve,
        expiresAt: code.expiresAt,
        createdById: auth.user.id,
      },
    });
  });

  return toView(created, frontendUrl);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedScan {
  subjectType: QrSubjectType;
  subjectId: string;
  scopesGranted: QrScope[];
  /** Scopes the code carries that this scanner did not get, with the reason. */
  scopesWithheld: Array<{ scope: QrScope; reason: string }>;
  identity: {
    displayName: string;
    secondaryLabel: string | null;
    imageUrl: string | null;
    verified: boolean;
    organizationName: string | null;
  };
  contact?: { phone: string | null };
  vehicle?: {
    registrationNumber: string;
    vehicleType: string;
    truckType: string;
    capacityTons: number;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    status: string;
  };
  driver?: {
    /**
     * Only set when the driver is not the scanned subject — a vehicle scan
     * resolving whoever is currently on it. On a driver scan the name is
     * already the identity block, and repeating it would be two sources of
     * truth for one string.
     */
    name?: string | null;
    photoUrl?: string | null;
    experienceYears: number;
    licenseClass: string | null;
    /** Band rather than the exact score — a checkpoint does not need a number. */
    scoreBand: string | null;
    totalTrips: number;
  };
  compliance?: {
    documents: Array<{ type: string; label: string; validity: string; expiresAt: string | null }>;
    allValid: boolean;
  };
  assignment?: { driverName: string | null; vehicleRegistration: string | null };
  tripStatus?: { reference: string; status: string; etaAt: string | null };
  orderStatus?: { reference: string; status: string; materialName: string };
  emergency?: {
    bloodGroup: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  /**
   * Rule-based service verdict. A gate operator asking "is this truck fit to
   * load?" gets an answer, never a maintenance ledger.
   */
  service?: { health: string; lastServiceDate: string | null };
  /** Whether the vehicle is under finance. Never the amounts — see QrField. */
  finance?: { financed: boolean };
  /**
   * The registration certificate as the RTO holds it.
   *
   * Present only when Saarthi has a stored RC lookup for the plate that is
   * still inside its retention window — the record is never fetched from the
   * provider during a scan, because a scan is unauthenticated and a provider
   * call is billable, which together would be a way to spend a fleet's money
   * from the roadside. `source` says whether it belongs to the scanned vehicle
   * or to the vehicle the scanned driver is currently on.
   */
  rc?: {
    registrationNumber: string;
    retrievedAt: string;
    source: 'VEHICLE' | 'ASSIGNED_VEHICLE';
    record: VehicleRcRecord;
  };
  /** The driving licence as the RTO holds it, on the same terms as `rc`. */
  licence?: {
    licenceNumber: string;
    retrievedAt: string;
    source: 'DRIVER' | 'ASSIGNED_DRIVER';
    record: DrivingLicenceRecord;
  };
  /**
   * What this scanner was shown, and what was withheld from them. Sent so the
   * scan screen can say "masked at your access level" rather than rendering a
   * blank that reads as missing data.
   */
  privacy?: ScanPrivacyReport;
  scannedAt: string;
}

/** Which of the six relationships this scanner has to this subject. */
async function classifyScanner(
  auth: AuthContext | null,
  subjectType: QrSubjectType,
  subjectId: string,
  subject: SubjectInfo,
  context: ResolveQrQuery,
): Promise<{
  relationship: ScannerRelationship;
  emergencyContextActive: boolean;
  handoverContextActive: boolean;
}> {
  if (!auth) {
    return {
      relationship: ScannerRelationship.ANONYMOUS,
      emergencyContextActive: false,
      handoverContextActive: false,
    };
  }

  // Platform staff is a *platform-wide* trust level, so it is keyed on
  // `admin.audit` — a grant only Saarthi staff roles hold. Deliberately not
  // `qr.audit`: that permission lets a fleet owner read the scan log of their
  // own codes, and treating it as staff would have let any fleet owner scan any
  // other tenant's code and receive the full disclosure set.
  const isPlatformStaff = auth.isPlatformAdmin || auth.permissions.includes(Permission.ADMIN_AUDIT);

  if (isPlatformStaff) {
    return {
      relationship: ScannerRelationship.PLATFORM_STAFF,
      emergencyContextActive: true,
      handoverContextActive: true,
    };
  }

  if (subject.organizationId !== null && subject.organizationId === auth.organizationId) {
    return {
      relationship: ScannerRelationship.SAME_ORGANIZATION,
      emergencyContextActive: true,
      handoverContextActive: true,
    };
  }

  // Emergency scope needs an *open* incident the scanner is responding to —
  // a responder from last month must not keep medical access.
  let emergencyContextActive = false;
  if (context.incidentId) {
    const incident = await prisma.sosIncident.findFirst({
      where: {
        id: context.incidentId,
        // The shared catalogue of open states, so a new one is never missed here.
        status: { in: ACTIVE_SOS_STATUSES },
      },
      select: { id: true, truckId: true, driverId: true },
    });
    if (incident) {
      const matchesSubject =
        (subjectType === QrSubjectType.VEHICLE && incident.truckId === subjectId) ||
        (subjectType === QrSubjectType.DRIVER && incident.driverId === subjectId);

      const isResponder =
        (await prisma.sosResponder.count({
          where: {
            incidentId: incident.id,
            ...(auth.driverId ? { driverId: auth.driverId } : {}),
          },
        })) > 0;

      if (matchesSubject && (isResponder || auth.permissions.includes('sos.respond' as never))) {
        emergencyContextActive = true;
        return {
          relationship: ScannerRelationship.EMERGENCY_RESPONDER,
          emergencyContextActive,
          handoverContextActive: false,
        };
      }
    }
  }

  // A relay partner assigned to the leg being handed over.
  if (context.relayId) {
    const relay = await prisma.relayDelivery.findFirst({
      where: { id: context.relayId, partnerOrganizationId: auth.organizationId },
      select: { id: true, status: true },
    });
    if (relay) {
      return {
        relationship: ScannerRelationship.RELAY_PARTNER,
        emergencyContextActive: false,
        handoverContextActive: true,
      };
    }
  }

  // A counterparty on a live order with the subject's fleet.
  if (auth.organizationId && subject.organizationId) {
    const shared = await prisma.order.count({
      where: {
        status: { in: ['CONFIRMED', 'ASSIGNED', 'PICKUP', 'IN_TRANSIT', 'DELIVERED'] },
        OR: [
          {
            customerOrganizationId: auth.organizationId,
            fleetOrganizationId: subject.organizationId,
          },
          {
            supplierOrganizationId: auth.organizationId,
            fleetOrganizationId: subject.organizationId,
          },
          {
            fleetOrganizationId: auth.organizationId,
            customerOrganizationId: subject.organizationId,
          },
          {
            fleetOrganizationId: auth.organizationId,
            supplierOrganizationId: subject.organizationId,
          },
        ],
      },
    });
    if (shared > 0) {
      return {
        relationship: ScannerRelationship.TRANSACTING_PARTNER,
        emergencyContextActive: false,
        handoverContextActive: true,
      };
    }
  }

  return {
    relationship: ScannerRelationship.SIGNED_IN_STRANGER,
    emergencyContextActive: false,
    handoverContextActive: false,
  };
}

export interface ScanContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Resolve a scanned token.
 *
 * Every outcome writes a `QrScan`, including NOT_FOUND — an unguessable token
 * still deserves a record of anyone trying to guess it, and that log is the only
 * way token-walking becomes visible.
 */
export async function resolveToken(
  auth: AuthContext | null,
  token: string,
  query: ResolveQrQuery,
  scanContext: ScanContext,
): Promise<ResolvedScan> {
  const code = await prisma.qrCode.findUnique({ where: { token } });

  if (!code) {
    qrLogger.warn(
      { ipAddress: scanContext.ipAddress, userId: auth?.user.id ?? null },
      'QR resolve attempted with an unknown token',
    );
    throw errors.notFound('QR code');
  }

  const recordScan = async (result: QrScanResult, scopesGranted: QrScope[]) => {
    await prisma.qrScan.create({
      data: {
        qrCodeId: code.id,
        scannedByUserId: auth?.user.id ?? null,
        scannedByOrganizationId: auth?.organizationId ?? null,
        purpose: query.purpose,
        result,
        scopesGranted,
        latitude: query.latitude ?? null,
        longitude: query.longitude ?? null,
        ipAddress: scanContext.ipAddress,
        userAgent: scanContext.userAgent,
      },
    });
  };

  if (code.status === QrCodeStatus.REVOKED) {
    await recordScan(QrScanResult.REVOKED, []);
    throw errors.businessRule('This QR code has been revoked and is no longer valid.');
  }

  if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
    await prisma.qrCode.update({ where: { id: code.id }, data: { status: QrCodeStatus.EXPIRED } });
    await recordScan(QrScanResult.EXPIRED, []);
    throw errors.businessRule('This QR code has expired.');
  }

  if (!auth && !code.allowPublicResolve) {
    await recordScan(QrScanResult.DENIED, []);
    // Not-found rather than unauthenticated: an anonymous scanner must not
    // learn that the token is real.
    throw errors.notFound('QR code');
  }

  const subjectType = code.subjectType as QrSubjectType;
  const subject = await resolveSubject(subjectType, code.subjectId);

  // The fleet's own policy. Loaded from the *subject's* organization, not the
  // scanner's — the tenant that owns the data decides what it discloses.
  const policy = await getPrivacyPolicy(subject.organizationId);

  // A tenant-level switch outranks an individual code opting into public
  // resolution, so a fleet can close anonymous scanning across every sticker
  // they have already printed without reissuing any of them.
  if (!auth && !policy.allowPublicScans) {
    await recordScan(QrScanResult.DENIED, []);
    throw errors.notFound('QR code');
  }

  const { relationship, emergencyContextActive, handoverContextActive } = await classifyScanner(
    auth,
    subjectType,
    code.subjectId,
    subject,
    query,
  );

  const codeScopes = code.scopes as QrScope[];
  const scopesGranted = resolveGrantedScopes({
    codeScopes,
    relationship,
    emergencyContextActive,
    handoverContextActive,
  });

  const built = await buildScanPayload(
    subjectType,
    code.subjectId,
    subject,
    codeScopes,
    scopesGranted,
  );

  // Field-level privacy runs last, over the assembled payload. It can only
  // narrow what the scope intersection already allowed — `scopeFieldFlags`
  // carries that decision in, and a field whose scope was denied stays denied
  // however the owner has configured it.
  const result = applyPrivacyPolicy(built, {
    subjectType,
    relationship,
    policy,
    scopeFlags: scopeFieldFlags(scopesGranted),
  });

  await prisma.$transaction([
    prisma.qrCode.update({
      where: { id: code.id },
      data: { lastScannedAt: new Date(), scanCount: { increment: 1 } },
    }),
    prisma.qrScan.create({
      data: {
        qrCodeId: code.id,
        scannedByUserId: auth?.user.id ?? null,
        scannedByOrganizationId: auth?.organizationId ?? null,
        purpose: query.purpose,
        result: QrScanResult.ALLOWED,
        scopesGranted,
        latitude: query.latitude ?? null,
        longitude: query.longitude ?? null,
        ipAddress: scanContext.ipAddress,
        userAgent: scanContext.userAgent,
      },
    }),
  ]);

  return result;
}

/** Assemble only the blocks the granted scopes allow. */
async function buildScanPayload(
  subjectType: QrSubjectType,
  subjectId: string,
  subject: SubjectInfo,
  codeScopes: QrScope[],
  granted: QrScope[],
): Promise<ResolvedScan> {
  const { scopeDeniedReason } = await import('@saarthi/shared');

  const organization = subject.organizationId
    ? await prisma.organization.findUnique({
        where: { id: subject.organizationId },
        select: { name: true, verificationStatus: true },
      })
    : null;

  const payload: ResolvedScan = {
    subjectType,
    subjectId,
    scopesGranted: granted,
    scopesWithheld: codeScopes
      .filter((scope) => !granted.includes(scope))
      .map((scope) => ({ scope, reason: scopeDeniedReason(scope) })),
    identity: {
      displayName: subject.displayName,
      secondaryLabel: subject.secondaryLabel,
      imageUrl: null,
      verified: organization?.verificationStatus === 'VERIFIED',
      organizationName: organization?.name ?? null,
    },
    scannedAt: new Date().toISOString(),
  };

  if (subjectType === QrSubjectType.DRIVER) {
    const driver = await prisma.driver.findUnique({
      where: { id: subjectId },
      include: { user: { select: { id: true, phone: true } } },
    });
    if (driver) {
      const avatars = await primaryUrlsFor(
        MediaOwnerType.USER,
        [driver.user.id],
        MediaPurpose.AVATAR,
      );
      payload.identity.imageUrl = avatars.get(driver.user.id) ?? null;
      payload.identity.verified = driver.verificationStatus === 'VERIFIED';

      if (granted.includes(QrScope.CONTACT)) {
        payload.contact = { phone: driver.user.phone };
      }
      if (granted.includes(QrScope.DRIVER_SUMMARY)) {
        payload.driver = {
          experienceYears: driver.experienceYears,
          licenseClass: driver.licenseClass,
          scoreBand: scoreBandFor(driver.overallScore),
          totalTrips: driver.totalTrips,
        };

        const licence = await storedLicenceFor(subjectId, driver.licenseNumber);
        if (licence) payload.licence = { ...licence, source: 'DRIVER' };
      }
      if (granted.includes(QrScope.EMERGENCY)) {
        payload.emergency = {
          bloodGroup: driver.bloodGroup,
          emergencyContactName: driver.emergencyContactName,
          emergencyContactPhone: driver.emergencyContactPhone,
        };
      }
      if (granted.includes(QrScope.ASSIGNMENT) && driver.currentTruckId) {
        const truck = await prisma.truck.findUnique({
          where: { id: driver.currentTruckId },
          select: { registrationNumber: true },
        });
        payload.assignment = {
          driverName: subject.displayName,
          vehicleRegistration: truck?.registrationNumber ?? null,
        };
      }
      if (granted.includes(QrScope.COMPLIANCE)) {
        payload.compliance = await complianceFor('DRIVER', subjectId);

        // The truck this driver is currently on. A roadside check reads one
        // sticker and expects an answer about both the person and the vehicle,
        // so the driver card resolves the vehicle's RC rather than making the
        // officer walk round to the cab door for the second code.
        if (driver.currentTruckId) {
          const assigned = await prisma.truck.findUnique({
            where: { id: driver.currentTruckId },
            select: { registrationNumber: true },
          });
          if (assigned) {
            const rc = await storedRcFor(assigned.registrationNumber);
            if (rc) payload.rc = { ...rc, source: 'ASSIGNED_VEHICLE' };
          }
        }
      }
    }
  }

  if (subjectType === QrSubjectType.VEHICLE) {
    const vehicle = await prisma.truck.findUnique({ where: { id: subjectId } });
    if (vehicle) {
      const photos = await primaryUrlsFor(MediaOwnerType.VEHICLE, [subjectId]);
      payload.identity.imageUrl = photos.get(subjectId) ?? null;
      payload.identity.verified = vehicle.verificationStatus === 'VERIFIED';

      if (granted.includes(QrScope.VEHICLE_SUMMARY)) {
        payload.vehicle = {
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
          truckType: vehicle.truckType,
          capacityTons: vehicle.capacityTons,
          manufacturer: vehicle.manufacturer,
          model: vehicle.model,
          year: vehicle.year,
          status: vehicle.status,
        };
      }
      if (granted.includes(QrScope.COMPLIANCE)) {
        payload.compliance = await complianceFor('TRUCK', subjectId);

        const rc = await storedRcFor(vehicle.registrationNumber);
        if (rc) payload.rc = { ...rc, source: 'VEHICLE' };
      }

      // The mirror of the driver branch: a cab-door sticker answers for the
      // person currently driving, not only for the steel.
      if (granted.includes(QrScope.DRIVER_SUMMARY) && vehicle.currentDriverId) {
        const current = await prisma.driver.findUnique({
          where: { id: vehicle.currentDriverId },
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        });
        if (current) {
          const avatars = await primaryUrlsFor(
            MediaOwnerType.USER,
            [current.user.id],
            MediaPurpose.AVATAR,
          );
          payload.driver = {
            name: `${current.user.firstName} ${current.user.lastName}`.trim() || null,
            photoUrl: avatars.get(current.user.id) ?? null,
            experienceYears: current.experienceYears,
            licenseClass: current.licenseClass,
            scoreBand: scoreBandFor(current.overallScore),
            totalTrips: current.totalTrips,
          };

          const licence = await storedLicenceFor(current.id, current.licenseNumber);
          if (licence) payload.licence = { ...licence, source: 'ASSIGNED_DRIVER' };
        }
      }
      if (granted.includes(QrScope.ASSIGNMENT) && vehicle.currentDriverId) {
        const driver = await prisma.driver.findUnique({
          where: { id: vehicle.currentDriverId },
          include: { user: { select: { firstName: true, lastName: true } } },
        });
        payload.assignment = {
          driverName: driver ? `${driver.user.firstName} ${driver.user.lastName}`.trim() : null,
          vehicleRegistration: vehicle.registrationNumber,
        };
      }
      if (granted.includes(QrScope.VEHICLE_SUMMARY)) {
        payload.service = await serviceHealthFor(subjectId);
        // The *fact* of finance, never the numbers. Defaults to fleet-only and
        // is stripped by the privacy pass for anyone below that.
        const financed = await prisma.vehicleLoan.count({
          where: { vehicleId: subjectId, status: { in: ['ACTIVE', 'DEFAULTED', 'ON_HOLD'] } },
        });
        payload.finance = { financed: financed > 0 };
      }

      if (granted.includes(QrScope.TRIP_STATUS) && vehicle.currentTripId) {
        const trip = await prisma.trip.findUnique({
          where: { id: vehicle.currentTripId },
          select: { reference: true, status: true, etaAt: true },
        });
        if (trip) {
          payload.tripStatus = {
            reference: trip.reference,
            status: trip.status,
            etaAt: trip.etaAt?.toISOString() ?? null,
          };
        }
      }
    }
  }

  if (subjectType === QrSubjectType.ORDER && granted.includes(QrScope.ORDER_STATUS)) {
    const order = await prisma.order.findUnique({
      where: { id: subjectId },
      select: { reference: true, status: true, materialName: true },
    });
    if (order) {
      payload.orderStatus = {
        reference: order.reference,
        status: order.status,
        materialName: order.materialName,
      };
    }
  }

  return payload;
}

/** A band, not a number: a gate operator needs "Good", not 87. */
function scoreBandFor(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Needs improvement';
}

/**
 * The stored RC record for a plate, or null.
 *
 * Reads Saarthi's own store and never calls the provider. Two reasons, both
 * hard: a scan can be anonymous, so a provider call here would let a stranger
 * spend a fleet's lookup budget by photographing a sticker repeatedly; and the
 * roadside is the worst place to discover that a billable call has timed out.
 *
 * `expiresAt` is the retention boundary the lookup module set when it stored
 * the record, not a cache TTL — a row past it is data Saarthi has undertaken to
 * stop showing, so it is skipped rather than served stale.
 */
async function storedRcFor(registrationNumber: string): Promise<{
  registrationNumber: string;
  retrievedAt: string;
  record: VehicleRcRecord;
} | null> {
  const plate = normalizeRegistrationNumber(registrationNumber);
  if (!plate) return null;

  const lookup = await prisma.vehicleLookup.findFirst({
    where: { registrationNumber: plate, expiresAt: { gt: new Date() } },
    orderBy: { fetchedAt: 'desc' },
    select: { responseData: true, fetchedAt: true },
  });
  if (!lookup?.responseData) return null;

  return {
    registrationNumber: plate,
    retrievedAt: lookup.fetchedAt.toISOString(),
    // Stored by the lookup module in Saarthi's own normalised shape, before any
    // per-caller redaction — the privacy pass below is what narrows it.
    record: lookup.responseData as unknown as VehicleRcRecord,
  };
}

/** The stored driving licence record for a driver, on the same terms as the RC. */
async function storedLicenceFor(
  driverId: string,
  licenceNumber: string | null,
): Promise<{
  licenceNumber: string;
  retrievedAt: string;
  record: DrivingLicenceRecord;
} | null> {
  const normalized = licenceNumber ? normalizeLicenceNumber(licenceNumber) : null;

  // Matched on the driver id first: a licence renewed under a new number still
  // belongs to the same person, and the id survives that where the string does
  // not. The number is the fallback for rows stored before the link was made.
  const lookup = await prisma.licenceLookup.findFirst({
    where: {
      expiresAt: { gt: new Date() },
      OR: [{ driverId }, ...(normalized ? [{ licenceNumber: normalized }] : [])],
    },
    orderBy: { fetchedAt: 'desc' },
    select: { responseData: true, fetchedAt: true, licenceNumber: true },
  });
  if (!lookup?.responseData) return null;

  return {
    licenceNumber: lookup.licenceNumber,
    retrievedAt: lookup.fetchedAt.toISOString(),
    record: lookup.responseData as unknown as DrivingLicenceRecord,
  };
}

/**
 * Rule-based service verdict for a scanned vehicle.
 *
 * Deliberately a verdict and a date, not a maintenance history: the person
 * scanning a door sticker is deciding whether to load this truck today. The
 * thresholds match the maintenance module's own rules, so the QR answer and the
 * dashboard answer cannot disagree.
 */
async function serviceHealthFor(
  vehicleId: string,
): Promise<{ health: string; lastServiceDate: string | null }> {
  const [vehicle, lastService, overdueCount] = await Promise.all([
    prisma.truck.findUnique({ where: { id: vehicleId }, select: { odometerKm: true } }),
    prisma.maintenanceRecord.findFirst({
      where: { truckId: vehicleId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, odometerKm: true },
    }),
    prisma.maintenanceRecord.count({
      where: { truckId: vehicleId, status: 'SCHEDULED', scheduledAt: { lt: new Date() } },
    }),
  ]);

  const lastServiceDate = lastService?.completedAt?.toISOString().slice(0, 10) ?? null;

  if (overdueCount > 0) {
    return { health: 'Service overdue', lastServiceDate };
  }
  if (!lastService?.completedAt) {
    // No completed service on record is not the same as a healthy vehicle, and
    // saying "Healthy" here would be an assertion nothing supports.
    return { health: 'No service recorded', lastServiceDate: null };
  }

  const daysSince = Math.round((Date.now() - lastService.completedAt.getTime()) / 86_400_000);
  const kmSince =
    vehicle && lastService.odometerKm !== null
      ? Math.max(0, vehicle.odometerKm - lastService.odometerKm)
      : null;

  if (daysSince > 120 || (kmSince !== null && kmSince > 15_000)) {
    return { health: 'Service due', lastServiceDate };
  }
  return { health: 'Healthy', lastServiceDate };
}

/**
 * Document validity flags — never the files themselves.
 *
 * A checkpoint needs to know the insurance is current, not to download it.
 */
async function complianceFor(
  ownerType: 'DRIVER' | 'TRUCK',
  ownerId: string,
): Promise<{
  documents: Array<{ type: string; label: string; validity: string; expiresAt: string | null }>;
  allValid: boolean;
}> {
  const documents = await prisma.document.findMany({
    where: { ownerType, ownerId, deletedAt: null },
    select: {
      documentType: true,
      expiryDate: true,
      verificationStatus: true,
    },
  });

  const rows = documents.map((document) => {
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    return {
      type: document.documentType,
      label: documentTypeDefinition(document.documentType)?.label ?? document.documentType,
      validity,
      expiresAt: document.expiryDate?.toISOString() ?? null,
    };
  });

  return {
    documents: rows,
    allValid: rows.length > 0 && rows.every((row) => row.validity === DocumentValidity.VALID),
  };
}

// ---------------------------------------------------------------------------
// Scan audit
// ---------------------------------------------------------------------------

export async function listScans(
  auth: AuthContext,
  qrCodeId: string,
  query: QrScanListQuery,
): Promise<Paginated<unknown>> {
  await loadOwnedCode(auth, qrCodeId);

  const where: Prisma.QrScanWhereInput = {
    qrCodeId,
    ...(query.purpose ? { purpose: query.purpose } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, scans] = await Promise.all([
    prisma.qrScan.count({ where }),
    prisma.qrScan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: scans.map((scan) => ({
      id: scan.id,
      purpose: scan.purpose,
      result: scan.result,
      scopesGranted: scan.scopesGranted,
      latitude: scan.latitude,
      longitude: scan.longitude,
      scannedByUserId: scan.scannedByUserId,
      scannedByOrganizationId: scan.scannedByOrganizationId,
      createdAt: scan.createdAt.toISOString(),
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export { QrScanPurpose };

import { createHash } from 'node:crypto';
import {
  LEGACY_IMAGE_MIRRORS,
  MediaModerationStatus,
  MediaOwnerType,
  type MediaPurpose,
  MediaVariant,
  MediaVisibility,
  buildPaginationMeta,
  isMediaImageMimeType,
  isMediaPurposeValidForOwner,
  mediaPurposeDefinition,
  type MediaListQuery,
  type ModerateMediaInput,
  type Paginated,
  type ReorderMediaInput,
  type UpdateMediaInput,
  type UploadMediaMetadata,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { logger } from '../../lib/logger';
import { detectMimeType, storageProvider } from '../../providers/storage';
import { readImageDimensions } from '../../providers/storage/image-metadata';
import type { AuthContext } from '../../auth/context';

/**
 * Media library.
 *
 * Two rules carry most of the weight here.
 *
 * 1. **The owner decides the tenant.** An asset's `organizationId` is resolved
 *    from the record it hangs off, never taken from the request, so a caller
 *    cannot file a photo under a tenant they do not belong to.
 *
 * 2. **The bytes are identified by their bytes.** The declared content type is
 *    ignored entirely; a `.png` that is really a script is rejected.
 */

const mediaLogger = logger.child({ module: 'media' });

export interface MediaAssetView {
  id: string;
  organizationId: string | null;
  ownerType: MediaOwnerType;
  ownerId: string;
  purpose: MediaPurpose;
  visibility: MediaVisibility;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  /** Aspect ratio, so the client can reserve layout space. Null when unknown. */
  aspectRatio: number | null;
  url: string;
  thumbnailUrl: string | null;
  altText: string | null;
  caption: string | null;
  sortOrder: number;
  isPrimary: boolean;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  moderationStatus: MediaModerationStatus;
  uploadedById: string;
  createdAt: string;
  updatedAt: string;
}

type MediaRecord = Prisma.MediaAssetGetPayload<Record<string, never>>;

function toView(asset: MediaRecord): MediaAssetView {
  return {
    id: asset.id,
    organizationId: asset.organizationId,
    ownerType: asset.ownerType as MediaOwnerType,
    ownerId: asset.ownerId,
    purpose: asset.purpose as MediaPurpose,
    visibility: asset.visibility as MediaVisibility,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
    aspectRatio:
      asset.width && asset.height ? Math.round((asset.width / asset.height) * 1000) / 1000 : null,
    url: `/api/v1/media/${asset.id}/file?variant=${MediaVariant.ORIGINAL}`,
    thumbnailUrl: asset.thumbnailStorageKey
      ? `/api/v1/media/${asset.id}/file?variant=${MediaVariant.THUMB}`
      : null,
    altText: asset.altText,
    caption: asset.caption,
    sortOrder: asset.sortOrder,
    isPrimary: asset.isPrimary,
    latitude: asset.latitude,
    longitude: asset.longitude,
    capturedAt: asset.capturedAt?.toISOString() ?? null,
    moderationStatus: asset.moderationStatus as MediaModerationStatus,
    uploadedById: asset.uploadedById,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

interface OwnerResolution {
  /** Tenant the owning record belongs to. Null for platform-wide records. */
  organizationId: string | null;
  /** Set when only this user may attach media (their own avatar, say). */
  restrictedToUserId?: string;
}

/**
 * Confirm the owner exists and work out which tenant it belongs to.
 *
 * Every branch is explicit rather than table-driven, because the tenant column
 * genuinely differs per entity and a generic lookup would have to trust a
 * caller-supplied table name.
 */
async function resolveOwner(
  auth: AuthContext,
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<OwnerResolution> {
  switch (ownerType) {
    case MediaOwnerType.USER: {
      const user = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!user) throw errors.notFound('User');
      // A user's own media is theirs; nobody else attaches to their profile.
      if (!auth.isPlatformAdmin && ownerId !== auth.user.id) {
        throw errors.forbidden('You can only change your own profile photo.');
      }
      return { organizationId: auth.organizationId, restrictedToUserId: ownerId };
    }

    case MediaOwnerType.ORGANIZATION: {
      const organization = await prisma.organization.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!organization) throw errors.notFound('Organization');
      return { organizationId: ownerId };
    }

    case MediaOwnerType.ASSOCIATION: {
      const profile = await prisma.associationProfile.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!profile) throw errors.notFound('Association');
      return { organizationId: profile.organizationId };
    }

    case MediaOwnerType.DRIVER: {
      const driver = await prisma.driver.findUnique({
        where: { id: ownerId },
        select: { organizationId: true, userId: true },
      });
      if (!driver) throw errors.notFound('Driver');
      return { organizationId: driver.organizationId };
    }

    case MediaOwnerType.VEHICLE: {
      const vehicle = await prisma.truck.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!vehicle) throw errors.notFound('Vehicle');
      return { organizationId: vehicle.organizationId };
    }

    case MediaOwnerType.MATERIAL: {
      const material = await prisma.material.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!material) throw errors.notFound('Material');
      return { organizationId: material.organizationId };
    }

    case MediaOwnerType.INVENTORY_LOCATION: {
      const location = await prisma.inventoryLocation.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!location) throw errors.notFound('Inventory location');
      return { organizationId: location.organizationId };
    }

    case MediaOwnerType.ORDER: {
      const order = await prisma.order.findUnique({
        where: { id: ownerId },
        select: {
          customerOrganizationId: true,
          supplierOrganizationId: true,
          fleetOrganizationId: true,
        },
      });
      if (!order) throw errors.notFound('Order');
      // An order touches three tenants. Any of them may attach evidence, and
      // the asset is filed under whichever one is uploading it — that keeps a
      // customer's complaint photo out of the fleet's private library while
      // still hanging off the same order.
      const participants = [
        order.customerOrganizationId,
        order.supplierOrganizationId,
        order.fleetOrganizationId,
      ].filter((value): value is string => value !== null);

      if (!auth.isPlatformAdmin && !participants.includes(auth.organizationId ?? '')) {
        throw errors.notFound('Order');
      }
      return { organizationId: auth.organizationId };
    }

    case MediaOwnerType.TRIP: {
      const trip = await prisma.trip.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!trip) throw errors.notFound('Trip');
      return { organizationId: trip.organizationId };
    }

    case MediaOwnerType.SOS_INCIDENT: {
      const incident = await prisma.sosIncident.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!incident) throw errors.notFound('Incident');
      return { organizationId: incident.organizationId };
    }

    case MediaOwnerType.MAINTENANCE_RECORD: {
      const record = await prisma.maintenanceRecord.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!record) throw errors.notFound('Maintenance record');
      return { organizationId: record.organizationId };
    }

    case MediaOwnerType.FUEL_RECORD: {
      const record = await prisma.fuelRecord.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!record) throw errors.notFound('Fuel record');
      return { organizationId: record.organizationId };
    }

    case MediaOwnerType.VEHICLE_LISTING: {
      const listing = await prisma.vehicleListing.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!listing) throw errors.notFound('Listing');
      return { organizationId: listing.organizationId };
    }

    case MediaOwnerType.TRAVEL_PACKAGE: {
      const travelPackage = await prisma.travelPackage.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!travelPackage) throw errors.notFound('Travel package');
      return { organizationId: travelPackage.organizationId };
    }

    case MediaOwnerType.RELAY_DELIVERY: {
      const relay = await prisma.relayDelivery.findUnique({
        where: { id: ownerId },
        select: { organizationId: true, partnerOrganizationId: true },
      });
      if (!relay) throw errors.notFound('Relay delivery');
      // Both sides of a handover photograph the load; each files under itself.
      const participants = [relay.organizationId, relay.partnerOrganizationId].filter(
        (value): value is string => value !== null,
      );
      if (!auth.isPlatformAdmin && !participants.includes(auth.organizationId ?? '')) {
        throw errors.notFound('Relay delivery');
      }
      return { organizationId: auth.organizationId };
    }

    case MediaOwnerType.TRANSFER_HUB: {
      const hub = await prisma.transferHub.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!hub) throw errors.notFound('Transfer hub');
      return { organizationId: hub.organizationId };
    }

    case MediaOwnerType.DEVICE: {
      const device = await prisma.hardwareDevice.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!device) throw errors.notFound('Device');
      return { organizationId: device.organizationId };
    }

    // Platform-wide reference data: hazards, POIs and stations belong to
    // everyone, so their media is filed against the contributing tenant.
    case MediaOwnerType.ROUTE_HAZARD: {
      const hazard = await prisma.routeHazard.findUnique({
        where: { id: ownerId },
        select: { organizationId: true },
      });
      if (!hazard) throw errors.notFound('Hazard');
      return { organizationId: hazard.organizationId ?? auth.organizationId };
    }

    case MediaOwnerType.NEARBY_PLACE: {
      const place = await prisma.nearbyPlace.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!place) throw errors.notFound('Place');
      return { organizationId: auth.organizationId };
    }

    case MediaOwnerType.PETROL_STATION: {
      const station = await prisma.petrolStation.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!station) throw errors.notFound('Petrol station');
      return { organizationId: auth.organizationId };
    }

    default:
      throw errors.validation('That owner type does not accept media.');
  }
}

/**
 * Tenant check for an existing asset.
 *
 * Reported as "not found" rather than "forbidden" so the difference cannot be
 * used to enumerate another tenant's asset ids — the same posture the rest of
 * the API takes.
 */
function assertAssetAccess(auth: AuthContext, asset: MediaRecord, forWrite: boolean): void {
  if (auth.isPlatformAdmin) return;

  if (asset.organizationId === null) {
    // Platform-wide asset: readable by any session, writable only by whoever
    // uploaded it.
    if (forWrite && asset.uploadedById !== auth.user.id) {
      throw errors.forbidden('Only the person who uploaded this image can change it.');
    }
    return;
  }

  if (asset.visibility === MediaVisibility.PLATFORM && !forWrite) return;

  if (asset.organizationId !== auth.organizationId) throw errors.notFound('Image');
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadFilePart {
  buffer: Buffer;
  fileName: string;
  declaredMimeType: string;
}

export interface UploadMediaFiles {
  file: UploadFilePart;
  /** Browser-produced thumbnail. Optional, but every real client sends one. */
  thumbnail?: UploadFilePart;
}

/**
 * Validate one rendition and hand back what the row needs.
 *
 * The declared content type never reaches the database: `detectMimeType` reads
 * the leading bytes, and a mismatch is a rejected upload rather than a warning.
 */
function inspectRendition(
  part: UploadFilePart,
  purpose: MediaPurpose,
  maxBytes: number,
  label: string,
): { mimeType: string; dimensions: { width: number; height: number } | null; checksum: string } {
  if (part.buffer.byteLength === 0) {
    throw errors.validation(`The ${label} is empty.`);
  }
  if (part.buffer.byteLength > maxBytes) {
    throw errors.payloadTooLarge(
      `The ${label} is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit. Resize it and try again.`,
    );
  }

  const detected = detectMimeType(part.buffer);
  if (!detected) {
    throw errors.unsupportedMediaType(
      'That file is not a supported image. Use JPEG, PNG, WebP or HEIC.',
    );
  }

  const definition = mediaPurposeDefinition(purpose);
  if (!isMediaImageMimeType(detected)) {
    // Only purposes that explicitly allow documents may carry a PDF.
    if (!definition.allowsDocuments) {
      throw errors.unsupportedMediaType(
        `A ${definition.label.toLowerCase()} must be an image, not a ${detected} file.`,
      );
    }
  }

  const dimensions = readImageDimensions(part.buffer);

  return {
    mimeType: detected,
    dimensions,
    checksum: createHash('sha256').update(part.buffer).digest('hex'),
  };
}

/** Storage prefix. Grouped by owner so a tenant's objects stay together. */
function storagePrefix(
  organizationId: string | null,
  ownerType: MediaOwnerType,
  ownerId: string,
): string {
  return `media/${organizationId ?? 'platform'}/${ownerType.toLowerCase()}/${ownerId}`;
}

export async function uploadMedia(
  auth: AuthContext,
  metadata: UploadMediaMetadata,
  files: UploadMediaFiles,
): Promise<MediaAssetView> {
  if (!isMediaPurposeValidForOwner(metadata.purpose, metadata.ownerType)) {
    const definition = mediaPurposeDefinition(metadata.purpose);
    throw errors.validation(
      `A ${definition.label.toLowerCase()} cannot be attached to a ${metadata.ownerType
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
    );
  }

  const owner = await resolveOwner(auth, metadata.ownerType, metadata.ownerId);
  const definition = mediaPurposeDefinition(metadata.purpose);

  // Per-owner cap. Singular purposes are exempt: replacing an avatar is a
  // replacement, not an addition, and counting old avatars toward a gallery cap
  // would eventually lock a user out of changing their own photo.
  if (!definition.singular) {
    const existing = await prisma.mediaAsset.count({
      where: {
        ownerType: metadata.ownerType,
        ownerId: metadata.ownerId,
        purpose: metadata.purpose,
        deletedAt: null,
      },
    });
    if (existing >= config.media.maxPerOwner) {
      throw errors.businessRule(
        `This record already has ${existing} images, the maximum allowed. Remove one before adding another.`,
      );
    }
  }

  const primary = inspectRendition(
    files.file,
    metadata.purpose,
    config.media.maxFileSize,
    'image',
  );
  const thumbnail = files.thumbnail
    ? inspectRendition(
        files.thumbnail,
        metadata.purpose,
        config.media.maxThumbnailSize,
        'thumbnail',
      )
    : null;

  const prefix = storagePrefix(owner.organizationId, metadata.ownerType, metadata.ownerId);

  const storedPrimary = await storageProvider.upload({
    prefix,
    fileName: files.file.fileName,
    mimeType: primary.mimeType,
    content: files.file.buffer,
  });

  let storedThumbnail: Awaited<ReturnType<typeof storageProvider.upload>> | null = null;
  if (files.thumbnail && thumbnail) {
    try {
      storedThumbnail = await storageProvider.upload({
        prefix: `${prefix}/thumb`,
        fileName: files.thumbnail.fileName,
        mimeType: thumbnail.mimeType,
        content: files.thumbnail.buffer,
      });
    } catch (error) {
      // A missing thumbnail degrades to serving the original; losing the whole
      // upload over it would be the wrong trade.
      mediaLogger.warn({ err: error }, 'Thumbnail could not be stored; keeping the original only');
    }
  }

  const visibility = metadata.visibility ?? definition.defaultVisibility;

  const asset = await prisma.$transaction(async (tx) => {
    const created = await tx.mediaAsset.create({
      data: {
        organizationId: owner.organizationId,
        ownerType: metadata.ownerType,
        ownerId: metadata.ownerId,
        purpose: metadata.purpose,
        visibility,
        storageKey: storedPrimary.storageKey,
        fileName: files.file.fileName.slice(0, 255),
        mimeType: primary.mimeType,
        fileSize: storedPrimary.size,
        width: metadata.width ?? primary.dimensions?.width ?? null,
        height: metadata.height ?? primary.dimensions?.height ?? null,
        checksum: storedPrimary.checksum,
        thumbnailStorageKey: storedThumbnail?.storageKey ?? null,
        thumbnailWidth: thumbnail?.dimensions?.width ?? null,
        thumbnailHeight: thumbnail?.dimensions?.height ?? null,
        thumbnailFileSize: storedThumbnail?.size ?? null,
        altText: metadata.altText ?? null,
        caption: metadata.caption ?? null,
        sortOrder: metadata.sortOrder ?? 0,
        latitude: metadata.latitude ?? null,
        longitude: metadata.longitude ?? null,
        capturedAt: metadata.capturedAt ?? null,
        uploadedById: auth.user.id,
      },
    });

    // A singular purpose is always primary — the first upload and every
    // replacement — otherwise an avatar could exist with nothing marked primary.
    const shouldBePrimary = definition.singular || metadata.isPrimary === true;
    if (shouldBePrimary) {
      await setPrimaryWithin(tx, created);
    }

    return created;
  });

  return toView(
    definition.singular || metadata.isPrimary === true ? { ...asset, isPrimary: true } : asset,
  );
}

// ---------------------------------------------------------------------------
// Primary selection & legacy mirroring
// ---------------------------------------------------------------------------

type TransactionClient = Prisma.TransactionClient;

/**
 * Make one asset the primary for its (owner, purpose) and mirror the URL into
 * the legacy column that predates this table.
 */
async function setPrimaryWithin(tx: TransactionClient, asset: MediaRecord): Promise<void> {
  await tx.mediaAsset.updateMany({
    where: {
      ownerType: asset.ownerType,
      ownerId: asset.ownerId,
      purpose: asset.purpose,
      isPrimary: true,
      id: { not: asset.id },
    },
    data: { isPrimary: false },
  });

  await tx.mediaAsset.update({ where: { id: asset.id }, data: { isPrimary: true } });

  await mirrorLegacyColumn(tx, asset);
}

/**
 * Keep `User.avatarUrl`, `Organization.logoUrl` and `Material.imageUrl` in step.
 *
 * These three columns are read across the whole app and predate the media
 * table. Mirroring the primary asset's URL into them means no existing consumer
 * has to change, and nothing regresses on the day this ships.
 */
async function mirrorLegacyColumn(
  tx: TransactionClient,
  asset: MediaRecord,
  clear = false,
): Promise<void> {
  const mirror = LEGACY_IMAGE_MIRRORS.find(
    (entry) => entry.ownerType === asset.ownerType && entry.purpose === asset.purpose,
  );
  if (!mirror) return;

  // The thumbnail is the right rendition for these columns: every one of them
  // is rendered as an avatar, a logo chip or a card image.
  const url = clear
    ? null
    : `/api/v1/media/${asset.id}/file?variant=${
        asset.thumbnailStorageKey ? MediaVariant.THUMB : MediaVariant.ORIGINAL
      }`;

  try {
    if (mirror.table === 'user') {
      await tx.user.update({ where: { id: asset.ownerId }, data: { avatarUrl: url } });
    } else if (mirror.table === 'organization') {
      await tx.organization.update({ where: { id: asset.ownerId }, data: { logoUrl: url } });
    } else {
      await tx.material.update({ where: { id: asset.ownerId }, data: { imageUrl: url } });
    }
  } catch (error) {
    // The owning row may have been archived between upload and mirror. The
    // media row is still valid, so this must not fail the request.
    mediaLogger.warn(
      { err: error, ownerType: asset.ownerType, ownerId: asset.ownerId },
      'Legacy image column could not be mirrored',
    );
  }
}

export async function setPrimary(auth: AuthContext, mediaId: string): Promise<MediaAssetView> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!asset) throw errors.notFound('Image');
  assertAssetAccess(auth, asset, true);

  await prisma.$transaction(async (tx) => setPrimaryWithin(tx, asset));

  return toView({ ...asset, isPrimary: true });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMedia(
  auth: AuthContext,
  query: MediaListQuery,
): Promise<Paginated<MediaAssetView>> {
  const where: Prisma.MediaAssetWhereInput = {
    deletedAt: null,
    ...(query.ownerType ? { ownerType: query.ownerType } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.purpose ? { purpose: { in: query.purpose } } : {}),
    ...(query.moderationStatus ? { moderationStatus: query.moderationStatus } : {}),
    ...(query.primaryOnly ? { isPrimary: true } : {}),
    // Platform admins with no tenant selected see everything; everyone else
    // sees their own tenant plus anything explicitly shared platform-wide.
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : {
          OR: [
            { organizationId: auth.organizationId ?? '__none__' },
            { visibility: { in: [MediaVisibility.PLATFORM, MediaVisibility.PUBLIC] } },
          ],
        }),
  };

  const [total, assets] = await Promise.all([
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.findMany({
      where,
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: assets.map(toView),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getMedia(auth: AuthContext, mediaId: string): Promise<MediaAssetView> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!asset) throw errors.notFound('Image');
  assertAssetAccess(auth, asset, false);
  return toView(asset);
}

/**
 * Media for one record, ordered for display.
 *
 * Returns the whole set rather than a page: a gallery is a small, bounded list
 * (capped by `MEDIA_MAX_PER_OWNER`) and paginating it would make every detail
 * screen do two round trips for no benefit.
 */
export async function listForOwner(
  auth: AuthContext,
  ownerType: MediaOwnerType,
  ownerId: string,
  purposes?: MediaPurpose[],
): Promise<MediaAssetView[]> {
  const assets = await prisma.mediaAsset.findMany({
    where: {
      ownerType,
      ownerId,
      deletedAt: null,
      ...(purposes && purposes.length > 0 ? { purpose: { in: purposes } } : {}),
      ...(auth.isPlatformAdmin && !auth.organizationId
        ? {}
        : {
            OR: [
              { organizationId: auth.organizationId ?? '__none__' },
              { visibility: { in: [MediaVisibility.PLATFORM, MediaVisibility.PUBLIC] } },
            ],
          }),
    },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: config.media.maxPerOwner * 2,
  });

  return assets.map(toView);
}

/**
 * The asset behind a file request, plus whether the caller may have it.
 *
 * Split out from the route so the visibility ladder lives with the rest of the
 * media rules rather than in an HTTP handler.
 */
export async function resolveForDownload(
  auth: AuthContext | null,
  mediaId: string,
  variant: MediaVariant,
): Promise<{ asset: MediaRecord; storageKey: string; mimeType: string }> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!asset) throw errors.notFound('Image');

  const visibility = asset.visibility as MediaVisibility;

  if (visibility === MediaVisibility.PUBLIC) {
    // No session needed — that is what PUBLIC means.
  } else if (!auth) {
    // Reported as not-found: an unauthenticated caller must not learn that an
    // id exists but is private.
    throw errors.notFound('Image');
  } else if (auth.isPlatformAdmin) {
    // Support can always see an image to investigate a dispute.
  } else if (visibility === MediaVisibility.PLATFORM) {
    // Any signed-in account.
  } else if (visibility === MediaVisibility.ORGANIZATION) {
    if (asset.organizationId !== null && asset.organizationId !== auth.organizationId) {
      throw errors.notFound('Image');
    }
  } else if (asset.uploadedById !== auth.user.id) {
    throw errors.notFound('Image');
  }

  const wantsThumb = variant === MediaVariant.THUMB && asset.thumbnailStorageKey !== null;

  return {
    asset,
    storageKey: wantsThumb ? asset.thumbnailStorageKey! : asset.storageKey,
    mimeType: asset.mimeType,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function updateMedia(
  auth: AuthContext,
  mediaId: string,
  input: UpdateMediaInput,
): Promise<MediaAssetView> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!asset) throw errors.notFound('Image');
  assertAssetAccess(auth, asset, true);

  const updated = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      ...(input.altText !== undefined ? { altText: input.altText } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    },
  });

  return toView(updated);
}

export async function reorderMedia(
  auth: AuthContext,
  input: ReorderMediaInput,
): Promise<MediaAssetView[]> {
  const assets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: input.mediaIds },
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      deletedAt: null,
    },
  });

  if (assets.length !== input.mediaIds.length) {
    throw errors.validation('Some of those images no longer exist on this record.');
  }
  for (const asset of assets) assertAssetAccess(auth, asset, true);

  await prisma.$transaction(
    input.mediaIds.map((id, index) =>
      prisma.mediaAsset.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  return listForOwner(auth, input.ownerType, input.ownerId);
}

/**
 * Soft delete.
 *
 * The bytes stay on disk until the retention sweep runs, which makes an
 * accidental deletion recoverable — and a deletion of the *primary* asset
 * promotes the next one rather than leaving the record with no image.
 */
export async function deleteMedia(auth: AuthContext, mediaId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!asset) throw errors.notFound('Image');
  assertAssetAccess(auth, asset, true);

  await prisma.$transaction(async (tx) => {
    await tx.mediaAsset.update({
      where: { id: mediaId },
      data: { deletedAt: new Date(), isPrimary: false },
    });

    if (!asset.isPrimary) return;

    const replacement = await tx.mediaAsset.findFirst({
      where: {
        ownerType: asset.ownerType,
        ownerId: asset.ownerId,
        purpose: asset.purpose,
        deletedAt: null,
        id: { not: mediaId },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    if (replacement) {
      await setPrimaryWithin(tx, replacement);
    } else {
      // Nothing left to promote, so the legacy column must be cleared too —
      // leaving it pointing at a deleted asset would render a broken image.
      await mirrorLegacyColumn(tx, asset, true);
    }
  });
}

export async function moderateMedia(
  auth: AuthContext,
  mediaId: string,
  input: ModerateMediaInput,
): Promise<MediaAssetView> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!asset) throw errors.notFound('Image');

  void auth;
  const updated = await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      moderationStatus: input.decision,
      moderationNote: input.note ?? null,
      // A rejected image must stop being served immediately, so it is pulled
      // back to private rather than merely flagged.
      ...(input.decision === MediaModerationStatus.REJECTED
        ? { visibility: MediaVisibility.PRIVATE, isPrimary: false }
        : {}),
    },
  });

  if (input.decision === MediaModerationStatus.REJECTED && asset.isPrimary) {
    await prisma.$transaction(async (tx) => mirrorLegacyColumn(tx, asset, true));
  }

  return toView(updated);
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Purge the bytes of assets soft-deleted beyond the retention window.
 *
 * Storage removal happens before the row does: an orphaned row is a cosmetic
 * problem, whereas an orphaned object is storage nobody can ever reclaim.
 */
export async function runMediaOrphanSweep(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - config.media.retentionDays * 86_400_000);

  const expired = await prisma.mediaAsset.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true, storageKey: true, thumbnailStorageKey: true },
    take: 500,
  });

  let purged = 0;
  for (const asset of expired) {
    try {
      await storageProvider.remove(asset.storageKey);
      if (asset.thumbnailStorageKey) await storageProvider.remove(asset.thumbnailStorageKey);
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
      purged += 1;
    } catch (error) {
      mediaLogger.warn({ err: error, mediaId: asset.id }, 'Media asset could not be purged');
    }
  }

  if (purged > 0) mediaLogger.info({ purged }, 'Purged soft-deleted media');
  return { purged };
}

/**
 * Primary image URLs for a batch of owners.
 *
 * Exists so list endpoints can decorate rows without an N+1: one query returns
 * every thumbnail for the page.
 */
export async function primaryUrlsFor(
  ownerType: MediaOwnerType,
  ownerIds: string[],
  purpose?: MediaPurpose,
): Promise<Map<string, string>> {
  if (ownerIds.length === 0) return new Map();

  const assets = await prisma.mediaAsset.findMany({
    where: {
      ownerType,
      ownerId: { in: ownerIds },
      isPrimary: true,
      deletedAt: null,
      moderationStatus: { not: MediaModerationStatus.REJECTED },
      ...(purpose ? { purpose } : {}),
    },
    select: { ownerId: true, id: true, thumbnailStorageKey: true },
  });

  return new Map(
    assets.map((asset) => [
      asset.ownerId,
      `/api/v1/media/${asset.id}/file?variant=${
        asset.thumbnailStorageKey ? MediaVariant.THUMB : MediaVariant.ORIGINAL
      }`,
    ]),
  );
}

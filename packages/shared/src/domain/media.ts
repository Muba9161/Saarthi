/**
 * Media library configuration.
 *
 * Purposes are configuration, not hard-coded UI strings: each one declares its
 * aspect ratio, whether it is singular (an avatar) or a set (a gallery), and its
 * default visibility. The uploader, the gallery and the API all read the same
 * table, so adding a new kind of photo is a change here rather than in three
 * places.
 */

import { MediaOwnerType, MediaPurpose, MediaVisibility } from './enums';

/** Rendition names the client produces and the API stores. */
export const MediaVariant = {
  ORIGINAL: 'original',
  THUMB: 'thumb',
} as const;
export type MediaVariant = (typeof MediaVariant)[keyof typeof MediaVariant];

export interface MediaPurposeDefinition {
  purpose: MediaPurpose;
  label: string;
  description: string;
  /**
   * `true` when only one asset of this purpose is meaningful for an owner. The
   * service still keeps history; it just moves `isPrimary` rather than stacking.
   */
  singular: boolean;
  /** Width / height the client should crop to. `null` = keep the source ratio. */
  aspectRatio: number | null;
  /** Longest-edge cap for the stored full-size rendition, in pixels. */
  maxDimension: number;
  defaultVisibility: MediaVisibility;
  /** Which owners this purpose is valid for. Empty = any owner. */
  ownerTypes: MediaOwnerType[];
  /** Non-image attachments (PDF) are allowed for this purpose. */
  allowsDocuments: boolean;
}

const SQUARE = 1;
const BANNER = 3;
const PHOTO = 4 / 3;

export const MEDIA_PURPOSE_CATALOGUE: MediaPurposeDefinition[] = [
  {
    purpose: MediaPurpose.AVATAR,
    label: 'Profile photo',
    description: 'The photo shown wherever this person appears.',
    singular: true,
    aspectRatio: SQUARE,
    maxDimension: 512,
    defaultVisibility: MediaVisibility.PLATFORM,
    ownerTypes: [MediaOwnerType.USER, MediaOwnerType.DRIVER],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.LOGO,
    label: 'Logo',
    description: 'Business logo shown on listings, orders and invoices.',
    singular: true,
    aspectRatio: SQUARE,
    maxDimension: 512,
    defaultVisibility: MediaVisibility.PLATFORM,
    ownerTypes: [MediaOwnerType.ORGANIZATION, MediaOwnerType.ASSOCIATION],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.COVER,
    label: 'Cover image',
    description: 'Banner across the top of a profile.',
    singular: true,
    aspectRatio: BANNER,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.PLATFORM,
    ownerTypes: [MediaOwnerType.USER, MediaOwnerType.ORGANIZATION],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.GALLERY,
    label: 'Photos',
    description: 'General photo set.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.PRODUCT,
    label: 'Item photo',
    description: 'What the material actually looks like.',
    singular: false,
    aspectRatio: PHOTO,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.PLATFORM,
    ownerTypes: [MediaOwnerType.MATERIAL],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.VEHICLE_EXTERIOR,
    label: 'Exterior photo',
    description: 'Outside of the vehicle — front, rear, both sides.',
    singular: false,
    aspectRatio: PHOTO,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.VEHICLE, MediaOwnerType.VEHICLE_LISTING],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.VEHICLE_INTERIOR,
    label: 'Interior photo',
    description: 'Cabin, load bed or passenger compartment.',
    singular: false,
    aspectRatio: PHOTO,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.VEHICLE, MediaOwnerType.VEHICLE_LISTING],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.VEHICLE_DAMAGE,
    label: 'Damage photo',
    description: 'Evidence of damage, wear or a defect.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [
      MediaOwnerType.VEHICLE,
      MediaOwnerType.VEHICLE_LISTING,
      MediaOwnerType.MAINTENANCE_RECORD,
      MediaOwnerType.SOS_INCIDENT,
      MediaOwnerType.RELAY_DELIVERY,
    ],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.ODOMETER,
    label: 'Odometer photo',
    description: 'Dash reading that substantiates the recorded kilometres.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1200,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [
      MediaOwnerType.VEHICLE,
      MediaOwnerType.VEHICLE_LISTING,
      MediaOwnerType.TRIP,
      MediaOwnerType.FUEL_RECORD,
    ],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.PROOF_OF_PICKUP,
    label: 'Pickup proof',
    description: 'Loaded goods at the pickup point.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.ORDER, MediaOwnerType.TRIP],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.PROOF_OF_DELIVERY,
    label: 'Delivery proof',
    description: 'Delivered goods, signed slip or the drop location.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.ORDER, MediaOwnerType.TRIP, MediaOwnerType.RELAY_DELIVERY],
    allowsDocuments: true,
  },
  {
    purpose: MediaPurpose.HANDOVER,
    label: 'Handover photo',
    description: 'Load condition and package count at a custody transfer.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.RELAY_DELIVERY],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.INCIDENT,
    label: 'Incident photo',
    description: 'The scene of a breakdown, accident or emergency.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.SOS_INCIDENT],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.HAZARD_EVIDENCE,
    label: 'Hazard photo',
    description: 'What was actually seen at a reported hazard.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1200,
    defaultVisibility: MediaVisibility.PLATFORM,
    ownerTypes: [MediaOwnerType.ROUTE_HAZARD],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.INSPECTION,
    label: 'Inspection photo',
    description: 'Recorded during a pre-purchase or compliance inspection.',
    singular: false,
    aspectRatio: null,
    maxDimension: 1600,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.VEHICLE, MediaOwnerType.VEHICLE_LISTING],
    allowsDocuments: true,
  },
  {
    purpose: MediaPurpose.SIGNATURE,
    label: 'Signature',
    description: 'Captured signature confirming a handover or delivery.',
    singular: false,
    aspectRatio: null,
    maxDimension: 800,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.ORDER, MediaOwnerType.TRIP, MediaOwnerType.RELAY_DELIVERY],
    allowsDocuments: false,
  },
  {
    purpose: MediaPurpose.ATTACHMENT,
    label: 'Attachment',
    description: 'Supporting file that is not a compliance document.',
    singular: false,
    aspectRatio: null,
    maxDimension: 2000,
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [],
    allowsDocuments: true,
  },
  {
    purpose: MediaPurpose.DRIVER_VERIFICATION,
    label: 'Driver arrival selfie',
    description: 'Taken at a Saarthi Terminal to verify a driver arrived at the vehicle.',
    /*
     * Not singular. Each arrival is its own evidence, and overwriting last
     * week's selfie with today's would destroy the record of who was at the
     * vehicle then — which is precisely the question an incident investigation
     * asks.
     */
    singular: false,
    aspectRatio: 1,
    /*
     * Small. It is a face at arm's length on a tablet, uploaded over whatever
     * signal a yard has, and a 2000px portrait buys nothing an approver needs.
     */
    maxDimension: 800,
    /*
     * ORGANIZATION rather than PRIVATE: the fleet owner has to see it to
     * approve, and the driver has to see what they submitted. Nothing wider —
     * a photograph of a person is never PLATFORM or PUBLIC.
     */
    defaultVisibility: MediaVisibility.ORGANIZATION,
    ownerTypes: [MediaOwnerType.DRIVER],
    allowsDocuments: false,
  },
];

const BY_PURPOSE = new Map<MediaPurpose, MediaPurposeDefinition>(
  MEDIA_PURPOSE_CATALOGUE.map((definition) => [definition.purpose, definition]),
);

export function mediaPurposeDefinition(purpose: MediaPurpose): MediaPurposeDefinition {
  return BY_PURPOSE.get(purpose) ?? BY_PURPOSE.get(MediaPurpose.GALLERY)!;
}

/** Purposes valid for an owner type, in the order a form should offer them. */
export function mediaPurposesForOwner(ownerType: MediaOwnerType): MediaPurposeDefinition[] {
  return MEDIA_PURPOSE_CATALOGUE.filter(
    (definition) =>
      definition.ownerTypes.length === 0 || definition.ownerTypes.includes(ownerType),
  );
}

export function isMediaPurposeValidForOwner(
  purpose: MediaPurpose,
  ownerType: MediaOwnerType,
): boolean {
  const definition = mediaPurposeDefinition(purpose);
  return definition.ownerTypes.length === 0 || definition.ownerTypes.includes(ownerType);
}

/**
 * Legacy URL columns that must keep working.
 *
 * `User.avatarUrl`, `Organization.logoUrl` and `Material.imageUrl` predate this
 * subsystem and are read all over the app. Setting a primary asset mirrors its
 * URL into the matching column, so no existing consumer has to change.
 */
export const LEGACY_IMAGE_MIRRORS: ReadonlyArray<{
  ownerType: MediaOwnerType;
  purpose: MediaPurpose;
  table: 'user' | 'organization' | 'material';
  column: 'avatarUrl' | 'logoUrl' | 'imageUrl';
}> = [
  {
    ownerType: MediaOwnerType.USER,
    purpose: MediaPurpose.AVATAR,
    table: 'user',
    column: 'avatarUrl',
  },
  {
    ownerType: MediaOwnerType.ORGANIZATION,
    purpose: MediaPurpose.LOGO,
    table: 'organization',
    column: 'logoUrl',
  },
  {
    ownerType: MediaOwnerType.MATERIAL,
    purpose: MediaPurpose.PRODUCT,
    table: 'material',
    column: 'imageUrl',
  },
];

/** Content types the media API accepts for an image purpose. */
export const MEDIA_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export type MediaImageMimeType = (typeof MEDIA_IMAGE_MIME_TYPES)[number];

export function isMediaImageMimeType(mimeType: string): mimeType is MediaImageMimeType {
  return (MEDIA_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Relative API path for an asset's bytes. Kept in one place so it never drifts. */
export function mediaFilePath(mediaId: string, variant: MediaVariant = MediaVariant.ORIGINAL): string {
  return `/media/${mediaId}/file?variant=${variant}`;
}

/**
 * Visibility ordering, used to answer "is this at least as open as X".
 * Deliberately explicit rather than relying on enum declaration order.
 */
const VISIBILITY_RANK: Record<MediaVisibility, number> = {
  [MediaVisibility.PRIVATE]: 0,
  [MediaVisibility.ORGANIZATION]: 1,
  [MediaVisibility.PLATFORM]: 2,
  [MediaVisibility.PUBLIC]: 3,
};

export function isAtLeastAsOpen(value: MediaVisibility, floor: MediaVisibility): boolean {
  return VISIBILITY_RANK[value] >= VISIBILITY_RANK[floor];
}

/** Cache-Control that matches a visibility. Never guessed at the call site. */
export function mediaCacheControl(visibility: MediaVisibility): string {
  switch (visibility) {
    case MediaVisibility.PUBLIC:
    case MediaVisibility.PLATFORM:
      return 'public, max-age=31536000, immutable';
    case MediaVisibility.ORGANIZATION:
      return 'private, max-age=300';
    case MediaVisibility.PRIVATE:
    default:
      return 'private, no-store';
  }
}

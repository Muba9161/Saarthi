import {
  MediaOwnerType,
  type MediaPurpose,
  type ProfileAudience,
  ProfileFieldKind,
  ProfileTarget,
  computeProfileCompletion,
  findProfileSection,
  isFieldFilled,
  profileBlueprint,
  resolveProfileAudience,
  type ProfileCompletion,
  type ProfileField,
  type ProfileSection,
  type UpdateOrganizationProfileInput,
  type UpdateUserProfileInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../auth/context';

/**
 * Profile builder.
 *
 * The blueprint in shared code is the authority on which fields exist, which
 * table each writes to and what "complete" means. This service does three
 * things: gather the current values from the six tables identity is spread
 * across, fan a section patch back out to them, and keep the cached completion
 * percentage in step.
 *
 * Nothing here accepts a field key the blueprint does not declare. Silently
 * dropping a value someone typed is worse than telling them it does not belong.
 */

const profileLogger = logger.child({ module: 'profiles' });

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The rows a profile is assembled from. Any of them may be absent. */
interface ProfileSources {
  user: {
    id: string;
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
  userProfile: Prisma.UserProfileGetPayload<Record<string, never>> | null;
  driver: Prisma.DriverGetPayload<Record<string, never>> | null;
  organization: Prisma.OrganizationGetPayload<Record<string, never>> | null;
  organizationProfile: Prisma.OrganizationProfileGetPayload<Record<string, never>> | null;
  supplier: Prisma.SupplierGetPayload<Record<string, never>> | null;
  customer: Prisma.CustomerGetPayload<Record<string, never>> | null;
  /** Primary media asset id per purpose, for the IMAGE fields. */
  media: Map<MediaPurpose, string>;
}

/**
 * Lazily create the two profile rows.
 *
 * Doing it on read rather than in a migration means no backfill over the whole
 * user table, and a user who never opens the builder never gets a row.
 */
async function ensureUserProfile(userId: string) {
  const existing = await prisma.userProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await prisma.userProfile.create({ data: { userId } });
  } catch (error) {
    // Two concurrent reads can race here; the unique constraint settles it.
    const retry = await prisma.userProfile.findUnique({ where: { userId } });
    if (retry) return retry;
    throw error;
  }
}

async function ensureOrganizationProfile(organizationId: string) {
  const existing = await prisma.organizationProfile.findUnique({ where: { organizationId } });
  if (existing) return existing;

  try {
    return await prisma.organizationProfile.create({ data: { organizationId } });
  } catch (error) {
    const retry = await prisma.organizationProfile.findUnique({ where: { organizationId } });
    if (retry) return retry;
    throw error;
  }
}

async function loadSources(auth: AuthContext): Promise<ProfileSources> {
  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
    },
  });
  if (!user) throw errors.notFound('User');

  const userProfile = await ensureUserProfile(auth.user.id);

  const organizationId = auth.organizationId;

  const [driver, organization, organizationProfile, supplier, customer, mediaRows] =
    await Promise.all([
      auth.driverId
        ? prisma.driver.findUnique({ where: { id: auth.driverId } })
        : prisma.driver.findUnique({ where: { userId: auth.user.id } }),
      organizationId ? prisma.organization.findUnique({ where: { id: organizationId } }) : null,
      organizationId ? ensureOrganizationProfile(organizationId) : null,
      organizationId ? prisma.supplier.findUnique({ where: { organizationId } }) : null,
      organizationId ? prisma.customer.findUnique({ where: { organizationId } }) : null,
      prisma.mediaAsset.findMany({
        where: {
          isPrimary: true,
          deletedAt: null,
          OR: [
            { ownerType: MediaOwnerType.USER, ownerId: auth.user.id },
            ...(organizationId
              ? [{ ownerType: MediaOwnerType.ORGANIZATION, ownerId: organizationId }]
              : []),
          ],
        },
        select: { id: true, purpose: true },
      }),
    ]);

  return {
    user,
    userProfile,
    driver,
    organization,
    organizationProfile,
    supplier,
    customer,
    media: new Map(mediaRows.map((row) => [row.purpose as MediaPurpose, row.id])),
  };
}

/** Read one dotted path out of a Json column, e.g. `preferences.locale`. */
function readJsonPath(value: Prisma.JsonValue | null, path: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return (value as Record<string, unknown>)[path] ?? null;
}

/**
 * Current value of one blueprint field.
 *
 * GEO fields collapse a latitude/longitude pair into one object so the form has
 * a single control; IMAGE fields resolve to the primary media asset id.
 */
function readFieldValue(field: ProfileField, sources: ProfileSources): unknown {
  if (field.kind === ProfileFieldKind.IMAGE) {
    return field.mediaPurpose ? (sources.media.get(field.mediaPurpose) ?? null) : null;
  }

  const [column, nested] = field.column.split('.') as [string, string | undefined];

  const row: Record<string, unknown> | null = (() => {
    switch (field.target) {
      case ProfileTarget.USER:
        return sources.user as unknown as Record<string, unknown>;
      case ProfileTarget.USER_PROFILE:
        return sources.userProfile as unknown as Record<string, unknown> | null;
      case ProfileTarget.DRIVER:
        return sources.driver as unknown as Record<string, unknown> | null;
      case ProfileTarget.ORGANIZATION:
        return sources.organization as unknown as Record<string, unknown> | null;
      case ProfileTarget.ORGANIZATION_PROFILE:
        return sources.organizationProfile as unknown as Record<string, unknown> | null;
      case ProfileTarget.SUPPLIER:
        return sources.supplier as unknown as Record<string, unknown> | null;
      case ProfileTarget.CUSTOMER:
        return sources.customer as unknown as Record<string, unknown> | null;
      default:
        return null;
    }
  })();

  if (!row) return null;

  // A GEO field addresses two columns at once.
  if (field.kind === ProfileFieldKind.GEO) {
    const [latColumn, lngColumn] = field.column.split(',');
    const latitude = latColumn ? row[latColumn] : null;
    const longitude = lngColumn ? row[lngColumn] : null;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return { latitude, longitude };
  }

  if (nested) return readJsonPath((row[column] ?? null) as Prisma.JsonValue | null, nested);

  const value = row[column];
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

export interface ProfileBuilderView {
  audience: ProfileAudience;
  sections: ProfileSection[];
  /** Keyed `sectionKey.fieldKey`. */
  values: Record<string, unknown>;
  completion: ProfileCompletion;
  /** True when the caller may write organization-scoped fields. */
  canEditOrganization: boolean;
  organizationId: string | null;
}

function resolveAudience(auth: AuthContext): ProfileAudience {
  return resolveProfileAudience({
    roles: auth.user.roles,
    membershipRole: auth.organization?.membershipRole ?? null,
    organizationType: auth.organization?.type ?? null,
  });
}

/**
 * Whether the caller may write fields marked `organizationScoped`.
 *
 * A dispatcher gets the fleet blueprint because that is the shape of their
 * account, but they must not be able to rewrite the company's GSTIN.
 */
function canEditOrganization(auth: AuthContext): boolean {
  if (auth.isPlatformAdmin) return true;
  return auth.permissions.includes('org.update' as never);
}

export async function getBuilder(auth: AuthContext): Promise<ProfileBuilderView> {
  const audience = resolveAudience(auth);
  const sections = profileBlueprint(audience);
  const sources = await loadSources(auth);

  const values: Record<string, unknown> = {};
  for (const section of sections) {
    for (const field of section.fields) {
      values[`${section.key}.${field.key}`] = readFieldValue(field, sources);
    }
  }

  const completion = computeProfileCompletion(sections, values);

  // Cache the score so dashboards and the nudge sweep do not have to recompute
  // the whole blueprint on every read.
  await persistCompletion(auth, completion, sources);

  return {
    audience,
    sections,
    values,
    completion,
    canEditOrganization: canEditOrganization(auth),
    organizationId: auth.organizationId,
  };
}

export async function getCompletion(auth: AuthContext): Promise<ProfileCompletion> {
  const { completion } = await getBuilder(auth);
  return completion;
}

async function persistCompletion(
  auth: AuthContext,
  completion: ProfileCompletion,
  sources: ProfileSources,
): Promise<void> {
  try {
    if (
      sources.userProfile &&
      (sources.userProfile.completionPercent !== completion.percent ||
        sources.userProfile.completedSections.length !== completion.completedSections.length)
    ) {
      await prisma.userProfile.update({
        where: { userId: auth.user.id },
        data: {
          completionPercent: completion.percent,
          completedSections: completion.completedSections,
          lastBuiltAt: new Date(),
        },
      });
    }
  } catch (error) {
    // A cache miss must never fail the read the user asked for.
    profileLogger.warn({ err: error }, 'Profile completion could not be cached');
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Per-table accumulators for one section patch. */
interface PatchBuckets {
  user: Record<string, unknown>;
  userProfile: Record<string, unknown>;
  driver: Record<string, unknown>;
  organization: Record<string, unknown>;
  organizationProfile: Record<string, unknown>;
  supplier: Record<string, unknown>;
  customer: Record<string, unknown>;
  /** Dotted Json paths, grouped by target then column. */
  json: Map<string, Map<string, Record<string, unknown>>>;
}

function emptyBuckets(): PatchBuckets {
  return {
    user: {},
    userProfile: {},
    driver: {},
    organization: {},
    organizationProfile: {},
    supplier: {},
    customer: {},
    json: new Map(),
  };
}

/** Coerce one submitted value to the shape its field declares. */
function coerceValue(field: ProfileField, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;

  switch (field.kind) {
    case ProfileFieldKind.NUMBER: {
      const numeric = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(numeric)) {
        throw errors.validation(`${field.label} must be a number.`);
      }
      if (field.min !== undefined && numeric < field.min) {
        throw errors.validation(`${field.label} cannot be below ${field.min}.`);
      }
      if (field.max !== undefined && numeric > field.max) {
        throw errors.validation(`${field.label} cannot be above ${field.max}.`);
      }
      return numeric;
    }

    case ProfileFieldKind.BOOLEAN:
      return typeof raw === 'boolean' ? raw : String(raw) === 'true';

    case ProfileFieldKind.DATE: {
      const date = new Date(String(raw));
      if (Number.isNaN(date.getTime())) {
        throw errors.validation(`${field.label} is not a valid date.`);
      }
      return date;
    }

    case ProfileFieldKind.TAGS:
    case ProfileFieldKind.MULTI_SELECT: {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const cleaned = list
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
        .slice(0, 30);
      return cleaned;
    }

    case ProfileFieldKind.SELECT: {
      const value = String(raw).trim();
      if (field.options && !field.options.some((option) => option.value === value)) {
        throw errors.validation(`${value} is not one of the choices for ${field.label}.`);
      }
      return value;
    }

    case ProfileFieldKind.GEO: {
      if (typeof raw !== 'object' || raw === null) {
        throw errors.validation(`${field.label} needs a latitude and a longitude.`);
      }
      const { latitude, longitude } = raw as { latitude?: unknown; longitude?: unknown };
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw errors.validation(`${field.label} needs a latitude and a longitude.`);
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw errors.validation(`${field.label} is not a valid coordinate.`);
      }
      return { latitude, longitude };
    }

    case ProfileFieldKind.URL: {
      const value = String(raw).trim();
      if (value.length === 0) return null;
      try {
        new URL(value);
      } catch {
        throw errors.validation(`${field.label} must be a full web address.`);
      }
      return value;
    }

    case ProfileFieldKind.PHONE: {
      const value = String(raw).replace(/[\s()-]/g, '');
      if (value.length === 0) return null;
      if (!/^(\+91)?[6-9]\d{9}$/.test(value)) {
        throw errors.validation(`${field.label} must be a valid 10-digit Indian mobile number.`);
      }
      return value.startsWith('+91') ? value : `+91${value}`;
    }

    case ProfileFieldKind.EMAIL: {
      const value = String(raw).trim().toLowerCase();
      if (value.length === 0) return null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw errors.validation(`${field.label} must be a valid email address.`);
      }
      return value;
    }

    default: {
      const value = String(raw).trim();
      if (value.length === 0) return null;
      if (field.maxLength && value.length > field.maxLength) {
        throw errors.validation(
          `${field.label} cannot be longer than ${field.maxLength} characters.`,
        );
      }
      return value;
    }
  }
}

function bucketFor(buckets: PatchBuckets, target: ProfileTarget): Record<string, unknown> | null {
  switch (target) {
    case ProfileTarget.USER:
      return buckets.user;
    case ProfileTarget.USER_PROFILE:
      return buckets.userProfile;
    case ProfileTarget.DRIVER:
      return buckets.driver;
    case ProfileTarget.ORGANIZATION:
      return buckets.organization;
    case ProfileTarget.ORGANIZATION_PROFILE:
      return buckets.organizationProfile;
    case ProfileTarget.SUPPLIER:
      return buckets.supplier;
    case ProfileTarget.CUSTOMER:
      return buckets.customer;
    default:
      return null;
  }
}

export interface PatchSectionResult {
  section: string;
  updatedFields: string[];
  completion: ProfileCompletion;
}

/**
 * Apply one section's values.
 *
 * Runs in a single transaction across up to seven tables, so a patch that names
 * both a personal and a business field either lands completely or not at all.
 */
export async function patchSection(
  auth: AuthContext,
  sectionKey: string,
  submitted: Record<string, unknown>,
): Promise<PatchSectionResult> {
  const audience = resolveAudience(auth);
  const section = findProfileSection(audience, sectionKey);
  if (!section) throw errors.notFound('Profile section');

  const editOrganization = canEditOrganization(auth);
  const buckets = emptyBuckets();
  const updatedFields: string[] = [];

  for (const [key, raw] of Object.entries(submitted)) {
    const field = section.fields.find((candidate) => candidate.key === key);
    if (!field) {
      throw errors.validation(`${key} is not a field in the ${section.title} section.`);
    }

    // Images live in the media library and have their own upload path, with its
    // own size limits and magic-byte checks. Accepting an id here would let a
    // caller point their avatar at somebody else's asset.
    if (field.kind === ProfileFieldKind.IMAGE) {
      throw errors.validation(
        `Upload ${field.label.toLowerCase()} through the image uploader rather than this form.`,
      );
    }

    if (field.organizationScoped && !editOrganization) {
      throw errors.forbidden(
        `${field.label} is a business detail. Ask an administrator of your organization to change it.`,
      );
    }
    if (field.organizationScoped && !auth.organizationId) {
      throw errors.organizationRequired(
        'Select an organization before editing its business details.',
      );
    }
    if (field.target === ProfileTarget.DRIVER && !auth.driverId) {
      throw errors.businessRule('This field belongs to a driver profile.');
    }

    const value = coerceValue(field, raw);

    if (field.required && !isFieldFilled(value)) {
      throw errors.validation(`${field.label} is required.`);
    }

    const bucket = bucketFor(buckets, field.target);
    if (!bucket) continue;

    if (field.kind === ProfileFieldKind.GEO) {
      const [latColumn, lngColumn] = field.column.split(',');
      const coordinate = value as { latitude: number; longitude: number } | null;
      if (latColumn) bucket[latColumn] = coordinate?.latitude ?? null;
      if (lngColumn) bucket[lngColumn] = coordinate?.longitude ?? null;
    } else if (field.column.includes('.')) {
      // Nested Json path: collected and merged so several preference keys in
      // one patch do not each overwrite the whole column.
      const [column, nested] = field.column.split('.') as [string, string];
      const byTarget = buckets.json.get(field.target) ?? new Map();
      const byColumn = byTarget.get(column) ?? {};
      byColumn[nested] = value;
      byTarget.set(column, byColumn);
      buckets.json.set(field.target, byTarget);
    } else {
      bucket[field.column] = value;
    }

    updatedFields.push(field.key);
  }

  if (updatedFields.length === 0) {
    throw errors.validation('Nothing to save in this section.');
  }

  const organizationId = auth.organizationId;

  await prisma.$transaction(async (tx) => {
    // Merge Json patches on top of what is stored rather than replacing it.
    for (const [target, columns] of buckets.json) {
      for (const [column, patch] of columns) {
        const existing = await readJsonColumn(tx, target as ProfileTarget, auth, column);
        const merged = { ...(existing ?? {}), ...patch };
        const bucket = bucketFor(buckets, target as ProfileTarget);
        if (bucket) bucket[column] = merged;
      }
    }

    if (Object.keys(buckets.user).length > 0) {
      await tx.user.update({ where: { id: auth.user.id }, data: buckets.user });
    }
    if (Object.keys(buckets.userProfile).length > 0) {
      await tx.userProfile.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, ...buckets.userProfile },
        update: buckets.userProfile,
      });
    }
    if (Object.keys(buckets.driver).length > 0 && auth.driverId) {
      await tx.driver.update({ where: { id: auth.driverId }, data: buckets.driver });
    }
    if (Object.keys(buckets.organization).length > 0 && organizationId) {
      await tx.organization.update({ where: { id: organizationId }, data: buckets.organization });
    }
    if (Object.keys(buckets.organizationProfile).length > 0 && organizationId) {
      await tx.organizationProfile.upsert({
        where: { organizationId },
        create: { organizationId, ...buckets.organizationProfile },
        update: buckets.organizationProfile,
      });
    }
    if (Object.keys(buckets.supplier).length > 0 && organizationId) {
      await tx.supplier.update({ where: { organizationId }, data: buckets.supplier });
    }
    if (Object.keys(buckets.customer).length > 0 && organizationId) {
      await tx.customer.update({ where: { organizationId }, data: buckets.customer });
    }
  });

  const { completion } = await getBuilder(auth);
  return { section: sectionKey, updatedFields, completion };
}

/** Current contents of a Json column, so a patch can merge rather than clobber. */
async function readJsonColumn(
  tx: Prisma.TransactionClient,
  target: ProfileTarget,
  auth: AuthContext,
  column: string,
): Promise<Record<string, unknown> | null> {
  const read = async (value: unknown): Promise<Record<string, unknown> | null> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  if (target === ProfileTarget.USER_PROFILE) {
    const row = await tx.userProfile.findUnique({ where: { userId: auth.user.id } });
    return read((row as Record<string, unknown> | null)?.[column]);
  }
  if (target === ProfileTarget.ORGANIZATION_PROFILE && auth.organizationId) {
    const row = await tx.organizationProfile.findUnique({
      where: { organizationId: auth.organizationId },
    });
    return read((row as Record<string, unknown> | null)?.[column]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direct profile updates (the non-builder path)
// ---------------------------------------------------------------------------

export async function updateUserProfile(
  auth: AuthContext,
  input: UpdateUserProfileInput,
): Promise<void> {
  const existing = await ensureUserProfile(auth.user.id);

  // Preferences and field visibility are merged, not replaced: a client that
  // sends only the theme must not wipe the user's language.
  const preferences = input.preferences
    ? {
        ...((existing.preferences as Record<string, unknown> | null) ?? {}),
        ...input.preferences,
      }
    : undefined;
  const fieldVisibility = input.fieldVisibility
    ? {
        ...((existing.fieldVisibility as Record<string, unknown> | null) ?? {}),
        ...input.fieldVisibility,
      }
    : undefined;

  const { preferences: _p, fieldVisibility: _f, socialLinks, ...rest } = input;
  void _p;
  void _f;

  await prisma.userProfile.update({
    where: { userId: auth.user.id },
    data: {
      ...rest,
      // Cast at the boundary: these are validated Zod objects, but Prisma types
      // Json columns as its own InputJsonValue rather than a plain record.
      ...(socialLinks ? { socialLinks: socialLinks as Prisma.InputJsonValue } : {}),
      ...(preferences ? { preferences: preferences as Prisma.InputJsonValue } : {}),
      ...(fieldVisibility
        ? { fieldVisibility: fieldVisibility as Prisma.InputJsonValue }
        : {}),
    },
  });
}

export async function updateOrganizationProfile(
  auth: AuthContext,
  organizationId: string,
  input: UpdateOrganizationProfileInput,
): Promise<void> {
  await ensureOrganizationProfile(organizationId);
  void auth;

  const { fieldVisibility, operatingHours, socialLinks, ...rest } = input;

  await prisma.organizationProfile.update({
    where: { organizationId },
    data: {
      ...rest,
      ...(socialLinks ? { socialLinks: socialLinks as Prisma.InputJsonValue } : {}),
      ...(operatingHours ? { operatingHours: operatingHours as Prisma.InputJsonValue } : {}),
      ...(fieldVisibility
        ? { fieldVisibility: fieldVisibility as Prisma.InputJsonValue }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Slugs & directory
// ---------------------------------------------------------------------------

export async function setSlug(
  auth: AuthContext,
  target: 'user' | 'organization',
  slug: string,
): Promise<{ slug: string }> {
  // Reserved words that would collide with real app routes.
  const reserved = ['admin', 'api', 'settings', 'login', 'register', 'me', 'new', 'scan', 'q'];
  if (reserved.includes(slug)) {
    throw errors.validation('That profile address is reserved. Choose another.');
  }

  try {
    if (target === 'organization') {
      const organizationId = auth.organizationId;
      if (!organizationId) throw errors.organizationRequired();
      if (!canEditOrganization(auth)) {
        throw errors.forbidden('Only an organization administrator can set its profile address.');
      }
      await ensureOrganizationProfile(organizationId);
      await prisma.organizationProfile.update({
        where: { organizationId },
        data: { publicSlug: slug },
      });
    } else {
      await ensureUserProfile(auth.user.id);
      await prisma.userProfile.update({
        where: { userId: auth.user.id },
        data: { publicSlug: slug },
      });
    }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw errors.duplicate('That profile address is already taken.');
    }
    throw error;
  }

  return { slug };
}

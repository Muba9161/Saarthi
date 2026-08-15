import crypto from 'node:crypto';
import {
  DEFAULT_SCORING_CONFIG,
  DriverAvailability,
  MembershipStatus,
  RoleName,
  type ScoreCategory,
  VerificationStatus,
  buildPaginationMeta,
  buildScoreBreakdown,
  computeCategoryScores,
  computeOverallScore,
  evaluateAchievements,
  emptyAchievementMetrics,
  resolveDocumentValidity,
  type AdjustScoreInput,
  type CreateDriverInput,
  type DriverListQuery,
  type Paginated,
  type UpdateDriverInput,
  type AppliedScoreEvent,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { assertTenantAccess } from '../../server/guards';
import { passwordHasher } from '../../auth/password';
import { generateOpaqueToken } from '../../auth/tokens';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import type { AuthContext } from '../../auth/context';

/**
 * Driver management.
 *
 * A driver is a person (User) plus an operational profile (Driver) inside one
 * fleet. Creating a driver from the fleet console provisions the account and
 * issues a one-time set-password link rather than inventing a password the
 * owner would have to communicate insecurely.
 */

export interface DriverSummary {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  licenseNumber: string;
  licenseExpiryDate: string | null;
  licenseClass: string | null;
  experienceYears: number;
  verificationStatus: string;
  availability: string;
  currentTruck: { id: string; registrationNumber: string } | null;
  overallScore: number | null;
  totalTrips: number;
  totalDistanceKm: number;
  documentHealth: { total: number; expired: number; expiringSoon: number; pending: number };
  createdAt: string;
  archivedAt: string | null;
}

const driverInclude = {
  user: {
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
  },
} satisfies Prisma.DriverInclude;

type DriverWithUser = Prisma.DriverGetPayload<{ include: typeof driverInclude }>;

async function documentHealthFor(
  driverIds: string[],
): Promise<Map<string, DriverSummary['documentHealth']>> {
  const map = new Map<string, DriverSummary['documentHealth']>();
  for (const id of driverIds) map.set(id, { total: 0, expired: 0, expiringSoon: 0, pending: 0 });
  if (driverIds.length === 0) return map;

  const documents = await prisma.document.findMany({
    where: { ownerType: 'DRIVER', ownerId: { in: driverIds }, deletedAt: null },
    select: { ownerId: true, expiryDate: true, verificationStatus: true },
  });

  for (const document of documents) {
    const bucket = map.get(document.ownerId);
    if (!bucket) continue;
    bucket.total += 1;
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    if (validity === 'EXPIRED') bucket.expired += 1;
    else if (validity === 'EXPIRING_SOON') bucket.expiringSoon += 1;
    else if (validity === 'PENDING_VERIFICATION') bucket.pending += 1;
  }

  return map;
}

async function truckLookup(driverIds: string[]): Promise<Map<string, { id: string; registrationNumber: string }>> {
  const map = new Map<string, { id: string; registrationNumber: string }>();
  if (driverIds.length === 0) return map;
  const trucks = await prisma.truck.findMany({
    where: { currentDriverId: { in: driverIds } },
    select: { id: true, registrationNumber: true, currentDriverId: true },
  });
  for (const truck of trucks) {
    if (truck.currentDriverId) {
      map.set(truck.currentDriverId, { id: truck.id, registrationNumber: truck.registrationNumber });
    }
  }
  return map;
}

function toSummary(
  driver: DriverWithUser,
  truck: { id: string; registrationNumber: string } | null,
  health: DriverSummary['documentHealth'],
): DriverSummary {
  return {
    id: driver.id,
    userId: driver.userId,
    firstName: driver.user.firstName,
    lastName: driver.user.lastName,
    fullName: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
    email: driver.user.email,
    phone: driver.user.phone,
    licenseNumber: driver.licenseNumber,
    licenseExpiryDate: driver.licenseExpiryDate?.toISOString() ?? null,
    licenseClass: driver.licenseClass,
    experienceYears: driver.experienceYears,
    verificationStatus: driver.verificationStatus,
    availability: driver.availability,
    currentTruck: truck,
    overallScore: driver.overallScore,
    totalTrips: driver.totalTrips,
    totalDistanceKm: Number(driver.totalDistanceKm.toFixed(1)),
    documentHealth: health,
    createdAt: driver.createdAt.toISOString(),
    archivedAt: driver.archivedAt?.toISOString() ?? null,
  };
}

export async function listDrivers(
  auth: AuthContext,
  query: DriverListQuery,
): Promise<Paginated<DriverSummary>> {
  const where: Prisma.DriverWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.availability ? { availability: { in: query.availability as never } } : {}),
    ...(query.verificationStatus
      ? { verificationStatus: { in: query.verificationStatus as VerificationStatus[] } }
      : {}),
    ...(query.assigned === 'true' ? { currentTruckId: { not: null } } : {}),
    ...(query.assigned === 'false' ? { currentTruckId: null } : {}),
    ...(query.search
      ? {
          OR: [
            { licenseNumber: { contains: query.search, mode: 'insensitive' } },
            { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
            { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
            { user: { email: { contains: query.search, mode: 'insensitive' } } },
            { user: { phone: { contains: query.search } } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.DriverOrderByWithRelationInput =
    query.sortBy === 'name'
      ? { user: { firstName: query.sortOrder } }
      : query.sortBy === 'overallScore'
        ? { overallScore: query.sortOrder }
        : query.sortBy === 'totalTrips'
          ? { totalTrips: query.sortOrder }
          : { createdAt: query.sortOrder };

  const [total, drivers] = await Promise.all([
    prisma.driver.count({ where }),
    prisma.driver.findMany({
      where,
      include: driverInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const ids = drivers.map((driver) => driver.id);
  const [health, trucks] = await Promise.all([documentHealthFor(ids), truckLookup(ids)]);

  return {
    items: drivers.map((driver) =>
      toSummary(driver, trucks.get(driver.id) ?? null, health.get(driver.id)!),
    ),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getDriver(auth: AuthContext, driverId: string): Promise<DriverSummary> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: driverInclude });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  const [health, trucks] = await Promise.all([
    documentHealthFor([driver.id]),
    truckLookup([driver.id]),
  ]);
  return toSummary(driver, trucks.get(driver.id) ?? null, health.get(driver.id)!);
}

async function assertDriverLimit(auth: AuthContext, organizationId: string): Promise<void> {
  const max = auth.subscription?.limits.maxDrivers;
  if (max === null || max === undefined) return;
  const existing = await prisma.driver.count({ where: { organizationId, archivedAt: null } });
  if (existing >= max) {
    throw errors.planLimitReached(
      'maxDrivers',
      `Your ${auth.subscription?.planName ?? 'current'} plan allows ${max} drivers. Upgrade your plan to add more.`,
    );
  }
}

export interface CreateDriverResult {
  driver: DriverSummary;
  /** One-time link the driver uses to set their own password. */
  setupUrl: string;
  /** Returned only outside production, where no email provider is configured. */
  setupToken?: string;
}

export async function createDriver(
  auth: AuthContext,
  organizationId: string,
  input: CreateDriverInput,
): Promise<CreateDriverResult> {
  await assertDriverLimit(auth, organizationId);

  const [emailTaken, phoneTaken, licenceTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email } }),
    prisma.user.findUnique({ where: { phone: input.phone } }),
    prisma.driver.findFirst({ where: { organizationId, licenseNumber: input.licenseNumber } }),
  ]);

  if (emailTaken) {
    throw errors.duplicate('An account already exists for this email address.', {
      fields: { email: ['An account already exists for this email address.'] },
    });
  }
  if (phoneTaken) {
    throw errors.duplicate('An account already exists for this mobile number.', {
      fields: { phone: ['An account already exists for this mobile number.'] },
    });
  }
  if (licenceTaken) {
    throw errors.duplicate('A driver with this licence number already exists in your fleet.', {
      fields: { licenseNumber: ['This licence number is already registered in your fleet.'] },
    });
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.DRIVER } });
  // The account is created with an unguessable password that is never shared;
  // the driver sets their own via the one-time link below.
  const placeholderPassword = crypto.randomBytes(32).toString('base64url');
  const { token, hash } = generateOpaqueToken(32);

  const driverId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        phone: input.phone,
        passwordHash: await passwordHasher.hash(placeholderPassword),
        firstName: input.firstName,
        lastName: input.lastName,
        status: 'ACTIVE',
        roles: { create: { roleId: role.id } },
      },
    });

    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId,
        role: RoleName.DRIVER,
        status: MembershipStatus.ACTIVE,
        isPrimary: true,
        invitedById: auth.user.id,
      },
    });

    const driver = await tx.driver.create({
      data: {
        userId: user.id,
        organizationId,
        licenseNumber: input.licenseNumber,
        licenseExpiryDate: input.licenseExpiryDate ?? null,
        licenseClass: input.licenseClass ?? null,
        experienceYears: input.experienceYears,
        dateOfBirth: input.dateOfBirth ?? null,
        bloodGroup: input.bloodGroup ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        verificationStatus: VerificationStatus.PENDING,
        availability: DriverAvailability.AVAILABLE,
      },
    });

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        // Generous window: an owner may add drivers ahead of onboarding day.
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    return driver.id;
  });

  const setupUrl = `${config.server.frontendUrl}/reset-password?token=${token}`;
  logger.info({ email: input.email, setupUrl }, 'Driver account created; set-password link issued');

  return {
    driver: await getDriver(auth, driverId),
    setupUrl,
    ...(config.isProduction ? {} : { setupToken: token }),
  };
}

export async function updateDriver(
  auth: AuthContext,
  driverId: string,
  input: UpdateDriverInput,
): Promise<DriverSummary> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  if (input.licenseNumber && input.licenseNumber !== driver.licenseNumber) {
    const clash = await prisma.driver.findFirst({
      where: {
        organizationId: driver.organizationId,
        licenseNumber: input.licenseNumber,
        NOT: { id: driverId },
      },
    });
    if (clash) {
      throw errors.duplicate('A driver with this licence number already exists in your fleet.', {
        fields: { licenseNumber: ['This licence number is already registered in your fleet.'] },
      });
    }
  }

  if (input.availability === DriverAvailability.ON_TRIP) {
    throw errors.businessRule(
      'Availability is set automatically while a driver is on a trip and cannot be set manually.',
    );
  }
  if (driver.availability === DriverAvailability.ON_TRIP && input.availability) {
    throw errors.businessRule('This driver is currently on a trip. Complete the trip first.');
  }

  await prisma.$transaction(async (tx) => {
    if (input.firstName !== undefined || input.lastName !== undefined) {
      await tx.user.update({
        where: { id: driver.userId },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        },
      });
    }

    await tx.driver.update({
      where: { id: driverId },
      data: {
        ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
        ...(input.licenseExpiryDate !== undefined
          ? { licenseExpiryDate: input.licenseExpiryDate }
          : {}),
        ...(input.licenseClass !== undefined ? { licenseClass: input.licenseClass } : {}),
        ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
        ...(input.bloodGroup !== undefined ? { bloodGroup: input.bloodGroup } : {}),
        ...(input.emergencyContactName !== undefined
          ? { emergencyContactName: input.emergencyContactName }
          : {}),
        ...(input.emergencyContactPhone !== undefined
          ? { emergencyContactPhone: input.emergencyContactPhone }
          : {}),
        ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
        ...(input.availability !== undefined ? { availability: input.availability } : {}),
      },
    });
  });

  return getDriver(auth, driverId);
}

export async function archiveDriver(auth: AuthContext, driverId: string): Promise<void> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  if (driver.availability === DriverAvailability.ON_TRIP) {
    throw errors.businessRule('This driver is on an active trip and cannot be archived yet.');
  }

  await prisma.$transaction([
    prisma.truckAssignment.updateMany({
      where: { driverId, status: 'ACTIVE' },
      data: { status: 'ENDED', unassignedAt: new Date() },
    }),
    prisma.truck.updateMany({
      where: { currentDriverId: driverId },
      data: { currentDriverId: null, status: 'AVAILABLE' },
    }),
    prisma.driver.update({
      where: { id: driverId },
      data: {
        archivedAt: new Date(),
        currentTruckId: null,
        availability: DriverAvailability.SUSPENDED,
      },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface DriverScoreDetail {
  driverId: string;
  overall: number;
  categories: Record<ScoreCategory, number>;
  band: string;
  strengths: ScoreCategory[];
  weaknesses: ScoreCategory[];
  recommendations: string[];
  calculatedAt: string;
  history: { date: string; overall: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    category: string;
    points: number;
    reason: string;
    createdAt: string;
  }[];
}

/** Recompute a driver's score from their full event history. */
export async function recalculateDriverScore(driverId: string): Promise<{
  overall: number;
  categories: Record<ScoreCategory, number>;
}> {
  const events = await prisma.driverScoreEvent.findMany({
    where: { driverId },
    orderBy: { createdAt: 'asc' },
    select: { category: true, points: true, reason: true },
  });

  const applied: AppliedScoreEvent[] = events.map((event) => ({
    category: event.category as ScoreCategory,
    points: event.points,
    reason: event.reason,
  }));

  const categories = computeCategoryScores(applied, DEFAULT_SCORING_CONFIG);
  const overall = computeOverallScore(categories, DEFAULT_SCORING_CONFIG);

  await prisma.$transaction([
    prisma.driverScore.create({
      data: {
        driverId,
        overallScore: overall,
        safetyScore: categories.SAFETY,
        reliabilityScore: categories.RELIABILITY,
        timelinessScore: categories.TIMELINESS,
        complianceScore: categories.COMPLIANCE,
        vehicleCareScore: categories.VEHICLE_CARE,
      },
    }),
    prisma.driver.update({ where: { id: driverId }, data: { overallScore: overall } }),
  ]);

  return { overall, categories };
}

export async function getDriverScore(
  auth: AuthContext,
  driverId: string,
): Promise<DriverScoreDetail> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  let latest = await prisma.driverScore.findFirst({
    where: { driverId },
    orderBy: { calculatedAt: 'desc' },
  });

  if (!latest) {
    await recalculateDriverScore(driverId);
    latest = await prisma.driverScore.findFirst({
      where: { driverId },
      orderBy: { calculatedAt: 'desc' },
    });
  }

  const categories: Record<ScoreCategory, number> = {
    SAFETY: latest?.safetyScore ?? DEFAULT_SCORING_CONFIG.baselineScore,
    RELIABILITY: latest?.reliabilityScore ?? DEFAULT_SCORING_CONFIG.baselineScore,
    TIMELINESS: latest?.timelinessScore ?? DEFAULT_SCORING_CONFIG.baselineScore,
    COMPLIANCE: latest?.complianceScore ?? DEFAULT_SCORING_CONFIG.baselineScore,
    VEHICLE_CARE: latest?.vehicleCareScore ?? DEFAULT_SCORING_CONFIG.baselineScore,
  };

  const breakdown = buildScoreBreakdown(categories, DEFAULT_SCORING_CONFIG);

  const [history, recentEvents] = await Promise.all([
    prisma.driverScore.findMany({
      where: { driverId },
      orderBy: { calculatedAt: 'desc' },
      take: 30,
      select: { overallScore: true, calculatedAt: true },
    }),
    prisma.driverScoreEvent.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  return {
    driverId,
    overall: breakdown.overall,
    categories: breakdown.categories,
    band:
      breakdown.overall >= 90
        ? 'EXCELLENT'
        : breakdown.overall >= 75
          ? 'GOOD'
          : breakdown.overall >= 60
            ? 'FAIR'
            : 'AT_RISK',
    strengths: breakdown.strengths,
    weaknesses: breakdown.weaknesses,
    recommendations: breakdown.recommendations,
    calculatedAt: (latest?.calculatedAt ?? new Date()).toISOString(),
    history: history
      .reverse()
      .map((entry) => ({ date: entry.calculatedAt.toISOString(), overall: entry.overallScore })),
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      category: event.category,
      points: event.points,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function adjustDriverScore(
  auth: AuthContext,
  driverId: string,
  input: AdjustScoreInput,
): Promise<DriverScoreDetail> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  await prisma.driverScoreEvent.create({
    data: {
      driverId,
      eventType: 'MANUAL_ADJUSTMENT',
      category: input.category,
      points: input.points,
      reason: input.reason,
      actorUserId: auth.user.id,
      sourceType: 'MANUAL',
    },
  });

  await recalculateDriverScore(driverId);
  return getDriverScore(auth, driverId);
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export async function getDriverAchievements(auth: AuthContext, driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw errors.notFound('Driver');
  assertTenantAccess(auth, driver.organizationId, 'Driver');

  const metrics = await buildAchievementMetrics(driverId);
  const evaluations = evaluateAchievements(metrics);
  const earned = await prisma.driverAchievement.findMany({ where: { driverId } });
  const earnedMap = new Map(earned.map((entry) => [entry.code, entry]));

  return evaluations.map((evaluation) => ({
    code: evaluation.code,
    earned: evaluation.earned,
    progress: Number(evaluation.progress.toFixed(2)),
    earnedAt: earnedMap.get(evaluation.code)?.earnedAt.toISOString() ?? null,
  }));
}

export async function buildAchievementMetrics(driverId: string) {
  const [driver, latestScore, trips, ratings, sosAssists, expiredDocuments] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId } }),
    prisma.driverScore.findFirst({ where: { driverId }, orderBy: { calculatedAt: 'desc' } }),
    prisma.trip.findMany({
      where: { driverId, status: 'COMPLETED' },
      select: { delayMinutes: true, actualDistanceKm: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.orderRating.aggregate({
      where: { driverId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.sosResponder.count({ where: { driverId, status: 'COMPLETED' } }),
    prisma.document.count({
      where: { ownerType: 'DRIVER', ownerId: driverId, expiryDate: { lt: new Date() }, deletedAt: null },
    }),
  ]);

  const incidents = await prisma.driverScoreEvent.count({
    where: { driverId, eventType: { in: ['INCIDENT', 'SPEED_VIOLATION'] } },
  });

  const metrics = emptyAchievementMetrics();
  metrics.completedTrips = trips.length;
  metrics.totalTrips = driver?.totalTrips ?? trips.length;
  metrics.onTimeTrips = trips.filter((trip) => trip.delayMinutes === 0).length;
  metrics.incidentCount = incidents;
  metrics.incidentFreeStreak = incidents === 0 ? trips.length : 0;
  metrics.safetyScore = latestScore?.safetyScore ?? 0;
  metrics.timelinessScore = latestScore?.timelinessScore ?? 0;
  metrics.complianceScore = latestScore?.complianceScore ?? 0;
  metrics.vehicleCareScore = latestScore?.vehicleCareScore ?? 0;
  metrics.averageCustomerRating = ratings._avg.rating;
  metrics.customerRatingCount = ratings._count.rating;
  metrics.sosAssistsCompleted = sosAssists;
  metrics.expiredMandatoryDocuments = expiredDocuments;
  metrics.totalDistanceKm = driver?.totalDistanceKm ?? 0;

  const fuel = await prisma.fuelRecord.aggregate({
    where: { driverId },
    _sum: { quantityLitres: true },
  });
  const litres = fuel._sum.quantityLitres ?? 0;
  metrics.fuelEfficiencyL100Km =
    litres > 0 && metrics.totalDistanceKm > 0
      ? Number(((litres / metrics.totalDistanceKm) * 100).toFixed(2))
      : null;

  return metrics;
}

/** Award any newly-earned achievements. Returns the codes granted. */
export async function evaluateAndAwardAchievements(driverId: string): Promise<string[]> {
  const metrics = await buildAchievementMetrics(driverId);
  const evaluations = evaluateAchievements(metrics);
  const existing = await prisma.driverAchievement.findMany({
    where: { driverId },
    select: { code: true },
  });
  const held = new Set(existing.map((entry) => entry.code));

  const granted: string[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.earned && !held.has(evaluation.code)) {
      await prisma.driverAchievement.create({
        data: { driverId, code: evaluation.code, progress: 1 },
      });
      granted.push(evaluation.code);
    }
  }
  return granted;
}

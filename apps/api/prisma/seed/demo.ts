import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_SCORING_CONFIG,
  MaterialUnit,
  MembershipStatus,
  OrganizationType,
  PlanTier,
  RoleName,
  SubscriptionStatus,
  VerificationStatus,
  bearing,
  computeCategoryScores,
  computeOverallScore,
  cumulativeDistances,
  pathLength,
  pointAtDistance,
  type AppliedScoreEvent,
} from '@saarthi/shared';
import { DEMO_ROUTES, routeByKey, type DemoRoute } from './routes';
import { seedNearbyPlaces } from './places';
import { buildDemoPdf, checksumOf } from './files';

/**
 * Local demo dataset.
 *
 * Everything here is written to PostgreSQL exactly as the application would
 * write it: no dashboard number in the UI is hard-coded, every figure shown is
 * aggregated from these rows. Re-running the seed rebuilds the same world
 * deterministically.
 */

export const DEMO_PASSWORD = 'Saarthi@2026';
const STORAGE_ROOT = path.resolve(__dirname, '../../../../storage/documents');

const day = 86_400_000;
const now = Date.now();
const daysFromNow = (days: number): Date => new Date(now + days * day);
const daysAgo = (days: number): Date => new Date(now - days * day);

let passwordHashCache: string | null = null;
async function demoPasswordHash(): Promise<string> {
  passwordHashCache ??= await bcrypt.hash(DEMO_PASSWORD, 10);
  return passwordHashCache;
}

/** Deterministic pseudo-random so every seed run produces the same world. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}
const random = seededRandom(20260815);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number): number => min + random() * (max - min);

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Removes previously seeded operational data. Reference data (roles, plans,
 * features) is preserved because the application depends on it.
 */
async function clearDemoData(prisma: PrismaClient): Promise<void> {
  // Ordered so foreign keys never block a delete.
  await prisma.sosEvent.deleteMany();
  await prisma.sosResponder.deleteMany();
  await prisma.sosIncident.deleteMany();

  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.aiInsight.deleteMany();
  await prisma.aiUsage.deleteMany();

  await prisma.simulation.deleteMany();

  await prisma.orderRating.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.orderQuote.deleteMany();
  await prisma.order.deleteMany();

  await prisma.tripStop.deleteMany();
  await prisma.tripEvent.deleteMany();
  await prisma.trip.deleteMany();

  await prisma.truckLocation.deleteMany();
  await prisma.truckEvent.deleteMany();
  await prisma.fuelRecord.deleteMany();
  await prisma.maintenanceRecord.deleteMany();
  await prisma.truckAssignment.deleteMany();
  await prisma.truck.deleteMany();

  await prisma.driverAchievement.deleteMany();
  await prisma.driverScoreEvent.deleteMany();
  await prisma.driverScore.deleteMany();
  await prisma.driver.deleteMany();

  await prisma.verificationEvent.deleteMany();
  await prisma.verificationDocument.deleteMany();
  await prisma.verificationCase.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.document.deleteMany();

  await prisma.material.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.customer.deleteMany();

  await prisma.notificationDelivery.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.notification.deleteMany();

  await prisma.auditLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Storage is rebuilt alongside the database so keys never dangle.
  await fs.rm(STORAGE_ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function createUser(
  prisma: PrismaClient,
  input: {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    role: RoleName;
  },
): Promise<{ id: string; email: string; firstName: string; lastName: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: input.role } });
  return prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash: await demoPasswordHash(),
      firstName: input.firstName,
      lastName: input.lastName,
      status: 'ACTIVE',
      lastLoginAt: daysAgo(between(0, 3)),
      roles: { create: { roleId: role.id } },
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
}

async function createOrganization(
  prisma: PrismaClient,
  input: {
    name: string;
    type: OrganizationType;
    inviteCode: string;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
    email: string;
    phone: string;
    registrationNumber: string;
    verification?: VerificationStatus;
    description?: string;
  },
) {
  return prisma.organization.create({
    data: {
      name: input.name,
      type: input.type,
      inviteCode: input.inviteCode,
      registrationNumber: input.registrationNumber,
      taxNumber: `27AAACS${Math.floor(between(1000, 9999))}A1Z5`,
      email: input.email,
      phone: input.phone,
      addressLine: `Plot ${Math.floor(between(1, 200))}, Industrial Area`,
      city: input.city,
      state: input.state,
      postalCode: String(Math.floor(between(110001, 560100))),
      latitude: input.latitude,
      longitude: input.longitude,
      verificationStatus: input.verification ?? VerificationStatus.VERIFIED,
      description: input.description ?? null,
    },
  });
}

async function addMembership(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  role: RoleName,
  isPrimary = true,
): Promise<void> {
  await prisma.membership.create({
    data: { userId, organizationId, role, status: MembershipStatus.ACTIVE, isPrimary },
  });
}

async function addSubscription(
  prisma: PrismaClient,
  organizationId: string,
  tier: PlanTier,
  status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
): Promise<void> {
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { tier } });
  await prisma.subscription.create({
    data: {
      organizationId,
      planId: plan.id,
      status,
      startsAt: daysAgo(120),
      endsAt: daysFromNow(245),
    },
  });
}

/** Writes a real PDF to local storage and records the Document row. */
async function createDocument(
  prisma: PrismaClient,
  input: {
    ownerType: 'DRIVER' | 'TRUCK' | 'ORGANIZATION' | 'USER' | 'TRIP' | 'ORDER';
    ownerId: string;
    organizationId: string;
    documentType: string;
    title: string;
    documentNumber: string;
    issueDate: Date;
    expiryDate: Date | null;
    verificationStatus: 'PENDING_VERIFICATION' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';
    uploadedById: string;
    verifiedById?: string;
    rejectionReason?: string;
    detailLines?: string[];
  },
): Promise<{ id: string }> {
  const buffer = buildDemoPdf(input.title, [
    `Document number: ${input.documentNumber}`,
    `Issued: ${input.issueDate.toISOString().slice(0, 10)}`,
    `Expires: ${input.expiryDate ? input.expiryDate.toISOString().slice(0, 10) : 'Not applicable'}`,
    ...(input.detailLines ?? []),
  ]);

  const prefix = `documents/${input.ownerType.toLowerCase()}/${input.ownerId}`;
  const fileName = `${input.documentType.toLowerCase()}.pdf`;
  const storageKey = path.posix.join(prefix, `${Date.now().toString(36)}-${Math.floor(random() * 1e9).toString(16)}.pdf`);

  const destination = path.join(STORAGE_ROOT, storageKey);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer);

  const document = await prisma.document.create({
    data: {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      documentType: input.documentType,
      documentNumber: input.documentNumber,
      title: input.title,
      issueDate: input.issueDate,
      expiryDate: input.expiryDate,
      storageKey,
      fileName,
      mimeType: 'application/pdf',
      fileSize: buffer.byteLength,
      checksum: checksumOf(buffer),
      verificationStatus: input.verificationStatus,
      rejectionReason: input.rejectionReason ?? null,
      verifiedById: input.verificationStatus === 'VERIFIED' ? (input.verifiedById ?? null) : null,
      verifiedAt: input.verificationStatus === 'VERIFIED' ? daysAgo(between(5, 60)) : null,
      uploadedById: input.uploadedById,
      currentVersion: 1,
      versions: {
        create: {
          versionNumber: 1,
          storageKey,
          fileName,
          mimeType: 'application/pdf',
          fileSize: buffer.byteLength,
          checksum: checksumOf(buffer),
          uploadedById: input.uploadedById,
          note: 'Initial upload',
        },
      },
    },
    select: { id: true },
  });

  return document;
}

// ---------------------------------------------------------------------------
// Reference values
// ---------------------------------------------------------------------------

const TRUCK_MODELS = [
  { manufacturer: 'Tata Motors', model: 'Signa 4825.TK', capacity: 25, type: 'MULTI_AXLE' as const },
  { manufacturer: 'Tata Motors', model: 'LPT 1618', capacity: 16, type: 'OPEN_BODY' as const },
  { manufacturer: 'Ashok Leyland', model: '3520 Haulage', capacity: 35, type: 'TRAILER' as const },
  { manufacturer: 'Ashok Leyland', model: 'Ecomet 1215', capacity: 12, type: 'CLOSED_CONTAINER' as const },
  { manufacturer: 'BharatBenz', model: '2823C', capacity: 28, type: 'TIPPER' as const },
  { manufacturer: 'BharatBenz', model: '1917R', capacity: 19, type: 'OPEN_BODY' as const },
  { manufacturer: 'Eicher', model: 'Pro 6028', capacity: 28, type: 'TIPPER' as const },
  { manufacturer: 'Mahindra', model: 'Blazo X 35', capacity: 35, type: 'TRAILER' as const },
  { manufacturer: 'Volvo', model: 'FM 420', capacity: 40, type: 'FLATBED' as const },
  { manufacturer: 'Tata Motors', model: 'Ultra T.7', capacity: 7, type: 'MINI_TRUCK' as const },
];

const FIRST_NAMES = [
  'Ramesh', 'Suresh', 'Vijay', 'Anil', 'Rakesh', 'Manoj', 'Deepak', 'Sanjay',
  'Prakash', 'Naresh', 'Mukesh', 'Dinesh', 'Ravi', 'Ajay', 'Sunil', 'Harish',
];
const LAST_NAMES = [
  'Kumar', 'Singh', 'Yadav', 'Sharma', 'Verma', 'Gupta', 'Patel', 'Reddy',
  'Chauhan', 'Rathore', 'Meena', 'Jat',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  await clearDemoData(prisma);

  // --- Platform ---------------------------------------------------------
  const platformOrg = await createOrganization(prisma, {
    name: 'Saarthi Platform Operations',
    type: OrganizationType.PLATFORM,
    inviteCode: 'SR-PLTFRM',
    city: 'Bengaluru',
    state: 'Karnataka',
    latitude: 12.9716,
    longitude: 77.5946,
    email: 'ops@saarthi.local',
    phone: '+919800000001',
    registrationNumber: 'U63030KA2026PTC000001',
    description: 'Saarthi platform administration and verification operations.',
  });

  const admin = await createUser(prisma, {
    email: 'admin@saarthi.local',
    phone: '+919800000001',
    firstName: 'Aarav',
    lastName: 'Menon',
    role: RoleName.PLATFORM_ADMIN,
  });
  await addMembership(prisma, admin.id, platformOrg.id, RoleName.PLATFORM_ADMIN);

  // Support actions in the demo history are attributed to the admin rather than
  // a second platform login — the sign-in list is deliberately kept to four.
  const support = admin;

  // --- Fleet A: the primary demo fleet ----------------------------------
  const fleetA = await createOrganization(prisma, {
    name: 'Sharma Transport Company',
    type: OrganizationType.FLEET_OWNER,
    inviteCode: 'SR-SHARMA',
    city: 'New Delhi',
    state: 'Delhi',
    latitude: 28.5355,
    longitude: 77.271,
    email: 'owner@sharmatransport.local',
    phone: '+919810000001',
    registrationNumber: 'U60231DL2018PTC334455',
    description: 'Bulk material haulage across the Delhi-NCR, Rajasthan and UP corridors.',
  });
  await addSubscription(prisma, fleetA.id, PlanTier.INTELLIGENCE);

  const owner = await createUser(prisma, {
    email: 'owner@saarthi.local',
    phone: '+919810000001',
    firstName: 'Rajesh',
    lastName: 'Sharma',
    role: RoleName.FLEET_OWNER,
  });
  await addMembership(prisma, owner.id, fleetA.id, RoleName.FLEET_OWNER);

  // Dispatch and management history is attributed to the fleet owner. The
  // FLEET_MANAGER / DISPATCHER roles still exist and can be granted from
  // Settings → Team; they simply do not get their own demo login.
  const manager = owner;
  const dispatcher = owner;

  // --- Fleet B: proves tenant isolation ---------------------------------
  const fleetB = await createOrganization(prisma, {
    name: 'Verma Logistics',
    type: OrganizationType.FLEET_OWNER,
    inviteCode: 'SR-VERMA',
    city: 'Pune',
    state: 'Maharashtra',
    latitude: 18.7606,
    longitude: 73.8636,
    email: 'owner@vermalogistics.local',
    phone: '+919820000001',
    registrationNumber: 'U60231MH2020PTC112233',
    description: 'Container and project cargo movement on the western corridor.',
  });
  await addSubscription(prisma, fleetB.id, PlanTier.BASIC);

  // Fleet B has no login on purpose: it exists so tenant isolation is
  // demonstrable (its trucks and trips must never appear for Fleet A) and so
  // the marketplace has a competing bidder.

  // --- Supplier ---------------------------------------------------------
  const supplierOrg = await createOrganization(prisma, {
    name: 'Rajasthan Aggregates & Sand Supply',
    type: OrganizationType.SUPPLIER,
    inviteCode: 'SR-RAJAGG',
    city: 'Jaipur',
    state: 'Rajasthan',
    latitude: 26.9124,
    longitude: 75.7873,
    email: 'sales@rajaggregates.local',
    phone: '+919830000001',
    registrationNumber: 'U14200RJ2015PTC098765',
    description: 'Sand, aggregate, gravel and construction material supply across north India.',
  });
  await addSubscription(prisma, supplierOrg.id, PlanTier.PRO);

  // The admin account holds a second membership here rather than there being a
  // fifth login. Signing in as admin@ and switching organization from the
  // sidebar shows the supplier side of the marketplace — and exercises the
  // organization switcher at the same time.
  await addMembership(prisma, admin.id, supplierOrg.id, RoleName.SUPPLIER);
  const supplierUser = admin;

  const supplier = await prisma.supplier.create({
    data: {
      organizationId: supplierOrg.id,
      businessDescription:
        'Family-run quarry and aggregate business operating four yards across Rajasthan since 2015.',
      addressLine: 'Bassi Industrial Area, Phase II',
      city: 'Jaipur',
      state: 'Rajasthan',
      postalCode: '303301',
      latitude: 26.8351,
      longitude: 75.9843,
      contactName: 'Mohan Agarwal',
      contactPhone: '+919830000001',
      verificationStatus: VerificationStatus.VERIFIED,
      rating: 4.4,
      ratingCount: 37,
    },
  });

  const materialSpecs = [
    { name: 'River Sand (Fine)', category: 'Sand', unit: MaterialUnit.TON, price: 1450, qty: 4200 },
    { name: 'M-Sand (Manufactured Sand)', category: 'Sand', unit: MaterialUnit.TON, price: 1180, qty: 6800 },
    { name: '20mm Coarse Aggregate', category: 'Aggregate', unit: MaterialUnit.TON, price: 980, qty: 9500 },
    { name: '10mm Coarse Aggregate', category: 'Aggregate', unit: MaterialUnit.TON, price: 1020, qty: 5100 },
    { name: 'Gravel (40mm)', category: 'Aggregate', unit: MaterialUnit.TON, price: 860, qty: 3300 },
    { name: 'Red Clay Bricks (Class A)', category: 'Bricks', unit: MaterialUnit.PIECE, price: 9.5, qty: 180000 },
    { name: 'Fly Ash Bricks', category: 'Bricks', unit: MaterialUnit.PIECE, price: 7.2, qty: 240000 },
    { name: 'OPC 53 Grade Cement', category: 'Cement', unit: MaterialUnit.BAG, price: 395, qty: 12000 },
  ];

  const materials = [];
  for (const spec of materialSpecs) {
    materials.push(
      await prisma.material.create({
        data: {
          supplierId: supplier.id,
          organizationId: supplierOrg.id,
          name: spec.name,
          category: spec.category,
          description: `${spec.name} sourced from the Bassi quarry, screened and washed to IS standards.`,
          unit: spec.unit,
          pricePerUnit: spec.price,
          availableQuantity: spec.qty,
          minimumOrderQty: spec.unit === MaterialUnit.PIECE ? 5000 : 5,
          status: 'ACTIVE',
          pickupAddress: 'Bassi Industrial Area, Phase II, Jaipur, Rajasthan',
          pickupLatitude: 26.8351,
          pickupLongitude: 75.9843,
        },
      }),
    );
  }

  // --- Customers --------------------------------------------------------
  const customerOrg = await createOrganization(prisma, {
    name: 'Kumar Constructions',
    type: OrganizationType.CUSTOMER,
    inviteCode: 'SR-KUMARC',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4595,
    longitude: 77.0266,
    email: 'projects@kumarconstructions.local',
    phone: '+919840000001',
    registrationNumber: 'U45200HR2012PTC045678',
    description: 'Residential and commercial construction across Delhi-NCR.',
  });
  await addSubscription(prisma, customerOrg.id, PlanTier.BASIC);

  const customerUser = await createUser(prisma, {
    email: 'customer@saarthi.local',
    phone: '+919840000001',
    firstName: 'Vikram',
    lastName: 'Kumar',
    role: RoleName.CUSTOMER,
  });
  await addMembership(prisma, customerUser.id, customerOrg.id, RoleName.CUSTOMER);

  const customer = await prisma.customer.create({
    data: {
      organizationId: customerOrg.id,
      primaryUserId: customerUser.id,
      businessType: 'Construction & Infrastructure',
      addressLine: 'Sector 62, Golf Course Extension Road',
      city: 'Gurugram',
      state: 'Haryana',
      postalCode: '122102',
      latitude: 28.4089,
      longitude: 77.0789,
      verificationStatus: VerificationStatus.VERIFIED,
    },
  });

  const customerOrg2 = await createOrganization(prisma, {
    name: 'Metro Infra Projects',
    type: OrganizationType.CUSTOMER,
    inviteCode: 'SR-METROI',
    city: 'Noida',
    state: 'Uttar Pradesh',
    latitude: 28.5355,
    longitude: 77.391,
    email: 'procurement@metroinfra.local',
    phone: '+919840000002',
    registrationNumber: 'U45201UP2016PTC087654',
    description: 'Metro rail and highway infrastructure contractor.',
  });
  await addSubscription(prisma, customerOrg2.id, PlanTier.BASIC);

  // No login and no membership here either. The orders below reference this
  // user only as their author; access is decided by organizationId, so
  // customer@ still cannot see Metro Infra's orders — which is the point.
  const customerUser2 = customerUser;

  const customer2 = await prisma.customer.create({
    data: {
      organizationId: customerOrg2.id,
      primaryUserId: customerUser2.id,
      businessType: 'Infrastructure',
      addressLine: 'Sector 143, Expressway',
      city: 'Noida',
      state: 'Uttar Pradesh',
      postalCode: '201305',
      latitude: 28.5021,
      longitude: 77.4103,
      verificationStatus: VerificationStatus.VERIFIED,
    },
  });

  // --- Drivers ----------------------------------------------------------
  interface SeededDriver {
    id: string;
    userId: string;
    name: string;
    email: string;
  }

  async function createDriver(
    organizationId: string,
    index: number,
    options: {
      verification?: VerificationStatus;
      licenceExpiryDays?: number;
      emailPrefix: string;
      email?: string;
    },
  ): Promise<SeededDriver> {
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length]!;
    const lastName = LAST_NAMES[(index * 3) % LAST_NAMES.length]!;
    const email = options.email ?? `${options.emailPrefix}${index + 1}@saarthi.local`;
    const user = await createUser(prisma, {
      email,
      phone: `+9198${String(50000000 + index * 137 + (organizationId.charCodeAt(0) % 97) * 1000).slice(0, 8)}`,
      firstName,
      lastName,
      role: RoleName.DRIVER,
    });
    await addMembership(prisma, user.id, organizationId, RoleName.DRIVER);

    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        organizationId,
        licenseNumber: `DL-${String(1420 + index)}-${String(20100000000 + index * 7919)}`,
        licenseExpiryDate: daysFromNow(options.licenceExpiryDays ?? Math.round(between(120, 1400))),
        licenseClass: pick(['HMV', 'HTV', 'HMV + HAZ']),
        experienceYears: Math.round(between(2, 22)),
        dateOfBirth: daysAgo(Math.round(between(28, 52)) * 365),
        bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'O-']),
        emergencyContactName: `${pick(FIRST_NAMES)} ${lastName}`,
        emergencyContactPhone: `+9197${String(60000000 + index * 313).slice(0, 8)}`,
        addressLine: `House ${Math.floor(between(1, 400))}, ${pick(['Model Town', 'Shastri Nagar', 'Gandhi Colony'])}`,
        city: pick(['New Delhi', 'Faridabad', 'Rewari', 'Alwar', 'Jaipur']),
        state: pick(['Delhi', 'Haryana', 'Rajasthan']),
        postalCode: String(Math.floor(between(110001, 302099))),
        verificationStatus: options.verification ?? VerificationStatus.VERIFIED,
        availability: 'AVAILABLE',
      },
    });

    return { id: driver.id, userId: user.id, name: `${firstName} ${lastName}`, email };
  }

  const driversA: SeededDriver[] = [];
  for (let index = 0; index < 6; index += 1) {
    driversA.push(
      await createDriver(fleetA.id, index, {
        emailPrefix: 'driver',
        // The first driver is the advertised demo login; the rest are fleet
        // records — a Driver row needs a User row, so they exist as staff.
        ...(index === 0 ? { email: 'driver@saarthi.local' } : {}),
        // One driver is still pending verification, one licence expires soon.
        verification: index === 5 ? VerificationStatus.SUBMITTED : VerificationStatus.VERIFIED,
        licenceExpiryDays: index === 4 ? 18 : undefined,
      }),
    );
  }

  const driversB: SeededDriver[] = [];
  for (let index = 0; index < 3; index += 1) {
    driversB.push(await createDriver(fleetB.id, index + 20, { emailPrefix: 'vdriver' }));
  }

  // --- Trucks -----------------------------------------------------------
  interface SeededTruck {
    id: string;
    registrationNumber: string;
    capacityTons: number;
    organizationId: string;
  }

  async function createTruck(
    organizationId: string,
    index: number,
    plate: string,
    origin: { latitude: number; longitude: number },
    options: { status?: string; verification?: VerificationStatus } = {},
  ): Promise<SeededTruck> {
    const spec = TRUCK_MODELS[index % TRUCK_MODELS.length]!;
    const truck = await prisma.truck.create({
      data: {
        organizationId,
        registrationNumber: plate,
        truckType: spec.type,
        manufacturer: spec.manufacturer,
        model: spec.model,
        year: 2016 + Math.round(between(0, 9)),
        capacityTons: spec.capacity,
        fuelType: 'DIESEL',
        fuelEfficiency: Number(between(28, 42).toFixed(1)),
        odometerKm: Math.round(between(45_000, 420_000)),
        status: (options.status ?? 'AVAILABLE') as never,
        verificationStatus: options.verification ?? VerificationStatus.VERIFIED,
        lastLatitude: origin.latitude + between(-0.08, 0.08),
        lastLongitude: origin.longitude + between(-0.08, 0.08),
        lastSpeedKph: 0,
        lastHeading: Math.round(between(0, 359)),
        lastLocationAt: daysAgo(between(0, 0.4)),
        shareLocation: true,
      },
    });
    return {
      id: truck.id,
      registrationNumber: truck.registrationNumber,
      capacityTons: truck.capacityTons,
      organizationId,
    };
  }

  const plateSeriesA = [
    'DL01AB1234', 'DL01AB5678', 'HR26CD4321', 'HR26CD8765',
    'RJ14EF1122', 'RJ14EF3344', 'UP16GH5566', 'UP16GH7788',
  ];
  const trucksA: SeededTruck[] = [];
  for (const [index, plate] of plateSeriesA.entries()) {
    trucksA.push(
      await createTruck(
        fleetA.id,
        index,
        plate,
        { latitude: 28.5355, longitude: 77.271 },
        {
          status: index === 6 ? 'MAINTENANCE' : index === 7 ? 'IDLE' : 'AVAILABLE',
          verification: index === 7 ? VerificationStatus.SUBMITTED : VerificationStatus.VERIFIED,
        },
      ),
    );
  }

  const plateSeriesB = ['MH12JK1010', 'MH12JK2020', 'MH14LM3030', 'MH14LM4040'];
  const trucksB: SeededTruck[] = [];
  for (const [index, plate] of plateSeriesB.entries()) {
    trucksB.push(
      await createTruck(fleetB.id, index + 3, plate, { latitude: 18.7606, longitude: 73.8636 }),
    );
  }

  // --- Assignments ------------------------------------------------------
  async function assign(truck: SeededTruck, driver: SeededDriver, organizationId: string) {
    await prisma.truckAssignment.create({
      data: {
        truckId: truck.id,
        driverId: driver.id,
        organizationId,
        status: 'ACTIVE',
        assignedById: owner.id,
        assignedAt: daysAgo(between(30, 200)),
        note: 'Primary assignment',
      },
    });
    await prisma.truck.update({
      where: { id: truck.id },
      data: { currentDriverId: driver.id, status: 'ASSIGNED' },
    });
    await prisma.driver.update({
      where: { id: driver.id },
      data: { currentTruckId: truck.id },
    });
  }

  for (let index = 0; index < 5; index += 1) {
    await assign(trucksA[index]!, driversA[index]!, fleetA.id);
  }
  for (let index = 0; index < 3; index += 1) {
    await assign(trucksB[index]!, driversB[index]!, fleetB.id);
  }

  // --- Documents --------------------------------------------------------
  // Deliberately spread across valid / expiring-soon / expired / rejected so
  // the compliance dashboard has something real to report.
  const truckDocPlan: {
    type: string;
    title: string;
    expiryDays: number | null;
    status: 'VERIFIED' | 'PENDING_VERIFICATION' | 'REJECTED';
  }[] = [
    { type: 'REGISTRATION_CERTIFICATE', title: 'Registration Certificate', expiryDays: 900, status: 'VERIFIED' },
    { type: 'INSURANCE', title: 'Motor Insurance Policy', expiryDays: 120, status: 'VERIFIED' },
    { type: 'FITNESS_CERTIFICATE', title: 'Fitness Certificate', expiryDays: 240, status: 'VERIFIED' },
    { type: 'PERMIT', title: 'National Permit', expiryDays: 400, status: 'VERIFIED' },
    { type: 'POLLUTION_CERTIFICATE', title: 'Pollution Under Control Certificate', expiryDays: 60, status: 'VERIFIED' },
  ];

  for (const [truckIndex, truck] of trucksA.entries()) {
    for (const [docIndex, plan] of truckDocPlan.entries()) {
      // Introduce realistic compliance problems on a couple of trucks.
      let expiryDays = plan.expiryDays;
      let status = plan.status;
      if (truckIndex === 2 && plan.type === 'POLLUTION_CERTIFICATE') expiryDays = -12;
      if (truckIndex === 3 && plan.type === 'INSURANCE') expiryDays = 9;
      if (truckIndex === 5 && plan.type === 'FITNESS_CERTIFICATE') expiryDays = 21;
      if (truckIndex === 7 && docIndex > 2) status = 'PENDING_VERIFICATION';
      if (truckIndex === 6 && plan.type === 'PERMIT') status = 'REJECTED';

      await createDocument(prisma, {
        ownerType: 'TRUCK',
        ownerId: truck.id,
        organizationId: fleetA.id,
        documentType: plan.type,
        title: `${plan.title} — ${truck.registrationNumber}`,
        documentNumber: `${plan.type.slice(0, 3)}${Math.floor(between(100000, 999999))}`,
        issueDate: daysAgo(between(200, 900)),
        expiryDate: expiryDays === null ? null : daysFromNow(expiryDays),
        verificationStatus: status,
        uploadedById: manager.id,
        verifiedById: admin.id,
        rejectionReason:
          status === 'REJECTED' ? 'The uploaded permit is illegible. Please re-upload a clear scan.' : undefined,
        detailLines: [`Vehicle: ${truck.registrationNumber}`, `Operator: ${fleetA.name}`],
      });
    }
  }

  for (const [driverIndex, driver] of driversA.entries()) {
    await createDocument(prisma, {
      ownerType: 'DRIVER',
      ownerId: driver.id,
      organizationId: fleetA.id,
      documentType: 'DRIVING_LICENCE',
      title: `Driving Licence — ${driver.name}`,
      documentNumber: `DL-${String(1420 + driverIndex)}-${String(20100000000 + driverIndex * 7919)}`,
      issueDate: daysAgo(between(500, 2000)),
      expiryDate: driverIndex === 4 ? daysFromNow(18) : daysFromNow(between(200, 1400)),
      verificationStatus: driverIndex === 5 ? 'PENDING_VERIFICATION' : 'VERIFIED',
      uploadedById: driver.userId,
      verifiedById: admin.id,
      detailLines: [`Holder: ${driver.name}`, 'Class: HMV'],
    });

    await createDocument(prisma, {
      ownerType: 'DRIVER',
      ownerId: driver.id,
      organizationId: fleetA.id,
      documentType: 'DRIVER_IDENTITY_PROOF',
      title: `Identity Proof — ${driver.name}`,
      documentNumber: `IDP${Math.floor(between(100000, 999999))}`,
      issueDate: daysAgo(between(800, 3000)),
      expiryDate: null,
      verificationStatus: driverIndex === 5 ? 'PENDING_VERIFICATION' : 'VERIFIED',
      uploadedById: driver.userId,
      verifiedById: admin.id,
    });
  }

  await createDocument(prisma, {
    ownerType: 'ORGANIZATION',
    ownerId: fleetA.id,
    organizationId: fleetA.id,
    documentType: 'BUSINESS_REGISTRATION',
    title: 'Certificate of Incorporation',
    documentNumber: 'U60231DL2018PTC334455',
    issueDate: daysAgo(2600),
    expiryDate: null,
    verificationStatus: 'VERIFIED',
    uploadedById: owner.id,
    verifiedById: admin.id,
  });

  await createDocument(prisma, {
    ownerType: 'ORGANIZATION',
    ownerId: supplierOrg.id,
    organizationId: supplierOrg.id,
    documentType: 'BUSINESS_REGISTRATION',
    title: 'Certificate of Incorporation',
    documentNumber: 'U14200RJ2015PTC098765',
    issueDate: daysAgo(3600),
    expiryDate: null,
    verificationStatus: 'VERIFIED',
    uploadedById: supplierUser.id,
    verifiedById: admin.id,
  });

  // --- Verification cases ------------------------------------------------
  await prisma.verificationCase.create({
    data: {
      subjectType: 'DRIVER',
      subjectId: driversA[5]!.id,
      organizationId: fleetA.id,
      status: VerificationStatus.SUBMITTED,
      submittedById: driversA[5]!.userId,
      submittedAt: daysAgo(2),
      events: {
        create: [
          {
            status: VerificationStatus.PENDING,
            actorUserId: driversA[5]!.userId,
            note: 'Driver profile created.',
            createdAt: daysAgo(3),
          },
          {
            status: VerificationStatus.SUBMITTED,
            actorUserId: driversA[5]!.userId,
            note: 'Licence and identity proof submitted for review.',
            createdAt: daysAgo(2),
          },
        ],
      },
    },
  });

  await prisma.verificationCase.create({
    data: {
      subjectType: 'TRUCK',
      subjectId: trucksA[7]!.id,
      organizationId: fleetA.id,
      status: VerificationStatus.UNDER_REVIEW,
      submittedById: manager.id,
      submittedAt: daysAgo(4),
      events: {
        create: [
          {
            status: VerificationStatus.SUBMITTED,
            actorUserId: manager.id,
            note: 'Vehicle documents uploaded.',
            createdAt: daysAgo(4),
          },
          {
            status: VerificationStatus.UNDER_REVIEW,
            actorUserId: support.id,
            note: 'Saarthi operations team is reviewing the submission.',
            createdAt: daysAgo(1),
          },
        ],
      },
    },
  });

  await prisma.verificationCase.create({
    data: {
      subjectType: 'ORGANIZATION',
      subjectId: fleetA.id,
      organizationId: fleetA.id,
      status: VerificationStatus.VERIFIED,
      submittedById: owner.id,
      submittedAt: daysAgo(180),
      reviewedById: admin.id,
      reviewedAt: daysAgo(176),
      reviewerNotes: 'Business registration verified against the certificate of incorporation.',
      events: {
        create: [
          { status: VerificationStatus.SUBMITTED, actorUserId: owner.id, createdAt: daysAgo(180) },
          { status: VerificationStatus.VERIFIED, actorUserId: admin.id, createdAt: daysAgo(176) },
        ],
      },
    },
  });

  // --- Maintenance & fuel history ---------------------------------------
  for (const [index, truck] of trucksA.entries()) {
    const services = [
      { type: 'OIL_CHANGE' as const, title: 'Engine oil and filter change', cost: 8500 },
      { type: 'TYRE' as const, title: 'Tyre rotation and alignment', cost: 6200 },
      { type: 'BRAKE' as const, title: 'Brake pad replacement', cost: 11400 },
      { type: 'PREVENTIVE' as const, title: 'Scheduled preventive service', cost: 15800 },
    ];

    for (const [serviceIndex, service] of services.entries()) {
      const completedAt = daysAgo(between(20, 300));
      await prisma.maintenanceRecord.create({
        data: {
          truckId: truck.id,
          organizationId: fleetA.id,
          type: service.type,
          title: service.title,
          description: `${service.title} carried out at an authorised workshop.`,
          odometerKm: Math.round(between(40_000, 400_000)),
          cost: Math.round(service.cost * between(0.8, 1.3)),
          status: 'COMPLETED',
          scheduledAt: new Date(completedAt.getTime() - day),
          startedAt: completedAt,
          completedAt,
          serviceProvider: pick([
            'Tata Motors Authorised Service',
            'Ashok Leyland Service Point',
            'Singh Truck Repair Works',
          ]),
          nextDueAt: daysFromNow(between(20, 160)),
          nextDueOdometerKm: Math.round(between(410_000, 460_000)),
          createdById: manager.id,
          createdAt: completedAt,
        },
      });
      void serviceIndex;
    }

    // One truck is in the workshop right now, one has an overdue service.
    if (index === 6) {
      await prisma.maintenanceRecord.create({
        data: {
          truckId: truck.id,
          organizationId: fleetA.id,
          type: 'ENGINE',
          title: 'Engine overheating diagnosis',
          description: 'Coolant loss reported by the driver; vehicle withdrawn from service.',
          status: 'IN_PROGRESS',
          scheduledAt: daysAgo(3),
          startedAt: daysAgo(2),
          serviceProvider: 'BharatBenz Authorised Workshop',
          cost: 42_000,
          createdById: manager.id,
        },
      });
    }
    if (index === 1) {
      await prisma.maintenanceRecord.create({
        data: {
          truckId: truck.id,
          organizationId: fleetA.id,
          type: 'INSPECTION',
          title: 'Quarterly safety inspection',
          description: 'Routine inspection is past its scheduled date.',
          status: 'SCHEDULED',
          scheduledAt: daysAgo(9),
          nextDueAt: daysAgo(9),
          createdById: manager.id,
        },
      });
    }

  }
  // Fuel is seeded further down, once the trips exist — a fill only makes
  // sense in proportion to the distance the truck actually covered.

  // --- Trips, orders and tracking history --------------------------------
  let orderCounter = 1;
  let tripCounter = 1;
  const orderReference = (): string => `SO-2026-${String(orderCounter++).padStart(5, '0')}`;
  const tripReference = (): string => `TR-2026-${String(tripCounter++).padStart(5, '0')}`;

  interface CompletedTripSpec {
    routeKey: string;
    truckIndex: number;
    driverIndex: number;
    daysAgoStart: number;
    onTime: boolean;
    materialIndex: number;
    quantity: number;
    customerId: string;
    customerOrganizationId: string;
    createdByUserId: string;
  }

  const completedTripSpecs: CompletedTripSpec[] = [
    { routeKey: 'delhi-jaipur', truckIndex: 0, driverIndex: 0, daysAgoStart: 34, onTime: true, materialIndex: 0, quantity: 20, customerId: customer.id, customerOrganizationId: customerOrg.id, createdByUserId: customerUser.id },
    { routeKey: 'delhi-jaipur', truckIndex: 1, driverIndex: 1, daysAgoStart: 29, onTime: true, materialIndex: 2, quantity: 24, customerId: customer.id, customerOrganizationId: customerOrg.id, createdByUserId: customerUser.id },
    { routeKey: 'kanpur-lucknow', truckIndex: 2, driverIndex: 2, daysAgoStart: 25, onTime: false, materialIndex: 1, quantity: 18, customerId: customer2.id, customerOrganizationId: customerOrg2.id, createdByUserId: customerUser2.id },
    { routeKey: 'delhi-jaipur', truckIndex: 3, driverIndex: 3, daysAgoStart: 21, onTime: true, materialIndex: 3, quantity: 22, customerId: customer.id, customerOrganizationId: customerOrg.id, createdByUserId: customerUser.id },
    { routeKey: 'ahmedabad-surat', truckIndex: 4, driverIndex: 4, daysAgoStart: 17, onTime: true, materialIndex: 4, quantity: 26, customerId: customer2.id, customerOrganizationId: customerOrg2.id, createdByUserId: customerUser2.id },
    { routeKey: 'kanpur-lucknow', truckIndex: 0, driverIndex: 0, daysAgoStart: 13, onTime: true, materialIndex: 2, quantity: 25, customerId: customer.id, customerOrganizationId: customerOrg.id, createdByUserId: customerUser.id },
    { routeKey: 'delhi-jaipur', truckIndex: 1, driverIndex: 1, daysAgoStart: 9, onTime: false, materialIndex: 0, quantity: 19, customerId: customer2.id, customerOrganizationId: customerOrg2.id, createdByUserId: customerUser2.id },
    { routeKey: 'delhi-jaipur', truckIndex: 2, driverIndex: 2, daysAgoStart: 5, onTime: true, materialIndex: 5, quantity: 40000, customerId: customer.id, customerOrganizationId: customerOrg.id, createdByUserId: customerUser.id },
  ];

  const driverScoreEvents = new Map<string, AppliedScoreEvent[]>();
  function addScoreEvent(driverId: string, event: AppliedScoreEvent): void {
    const list = driverScoreEvents.get(driverId) ?? [];
    list.push(event);
    driverScoreEvents.set(driverId, list);
  }

  async function writeTrackingHistory(
    route: DemoRoute,
    truckId: string,
    tripId: string,
    driverId: string,
    startedAt: Date,
    durationMinutes: number,
    sampleCount: number,
  ): Promise<void> {
    const totalMeters = pathLength(route.points);
    const samples: {
      truckId: string;
      organizationId: string;
      tripId: string;
      driverId: string;
      latitude: number;
      longitude: number;
      speedKph: number;
      heading: number;
      accuracy: number;
      source: 'MOCK';
      simulated: boolean;
      recordedAt: Date;
    }[] = [];

    for (let index = 0; index <= sampleCount; index += 1) {
      const progress = index / sampleCount;
      const point = pointAtDistance(route.points, totalMeters * progress);
      // Speed tapers at the start and end of the trip, as a real haul does.
      const shape = Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
      const speed = index === 0 || index === sampleCount ? 0 : Math.round(28 + shape * 32 + between(-6, 6));
      samples.push({
        truckId,
        organizationId: fleetA.id,
        tripId,
        driverId,
        latitude: Number(point.position.latitude.toFixed(6)),
        longitude: Number(point.position.longitude.toFixed(6)),
        speedKph: Math.max(0, speed),
        heading: Math.round(point.heading),
        accuracy: Number(between(4, 12).toFixed(1)),
        source: 'MOCK',
        simulated: true,
        recordedAt: new Date(startedAt.getTime() + progress * durationMinutes * 60_000),
      });
    }

    await prisma.truckLocation.createMany({ data: samples });
  }

  for (const spec of completedTripSpecs) {
    const route = routeByKey(spec.routeKey);
    const truck = trucksA[spec.truckIndex]!;
    const driver = driversA[spec.driverIndex]!;
    const material = materials[spec.materialIndex]!;

    const plannedDurationMin = Math.round((route.distanceKm / 45) * 60);
    const actualDurationMin = spec.onTime
      ? Math.round(plannedDurationMin * between(0.9, 1.0))
      : Math.round(plannedDurationMin * between(1.15, 1.35));

    const startedAt = daysAgo(spec.daysAgoStart);
    const plannedArrival = new Date(startedAt.getTime() + plannedDurationMin * 60_000);
    const actualArrival = new Date(startedAt.getTime() + actualDurationMin * 60_000);
    const delayMinutes = Math.max(0, Math.round((actualArrival.getTime() - plannedArrival.getTime()) / 60_000));

    const materialPrice = Number(material.pricePerUnit) * spec.quantity;
    const transportPrice = Math.round(route.distanceKm * between(52, 68) * (spec.quantity > 1000 ? 1 : spec.quantity / 20));

    const trip = await prisma.trip.create({
      data: {
        reference: tripReference(),
        organizationId: fleetA.id,
        truckId: truck.id,
        driverId: driver.id,
        originAddress: route.originName,
        originLatitude: route.points[0]!.latitude,
        originLongitude: route.points[0]!.longitude,
        destinationAddress: route.destinationName,
        destinationLatitude: route.points[route.points.length - 1]!.latitude,
        destinationLongitude: route.points[route.points.length - 1]!.longitude,
        plannedRoute: route.points as never,
        plannedDistanceKm: route.distanceKm,
        actualDistanceKm: Number((route.distanceKm * between(1.0, 1.06)).toFixed(1)),
        plannedDurationMin,
        actualDurationMin,
        plannedStartAt: startedAt,
        actualStartAt: startedAt,
        plannedArrivalAt: plannedArrival,
        actualArrivalAt: actualArrival,
        etaAt: actualArrival,
        delayMinutes,
        status: 'COMPLETED',
        price: transportPrice,
        expenses: Math.round(transportPrice * between(0.55, 0.72)),
        createdById: dispatcher.id,
        createdAt: new Date(startedAt.getTime() - 6 * 3_600_000),
        stops: {
          create: [
            {
              type: 'ORIGIN',
              name: route.originName,
              latitude: route.points[0]!.latitude,
              longitude: route.points[0]!.longitude,
              sequence: 0,
              plannedArrival: startedAt,
              actualArrival: startedAt,
              actualDeparture: new Date(startedAt.getTime() + 45 * 60_000),
              status: 'DEPARTED',
            },
            {
              type: 'DESTINATION',
              name: route.destinationName,
              latitude: route.points[route.points.length - 1]!.latitude,
              longitude: route.points[route.points.length - 1]!.longitude,
              sequence: 1,
              plannedArrival: plannedArrival,
              actualArrival: actualArrival,
              status: 'ARRIVED',
            },
          ],
        },
        events: {
          create: [
            { type: 'CREATED', description: 'Trip created from the accepted order.', createdAt: new Date(startedAt.getTime() - 6 * 3_600_000) },
            { type: 'ASSIGNED', description: `Assigned to ${driver.name} on ${truck.registrationNumber}.`, createdAt: new Date(startedAt.getTime() - 5 * 3_600_000) },
            { type: 'LOADING_STARTED', description: 'Loading started at origin.', createdAt: new Date(startedAt.getTime() - 60 * 60_000) },
            { type: 'DEPARTED', description: 'Departed from origin.', latitude: route.points[0]!.latitude, longitude: route.points[0]!.longitude, createdAt: startedAt },
            ...(spec.onTime
              ? []
              : [{ type: 'DELAY_DETECTED' as const, description: `Running ${delayMinutes} minutes behind the planned arrival.`, createdAt: new Date(startedAt.getTime() + actualDurationMin * 0.7 * 60_000) }]),
            { type: 'ARRIVED', description: 'Arrived at destination.', latitude: route.points[route.points.length - 1]!.latitude, longitude: route.points[route.points.length - 1]!.longitude, createdAt: actualArrival },
            { type: 'COMPLETED', description: 'Delivery completed and trip closed.', createdAt: new Date(actualArrival.getTime() + 40 * 60_000) },
          ],
        },
      },
    });

    await writeTrackingHistory(route, truck.id, trip.id, driver.id, startedAt, actualDurationMin, 60);

    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        customerId: spec.customerId,
        customerOrganizationId: spec.customerOrganizationId,
        materialId: material.id,
        supplierOrganizationId: supplierOrg.id,
        fleetOrganizationId: fleetA.id,
        materialName: material.name,
        quantity: spec.quantity,
        unit: material.unit,
        materialPrice,
        transportPrice,
        totalPrice: materialPrice + transportPrice,
        originAddress: route.originName,
        originLatitude: route.points[0]!.latitude,
        originLongitude: route.points[0]!.longitude,
        destinationAddress: route.destinationName,
        destinationLatitude: route.points[route.points.length - 1]!.latitude,
        destinationLongitude: route.points[route.points.length - 1]!.longitude,
        distanceKm: route.distanceKm,
        requiredCapacityTons: spec.quantity > 1000 ? 20 : spec.quantity,
        pickupAt: startedAt,
        deliverBy: plannedArrival,
        status: 'COMPLETED',
        assignedTruckId: truck.id,
        assignedDriverId: driver.id,
        tripId: trip.id,
        createdById: spec.createdByUserId,
        confirmedAt: new Date(startedAt.getTime() - 8 * 3_600_000),
        deliveredAt: actualArrival,
        completedAt: new Date(actualArrival.getTime() + 60 * 60_000),
        createdAt: new Date(startedAt.getTime() - 12 * 3_600_000),
        events: {
          create: [
            { type: 'CREATED', description: 'Requirement posted by the customer.', createdAt: new Date(startedAt.getTime() - 12 * 3_600_000) },
            { type: 'QUOTE_ADDED', description: `${fleetA.name} quoted this requirement.`, createdAt: new Date(startedAt.getTime() - 10 * 3_600_000) },
            { type: 'QUOTE_ACCEPTED', description: 'Customer accepted the transport quote.', createdAt: new Date(startedAt.getTime() - 8 * 3_600_000) },
            { type: 'TRIP_CREATED', description: `Trip ${trip.reference} created.`, createdAt: new Date(startedAt.getTime() - 6 * 3_600_000) },
            { type: 'IN_TRANSIT', description: 'Truck departed with the consignment.', createdAt: startedAt },
            { type: 'DELIVERED', description: 'Consignment delivered at destination.', createdAt: actualArrival },
            { type: 'COMPLETED', description: 'Order closed.', createdAt: new Date(actualArrival.getTime() + 60 * 60_000) },
          ],
        },
      },
    });

    // Ratings — the two late trips get weaker scores, as they should.
    const ratingValue = spec.onTime ? (random() > 0.4 ? 5 : 4) : random() > 0.5 ? 3 : 2;
    await prisma.orderRating.create({
      data: {
        orderId: order.id,
        driverId: driver.id,
        fleetOrganizationId: fleetA.id,
        supplierOrganizationId: supplierOrg.id,
        rating: ratingValue,
        punctuality: spec.onTime ? 5 : 2,
        communication: spec.onTime ? 5 : 3,
        cargoCondition: 5,
        comment: spec.onTime
          ? 'Delivered on schedule, material in good condition.'
          : 'Delivery arrived later than promised; driver kept us informed.',
        ratedByUserId: spec.createdByUserId,
        createdAt: new Date(actualArrival.getTime() + 2 * 3_600_000),
      },
    });

    addScoreEvent(driver.id, {
      category: 'TIMELINESS',
      points: spec.onTime ? 3 : -4,
      reason: spec.onTime
        ? `Trip ${trip.reference} delivered on time.`
        : `Trip ${trip.reference} arrived ${delayMinutes} minutes late.`,
    });
    addScoreEvent(driver.id, {
      category: 'RELIABILITY',
      points: ratingValue >= 4 ? 4 : -6,
      reason: ratingValue >= 4 ? 'Customer rated the delivery positively.' : 'Customer rated the delivery negatively.',
    });

    await prisma.truck.update({
      where: { id: truck.id },
      data: { odometerKm: { increment: route.distanceKm } },
    });
    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        totalTrips: { increment: 1 },
        totalDistanceKm: { increment: route.distanceKm },
      },
    });

    // --- Fuel for this trip ---------------------------------------------
    // A loaded tipper returns roughly 3.5 km/litre, and trucks deadhead back
    // empty and idle at loading points — so consumption runs above the laden
    // figure. Recording the fill against the trip that burned it is what makes
    // cost-per-km and gross margin mean anything: fuel invented independently
    // of distance produces a fleet that burns diesel it never used.
    const litresConsumed = (route.distanceKm * between(1.25, 1.45)) / between(3.2, 3.9);
    const fills = Math.max(1, Math.round(litresConsumed / 200));
    for (let fill = 0; fill < fills; fill += 1) {
      const litres = Math.round(litresConsumed / fills);
      const price = Number(between(88, 96).toFixed(2));
      await prisma.fuelRecord.create({
        data: {
          truckId: truck.id,
          organizationId: fleetA.id,
          driverId: driver.id,
          quantityLitres: litres,
          pricePerUnit: price,
          totalCost: Number((litres * price).toFixed(2)),
          odometerKm: Math.round(between(40_000, 400_000)),
          stationName: pick([
            'Indian Oil Highway Fuel Station',
            'Bharat Petroleum Truck Point',
            'HP Petrol Pump',
          ]),
          latitude: 28.5355 + between(-1.5, 1.5),
          longitude: 77.271 + between(-1.5, 1.5),
          // Topped up before departure, then again en route on longer runs.
          recordedAt: new Date(
            startedAt.getTime() + (fill / Math.max(1, fills)) * actualDurationMin * 60_000,
          ),
          createdById: manager.id,
        },
      });
    }
  }

  // --- One trip in flight right now --------------------------------------
  const liveRoute = routeByKey('delhi-jaipur');
  const liveTruck = trucksA[3]!;
  const liveDriver = driversA[3]!;
  const liveMaterial = materials[0]!;
  const liveStartedAt = new Date(now - 95 * 60_000);
  const livePlannedDuration = Math.round((liveRoute.distanceKm / 45) * 60);

  const liveTrip = await prisma.trip.create({
    data: {
      reference: tripReference(),
      organizationId: fleetA.id,
      truckId: liveTruck.id,
      driverId: liveDriver.id,
      originAddress: liveRoute.originName,
      originLatitude: liveRoute.points[0]!.latitude,
      originLongitude: liveRoute.points[0]!.longitude,
      destinationAddress: liveRoute.destinationName,
      destinationLatitude: liveRoute.points[liveRoute.points.length - 1]!.latitude,
      destinationLongitude: liveRoute.points[liveRoute.points.length - 1]!.longitude,
      plannedRoute: liveRoute.points as never,
      plannedDistanceKm: liveRoute.distanceKm,
      actualDistanceKm: Number((liveRoute.distanceKm * 0.32).toFixed(1)),
      plannedDurationMin: livePlannedDuration,
      plannedStartAt: liveStartedAt,
      actualStartAt: liveStartedAt,
      plannedArrivalAt: new Date(liveStartedAt.getTime() + livePlannedDuration * 60_000),
      etaAt: new Date(liveStartedAt.getTime() + livePlannedDuration * 60_000),
      status: 'IN_TRANSIT',
      price: Math.round(liveRoute.distanceKm * 61),
      createdById: dispatcher.id,
      createdAt: new Date(liveStartedAt.getTime() - 4 * 3_600_000),
      stops: {
        create: [
          {
            type: 'ORIGIN',
            name: liveRoute.originName,
            latitude: liveRoute.points[0]!.latitude,
            longitude: liveRoute.points[0]!.longitude,
            sequence: 0,
            plannedArrival: liveStartedAt,
            actualArrival: liveStartedAt,
            actualDeparture: liveStartedAt,
            status: 'DEPARTED',
          },
          {
            type: 'DESTINATION',
            name: liveRoute.destinationName,
            latitude: liveRoute.points[liveRoute.points.length - 1]!.latitude,
            longitude: liveRoute.points[liveRoute.points.length - 1]!.longitude,
            sequence: 1,
            plannedArrival: new Date(liveStartedAt.getTime() + livePlannedDuration * 60_000),
            status: 'PENDING',
          },
        ],
      },
      events: {
        create: [
          { type: 'CREATED', description: 'Trip created from the accepted order.', createdAt: new Date(liveStartedAt.getTime() - 4 * 3_600_000) },
          { type: 'ASSIGNED', description: `Assigned to ${liveDriver.name} on ${liveTruck.registrationNumber}.`, createdAt: new Date(liveStartedAt.getTime() - 3 * 3_600_000) },
          { type: 'DEPARTED', description: 'Departed from origin.', latitude: liveRoute.points[0]!.latitude, longitude: liveRoute.points[0]!.longitude, createdAt: liveStartedAt },
        ],
      },
    },
  });

  // Partial tracking trail up to the truck's current position.
  const liveTotalMeters = pathLength(liveRoute.points);
  const liveProgressMeters = liveTotalMeters * 0.32;
  const liveSamples = 40;
  for (let index = 0; index <= liveSamples; index += 1) {
    const point = pointAtDistance(liveRoute.points, (liveProgressMeters * index) / liveSamples);
    await prisma.truckLocation.create({
      data: {
        truckId: liveTruck.id,
        organizationId: fleetA.id,
        tripId: liveTrip.id,
        driverId: liveDriver.id,
        latitude: Number(point.position.latitude.toFixed(6)),
        longitude: Number(point.position.longitude.toFixed(6)),
        speedKph: index === 0 ? 0 : Math.round(between(38, 64)),
        heading: Math.round(point.heading),
        accuracy: Number(between(4, 10).toFixed(1)),
        source: 'MOCK',
        simulated: true,
        recordedAt: new Date(liveStartedAt.getTime() + (index / liveSamples) * 95 * 60_000),
      },
    });
  }

  const livePoint = pointAtDistance(liveRoute.points, liveProgressMeters);
  await prisma.truck.update({
    where: { id: liveTruck.id },
    data: {
      status: 'ON_TRIP',
      currentTripId: liveTrip.id,
      lastLatitude: Number(livePoint.position.latitude.toFixed(6)),
      lastLongitude: Number(livePoint.position.longitude.toFixed(6)),
      lastSpeedKph: 52,
      lastHeading: Math.round(livePoint.heading),
      lastLocationAt: new Date(now - 20_000),
    },
  });
  await prisma.driver.update({ where: { id: liveDriver.id }, data: { availability: 'ON_TRIP' } });

  const liveMaterialPrice = Number(liveMaterial.pricePerUnit) * 22;
  const liveOrder = await prisma.order.create({
    data: {
      reference: orderReference(),
      customerId: customer.id,
      customerOrganizationId: customerOrg.id,
      materialId: liveMaterial.id,
      supplierOrganizationId: supplierOrg.id,
      fleetOrganizationId: fleetA.id,
      materialName: liveMaterial.name,
      quantity: 22,
      unit: liveMaterial.unit,
      materialPrice: liveMaterialPrice,
      transportPrice: Math.round(liveRoute.distanceKm * 61),
      totalPrice: liveMaterialPrice + Math.round(liveRoute.distanceKm * 61),
      originAddress: liveRoute.originName,
      originLatitude: liveRoute.points[0]!.latitude,
      originLongitude: liveRoute.points[0]!.longitude,
      destinationAddress: liveRoute.destinationName,
      destinationLatitude: liveRoute.points[liveRoute.points.length - 1]!.latitude,
      destinationLongitude: liveRoute.points[liveRoute.points.length - 1]!.longitude,
      distanceKm: liveRoute.distanceKm,
      requiredCapacityTons: 22,
      pickupAt: liveStartedAt,
      deliverBy: new Date(liveStartedAt.getTime() + livePlannedDuration * 60_000),
      status: 'IN_TRANSIT',
      assignedTruckId: liveTruck.id,
      assignedDriverId: liveDriver.id,
      tripId: liveTrip.id,
      createdById: customerUser.id,
      confirmedAt: new Date(liveStartedAt.getTime() - 5 * 3_600_000),
      createdAt: new Date(liveStartedAt.getTime() - 8 * 3_600_000),
      events: {
        create: [
          { type: 'CREATED', description: 'Requirement posted by the customer.', createdAt: new Date(liveStartedAt.getTime() - 8 * 3_600_000) },
          { type: 'QUOTE_ACCEPTED', description: 'Customer accepted the transport quote.', createdAt: new Date(liveStartedAt.getTime() - 5 * 3_600_000) },
          { type: 'IN_TRANSIT', description: 'Truck departed with the consignment.', createdAt: liveStartedAt },
        ],
      },
    },
  });

  // --- Open marketplace requirements awaiting quotes ---------------------
  const openRequirements = [
    { material: materials[2]!, quantity: 30, capacity: 30, customerId: customer.id, orgId: customerOrg.id, userId: customerUser.id, origin: 'Bassi Industrial Area, Jaipur', destination: 'Sector 62, Gurugram', originLat: 26.8351, originLng: 75.9843, destLat: 28.4089, destLng: 77.0789, distance: 268 },
    { material: materials[6]!, quantity: 60000, capacity: 25, customerId: customer2.id, orgId: customerOrg2.id, userId: customerUser2.id, origin: 'Bassi Industrial Area, Jaipur', destination: 'Sector 143, Noida', originLat: 26.8351, originLng: 75.9843, destLat: 28.5021, destLng: 77.4103, distance: 295 },
  ];

  const openOrders = [];
  for (const requirement of openRequirements) {
    const order = await prisma.order.create({
      data: {
        reference: orderReference(),
        customerId: requirement.customerId,
        customerOrganizationId: requirement.orgId,
        materialId: requirement.material.id,
        supplierOrganizationId: supplierOrg.id,
        materialName: requirement.material.name,
        quantity: requirement.quantity,
        unit: requirement.material.unit,
        materialPrice: Number(requirement.material.pricePerUnit) * requirement.quantity,
        budget: Math.round(requirement.distance * 70),
        originAddress: requirement.origin,
        originLatitude: requirement.originLat,
        originLongitude: requirement.originLng,
        destinationAddress: requirement.destination,
        destinationLatitude: requirement.destLat,
        destinationLongitude: requirement.destLng,
        distanceKm: requirement.distance,
        requiredCapacityTons: requirement.capacity,
        pickupAt: daysFromNow(2),
        deliverBy: daysFromNow(4),
        status: 'REQUESTED',
        createdById: requirement.userId,
        notes: 'Site access is available between 06:00 and 20:00. Weighbridge slip required at delivery.',
        createdAt: daysAgo(between(0.2, 1.5)),
        events: {
          create: [
            { type: 'CREATED', description: 'Requirement posted by the customer.', createdAt: daysAgo(1) },
          ],
        },
      },
    });
    openOrders.push(order);
  }

  // A competing quote already on the first open requirement.
  await prisma.orderQuote.create({
    data: {
      orderId: openOrders[0]!.id,
      fleetOrganizationId: fleetA.id,
      truckId: trucksA[0]!.id,
      driverId: driversA[0]!.id,
      price: Math.round(268 * 64),
      estimatedPickupAt: daysFromNow(2),
      estimatedArrivalAt: daysFromNow(2.4),
      distanceToPickupKm: 12.4,
      message: 'Verified 25T multi-axle available at the Jaipur yard, driver score 88.',
      status: 'OFFERED',
      expiresAt: daysFromNow(1),
      createdById: dispatcher.id,
    },
  });
  await prisma.order.update({
    where: { id: openOrders[0]!.id },
    data: { status: 'QUOTED' },
  });
  await prisma.orderEvent.create({
    data: {
      orderId: openOrders[0]!.id,
      type: 'QUOTE_ADDED',
      description: `${fleetA.name} quoted this requirement.`,
      createdAt: daysAgo(0.5),
    },
  });

  // --- Driver scores, events and achievements ----------------------------
  for (const driver of [...driversA, ...driversB]) {
    const events = driverScoreEvents.get(driver.id) ?? [];

    // Every driver gets a compliance signal derived from their documents.
    const expiredDocs = await prisma.document.count({
      where: { ownerType: 'DRIVER', ownerId: driver.id, expiryDate: { lt: new Date() } },
    });
    if (expiredDocs > 0) {
      events.push({
        category: 'COMPLIANCE',
        points: -10,
        reason: 'A mandatory document was allowed to expire.',
      });
    } else {
      events.push({
        category: 'COMPLIANCE',
        points: 5,
        reason: 'All mandatory documents are valid and verified.',
      });
    }

    // A couple of safety events so the safety dimension is not uniformly full.
    if (driversA.indexOf(driver) === 2) {
      events.push({ category: 'SAFETY', points: -5, reason: 'Recorded speed exceeded the configured safe limit.' });
      events.push({ category: 'SAFETY', points: -2, reason: 'Harsh braking detected during the trip.' });
    }
    if (driversA.indexOf(driver) === 0) {
      events.push({ category: 'VEHICLE_CARE', points: 3, reason: 'Driver proactively reported a vehicle issue.' });
      events.push({ category: 'SAFETY', points: 6, reason: 'Driver responded to another Saarthi driver in an emergency.' });
    }

    for (const event of events) {
      await prisma.driverScoreEvent.create({
        data: {
          driverId: driver.id,
          eventType:
            event.points > 0
              ? event.category === 'TIMELINESS'
                ? 'TRIP_COMPLETED_ON_TIME'
                : event.category === 'COMPLIANCE'
                  ? 'DOCUMENT_RENEWED'
                  : event.category === 'VEHICLE_CARE'
                    ? 'MAINTENANCE_REPORTED'
                    : event.category === 'SAFETY'
                      ? 'SOS_ASSISTANCE_PROVIDED'
                      : 'CUSTOMER_POSITIVE_RATING'
              : event.category === 'TIMELINESS'
                ? 'TRIP_COMPLETED_LATE'
                : event.category === 'COMPLIANCE'
                  ? 'DOCUMENT_EXPIRED'
                  : event.category === 'SAFETY'
                    ? 'SPEED_VIOLATION'
                    : 'CUSTOMER_NEGATIVE_RATING',
          category: event.category,
          points: event.points,
          reason: event.reason,
          createdAt: daysAgo(between(1, 40)),
        },
      });
    }

    const categories = computeCategoryScores(events, DEFAULT_SCORING_CONFIG);
    const overall = computeOverallScore(categories, DEFAULT_SCORING_CONFIG);

    await prisma.driverScore.create({
      data: {
        driverId: driver.id,
        overallScore: overall,
        safetyScore: categories.SAFETY,
        reliabilityScore: categories.RELIABILITY,
        timelinessScore: categories.TIMELINESS,
        complianceScore: categories.COMPLIANCE,
        vehicleCareScore: categories.VEHICLE_CARE,
      },
    });
    await prisma.driver.update({ where: { id: driver.id }, data: { overallScore: overall } });

    const driverRecord = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    if (driverRecord.totalTrips >= 1) {
      await prisma.driverAchievement.create({
        data: { driverId: driver.id, code: 'FIRST_TRIP', earnedAt: daysAgo(30), progress: 1 },
      });
    }
    if (categories.COMPLIANCE >= 95) {
      await prisma.driverAchievement.create({
        data: { driverId: driver.id, code: 'DOCUMENT_PERFECT', earnedAt: daysAgo(10), progress: 1 },
      });
    }
  }

  // --- A resolved SOS incident, so the safety history is not empty --------
  const sosPoint = pointAtDistance(liveRoute.points, pathLength(liveRoute.points) * 0.55);
  const sosIncident = await prisma.sosIncident.create({
    data: {
      reference: 'SOS-2026-00001',
      organizationId: fleetA.id,
      driverId: driversA[1]!.id,
      truckId: trucksA[1]!.id,
      triggeredByUserId: driversA[1]!.userId,
      type: 'TYRE',
      status: 'RESOLVED',
      latitude: Number(sosPoint.position.latitude.toFixed(6)),
      longitude: Number(sosPoint.position.longitude.toFixed(6)),
      address: 'NH48, near Shahjahanpur toll plaza',
      description: 'Rear left tyre blowout. Vehicle safely parked on the shoulder.',
      searchRadiusMeters: 10_000,
      contactPhone: '+919810000002',
      acknowledgedAt: daysAgo(11.9),
      assignedAt: daysAgo(11.88),
      arrivedAt: daysAgo(11.82),
      resolvedAt: daysAgo(11.7),
      resolvedByUserId: manager.id,
      resolutionNote: 'Spare tyre fitted with assistance from a nearby Saarthi truck. Trip resumed.',
      triggeredAt: daysAgo(12),
      responders: {
        create: [
          {
            truckId: trucksA[0]!.id,
            driverId: driversA[0]!.id,
            organizationId: fleetA.id,
            distanceKm: 6.8,
            status: 'COMPLETED',
            notifiedAt: daysAgo(11.95),
            acknowledgedAt: daysAgo(11.9),
            arrivedAt: daysAgo(11.82),
            completedAt: daysAgo(11.7),
            note: 'Carried a spare and assisted with the change.',
          },
          {
            truckId: trucksA[2]!.id,
            driverId: driversA[2]!.id,
            organizationId: fleetA.id,
            distanceKm: 18.2,
            status: 'DECLINED',
            notifiedAt: daysAgo(11.95),
            declinedAt: daysAgo(11.92),
            note: 'On a time-critical delivery.',
          },
        ],
      },
      events: {
        create: [
          { eventType: 'TRIGGERED', description: 'Driver raised a tyre emergency.', createdAt: daysAgo(12) },
          { eventType: 'BROADCAST_STARTED', description: 'Broadcasting to nearby Saarthi trucks within 10 km.', createdAt: daysAgo(11.97) },
          { eventType: 'RESPONDER_NOTIFIED', description: '2 nearby trucks notified.', createdAt: daysAgo(11.95) },
          { eventType: 'RESPONDER_ACKNOWLEDGED', description: 'Ramesh Kumar acknowledged and is en route.', createdAt: daysAgo(11.9) },
          { eventType: 'HELP_ASSIGNED', description: 'Assistance assigned.', createdAt: daysAgo(11.88) },
          { eventType: 'ASSISTANCE_ARRIVED', description: 'Responder reached the incident location.', createdAt: daysAgo(11.82) },
          { eventType: 'RESOLVED', description: 'Incident resolved; vehicle back in service.', createdAt: daysAgo(11.7) },
        ],
      },
    },
  });

  // --- Notifications ------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      {
        userId: owner.id,
        organizationId: fleetA.id,
        type: 'DOCUMENT_EXPIRING',
        title: 'Documents expiring soon',
        body: 'Insurance for HR26CD8765 expires in 9 days and the PUC for HR26CD4321 has already expired.',
        priority: 'HIGH',
        actionUrl: '/fleet/documents?filter=expiring',
        createdAt: daysAgo(0.5),
      },
      {
        userId: owner.id,
        organizationId: fleetA.id,
        type: 'MAINTENANCE_OVERDUE',
        title: 'Maintenance overdue',
        body: 'The quarterly safety inspection for DL01AB5678 is 9 days past its scheduled date.',
        priority: 'HIGH',
        actionUrl: '/fleet/maintenance',
        createdAt: daysAgo(0.9),
      },
      {
        userId: owner.id,
        organizationId: fleetA.id,
        type: 'ORDER_CREATED',
        title: 'New requirement matching your fleet',
        body: 'Kumar Constructions posted a 30T aggregate movement from Jaipur to Gurugram.',
        priority: 'NORMAL',
        actionUrl: '/marketplace/requirements',
        createdAt: daysAgo(1),
      },
      {
        userId: customerUser.id,
        organizationId: customerOrg.id,
        type: 'TRIP_STARTED',
        title: 'Your delivery is on the way',
        body: `${liveOrder.reference}: the truck has departed Jaipur and is en route to your site.`,
        priority: 'NORMAL',
        actionUrl: `/orders/${liveOrder.id}`,
        createdAt: new Date(liveStartedAt.getTime()),
      },
      {
        userId: driversA[3]!.userId,
        organizationId: fleetA.id,
        type: 'TRIP_ASSIGNED',
        title: 'Trip assigned',
        body: `${liveTrip.reference}: Delhi to Jaipur, 22T river sand.`,
        priority: 'HIGH',
        actionUrl: `/driver/trips/${liveTrip.id}`,
        createdAt: new Date(liveStartedAt.getTime() - 3 * 3_600_000),
      },
      {
        userId: supplierUser.id,
        organizationId: supplierOrg.id,
        type: 'ORDER_UPDATED',
        title: 'Order dispatched',
        body: `${liveOrder.reference}: 22T of river sand collected from the Bassi yard.`,
        priority: 'NORMAL',
        actionUrl: `/orders/${liveOrder.id}`,
        createdAt: liveStartedAt,
      },
      {
        userId: admin.id,
        organizationId: platformOrg.id,
        type: 'VERIFICATION_RESULT',
        title: 'Verification queue',
        body: '2 submissions are waiting for review: 1 driver and 1 vehicle.',
        priority: 'NORMAL',
        actionUrl: '/admin/verification',
        createdAt: daysAgo(0.2),
      },
    ],
  });

  // --- Nearby POI dataset --------------------------------------------------
  const placeCount = await seedNearbyPlaces(prisma);

  // --- Summary -------------------------------------------------------------
  const counts = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    trucks: await prisma.truck.count(),
    drivers: await prisma.driver.count(),
    materials: await prisma.material.count(),
    orders: await prisma.order.count(),
    trips: await prisma.trip.count(),
    documents: await prisma.document.count(),
    locations: await prisma.truckLocation.count(),
    nearbyPlaces: placeCount,
    sosIncidents: await prisma.sosIncident.count(),
  };

  console.log('  ✓ demo dataset created');
  console.table(counts);
  console.log(`
  Four demo accounts — all use the password: ${DEMO_PASSWORD}

    Platform admin   admin@saarthi.local      verification queue, audit, org list
                                              (switch org → acts as the supplier)
    Fleet owner      owner@saarthi.local      fleet, trips, live map, simulator, AI
    Driver           driver@saarthi.local     driver app, SOS, safety score
    Customer         customer@saarthi.local   marketplace, orders, live tracking

  Registration is open at /register — a new organization gets a 14-day Pro trial
  and starts empty, so the app is fully usable without this demo data.
`);

  void sosIncident;
  void cumulativeDistances;
  void bearing;
  void DEMO_ROUTES;
}

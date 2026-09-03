import type { FastifyInstance } from 'fastify';
import {
  MembershipStatus,
  OrganizationType,
  PlanTier,
  type RoleName,
  SubscriptionStatus,
  VerificationStatus,
  type SessionPayload,
} from '@saarthi/shared';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/server/app';
import { prisma } from '../src/database/prisma';

/**
 * Shared test utilities: a booted app instance, tenant/user factories and a
 * fast truncate between test files. Everything here talks to the real
 * PostgreSQL test database — nothing is stubbed, so the tests exercise the
 * same code paths production will.
 */

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
  await prisma.$disconnect();
}

/** Truncate every operational table, keeping reference data intact. */
/**
 * Refuse to touch a database that is not a test database.
 *
 * `resetDatabase` truncates every table. The only thing that made that safe was
 * `setup.ts` rewriting DATABASE_URL to `saarthi_test` — a single string
 * substitution, with nothing verifying it had worked.
 *
 * It stopped working once two PostgreSQL servers were listening on the same
 * port: connections landed on whichever answered first, and a developer's
 * database was truncated by a test run. Recovering that is not possible, so the
 * cost of being wrong here is unbounded and the check has to be a hard
 * precondition rather than a convention.
 *
 * Asserted against the *live connection* rather than the environment variable,
 * because the whole class of failure is the two disagreeing.
 */
let verifiedTestDatabase = false;

async function assertTestDatabase(): Promise<void> {
  if (verifiedTestDatabase) return;

  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const name = row?.db ?? '(unknown)';

  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests: connected to database "${name}", which is not a test database.\n` +
        `\n` +
        `resetDatabase() truncates every table, so this would destroy real data.\n` +
        `\n` +
        `Most likely cause: something else is listening on the database port — for\n` +
        `example a Docker postgres container alongside a native server — so the\n` +
        `connection did not reach the server the URL names. Check with:\n` +
        `  docker ps --filter name=postgres\n`,
    );
  }

  verifiedTestDatabase = true;
}

export async function resetDatabase(): Promise<void> {
  await assertTestDatabase();

  const tables = [
    'sos_events',
    'sos_responders',
    'sos_incidents',
    'ai_messages',
    'ai_conversations',
    'ai_insights',
    'ai_usage',
    'simulations',
    'requirement_events',
    'requirement_bids',
    'requirements',
    'order_ratings',
    'order_events',
    'order_quotes',
    'orders',
    'trip_stops',
    'trip_events',
    'trips',
    'truck_locations',
    'truck_events',
    'toll_transactions',
    'fastag_accounts',
    'fuel_records',
    'loan_reminders',
    'loan_events',
    'loan_payments',
    'loan_installments',
    'vehicle_loans',
    'maintenance_records',
    'truck_assignments',
    'trucks',
    'driver_achievements',
    'driver_score_events',
    'driver_scores',
    'drivers',
    'verification_events',
    'verification_documents',
    'verification_cases',
    'document_versions',
    'documents',
    'materials',
    'suppliers',
    'customers',
    'nearby_places',
    'petrol_stations',
    'vehicle_lookups',
    'licence_lookups',
    // Mobility expansion. CASCADE would reach most of these through their
    // organization FK, but listing them keeps the reset explicit and means a
    // table that later loses its FK does not silently start leaking between
    // test files.
    'telemetry_diagnostic_codes',
    'telemetry_alerts',
    'telemetry_readings',
    'telemetry_alert_rules',
    'geofences',
    'mock_device_runs',
    'video_stream_sessions',
    'device_cameras',
    'device_events',
    'device_commands',
    'device_pairing_tokens',
    'device_enrolments',
    'device_assignments',
    'hardware_devices',
    'travel_reviews',
    'payments',
    'travel_booking_events',
    'travel_bookings',
    'travel_itinerary_days',
    'travel_packages',
    'provider_service_areas',
    'service_provider_profiles',
    'association_responders',
    'association_alert_events',
    'association_alerts',
    'association_coverage_areas',
    'association_profiles',
    // Batch-2 expansion. Listed for the same reason as the mobility tables:
    // most would be reached by CASCADE, but an explicit list means a table that
    // later loses its FK cannot silently start leaking between test files.
    'trip_hazard_alerts',
    'route_hazard_reports',
    'route_hazards',
    'relay_events',
    'relay_offers',
    'relay_deliveries',
    'last_mile_partners',
    'transfer_hubs',
    'city_access_restrictions',
    'return_load_matches',
    'return_load_requests',
    'qr_scans',
    'qr_codes',
    'qr_privacy_policies',
    'organization_profiles',
    'user_profiles',
    'vehicle_transfers',
    'vehicle_listing_watches',
    'vehicle_listing_events',
    'vehicle_inspection_requests',
    'vehicle_listing_offers',
    'vehicle_listings',
    'material_price_tiers',
    'stock_reservations',
    'stock_movements',
    'stock_items',
    'inventory_locations',
    'media_assets',
    'notification_deliveries',
    'notification_preferences',
    'notifications',
    'audit_logs',
    'password_reset_tokens',
    'sessions',
    'vehicle_subscription_topups',
    'subscriptions',
    'memberships',
    'user_view_preferences',
    'user_roles',
    'users',
    'organizations',
  ];
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export const TEST_PASSWORD = 'TestPass123!';

let uniqueCounter = 0;
export function unique(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}${Date.now().toString(36)}${uniqueCounter}`;
}

export function uniquePhone(): string {
  uniqueCounter += 1;
  const suffix = String(1000000 + (uniqueCounter % 8999999)).padStart(7, '0');
  return `+919${String(Date.now() % 100).padStart(2, '0')}${suffix}`;
}

export interface TestOrganization {
  id: string;
  name: string;
  inviteCode: string;
}

export async function createOrganization(
  type: OrganizationType = OrganizationType.FLEET_OWNER,
  tier: PlanTier = PlanTier.INTELLIGENCE,
): Promise<TestOrganization> {
  const organization = await prisma.organization.create({
    data: {
      name: unique('Test Org '),
      type,
      inviteCode: unique('SR-T').toUpperCase().slice(0, 12),
      verificationStatus: VerificationStatus.VERIFIED,
      city: 'New Delhi',
      state: 'Delhi',
      latitude: 28.6139,
      longitude: 77.209,
    },
  });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { tier } });
  if (plan) {
    await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });
  }

  if (type === OrganizationType.SUPPLIER) {
    await prisma.supplier.create({
      data: { organizationId: organization.id, verificationStatus: VerificationStatus.VERIFIED },
    });
  }
  if (type === OrganizationType.CUSTOMER) {
    await prisma.customer.create({
      data: { organizationId: organization.id, verificationStatus: VerificationStatus.VERIFIED },
    });
  }

  return { id: organization.id, name: organization.name, inviteCode: organization.inviteCode };
}

export interface TestUser {
  id: string;
  email: string;
  organizationId: string | null;
  accessToken: string;
  driverId?: string;
}

/** Create a user with a role, membership and a signed-in session. */
export async function createUser(options: {
  role: RoleName;
  organizationId?: string | null;
  driver?: boolean;
}): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: options.role } });
  const email = `${unique('user')}@test.local`;

  const user = await prisma.user.create({
    data: {
      email,
      phone: uniquePhone(),
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      firstName: 'Test',
      lastName: 'User',
      status: 'ACTIVE',
      roles: { create: { roleId: role.id } },
    },
  });

  if (options.organizationId) {
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: options.organizationId,
        role: options.role,
        status: MembershipStatus.ACTIVE,
        isPrimary: true,
      },
    });
  }

  let driverId: string | undefined;
  if (options.driver && options.organizationId) {
    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        organizationId: options.organizationId,
        licenseNumber: unique('DL-'),
        licenseExpiryDate: new Date(Date.now() + 365 * 86_400_000),
        verificationStatus: VerificationStatus.VERIFIED,
      },
    });
    driverId = driver.id;
  }

  const instance = await getApp();
  const response = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: TEST_PASSWORD },
  });

  const body = response.json() as { data: { accessToken: string } };

  return {
    id: user.id,
    email,
    organizationId: options.organizationId ?? null,
    accessToken: body.data.accessToken,
    ...(driverId ? { driverId } : {}),
  };
}

export function authHeaders(user: TestUser): Record<string, string> {
  return { authorization: `Bearer ${user.accessToken}` };
}

/** Convenience: perform an authenticated request and return the parsed body. */
export async function request<T = unknown>(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  user?: TestUser;
  payload?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: { success: boolean; data: T; error?: { code: string; message: string } } }> {
  const instance = await getApp();
  const response = await instance.inject({
    method: options.method,
    url: options.url,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    headers: {
      ...(options.user ? authHeaders(options.user) : {}),
      ...options.headers,
    },
  });

  return {
    status: response.statusCode,
    body: response.json() as {
      success: boolean;
      data: T;
      error?: { code: string; message: string };
    },
  };
}

/**
 * A request whose body is not JSON.
 *
 * `request` above parses every response, which is right for an API and wrong
 * for the handful of endpoints that stream bytes — a QR image, a document, a
 * driver's arrival photo. Those need the status and the headers, and parsing
 * their body throws before a test can assert anything about either.
 */
export async function requestRaw(options: {
  method: 'GET' | 'POST';
  url: string;
  user?: TestUser;
  headers?: Record<string, string>;
}): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  const instance = await getApp();
  const response = await instance.inject({
    method: options.method,
    url: options.url,
    headers: {
      ...(options.user ? authHeaders(options.user) : {}),
      ...options.headers,
    },
  });

  return {
    status: response.statusCode,
    headers: response.headers as Record<string, unknown>,
    body: response.rawPayload,
  };
}

export interface MultipartFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  content: Buffer;
}

/**
 * Build a multipart/form-data body by hand so upload routes can be exercised
 * end-to-end through `app.inject` without an extra dependency.
 *
 * Takes a *list* of files. It used to take exactly one, which is why a bug
 * where the server aborted the second file part went unnoticed until a driver
 * tried to upload an arrival photo: the browser sends the photo and its
 * thumbnail, and no test could express that shape.
 */
export function multipart(
  fields: Record<string, string>,
  file?: MultipartFile | MultipartFile[],
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----saarthitest${Date.now().toString(16)}`;
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  const files = file === undefined ? [] : Array.isArray(file) ? file : [file];
  for (const part of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.fieldName}"; filename="${part.fileName}"\r\n` +
          `Content-Type: ${part.contentType}\r\n\r\n`,
      ),
      part.content,
      Buffer.from('\r\n'),
    );
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * The smallest bytes that sniff as a JPEG.
 *
 * Uploads are typed by content, never by the declared header, so a test image
 * has to start with a real SOI marker. Nothing beyond it needs to decode: the
 * media library stores the bytes and does not render them.
 */
export function sampleJpeg(sizeBytes = 512): Buffer {
  const body = Buffer.alloc(Math.max(0, sizeBytes - 4), 0x20);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body]);
}

/** A small but structurally valid PDF, for document upload tests. */
export function samplePdf(title = 'Test Document'): Buffer {
  const content = `BT /F1 14 Tf 60 760 Td (${title}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

export type { SessionPayload };

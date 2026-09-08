import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationType, RoleName, VerificationStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Verification against the issuing registry — integration tests.
 *
 * Every outbound call is stubbed, so the suite never spends a paid provider
 * lookup. `fetch` is the only seam, which means these exercise the real route,
 * guards, lookup service, cache, normaliser, evaluation rules and the case
 * that gets written — the whole path an owner's click takes.
 *
 * The cases that matter most are the ones where the two halves could disagree:
 * a registry answer must always settle the subject's own status, and a
 * registry *outage* must never touch it.
 */

/**
 * Every subject gets its own number.
 *
 * A truck's registration is globally unique and a driver's licence is unique
 * per organization, so tests that shared one plate would collide as soon as
 * there were two of them. The stubs echo whichever number they were asked
 * about, which is also what the real provider does — and what the mismatch
 * rule depends on.
 */
let sequence = 0;
function nextPlate(): string {
  sequence += 1;
  return `UP32AB${String(1000 + sequence).slice(0, 4)}`;
}
function nextLicence(): string {
  sequence += 1;
  return `UP32201400${String(10000 + sequence)}`;
}

let fleet: TestOrganization;
let otherFleet: TestOrganization;
let owner: TestUser;
let dispatcher: TestUser;
let platformAdmin: TestUser;

// ---------------------------------------------------------------------------
// Provider envelopes
// ---------------------------------------------------------------------------

function rcEnvelope(plate: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'SUCCESS',
    status_code: 200,
    charged: true,
    success: true,
    message_code: 'OK',
    order_id: 'W2A-RC-1',
    data: {
      order_id: 'W2A-RC-1',
      result: {
        rc_number: plate,
        registration_date: '2022-03-20',
        rc_status: 'ACTIVE',
        owner_name: 'SNEHA MOHANTY',
        vehicle_category: 'HGV',
        vehicle_category_description: 'Goods Carrier',
        maker_description: 'TATA MOTORS LTD',
        maker_model: 'SIGNA 4018.S',
        fuel_type: 'DIESEL',
        registered_at: 'LUCKNOW RTO, Uttar Pradesh',
        vehicle_chasi_number: 'ME1AB1234C5678901',
        vehicle_engine_number: 'G3AB1C234567',
        fit_up_to: '2037-03-19',
        tax_upto: '2037-03-19',
        insurance_upto: '2029-03-18',
        pucc_upto: '2029-11-02',
        blacklist_status: '',
        less_info: false,
        pdf_url: null,
        ...overrides,
      },
    },
  };
}

/** The provider's documented "we have nothing" answer. */
function rcNotFoundEnvelope() {
  return {
    status: 'FAILED',
    status_code: 200,
    charged: false,
    success: false,
    message_code: 'NO_RECORD_FOUND',
    order_id: 'W2A-RC-404',
    data: { order_id: 'W2A-RC-404' },
  };
}

function licenceEnvelope(licence: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'SUCCESS',
    status_code: 200,
    charged: true,
    success: true,
    message_code: 'OK',
    order_id: 'W2A-DL-1',
    data: {
      order_id: 'W2A-DL-1',
      result: {
        license_number: licence,
        state: 'Uttar Pradesh',
        name: 'RAMESH KUMAR',
        dob: '1988-03-14',
        ola_name: 'RTO LUCKNOW',
        ola_code: 'UP32',
        doi: '2014-05-20',
        doe: '2034-05-19',
        transport_doi: '2015-01-10',
        transport_doe: '2028-01-09',
        vehicle_classes: ['LMV-NT', 'HGMV'],
        has_image: true,
        less_info: false,
        ...overrides,
      },
    },
  };
}

function licenceNotFoundEnvelope() {
  return {
    status: 'FAILED',
    status_code: 200,
    charged: false,
    success: false,
    message_code: 'NO_RECORD_FOUND',
    order_id: 'W2A-DL-404',
    data: { order_id: 'W2A-DL-404' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestedNumber(init: RequestInit | undefined, field: string): string {
  try {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return String(body[field] ?? '');
  } catch {
    return '';
  }
}

/**
 * Answer whichever registry endpoint is called, echoing the number asked about.
 *
 * `rc` and `licence` override the *result* fields rather than the whole
 * envelope, so a test can say "the same record but cancelled" without
 * restating a payload — and without accidentally pinning the plate to a
 * different vehicle than the one under test.
 *
 * Returned so a test can assert the provider was *not* reached, which is the
 * only way to prove a local refusal cost nothing.
 */
function stubRegistry(
  options: {
    rc?: Record<string, unknown>;
    licence?: Record<string, unknown>;
    rcEnvelopeOverride?: unknown;
    licenceEnvelopeOverride?: unknown;
    status?: number;
  } = {},
) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/rc/text-pdf')) {
      return jsonResponse(
        options.rcEnvelopeOverride ??
          rcEnvelope(requestedNumber(init, 'rc_number'), options.rc ?? {}),
        options.status ?? 200,
      );
    }
    if (url.includes('/api/v1/driving-license/verify')) {
      return jsonResponse(
        options.licenceEnvelopeOverride ??
          licenceEnvelope(requestedNumber(init, 'dl_number'), options.licence ?? {}),
        options.status ?? 200,
      );
    }
    // Any RC PDF fetch. The RC route stores its own copy, and a failure there
    // must never cost the caller the record they already have.
    return new Response('not a pdf', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface RegistryResponse {
  outcome: string;
  verified: boolean;
  status: string;
  summary: string;
  reference: string;
  findings: { code: string; severity: string; label: string; detail: string }[];
  registry: { checked: boolean; cached: boolean; details: { label: string; value: string }[] };
  case: { id: string; status: string; rejectionReason: string | null };
  driverChecklist: {
    complete: boolean;
    verifiedCount: number;
    totalCount: number;
    outstanding: string[];
    summary: string;
    items: { key: string; label: string; verified: boolean }[];
  } | null;
}

async function createTruck(organizationId: string, registrationNumber = nextPlate()) {
  return prisma.truck.create({
    data: {
      organizationId,
      registrationNumber,
      truckType: 'TIPPER',
      capacityTons: 25,
      fuelType: 'DIESEL',
      verificationStatus: VerificationStatus.PENDING,
    },
  });
}

async function createDriver(
  organizationId: string,
  data: {
    licenseNumber?: string;
    dateOfBirth?: Date | null;
    /** Confirm the three identity checks up front, to isolate the licence. */
    identityConfirmed?: boolean;
    verificationStatus?: VerificationStatus;
  } = {},
) {
  const user = await createUser({ role: RoleName.DRIVER, organizationId });
  const confirmed = data.identityConfirmed ? new Date('2026-06-01T00:00:00.000Z') : null;
  return prisma.driver.create({
    data: {
      userId: user.id,
      organizationId,
      licenseNumber: data.licenseNumber ?? nextLicence(),
      dateOfBirth: data.dateOfBirth === undefined ? new Date('1988-03-14') : data.dateOfBirth,
      aadhaarVerifiedAt: confirmed,
      panVerifiedAt: confirmed,
      voterIdVerifiedAt: confirmed,
      verificationStatus: data.verificationStatus ?? VerificationStatus.PENDING,
    },
  });
}

function verifyUrl(subjectType: 'truck' | 'driver' | 'organization', id: string): string {
  return `/api/v1/verification/subject/${subjectType}/${id}/registry-verify`;
}

beforeAll(async () => {
  await getApp();
  await resetDatabase();
  fleet = await createOrganization(OrganizationType.FLEET_OWNER);
  otherFleet = await createOrganization(OrganizationType.FLEET_OWNER);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  dispatcher = await createUser({ role: RoleName.DISPATCHER, organizationId: fleet.id });
  // `verification.review` is platform staff only, which is what the reviewer
  // path needs — a fleet cannot approve its own case outside demo mode.
  platformAdmin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  // Each test decides what the registry says, so no stored answer may carry
  // over — a cache hit would silently skip the stub.
  await prisma.vehicleLookup.deleteMany({});
  await prisma.licenceLookup.deleteMany({});
  await cache.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

describe('registry verification — vehicles', () => {
  it('verifies a vehicle the RTO holds an active registration for', async () => {
    stubRegistry();
    const truck = await createTruck(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(200);
    expect(response.body.data.verified).toBe(true);
    expect(response.body.data.outcome).toBe('VERIFIED');
    expect(response.body.data.status).toBe(VerificationStatus.VERIFIED);
    expect(response.body.data.summary).toContain('TATA MOTORS LTD');
    expect(
      response.body.data.findings.filter((finding) => finding.severity === 'BLOCKING'),
    ).toHaveLength(0);

    // Trip assignment reads the truck's own column, so the subject itself has
    // to move — a verified case with a pending truck would be a silent bug.
    const stored = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('returns what the RTO said, so the tick has evidence behind it', async () => {
    stubRegistry();
    const truck = await createTruck(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    const labels = response.body.data.registry.details.map((row) => row.label);
    expect(labels).toContain('Make and model');
    expect(labels).toContain('Registered at');
    expect(response.body.data.registry.checked).toBe(true);
  });

  it('records the decision as a case with an event', async () => {
    stubRegistry();
    const truck = await createTruck(fleet.id);

    await request({ method: 'POST', url: verifyUrl('truck', truck.id), user: owner, payload: {} });

    const verificationCase = await prisma.verificationCase.findFirstOrThrow({
      where: { subjectId: truck.id },
      include: { events: true },
    });
    expect(verificationCase.status).toBe(VerificationStatus.VERIFIED);
    expect(verificationCase.events).toHaveLength(1);
    expect(verificationCase.reviewerNotes).toContain('RTO vehicle register');
  });

  it('rejects a vehicle the RTO has no record of, and says why', async () => {
    stubRegistry({ rcEnvelopeOverride: rcNotFoundEnvelope() });
    const truck = await createTruck(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    // A recorded answer, not a failed request — the caller gets a 200 with the
    // problem in it, because the subject's status did change.
    expect(response.status).toBe(200);
    expect(response.body.data.verified).toBe(false);
    expect(response.body.data.outcome).toBe('NOT_FOUND');
    expect(response.body.data.findings[0]?.code).toBe('RC_NOT_FOUND');
    expect(response.body.data.case.rejectionReason).toBeTruthy();

    const stored = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.REJECTED);
  });

  it('refuses a registration the RTO reports as cancelled', async () => {
    stubRegistry({ rc: { rc_status: 'RC Cancelled' } });
    const truck = await createTruck(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.outcome).toBe('INELIGIBLE');
    expect(response.body.data.verified).toBe(false);
    expect(response.body.data.findings[0]?.code).toBe('RC_STATUS_BARRED');
  });

  it('refuses a record that belongs to a different vehicle', async () => {
    stubRegistry({ rc: { rc_number: 'MH12XY9999' } });
    const truck = await createTruck(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.outcome).toBe('MISMATCH');
    expect(response.body.data.findings[0]?.code).toBe('RC_PLATE_MISMATCH');
  });

  it('still verifies a vehicle with lapsed insurance, and flags it', async () => {
    stubRegistry({ rc: { insurance_upto: '2020-01-31' } });
    const truck = await createTruck(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.verified).toBe(true);
    const advisory = response.body.data.findings.filter(
      (finding) => finding.severity === 'ADVISORY',
    );
    expect(advisory.map((finding) => finding.code)).toContain('RC_INSURANCE_EXPIRED');
  });

  it('spends nothing on a registration number that cannot be real', async () => {
    const fetchMock = stubRegistry();
    // Written straight to the database: the create endpoint would have refused
    // this, but a legacy row can still carry it.
    const truck = await createTruck(fleet.id, 'ABCDEFG');

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.outcome).toBe('INVALID_FORMAT');
    expect(response.body.data.registry.checked).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the vehicle untouched when the registry cannot be reached', async () => {
    stubRegistry({ status: 503 });
    const truck = await createTruck(fleet.id);

    const response = await request({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(503);

    // The whole point: an outage is not evidence about a vehicle, so nothing
    // was recorded and the status is exactly where it was.
    const stored = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.PENDING);
    expect(await prisma.verificationCase.count({ where: { subjectId: truck.id } })).toBe(0);
  });

  it('refuses a vehicle belonging to another organization', async () => {
    stubRegistry();
    const truck = await createTruck(otherFleet.id, 'DL3CAB1234');

    const response = await request({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    // 404 rather than 403 so ids cannot be probed across tenants.
    expect(response.status).toBe(404);

    const stored = await prisma.truck.findUniqueOrThrow({ where: { id: truck.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.PENDING);
  });

  it('refuses a role that may not run a vehicle lookup', async () => {
    stubRegistry();
    const truck = await createTruck(fleet.id);

    // A dispatcher holds `vehicles.lookup` but not `verification.submit`, so
    // the route's own gate is what stops this one.
    const response = await request({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: dispatcher,
      payload: {},
    });

    expect(response.status).toBe(403);
  });

  it('re-verifying uses the stored record rather than paying twice', async () => {
    const fetchMock = stubRegistry();
    const truck = await createTruck(fleet.id);

    await request({ method: 'POST', url: verifyUrl('truck', truck.id), user: owner, payload: {} });
    const rcCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/v1/rc/text-pdf'),
    ).length;

    const second = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('truck', truck.id),
      user: owner,
      payload: {},
    });

    expect(second.body.data.verified).toBe(true);
    expect(second.body.data.registry.cached).toBe(true);
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/v1/rc/text-pdf')).length,
    ).toBe(rcCalls);

    // One subject, one case, however many times it is checked.
    expect(await prisma.verificationCase.count({ where: { subjectId: truck.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

describe('registry verification — drivers', () => {
  it('confirms the licence against the date of birth on file', async () => {
    stubRegistry();
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(200);
    expect(response.body.data.verified).toBe(true);
    expect(response.body.data.outcome).toBe('VERIFIED');

    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.licenceVerifiedAt).not.toBeNull();
  });

  it('does not verify the driver on a confirmed licence alone', async () => {
    stubRegistry();
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    // The licence is confirmed, the driver is not. One of four.
    expect(response.body.data.verified).toBe(true);
    expect(response.body.data.status).toBe(VerificationStatus.PENDING);
    expect(response.body.data.driverChecklist?.complete).toBe(false);
    expect(response.body.data.driverChecklist?.verifiedCount).toBe(1);
    expect(response.body.data.driverChecklist?.outstanding).toEqual([
      'Aadhaar',
      'PAN',
      'Voter ID',
    ]);

    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.PENDING);
  });

  it('verifies the driver when the licence completes the four checks', async () => {
    stubRegistry();
    const driver = await createDriver(fleet.id, { identityConfirmed: true });

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.driverChecklist?.complete).toBe(true);
    expect(response.body.data.status).toBe(VerificationStatus.VERIFIED);

    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.VERIFIED);
  });

  it('clears the licence confirmation when the register contradicts it', async () => {
    stubRegistry({ licence: { doe: '2020-05-19' } });
    const driver = await createDriver(fleet.id, {
      identityConfirmed: true,
      verificationStatus: VerificationStatus.VERIFIED,
    });
    await prisma.driver.update({
      where: { id: driver.id },
      data: { licenceVerifiedAt: new Date('2026-01-01T00:00:00.000Z') },
    });

    await request({ method: 'POST', url: verifyUrl('driver', driver.id), user: owner, payload: {} });

    // An expired licence is not a confirmed one, and a stale confirmation left
    // in place would keep the driver verified on it.
    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.licenceVerifiedAt).toBeNull();
    expect(stored.verificationStatus).toBe(VerificationStatus.REJECTED);
  });

  it('cross-checks the number on the document against the profile, for free', async () => {
    const fetchMock = stubRegistry();
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      // The number a licence upload would carry — belonging to another driver.
      payload: { licenceNumber: 'MH1220100009999' },
    });

    expect(response.body.data.outcome).toBe('MISMATCH');
    expect(response.body.data.findings[0]?.code).toBe('DL_DOCUMENT_NUMBER_MISMATCH');
    expect(response.body.data.registry.checked).toBe(false);
    // Caught before anything billable — the whole reason to compare locally.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the document number when it matches the profile', async () => {
    stubRegistry();
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      // Typed with the separators a licence is printed with.
      payload: { licenceNumber: `${driver.licenseNumber.slice(0, 4)}-${driver.licenseNumber.slice(4)}` },
    });

    expect(response.body.data.verified).toBe(true);
  });

  it('never puts the full licence number in the response', async () => {
    stubRegistry();
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.reference).not.toBe(driver.licenseNumber);
    expect(response.body.data.reference).toContain('•');
  });

  it('asks for a date of birth when the profile has none, as a field error', async () => {
    const fetchMock = stubRegistry();
    const driver = await createDriver(fleet.id, { dateOfBirth: null });

    const response = await request<unknown>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');

    // Named as a field error, not just described in the message — that is what
    // lets the client prompt for exactly this rather than reporting a failure.
    const details = (
      response.body.error as unknown as
        | { details?: { fields?: Record<string, string[]> } }
        | undefined
    )?.details;
    expect(details?.fields).toHaveProperty('dateOfBirth');
    // Refused before the provider, so asking costs nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a date of birth in the request and keeps it once it has worked', async () => {
    stubRegistry();
    const driver = await createDriver(fleet.id, { dateOfBirth: null });

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: { dateOfBirth: '1988-03-14' },
    });

    expect(response.body.data.verified).toBe(true);

    // The register confirmed the licence against this date, which makes it the
    // right one — so the driver is not asked for it a second time.
    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.dateOfBirth?.toISOString().slice(0, 10)).toBe('1988-03-14');
  });

  it('refuses a driver whose licence has expired', async () => {
    stubRegistry({ licence: { doe: '2020-05-19' } });
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.outcome).toBe('INELIGIBLE');
    expect(response.body.data.findings[0]?.code).toBe('DL_EXPIRED');

    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.REJECTED);
  });

  it('rejects a driver the licence register has no record of', async () => {
    stubRegistry({ licenceEnvelopeOverride: licenceNotFoundEnvelope() });
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.outcome).toBe('NOT_FOUND');
    expect(response.body.data.findings[0]?.code).toBe('DL_NOT_FOUND');
  });

  it('still verifies a driver with no commercial class, and flags it', async () => {
    stubRegistry({ licence: { vehicle_classes: ['MCWG', 'LMV-NT'], transport_doe: null } });
    const driver = await createDriver(fleet.id);

    const response = await request<RegistryResponse>({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.body.data.verified).toBe(true);
    expect(response.body.data.findings.map((finding) => finding.code)).toContain(
      'DL_NO_TRANSPORT_CLASS',
    );
  });

  it('refuses a driver on another organization’s roster', async () => {
    stubRegistry();
    const driver = await createDriver(otherFleet.id, { licenseNumber: 'MH1220100009999' });

    const response = await request({
      method: 'POST',
      url: verifyUrl('driver', driver.id),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The four checks
// ---------------------------------------------------------------------------

describe('a driver is verified only once all four checks are confirmed', () => {
  it('reports the checklist on the subject endpoint', async () => {
    const driver = await createDriver(fleet.id);

    const response = await request<{
      driverChecklist: { complete: boolean; totalCount: number; items: { key: string }[] } | null;
    }>({
      method: 'GET',
      url: `/api/v1/verification/subject/driver/${driver.id}`,
      user: owner,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.driverChecklist?.complete).toBe(false);
    expect(response.body.data.driverChecklist?.totalCount).toBe(4);
    expect(response.body.data.driverChecklist?.items.map((item) => item.key)).toEqual([
      'DRIVING_LICENCE',
      'AADHAAR',
      'PAN',
      'VOTER_ID',
    ]);
  });

  it('holds back a reviewer approval while a check is outstanding', async () => {
    stubRegistry({ rcEnvelopeOverride: rcNotFoundEnvelope() });
    const driver = await createDriver(fleet.id);

    // Put a case in front of the reviewer without any check having run.
    await prisma.verificationCase.create({
      data: {
        subjectType: 'DRIVER',
        subjectId: driver.id,
        organizationId: fleet.id,
        status: VerificationStatus.SUBMITTED,
        submittedById: owner.id,
        submittedAt: new Date(),
      },
    });
    const verificationCase = await prisma.verificationCase.findFirstOrThrow({
      where: { subjectId: driver.id },
    });

    const response = await request<{ status: string; rejectionReason: string | null }>({
      method: 'POST',
      url: `/api/v1/verification/${verificationCase.id}/review`,
      user: platformAdmin,
      payload: { decision: 'VERIFIED', reviewerNotes: 'Scans look genuine.' },
    });

    expect(response.status).toBe(200);
    // A reviewer confirming a scan is not an authority confirming the number.
    expect(response.body.data.status).toBe(VerificationStatus.PENDING);
    expect(response.body.data.rejectionReason).toContain('Still needed');

    // And the case and the driver row agree, which is the part that matters.
    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.PENDING);
  });

  it('lets a reviewer approval through once all four are confirmed', async () => {
    const driver = await createDriver(fleet.id, { identityConfirmed: true });
    await prisma.driver.update({
      where: { id: driver.id },
      data: { licenceVerifiedAt: new Date() },
    });

    await prisma.verificationCase.create({
      data: {
        subjectType: 'DRIVER',
        subjectId: driver.id,
        organizationId: fleet.id,
        status: VerificationStatus.SUBMITTED,
        submittedById: owner.id,
        submittedAt: new Date(),
      },
    });
    const verificationCase = await prisma.verificationCase.findFirstOrThrow({
      where: { subjectId: driver.id },
    });

    const response = await request<{ status: string }>({
      method: 'POST',
      url: `/api/v1/verification/${verificationCase.id}/review`,
      user: platformAdmin,
      payload: { decision: 'VERIFIED' },
    });

    expect(response.body.data.status).toBe(VerificationStatus.VERIFIED);
  });

  it('keeps the demo shortcut working by confirming all four', async () => {
    const driver = await createDriver(fleet.id);

    const response = await request<{ status: string }>({
      method: 'POST',
      url: `/api/v1/verification/subject/driver/${driver.id}/demo-verify`,
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(VerificationStatus.VERIFIED);

    // Not an exception to the rule — the four are filled in, so the rule holds.
    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(stored.licenceVerifiedAt).not.toBeNull();
    expect(stored.aadhaarVerifiedAt).not.toBeNull();
    expect(stored.panVerifiedAt).not.toBeNull();
    expect(stored.voterIdVerifiedAt).not.toBeNull();
  });

  it('takes a driver back down when a check stops passing', async () => {
    stubRegistry({ licence: { doe: '2020-05-19' } });
    const driver = await createDriver(fleet.id, { identityConfirmed: true });
    await prisma.driver.update({
      where: { id: driver.id },
      data: {
        licenceVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        verificationStatus: VerificationStatus.VERIFIED,
      },
    });

    await request({ method: 'POST', url: verifyUrl('driver', driver.id), user: owner, payload: {} });

    const stored = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored.verificationStatus).toBe(VerificationStatus.REJECTED);
  });
});

// ---------------------------------------------------------------------------
// Subjects with no registry
// ---------------------------------------------------------------------------

describe('registry verification — subjects with no single registry', () => {
  it('points an organization at its GSTIN rather than failing opaquely', async () => {
    stubRegistry();

    const response = await request<unknown>({
      method: 'POST',
      url: verifyUrl('organization', fleet.id),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.message).toContain('GSTIN');
  });

  it('rejects a malformed identifier with a validation error, not a crash', async () => {
    const response = await request({
      method: 'POST',
      url: verifyUrl('truck', 'not-a-uuid'),
      user: owner,
      payload: {},
    });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');
  });
});

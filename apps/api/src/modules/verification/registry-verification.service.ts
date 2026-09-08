import {
  ErrorCode,
  Permission,
  RegistryVerificationOutcome,
  VerificationStatus,
  VerificationSubjectType,
  evaluateDrivingLicence,
  evaluateVehicleRegistration,
  formatRegistrationNumber,
  hasPermission,
  invalidNumberEvaluation,
  isPlausibleIndianLicence,
  normalizeLicenceNumber,
  notFoundEvaluation,
  registrationLooksUsable,
  type DriverVerificationChecklist,
  type DrivingLicenceRecord,
  type RegistryEvaluation,
  type RegistryFinding,
  type RegistryVerifyInput,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors, isAppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { maskLicence } from '../../providers/driving-licence';
import { maskRegistration } from '../../providers/vehicle-rc';
import * as licenceLookupService from '../licence-lookup/licence-lookup.service';
import * as vehicleLookupService from '../vehicle-lookup/vehicle-lookup.service';
import {
  getDriverChecklist,
  recordRegistryDecision,
  type VerificationCaseSummary,
} from './verification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Verification against the issuing registry.
 *
 * The document-review workflow in `verification.service` answers "has somebody
 * looked at this?". This answers a different and better question: "does the
 * authority that issued the record agree it exists?". A vehicle's RC and a
 * driver's licence are both live government records, so for those two subjects
 * there is no need to route a case to a human at all — Saarthi asks the RTO and
 * acts on the answer.
 *
 * Nothing here invents a new source. It composes the two lookup modules that
 * already own the RTO integration, which is what keeps their guarantees
 * intact: the tenant boundary (you may only look up your own vehicle, your own
 * driver), the cache that stops a second click costing a second call, the
 * environment's billable-call ceiling, the redaction of personal fields for
 * callers who may not see them, and the retention sweep.
 *
 * Three rules decide what an answer does:
 *
 *  1. **An answer settles the status, either way.** Found and in good standing
 *     verifies the subject; not found, mismatched, or barred by the registry's
 *     own state rejects it with the reason attached. Both are recorded as a
 *     case with an event, so the history says what happened and why.
 *
 *  2. **An outage is not an answer.** A timeout, a rate limit, an exhausted
 *     allowance or a missing API key is raised as an error and changes nothing.
 *     The records service being unreachable is not evidence about a vehicle.
 *
 *  3. **Nothing unverifiable is spent on.** A number that cannot be real is
 *     refused locally, before a billable call, and reported as a number to fix
 *     rather than as a record that does not exist.
 */

const serviceLogger = logger.child({ module: 'registry-verification' });

/** Which registry answered. */
export type RegistrySource = 'VEHICLE_RC' | 'DRIVING_LICENCE';

export interface RegistryVerificationResult {
  subjectType: VerificationSubjectType;
  subjectId: string;
  /** Plate or driver name, for the dialog heading. */
  subjectLabel: string;
  source: RegistrySource;
  /** What was checked, in a form safe to show this caller. */
  reference: string;
  outcome: RegistryVerificationOutcome;
  verified: boolean;
  /** The subject's verification status after this check. */
  status: VerificationStatus;
  /** One-line verdict. */
  summary: string;
  /** Blocking findings first, then advisories. */
  findings: RegistryFinding[];
  registry: {
    /** False when the number was refused locally and nothing was sent. */
    checked: boolean;
    /** Served from Saarthi's stored record rather than a fresh call. */
    cached: boolean;
    checkedAt: string | null;
    lookupId: string | null;
    providerReference: string | null;
    /**
     * What the registry actually said, as label/value pairs.
     *
     * Built from the record the caller is entitled to see, so a manager
     * without `vehicles.lookup.sensitive` gets the vehicle's make and RTO
     * without its registered owner.
     */
    details: { label: string; value: string }[];
  };
  /** The verification case this check wrote. */
  case: VerificationCaseSummary;
  /**
   * For a driver: where they now stand against all four checks.
   *
   * A confirmed licence is one of four, so the reply has to say what is still
   * missing — otherwise a green result here reads as "this driver is verified"
   * when three checks are still outstanding. `null` for a vehicle, which has
   * no such list.
   */
  driverChecklist: DriverVerificationChecklist | null;
}

export interface RegistryVerifyOutcome {
  result: RegistryVerificationResult;
  /** Audit metadata. Carries no personal data and no full licence number. */
  audit: {
    caseId: string;
    subjectType: VerificationSubjectType;
    subjectId: string;
    source: RegistrySource;
    outcome: RegistryVerificationOutcome;
    verified: boolean;
    checked: boolean;
    cached: boolean;
    lookupId: string | null;
    providerReference: string | null;
    findingCodes: string[];
  };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Verifying against the registry *is* a lookup, so it needs the lookup
 * permission as well as the one to submit a verification.
 *
 * Checked here rather than in a route preHandler because which permission
 * applies depends on the subject: a driver holds `drivers.licence.lookup` for
 * their own licence but has no business pulling an RC record, and gating the
 * route on both would stop them completing their own profile.
 */
function requireLookupPermission(auth: AuthContext, permission: Permission, subject: string): void {
  if (auth.isPlatformAdmin || hasPermission(auth.permissions, permission)) return;
  throw errors.forbidden(
    `Your role cannot check ${subject} against the government registry. ` +
      'Ask an owner or fleet manager to run the check.',
  );
}

/** Was this the provider saying "no such record", rather than a fault? */
function isNotFound(error: unknown): boolean {
  return (
    isAppError(error) &&
    (error.code === ErrorCode.VEHICLE_NOT_FOUND || error.code === ErrorCode.LICENCE_NOT_FOUND)
  );
}

// ---------------------------------------------------------------------------
// Detail rows
// ---------------------------------------------------------------------------

function rows(
  entries: [label: string, value: string | number | null | undefined][],
): { label: string; value: string }[] {
  return entries
    .filter((entry): entry is [string, string | number] => {
      const value = entry[1];
      return value !== null && value !== undefined && String(value).trim().length > 0;
    })
    .map(([label, value]) => ({ label, value: String(value) }));
}

function vehicleDetails(record: VehicleRcRecord): { label: string; value: string }[] {
  return rows([
    ['Registered owner', record.owner?.name],
    ['Make and model', [record.maker, record.model].filter(Boolean).join(' ')],
    ['Vehicle class', record.vehicleClass],
    ['Fuel', record.fuelType],
    ['Registered at', record.rto],
    ['Registered on', record.registrationDate],
    ['Registration status', record.registrationStatus],
    ['Insurance valid until', record.insuranceValidUntil],
    ['Fitness valid until', record.fitnessValidUntil],
  ]);
}

function licenceDetails(record: DrivingLicenceRecord): { label: string; value: string }[] {
  return rows([
    ['Licence holder', record.holder?.name],
    ['Date of birth', record.holder?.dateOfBirth],
    ['Issued by', record.issuingAuthority ?? record.state],
    ['Issued on', record.issuedOn],
    ['Valid until', record.validUntil],
    ['Commercial entitlement until', record.transportValidUntil],
    ['Entitlement classes', record.vehicleClasses.join(', ')],
  ]);
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

async function verifyTruck(
  auth: AuthContext,
  truckId: string,
  input: RegistryVerifyInput,
): Promise<RegistryVerifyOutcome> {
  const truck = await prisma.truck.findUnique({
    where: { id: truckId },
    select: { id: true, organizationId: true, registrationNumber: true, archivedAt: true },
  });
  // 404 rather than 403 throughout: a vehicle in another tenant must not be
  // distinguishable from one that does not exist.
  if (!truck) throw errors.notFound('Vehicle');
  if (!auth.isPlatformAdmin && truck.organizationId !== auth.organizationId) {
    throw errors.notFound('Vehicle');
  }
  if (truck.archivedAt) {
    throw errors.businessRule('This vehicle is archived. Restore it before verifying it.');
  }

  requireLookupPermission(auth, Permission.VEHICLE_LOOKUP, 'a vehicle');

  const plate = truck.registrationNumber;
  const label = formatRegistrationNumber(plate);

  // The shape check runs on the normalised form, but the lookup is given the
  // plate exactly as stored — that string is what the ownership check and the
  // lookup cache are keyed on everywhere else in the system.
  if (!registrationLooksUsable(plate)) {
    return settle(auth, {
      subjectType: VerificationSubjectType.TRUCK,
      subjectId: truck.id,
      subjectLabel: label,
      organizationId: truck.organizationId,
      source: 'VEHICLE_RC',
      reference: label,
      evaluation: invalidNumberEvaluation('REGISTRATION', label),
      registry: {
        checked: false,
        cached: false,
        checkedAt: null,
        lookupId: null,
        providerReference: null,
        details: [],
      },
    });
  }

  try {
    const { result } = await vehicleLookupService.lookupVehicle(auth, {
      registrationNumber: plate,
      refresh: input.refresh,
    });

    return settle(auth, {
      subjectType: VerificationSubjectType.TRUCK,
      subjectId: truck.id,
      subjectLabel: label,
      organizationId: truck.organizationId,
      source: 'VEHICLE_RC',
      reference: label,
      evaluation: evaluateVehicleRegistration(result.vehicle, { registrationNumber: plate }),
      registry: {
        checked: true,
        cached: result.cached,
        checkedAt: result.retrievedAt,
        lookupId: result.lookupId,
        providerReference: result.providerReference,
        details: vehicleDetails(result.vehicle),
      },
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;

    serviceLogger.info(
      { plate: maskRegistration(plate), truckId: truck.id },
      'Registry verification found no RC record for this vehicle',
    );

    return settle(auth, {
      subjectType: VerificationSubjectType.TRUCK,
      subjectId: truck.id,
      subjectLabel: label,
      organizationId: truck.organizationId,
      source: 'VEHICLE_RC',
      reference: label,
      evaluation: notFoundEvaluation('REGISTRATION'),
      registry: {
        checked: true,
        cached: false,
        checkedAt: new Date().toISOString(),
        lookupId: null,
        providerReference: null,
        details: [],
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/**
 * The document's number and the profile's number disagree.
 *
 * Not one of the domain evaluations: those judge what a registry returned,
 * while this is Saarthi noticing that two of its own values contradict each
 * other before anything is sent anywhere.
 */
function licenceNumberMismatchEvaluation(): RegistryEvaluation {
  return {
    outcome: RegistryVerificationOutcome.MISMATCH,
    verified: false,
    summary:
      'The licence number on this document is not the one on the driver’s profile, so nothing ' +
      'was sent to the licensing authority.',
    findings: [
      {
        code: 'DL_DOCUMENT_NUMBER_MISMATCH',
        severity: 'BLOCKING',
        label: 'Document does not match the profile',
        detail:
          'The number entered for this document differs from the licence number on the ' +
          'driver’s profile. Either the document belongs to a different driver, or one of the ' +
          'two numbers has a typo. Correct it and verify again.',
      },
    ],
  };
}

async function verifyDriver(
  auth: AuthContext,
  driverId: string,
  input: RegistryVerifyInput,
): Promise<RegistryVerifyOutcome> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      organizationId: true,
      licenseNumber: true,
      dateOfBirth: true,
      archivedAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!driver) throw errors.notFound('Driver');

  // A driver may always verify themselves — that is how they finish their own
  // onboarding. Everyone else is held to the tenant boundary.
  const isSelf = auth.driverId === driver.id;
  if (!isSelf && !auth.isPlatformAdmin && driver.organizationId !== auth.organizationId) {
    throw errors.notFound('Driver');
  }
  if (driver.archivedAt) {
    throw errors.businessRule('This driver is archived. Restore them before verifying.');
  }

  requireLookupPermission(auth, Permission.DRIVER_LICENCE_LOOKUP, 'a driving licence');

  const label = `${driver.user.firstName} ${driver.user.lastName}`.trim() || 'Driver';
  const licence = driver.licenseNumber;
  const normalized = normalizeLicenceNumber(licence);

  const base = {
    subjectType: VerificationSubjectType.DRIVER,
    subjectId: driver.id,
    subjectLabel: label,
    organizationId: driver.organizationId,
    source: 'DRIVING_LICENCE' as const,
    // Masked even for callers who may see the record: the number belongs on
    // the Licence tab, not in a verification dialog.
    reference: maskLicence(normalized),
  };

  const unchecked = {
    checked: false,
    cached: false,
    checkedAt: null,
    lookupId: null,
    providerReference: null,
    details: [],
  };

  if (!isPlausibleIndianLicence(normalized)) {
    return settle(auth, {
      ...base,
      evaluation: invalidNumberEvaluation('LICENCE', licence),
      registry: unchecked,
    });
  }

  /**
   * The number printed on the document must be the number on the profile.
   *
   * Supplied when the check is run from a licence upload. Comparing the two
   * costs nothing and catches the two things a paid call could not tell apart:
   * a document attached to the wrong driver, and a typo. Both would otherwise
   * come back as a cheerful "this licence exists" — about somebody else.
   */
  if (input.licenceNumber) {
    const printed = normalizeLicenceNumber(input.licenceNumber);
    if (printed !== normalized) {
      return settle(auth, {
        ...base,
        evaluation: licenceNumberMismatchEvaluation(),
        registry: unchecked,
      });
    }
  }

  /**
   * The licensing authority verifies a licence number *against* a date of
   * birth, so there is no check to run without one. It is taken from the
   * driver's profile when Saarthi has it, and only asked for when it does not
   * — flagged as a field error so the client can prompt for exactly that
   * rather than reporting a generic failure.
   */
  const dateOfBirth = input.dateOfBirth ?? driver.dateOfBirth;
  if (!dateOfBirth) {
    throw errors.validation(
      'The licensing authority verifies a licence against the holder’s date of birth, and ' +
        'Saarthi does not hold one for this driver. Supply it to run the check.',
      { fields: { dateOfBirth: ['Enter the date of birth printed on the licence.'] } },
    );
  }

  try {
    const { result } = await licenceLookupService.lookupLicence(auth, {
      licenceNumber: licence,
      dateOfBirth,
      refresh: input.refresh,
    });

    const outcome = await settle(auth, {
      ...base,
      evaluation: evaluateDrivingLicence(result.licence, { licenceNumber: licence }),
      registry: {
        checked: true,
        cached: result.cached,
        checkedAt: result.retrievedAt,
        lookupId: result.lookupId,
        providerReference: result.providerReference,
        details: licenceDetails(result.licence),
      },
    });

    // The registry confirmed the licence against this date of birth, which
    // makes it the right one — so a driver who had to type it in is not asked
    // again. Only ever fills a gap; a date already on file is never touched.
    if (outcome.result.verified && !driver.dateOfBirth) {
      await prisma.driver.update({ where: { id: driver.id }, data: { dateOfBirth } });
    }

    return outcome;
  } catch (error) {
    if (!isNotFound(error)) throw error;

    serviceLogger.info(
      { licence: maskLicence(normalized), driverId: driver.id },
      'Registry verification found no licence record for this driver',
    );

    return settle(auth, {
      ...base,
      evaluation: notFoundEvaluation('LICENCE'),
      registry: {
        checked: true,
        cached: false,
        checkedAt: new Date().toISOString(),
        lookupId: null,
        providerReference: null,
        details: [],
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Recording the decision
// ---------------------------------------------------------------------------

/**
 * Turn an evaluation into a recorded decision.
 *
 * Every path above ends here, so there is exactly one place where a registry
 * answer becomes a verification status — and no path can reach a verdict
 * without writing the case that explains it.
 */
async function settle(
  auth: AuthContext,
  input: Omit<
    RegistryVerificationResult,
    'outcome' | 'verified' | 'status' | 'summary' | 'findings' | 'case' | 'driverChecklist'
  > & {
    organizationId: string | null;
    evaluation: RegistryEvaluation;
  },
): Promise<RegistryVerifyOutcome> {
  const { evaluation, organizationId, ...rest } = input;
  const isDriver = rest.subjectType === VerificationSubjectType.DRIVER;

  /**
   * Record the licence answer on the driver *before* the status is computed.
   *
   * `recordRegistryDecision` asks the checklist whether the driver may hold
   * VERIFIED, and the licence is one of the four it reads — so writing the
   * timestamp afterwards would have the driver judged against a licence result
   * that had not landed yet, and a driver completing their fourth check would
   * be told they had only done three.
   *
   * A blocking answer clears it. An expired or unfound licence is not a
   * confirmed one, and leaving yesterday's confirmation in place would let a
   * driver stay verified on a licence the register has since contradicted.
   */
  if (isDriver) {
    await prisma.driver.update({
      where: { id: rest.subjectId },
      data: { licenceVerifiedAt: evaluation.verified ? new Date() : null },
    });
  }

  const status = evaluation.verified ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED;

  const note = evaluation.verified
    ? `Verified against the ${
        rest.source === 'VEHICLE_RC' ? 'RTO vehicle register' : 'driving licence register'
      }. ${evaluation.summary}`
    : evaluation.summary;

  const verificationCase = await recordRegistryDecision(
    auth,
    rest.subjectType,
    rest.subjectId,
    organizationId,
    {
      status,
      note,
      rejectionReason: evaluation.verified ? null : evaluation.summary,
    },
  );

  // Read after the decision, so it reflects the licence result just recorded.
  const driverChecklist = isDriver ? await getDriverChecklist(rest.subjectId) : null;

  serviceLogger.info(
    {
      subjectType: rest.subjectType,
      subjectId: rest.subjectId,
      source: rest.source,
      outcome: evaluation.outcome,
      cached: rest.registry.cached,
      checked: rest.registry.checked,
    },
    'Registry verification completed',
  );

  return {
    result: {
      ...rest,
      outcome: evaluation.outcome,
      verified: evaluation.verified,
      // The case's status, not the evaluation's: a confirmed licence does not
      // by itself verify a driver, and this is the field the client trusts.
      status: verificationCase.status,
      summary: evaluation.summary,
      findings: evaluation.findings,
      case: verificationCase,
      driverChecklist,
    },
    audit: {
      caseId: verificationCase.id,
      subjectType: rest.subjectType,
      subjectId: rest.subjectId,
      source: rest.source,
      outcome: evaluation.outcome,
      verified: evaluation.verified,
      checked: rest.registry.checked,
      cached: rest.registry.cached,
      lookupId: rest.registry.lookupId,
      providerReference: rest.registry.providerReference,
      findingCodes: evaluation.findings.map((finding) => finding.code),
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Verify one subject against the registry that issued its record.
 *
 * Only vehicles and drivers have a single government record that settles the
 * question. An organization's equivalent is its GSTIN, which is already
 * handled by the identity module against its own source — so rather than
 * failing opaquely, this says where to go.
 */
export async function verifyAgainstRegistry(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
  input: RegistryVerifyInput,
): Promise<RegistryVerifyOutcome> {
  switch (subjectType) {
    case VerificationSubjectType.TRUCK:
      return verifyTruck(auth, subjectId, input);
    case VerificationSubjectType.DRIVER:
      return verifyDriver(auth, subjectId, input);
    case VerificationSubjectType.ORGANIZATION:
      throw errors.businessRule(
        'An organization is verified through its GSTIN, on the Identity tab of its documents — ' +
          'there is no single vehicle or licence record to check it against.',
      );
    default:
      throw errors.validation(
        'Only a vehicle or a driver can be verified against a government registry.',
      );
  }
}

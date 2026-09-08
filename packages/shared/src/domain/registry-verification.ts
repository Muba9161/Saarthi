import { RegistryVerificationOutcome } from './enums';
import {
  hasTransportEntitlement,
  normalizeLicenceNumber,
  type DrivingLicenceRecord,
} from './driving-licence';
import { isPlausibleIndianRegistration, rcValidity, type VehicleRcRecord } from './vehicle-rc';
import { normalizeRegistrationNumber } from '../utils/format';

/**
 * Registry verification rules.
 *
 * A vehicle and a driver each have exactly one record that decides whether
 * they may lawfully be dispatched — the RC held by the RTO, and the driving
 * licence held by the licensing authority. Verification on Saarthi therefore
 * does not have to be a queue somebody drains by hand: the platform can ask
 * the issuing authority directly and act on what it says.
 *
 * These functions are the *judgement* half of that, kept pure and free of the
 * provider, the database and the request so they can be exercised without an
 * API key. The service layer fetches a record; this decides what it means.
 *
 * Two rules run through all of it:
 *
 *  1. **Existence is the question, but not the only one.** A registration the
 *     RTO has cancelled, scrapped or blacklisted "exists" — and marking it
 *     verified would put a vehicle that may not lawfully be on the road into a
 *     fleet's dispatchable pool. Those states block; they do not pass.
 *
 *  2. **An unknown is never read as a failure.** The RTO publishes partial
 *     records, and a missing insurance date is the registry being quiet, not a
 *     vehicle being uninsured. Anything Saarthi cannot conclude from becomes an
 *     advisory the operator can see and act on, never a blocking finding.
 */

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * How much weight a finding carries.
 *
 * `BLOCKING` is the only severity that can stop verification, and only a
 * positive statement by the registry earns it. `ADVISORY` findings are shown
 * alongside a successful check — they are compliance work the operator now
 * knows about, not a reason to refuse them.
 */
export type RegistryFindingSeverity = 'BLOCKING' | 'ADVISORY';

export interface RegistryFinding {
  /** Stable machine code, safe for audit rows and analytics. */
  code: string;
  severity: RegistryFindingSeverity;
  /** Short label, e.g. "Registration cancelled". */
  label: string;
  /** What it means and what to do about it, addressed to the operator. */
  detail: string;
}

export interface RegistryEvaluation {
  outcome: RegistryVerificationOutcome;
  /** True only for `VERIFIED`. Kept explicit so callers cannot drift. */
  verified: boolean;
  /** One line fit for a toast, a badge tooltip and a case note. */
  summary: string;
  /** Blocking findings first, then advisories, each group in check order. */
  findings: RegistryFinding[];
}

function order(findings: RegistryFinding[]): RegistryFinding[] {
  return [
    ...findings.filter((entry) => entry.severity === 'BLOCKING'),
    ...findings.filter((entry) => entry.severity === 'ADVISORY'),
  ];
}

function conclude(
  outcome: RegistryVerificationOutcome,
  summary: string,
  findings: RegistryFinding[],
): RegistryEvaluation {
  return {
    outcome,
    verified: outcome === RegistryVerificationOutcome.VERIFIED,
    summary,
    findings: order(findings),
  };
}

/**
 * Does this provider status string mean "yes, there is one"?
 *
 * The RTO answers questions like blacklisting and non-use in free text, and
 * "NO", "None", "Nil" and "Not blacklisted" all mean the same clean answer.
 * Treating any non-empty string as positive would flag every clean vehicle.
 */
function statesSomething(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !/^(no|none|nil|not|n\/a|na|clear|clean|false|-|0)\b/i.test(trimmed);
}

/** A date already in the past, on whole-day granularity. */
function isExpired(iso: string | null | undefined, now: Date): boolean {
  return rcValidity(iso, { now }).validity === 'EXPIRED';
}

function daysLabel(iso: string, now: Date): string {
  const { daysRemaining } = rcValidity(iso, { now });
  if (daysRemaining === null) return iso;
  if (daysRemaining < 0) return `${iso} (${Math.abs(daysRemaining)} days ago)`;
  if (daysRemaining === 0) return `${iso} (today)`;
  return `${iso} (in ${daysRemaining} days)`;
}

/** Compliance dates an RC carries, checked identically and reported as advisories. */
const RC_COMPLIANCE: {
  code: string;
  label: string;
  read: (record: VehicleRcRecord) => string | null;
  missing: string;
}[] = [
  {
    code: 'RC_INSURANCE',
    label: 'Insurance',
    read: (record) => record.insuranceValidUntil,
    missing: 'The RTO holds no insurance validity date for this vehicle.',
  },
  {
    code: 'RC_FITNESS',
    label: 'Fitness certificate',
    read: (record) => record.fitnessValidUntil,
    missing: 'The RTO holds no fitness validity date for this vehicle.',
  },
  {
    code: 'RC_PUCC',
    label: 'Pollution certificate',
    read: (record) => record.puccValidUntil,
    missing: 'The RTO holds no PUCC validity date for this vehicle.',
  },
  {
    code: 'RC_TAX',
    label: 'Road tax',
    read: (record) => record.tax.validUntil,
    missing: 'The RTO holds no road-tax validity date for this vehicle.',
  },
];

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/** RC statuses that bar a vehicle from being dispatched at all. */
const RC_BARRED_STATUS =
  /(cancel|scrap|suspend|seiz|surrender|de-?regist|withdraw|expired|invalid)/i;

export interface VehicleRegistryExpectation {
  /** The plate Saarthi holds for the vehicle, in any typed form. */
  registrationNumber: string;
}

/**
 * Judge an RC record against the vehicle Saarthi holds.
 *
 * Called only once a record has come back: a provider that found nothing has
 * already been turned into `NOT_FOUND` by the caller, because "no record" is a
 * transport-level answer rather than something to infer from empty fields.
 */
export function evaluateVehicleRegistration(
  record: VehicleRcRecord,
  expected: VehicleRegistryExpectation,
  options: { now?: Date; expiringSoonDays?: number } = {},
): RegistryEvaluation {
  const { now = new Date(), expiringSoonDays = 30 } = options;
  const findings: RegistryFinding[] = [];

  // An envelope that reported success but carries nothing identifying is a
  // not-found in disguise; verifying against it would be verifying against
  // nothing at all.
  //
  // Only fields that survive redaction are consulted. Owner, chassis and
  // engine are stripped for callers without `vehicles.lookup.sensitive`, and a
  // verification verdict that changed with who clicked the button would be no
  // verdict at all.
  const identified =
    record.registrationNumber !== null ||
    record.registrationDate !== null ||
    record.maker !== null ||
    record.model !== null ||
    record.vehicleClass !== null ||
    record.rto !== null;

  if (!identified) {
    return conclude(
      RegistryVerificationOutcome.NOT_FOUND,
      'The RTO returned no registration record for this vehicle.',
      [
        {
          code: 'RC_EMPTY_RECORD',
          severity: 'BLOCKING',
          label: 'No registration record',
          detail:
            'The records service answered but held nothing for this number. Check the ' +
            'registration number on the vehicle and try again.',
        },
      ],
    );
  }

  // The provider echoes the plate it searched. A different one back means the
  // record describes another vehicle, which must never be silently accepted.
  const returned = record.registrationNumber
    ? normalizeRegistrationNumber(record.registrationNumber)
    : null;
  const wanted = normalizeRegistrationNumber(expected.registrationNumber);

  if (returned !== null && returned !== wanted) {
    return conclude(
      RegistryVerificationOutcome.MISMATCH,
      `The RTO record is for ${returned}, not ${wanted}.`,
      [
        {
          code: 'RC_PLATE_MISMATCH',
          severity: 'BLOCKING',
          label: 'Record is for a different vehicle',
          detail:
            `The registry returned a record for ${returned} while Saarthi holds ${wanted}. ` +
            'Correct the registration number on the vehicle before verifying it.',
        },
      ],
    );
  }

  if (returned === null) {
    findings.push({
      code: 'RC_PLATE_NOT_ECHOED',
      severity: 'ADVISORY',
      label: 'Registration number not echoed',
      detail:
        'The registry returned a record but did not repeat the registration number, so Saarthi ' +
        'could not confirm field by field that the two are the same vehicle.',
    });
  }

  // --- Blocking state ----------------------------------------------------

  if (record.registrationStatus && RC_BARRED_STATUS.test(record.registrationStatus)) {
    return conclude(
      RegistryVerificationOutcome.INELIGIBLE,
      `The RTO reports this registration as "${record.registrationStatus}".`,
      [
        {
          code: 'RC_STATUS_BARRED',
          severity: 'BLOCKING',
          label: 'Registration not active',
          detail:
            `The RTO reports the registration status as "${record.registrationStatus}". ` +
            'A vehicle in this state cannot be verified for dispatch.',
        },
      ],
    );
  }

  if (statesSomething(record.blacklistStatus)) {
    return conclude(
      RegistryVerificationOutcome.INELIGIBLE,
      'The RTO reports this vehicle as blacklisted.',
      [
        {
          code: 'RC_BLACKLISTED',
          severity: 'BLOCKING',
          label: 'Vehicle blacklisted',
          detail:
            `The RTO blacklist entry reads "${record.blacklistStatus}". Clear it with the RTO ` +
            'before this vehicle can be verified.',
        },
      ],
    );
  }

  // --- Advisories --------------------------------------------------------

  if (statesSomething(record.nonUse.status)) {
    findings.push({
      code: 'RC_NON_USE',
      severity: 'ADVISORY',
      label: 'Declared off-road',
      detail:
        `The RTO holds a non-use declaration ("${record.nonUse.status}")` +
        `${record.nonUse.from ? ` from ${record.nonUse.from}` : ''}` +
        `${record.nonUse.to ? ` to ${record.nonUse.to}` : ''}. ` +
        'The registration is valid, but the vehicle is recorded as not in use.',
    });
  }

  for (const item of RC_COMPLIANCE) {
    const validUntil = item.read(record);
    if (!validUntil) {
      findings.push({
        code: `${item.code}_UNKNOWN`,
        severity: 'ADVISORY',
        label: `${item.label} not on record`,
        detail: item.missing,
      });
      continue;
    }
    const { validity } = rcValidity(validUntil, { now, expiringSoonDays });
    if (validity === 'EXPIRED') {
      findings.push({
        code: `${item.code}_EXPIRED`,
        severity: 'ADVISORY',
        label: `${item.label} expired`,
        detail: `The RTO records this as valid until ${daysLabel(validUntil, now)}. Renew it.`,
      });
    } else if (validity === 'EXPIRING_SOON') {
      findings.push({
        code: `${item.code}_EXPIRING`,
        severity: 'ADVISORY',
        label: `${item.label} expiring`,
        detail: `The RTO records this as valid until ${daysLabel(validUntil, now)}.`,
      });
    }
  }

  if (record.partialRecord === true) {
    findings.push({
      code: 'RC_PARTIAL_RECORD',
      severity: 'ADVISORY',
      label: 'Reduced record',
      detail:
        'The RTO returned a reduced record for this vehicle, so some fields are absent. The ' +
        'registration itself is confirmed.',
    });
  }

  const identity = [record.maker, record.model].filter(Boolean).join(' ');

  return conclude(
    RegistryVerificationOutcome.VERIFIED,
    identity
      ? `Confirmed with the RTO — ${wanted} is registered as a ${identity}.`
      : `Confirmed with the RTO — ${wanted} is a registered vehicle.`,
    findings,
  );
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export interface LicenceRegistryExpectation {
  /** The licence number Saarthi holds for the driver, in any typed form. */
  licenceNumber: string;
}

/**
 * Judge a driving licence record against the driver Saarthi holds.
 *
 * An expired licence blocks, and deliberately so — this status decides whether
 * the driver may be assigned a trip, and a fleet must not be told somebody is
 * verified to drive on a licence that has run out. A missing *commercial*
 * class is only an advisory: the RTO publishes no entitlement list for some
 * licences, and refusing every driver whose classes the registry happens not
 * to list would be Saarthi's gap presented as the driver's fault.
 */
export function evaluateDrivingLicence(
  record: DrivingLicenceRecord,
  expected: LicenceRegistryExpectation,
  options: { now?: Date; expiringSoonDays?: number } = {},
): RegistryEvaluation {
  const { now = new Date(), expiringSoonDays = 30 } = options;
  const findings: RegistryFinding[] = [];

  // As with the RC record, only fields that survive redaction count: the
  // holder block is stripped for callers without
  // `drivers.licence.lookup.sensitive`, and the verdict must be the same
  // either way.
  const identified =
    record.licenceNumber !== null ||
    record.issuingAuthority !== null ||
    record.issuedOn !== null ||
    record.validUntil !== null ||
    record.state !== null ||
    record.vehicleClasses.length > 0;

  if (!identified) {
    return conclude(
      RegistryVerificationOutcome.NOT_FOUND,
      'The licensing authority returned no record for this licence.',
      [
        {
          code: 'DL_EMPTY_RECORD',
          severity: 'BLOCKING',
          label: 'No licence record',
          detail:
            'The records service answered but held nothing for this licence number and date of ' +
            'birth. Check both against the licence itself and try again.',
        },
      ],
    );
  }

  const returned = record.licenceNumber ? normalizeLicenceNumber(record.licenceNumber) : null;
  const wanted = normalizeLicenceNumber(expected.licenceNumber);

  if (returned !== null && returned !== wanted) {
    return conclude(
      RegistryVerificationOutcome.MISMATCH,
      'The licence record returned is for a different licence number.',
      [
        {
          code: 'DL_NUMBER_MISMATCH',
          severity: 'BLOCKING',
          label: 'Record is for a different licence',
          detail:
            'The registry returned a record for a different licence number than the one on ' +
            "this driver's profile. Correct the licence number before verifying.",
        },
      ],
    );
  }

  if (returned === null) {
    findings.push({
      code: 'DL_NUMBER_NOT_ECHOED',
      severity: 'ADVISORY',
      label: 'Licence number not echoed',
      detail:
        'The registry returned a record but did not repeat the licence number, so Saarthi ' +
        'could not confirm field by field that the two are the same licence.',
    });
  }

  // --- Blocking state ----------------------------------------------------

  if (record.validUntil && isExpired(record.validUntil, now)) {
    return conclude(
      RegistryVerificationOutcome.INELIGIBLE,
      `This licence expired on ${record.validUntil}.`,
      [
        {
          code: 'DL_EXPIRED',
          severity: 'BLOCKING',
          label: 'Licence expired',
          detail:
            'The licensing authority records this licence as valid until ' +
            `${daysLabel(record.validUntil, now)}. It must be renewed before the driver can be ` +
            'verified.',
        },
      ],
    );
  }

  // --- Advisories --------------------------------------------------------

  if (!record.validUntil) {
    findings.push({
      code: 'DL_VALIDITY_UNKNOWN',
      severity: 'ADVISORY',
      label: 'Expiry date not on record',
      detail:
        'The licensing authority published no expiry date for this licence, so Saarthi cannot ' +
        'track its renewal. Confirm it from the licence itself.',
    });
  } else if (rcValidity(record.validUntil, { now, expiringSoonDays }).validity === 'EXPIRING_SOON') {
    findings.push({
      code: 'DL_EXPIRING',
      severity: 'ADVISORY',
      label: 'Licence expiring',
      detail: `This licence is valid until ${daysLabel(record.validUntil, now)}.`,
    });
  }

  const transport = hasTransportEntitlement(record);
  if (transport === false) {
    findings.push({
      code: 'DL_NO_TRANSPORT_CLASS',
      severity: 'ADVISORY',
      label: 'No commercial entitlement',
      detail:
        `The registry lists ${record.vehicleClasses.join(', ')} for this licence, and none of ` +
        'those permits a commercial goods vehicle. The licence is genuine — check it before ' +
        'assigning a truck.',
    });
  } else if (transport === null) {
    findings.push({
      code: 'DL_CLASSES_UNKNOWN',
      severity: 'ADVISORY',
      label: 'Entitlement classes not on record',
      detail:
        'The registry published no entitlement classes for this licence, so Saarthi cannot ' +
        'confirm a commercial entitlement from it.',
    });
  } else if (record.transportValidUntil && isExpired(record.transportValidUntil, now)) {
    findings.push({
      code: 'DL_TRANSPORT_EXPIRED',
      severity: 'ADVISORY',
      label: 'Commercial entitlement expired',
      detail:
        'The commercial endorsement on this licence ran to ' +
        `${daysLabel(record.transportValidUntil, now)}. The licence itself is still valid.`,
    });
  }

  if (record.partialRecord === true) {
    findings.push({
      code: 'DL_PARTIAL_RECORD',
      severity: 'ADVISORY',
      label: 'Reduced record',
      detail:
        'The licensing authority returned a reduced record, so some fields are absent. The ' +
        'licence itself is confirmed.',
    });
  }

  const holder = record.holder?.name;

  return conclude(
    RegistryVerificationOutcome.VERIFIED,
    holder
      ? `Confirmed with the licensing authority — licence held by ${holder}.`
      : 'Confirmed with the licensing authority — this licence is on record.',
    findings,
  );
}

// ---------------------------------------------------------------------------
// Outcomes that need no record
// ---------------------------------------------------------------------------

/**
 * The number on file cannot be real, so no billable call is made.
 *
 * Reported as its own outcome rather than as "not found": telling an operator
 * the RTO has no record of a plate they mistyped sends them looking for a
 * problem at the RTO.
 */
export function invalidNumberEvaluation(
  what: 'REGISTRATION' | 'LICENCE',
  value: string,
): RegistryEvaluation {
  const vehicle = what === 'REGISTRATION';
  return conclude(
    RegistryVerificationOutcome.INVALID_FORMAT,
    vehicle
      ? `"${value}" is not a usable registration number, so nothing was sent to the RTO.`
      : `"${value}" is not a usable licence number, so nothing was sent to the RTO.`,
    [
      {
        code: vehicle ? 'RC_NUMBER_INVALID' : 'DL_NUMBER_INVALID',
        severity: 'BLOCKING',
        label: vehicle ? 'Registration number not usable' : 'Licence number not usable',
        detail: vehicle
          ? `Saarthi holds "${value}" for this vehicle, which is not a valid Indian ` +
            'registration number. Correct it on the vehicle, then verify.'
          : `Saarthi holds "${value}" for this driver, which is not a valid Indian driving ` +
            "licence number. Correct it on the driver's profile, then verify.",
      },
    ],
  );
}

/** Not-found reported by the provider itself, rather than inferred from a record. */
export function notFoundEvaluation(what: 'REGISTRATION' | 'LICENCE'): RegistryEvaluation {
  const vehicle = what === 'REGISTRATION';
  return conclude(
    RegistryVerificationOutcome.NOT_FOUND,
    vehicle
      ? 'The RTO has no registration record for this number.'
      : 'The licensing authority has no record for this licence number and date of birth.',
    [
      {
        code: vehicle ? 'RC_NOT_FOUND' : 'DL_NOT_FOUND',
        severity: 'BLOCKING',
        label: vehicle ? 'Not registered' : 'Licence not found',
        detail: vehicle
          ? 'The RTO holds no vehicle against this registration number. Check the number on ' +
            'the vehicle — a single wrong character is enough — and try again.'
          : 'The licensing authority holds no licence against this number and date of birth. ' +
            'Check both against the licence itself and try again.',
      },
    ],
  );
}

// ---------------------------------------------------------------------------
// Reading an evaluation
// ---------------------------------------------------------------------------

/** Blocking findings decide the outcome; this is what the UI leads with. */
export function blockingFindings(evaluation: RegistryEvaluation): RegistryFinding[] {
  return evaluation.findings.filter((entry) => entry.severity === 'BLOCKING');
}

/** Advisories accompany any outcome, including a successful one. */
export function advisoryFindings(evaluation: RegistryEvaluation): RegistryFinding[] {
  return evaluation.findings.filter((entry) => entry.severity === 'ADVISORY');
}

/**
 * Is this registration number worth spending a provider call on?
 *
 * The local shape check exists to keep a typo from costing a billable lookup
 * and coming back as the misleading "no record found".
 */
export function registrationLooksUsable(value: string): boolean {
  const normalized = normalizeRegistrationNumber(value);
  return normalized.length > 0 && isPlausibleIndianRegistration(normalized);
}

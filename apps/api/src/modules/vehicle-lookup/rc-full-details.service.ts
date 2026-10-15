import {
  VehicleOwnershipStatus,
  VerificationSubjectType,
  type VehicleRcDetailsCheckInput,
} from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import type { ProviderCallGate } from '../../lib/provider-call-gate';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { evaluateOwnership } from '../vehicles/vehicle-ownership.service';
import {
  assertPlateAddable,
  fetchLookup,
  type RawLookupResult,
  type VehicleLookupOutcome,
} from './vehicle-lookup.service';

/**
 * Full vehicle details, paid: RC Details Advanced merged with Lite, sold for
 * ₹20 through Pay & Verify (`VEHICLE_RC_DETAILS`).
 *
 * Bought in one of two places. While a vehicle is being added it does not
 * exist yet, so the account pays and names the plate, which must be one it may
 * add. From a vehicle's page the plate is the vehicle's own, so nobody types
 * it twice. Either way the record is stored against the account, where the add
 * form and the vehicle's Virtual RC read it back.
 *
 * Everything that can refuse runs before the gate, so Pay & Verify's preflight
 * turns a plate that cannot be added into an error, not a payment; and full
 * details already held come back without one.
 */
export async function fetchFullDetails(
  auth: AuthContext,
  input: VehicleRcDetailsCheckInput,
  gate: ProviderCallGate,
): Promise<{ registrationNumber: string; outcome: VehicleLookupOutcome<RawLookupResult> }> {
  const { registrationNumber, truck } = await resolveSubject(auth, input);
  const outcome = await fetchLookup(
    auth,
    { registrationNumber, refresh: input.refresh },
    'FULL',
    { gate },
  );

  // Recorded as every lookup is, so the environment's billable-call ceiling
  // counts paid ones too.
  await recordAudit({
    action: AuditAction.VEHICLE_RC_LOOKUP,
    entityType: 'VehicleLookup',
    entityId: outcome.audit.lookupId,
    actorUserId: auth.user.id,
    organizationId: auth.organizationId ?? null,
    after: {
      registrationNumber: outcome.audit.registrationNumber,
      cached: outcome.audit.cached,
      pdfStored: outcome.audit.pdfStored,
      providerReference: outcome.audit.providerReference,
      purpose: 'full-details',
    },
  });

  // A fresh record is the evidence a pending ownership waits on.
  if (truck?.ownershipStatus === VehicleOwnershipStatus.PENDING) await evaluateOwnership(truck.id);

  return { registrationNumber, outcome };
}

async function resolveSubject(
  auth: AuthContext,
  input: VehicleRcDetailsCheckInput,
): Promise<{ registrationNumber: string; truck: { id: string; ownershipStatus: string } | null }> {
  if (input.subjectType === VerificationSubjectType.TRUCK) {
    const truck = await prisma.truck.findUnique({
      where: { id: input.subjectId },
      select: {
        id: true,
        organizationId: true,
        registrationNumber: true,
        ownershipStatus: true,
        archivedAt: true,
      },
    });
    // "Not found" rather than "forbidden", so ids cannot be probed across tenants.
    if (
      !truck ||
      truck.archivedAt ||
      (!auth.isPlatformAdmin && truck.organizationId !== auth.organizationId)
    ) {
      throw errors.notFound('Vehicle');
    }
    return { registrationNumber: truck.registrationNumber, truck };
  }

  if (!auth.isPlatformAdmin && input.subjectId !== auth.organizationId) {
    throw errors.notFound('Organization');
  }
  if (!input.registrationNumber) {
    throw errors.validation('Enter the registration number to fetch full details for.');
  }
  await assertPlateAddable(auth, input.registrationNumber);
  return { registrationNumber: input.registrationNumber, truck: null };
}

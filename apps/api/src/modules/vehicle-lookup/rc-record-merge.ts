import type { VehicleMaskedFields, VehicleRcRecord } from '@saarthi/shared';

/**
 * One RC record from two: the paid full record, which must never show less
 * than the free one.
 *
 * RC Details Advanced is not a superset of RC Details Lite. For a real vehicle
 * on 2026-10-15 Advanced returned the maker, model, fuel, colour and emission
 * norms Lite had left blank, and left blank the father's name, address, RTO,
 * tax validity and seats Lite had returned; its chassis number came back partly
 * masked where Lite's was whole. So the record a customer pays for is built
 * from both: `primary`'s values win, any field it leaves blank is filled from
 * `secondary`, and a value the provider masked gives way to the same field
 * unmasked.
 */

type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** Field by field, nested objects included: `primary` unless it is blank. */
function fill(primary: unknown, secondary: unknown): unknown {
  if (isPlain(primary) && isPlain(secondary)) {
    const merged: Plain = {};
    for (const key of new Set([...Object.keys(primary), ...Object.keys(secondary)])) {
      merged[key] = fill(primary[key], secondary[key]);
    }
    return merged;
  }
  return isBlank(primary) ? (secondary ?? primary ?? null) : primary;
}

/** The value to keep for a field the provider may mask, and whether it is masked. */
function pick<T>(
  primary: T | null | undefined,
  primaryMasked: boolean,
  secondary: T | null | undefined,
  secondaryMasked: boolean,
): { value: T | null; masked: boolean } {
  if (isBlank(primary)) {
    return isBlank(secondary)
      ? { value: null, masked: false }
      : { value: secondary ?? null, masked: secondaryMasked };
  }
  if (primaryMasked && !isBlank(secondary) && !secondaryMasked) {
    return { value: secondary ?? null, masked: false };
  }
  return { value: primary ?? null, masked: primaryMasked };
}

export function mergeRcRecords(
  primary: VehicleRcRecord,
  secondary: VehicleRcRecord,
): VehicleRcRecord {
  const merged = fill(primary, secondary) as VehicleRcRecord;
  const primaryMasks: VehicleMaskedFields = primary.maskedByProvider;
  const secondaryMasks: VehicleMaskedFields = secondary.maskedByProvider;

  const ownerName = pick(
    primary.owner?.name,
    primaryMasks.ownerName,
    secondary.owner?.name,
    secondaryMasks.ownerName,
  );
  const chassis = pick(
    primary.chassisNumber,
    primaryMasks.chassisNumber,
    secondary.chassisNumber,
    secondaryMasks.chassisNumber,
  );
  const engine = pick(
    primary.engineNumber,
    primaryMasks.engineNumber,
    secondary.engineNumber,
    secondaryMasks.engineNumber,
  );

  return {
    ...merged,
    owner: merged.owner ? { ...merged.owner, name: ownerName.value } : merged.owner,
    chassisNumber: chassis.value,
    engineNumber: engine.value,
    maskedByProvider: {
      ownerName: ownerName.masked,
      chassisNumber: chassis.masked,
      engineNumber: engine.masked,
    },
    redacted: false,
  };
}

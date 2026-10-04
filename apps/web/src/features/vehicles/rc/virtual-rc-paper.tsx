import * as React from 'react';
import { rcValidity, type RcValidity, type VehicleRcRecord } from '@saarthi/shared';
import { InkStamp, PaperDecor } from './rc-security-art';

/**
 * The RTO record printed as a certificate — front (registration and owner) and
 * back (vehicle particulars).
 *
 * Renders only what the record carries. A field the RTO did not publish, or the
 * server withheld from this caller, arrives as `null` and prints as a dash:
 * redaction happens before the record is serialised, never here.
 */

export type RcSide = 'front' | 'back';

interface RcField {
  label: string;
  value: string | number | null | undefined;
  wide?: boolean;
}

const VALIDITY_INK: Record<RcValidity, string> = {
  VALID: '#1C6B42',
  EXPIRING_SOON: '#8A5300',
  EXPIRED: '#B42318',
  UNKNOWN: '#30354A',
};

function printed(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

/** Joins the parts that exist, or `null` when none do. */
function joined(parts: (string | number | null | undefined)[], separator = ' · '): string | null {
  const present = parts.filter((part) => part !== null && part !== undefined && part !== '');
  return present.length > 0 ? present.join(separator) : null;
}

function withUnit(value: number | null, unit: string): string | null {
  return value === null ? null : `${value} ${unit}`;
}

function frontFields(record: VehicleRcRecord, plate: string): RcField[] {
  return [
    { label: 'Registration no.', value: plate },
    { label: 'Date of registration', value: record.registrationDate },
    { label: 'Status', value: record.registrationStatus },
    { label: 'Owner name', value: record.owner?.name, wide: true },
    { label: 'Owner serial no.', value: record.owner?.serialNumber },
    { label: 'Son / wife / daughter of', value: record.owner?.fatherName, wide: true },
    { label: 'Mobile', value: record.owner?.mobileNumber },
    { label: 'Present address', value: record.owner?.presentAddress, wide: true },
    { label: 'Registering authority', value: joined([record.rto, record.rtoCode]) },
    { label: 'Chassis no.', value: record.chassisNumber },
    { label: 'Engine / motor no.', value: record.engineNumber },
    { label: 'Emission norms', value: record.emissionNorms },
    { label: 'Fuel', value: record.fuelType },
    { label: 'Colour', value: record.color },
    { label: 'Manufactured', value: record.manufacturedOn },
  ];
}

function backFields(record: VehicleRcRecord): RcField[] {
  return [
    { label: 'Vehicle class', value: record.vehicleClass },
    { label: 'Category', value: record.vehicleCategory },
    { label: 'Body type', value: record.bodyType },
    { label: 'Maker', value: record.maker },
    { label: 'Model', value: record.model },
    { label: 'Variant', value: record.variant },
    { label: 'Seating capacity', value: record.seatingCapacity },
    {
      label: 'Standing / sleeper',
      value:
        record.standingCapacity === null && record.sleeperCapacity === null
          ? null
          : `${printed(record.standingCapacity)} / ${printed(record.sleeperCapacity)}`,
    },
    { label: 'Cubic capacity', value: withUnit(record.cubicCapacity, 'cc') },
    { label: 'Cylinders', value: record.cylinders },
    { label: 'Wheelbase', value: withUnit(record.wheelbaseMm, 'mm') },
    {
      label: 'Unladen / gross weight',
      value:
        record.unladenWeight === null && record.grossVehicleWeight === null
          ? null
          : `${printed(record.unladenWeight)} / ${printed(record.grossVehicleWeight)} kg`,
    },
    {
      label: 'Hypothecated to',
      value:
        record.financed === false ? 'None' : record.financed ? (record.financer ?? 'Financed') : null,
    },
    { label: 'Permit', value: joined([record.permit.type, record.permit.number]) },
    { label: 'Permit valid until', value: record.permit.validUntil },
    { label: 'National permit', value: record.permit.national.number },
    { label: 'Blacklist status', value: record.blacklistStatus },
    { label: 'NOC', value: record.nocDetails },
    {
      label: 'Non-use',
      value: joined([record.nonUse.status, joined([record.nonUse.from, record.nonUse.to], ' – ')]),
    },
    { label: 'Challans', value: record.challanDetails },
  ];
}

function validityRows(record: VehicleRcRecord) {
  return [
    {
      name: 'Insurance',
      until: record.insuranceValidUntil,
      detail: joined([record.insurer, record.insurancePolicyNumber]),
    },
    { name: 'Pollution (PUCC)', until: record.puccValidUntil, detail: record.puccNumber },
    { name: 'Fitness', until: record.fitnessValidUntil, detail: null },
    {
      name: 'Road tax',
      until: record.tax.validUntil,
      detail: record.tax.paidUntil ? `Paid till ${record.tax.paidUntil}` : null,
    },
  ];
}

export function VirtualRcPaper({
  record,
  plate,
  side,
  verified,
  qrSrc,
  asOf,
}: {
  record: VehicleRcRecord;
  /** As printed in the header plate, e.g. `UP-63-N-5670`. */
  plate: string;
  side: RcSide;
  /** The vehicle's registration has been verified on Saarthi. */
  verified: boolean;
  /** The vehicle's own QR, when this caller may see it. */
  qrSrc: string | null;
  /** When the provider last refreshed the record, as printed. */
  asOf: string;
}) {
  const fields = side === 'front' ? frontFields(record, plate.replace(/-/g, '')) : backFields(record);

  return (
    <article
      key={side}
      className="vrc-paper"
      aria-label={`Virtual RC, ${side === 'front' ? 'front' : 'back'}`}
    >
      <PaperDecor />

      <div className="vrc-head">
        <div>
          <p className="vrc-title">Certificate of registration</p>
          <p className="vrc-subtitle">
            {side === 'front' ? 'Part A · registration and owner' : 'Part B · vehicle particulars'} ·
            virtual copy
          </p>
        </div>
        <div className="flex flex-col items-end gap-2.5">
          <div className="vrc-plate" role="img" aria-label={`Registration ${plate}`}>
            <span className="vrc-plate-ind">IND</span>
            <span className="vrc-plate-no">{plate}</span>
          </div>
          {verified ? (
            <span className="vrc-seal">
              <span className="vrc-holo" aria-hidden />
              Saarthi verified
            </span>
          ) : null}
        </div>
      </div>

      <div className="vrc-body" data-side={side}>
        <dl className="vrc-grid m-0">
          {fields.map((field) => (
            <div key={field.label} className="vrc-field" data-wide={field.wide ? '' : undefined}>
              <dt className="vrc-key">{field.label}</dt>
              <dd className="vrc-value m-0">{printed(field.value)}</dd>
            </div>
          ))}
        </dl>

        {side === 'front' ? (
          <aside className="vrc-stub" aria-label="Validity">
            <p className="vrc-stub-heading">Validity</p>
            {validityRows(record).map((row) => {
              const { validity } = rcValidity(row.until);
              return (
                <div key={row.name} className="flex flex-col gap-0.5">
                  <span className="vrc-stub-name">{row.name}</span>
                  <span className="vrc-stub-line" style={{ color: VALIDITY_INK[validity] }}>
                    {row.until ? `Till ${row.until}` : 'Not published'}
                  </span>
                  {row.detail ? (
                    <span className="vrc-stub-line opacity-70">{row.detail}</span>
                  ) : null}
                </div>
              );
            })}
          </aside>
        ) : null}
      </div>

      <div className="vrc-foot">
        {qrSrc ? <img src={qrSrc} alt="This vehicle's QR code" className="vrc-qr" /> : null}
        <p className="vrc-note">
          A rendering of the RTO record for reference. Carry the original RC or its DigiLocker copy
          when you drive. Data as of {asOf}.
        </p>
      </div>
      <InkStamp date={asOf} />
    </article>
  );
}

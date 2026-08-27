import type { ReactNode } from 'react';
import {
  rcValidity,
  type DrivingLicenceRecord,
  type RcValidity,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';

/**
 * Presentation for the two RTO records — the registration certificate and the
 * driving licence.
 *
 * Extracted from the RC and licence lookup panels because a third screen now
 * renders the same records: the public scan page a QR sticker opens. Keeping
 * one renderer means a field added to the RC contract appears everywhere at
 * once, and — more importantly — that the fleet-facing and roadside-facing
 * views of the same certificate cannot drift into disagreeing about it.
 *
 * These components render whatever they are handed and make no authorisation
 * decisions. Redaction happens on the server, before the record is serialised,
 * so a field the caller may not see arrives as `null` and shows as an em dash.
 */

const VALIDITY_TONE: Record<
  RcValidity,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }
> = {
  VALID: { label: 'Valid', variant: 'success' },
  EXPIRING_SOON: { label: 'Expiring soon', variant: 'warning' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  UNKNOWN: { label: 'Not published', variant: 'muted' },
};

/** One label/value pair. Renders an em dash when the RTO published nothing. */
export function RtoDetail({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm" title={display}>
        {display}
      </p>
    </div>
  );
}

/** A dated document and whether it is still current. */
export function RtoValidityRow({
  label,
  validUntil,
}: {
  label: string;
  validUntil: string | null;
}) {
  const { validity, daysRemaining } = rcValidity(validUntil);
  const tone = VALIDITY_TONE[validity];

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {validUntil ? (
          <span className="tabular text-xs text-muted-foreground">
            {validUntil}
            {daysRemaining !== null && validity !== 'EXPIRED' ? ` · ${daysRemaining} days` : ''}
          </span>
        ) : null}
        <Badge variant={tone.variant} size="sm">
          {tone.label}
        </Badge>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

/** The four dated documents that decide whether a vehicle is legal today. */
export function RcComplianceRows({ record }: { record: VehicleRcRecord }) {
  return (
    <>
      <RtoValidityRow label="Insurance" validUntil={record.insuranceValidUntil} />
      <RtoValidityRow label="PUC" validUntil={record.puccValidUntil} />
      <RtoValidityRow label="Fitness" validUntil={record.fitnessValidUntil} />
      <RtoValidityRow label="Road tax" validUntil={record.tax.validUntil} />
    </>
  );
}

export function RcRecordDetails({ record }: { record: VehicleRcRecord }) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionHeading>Vehicle</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <RtoDetail label="Maker" value={record.maker} />
          <RtoDetail label="Model" value={record.model} />
          <RtoDetail label="Variant" value={record.variant} />
          <RtoDetail label="Class" value={record.vehicleClass} />
          <RtoDetail label="Category" value={record.vehicleCategory} />
          <RtoDetail label="Body type" value={record.bodyType} />
          <RtoDetail label="Fuel" value={record.fuelType} />
          <RtoDetail label="Colour" value={record.color} />
          <RtoDetail label="Emission norms" value={record.emissionNorms} />
          <RtoDetail label="Manufactured" value={record.manufacturedOn} />
          <RtoDetail
            label="Cubic capacity"
            value={record.cubicCapacity === null ? null : `${record.cubicCapacity} cc`}
          />
          <RtoDetail label="Cylinders" value={record.cylinders} />
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeading>Capacity &amp; weight</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <RtoDetail label="Seating" value={record.seatingCapacity} />
          <RtoDetail label="Sleeper" value={record.sleeperCapacity} />
          <RtoDetail label="Standing" value={record.standingCapacity} />
          <RtoDetail
            label="Gross weight"
            value={record.grossVehicleWeight === null ? null : `${record.grossVehicleWeight} kg`}
          />
          <RtoDetail
            label="Unladen weight"
            value={record.unladenWeight === null ? null : `${record.unladenWeight} kg`}
          />
          <RtoDetail
            label="Wheelbase"
            value={record.wheelbaseMm === null ? null : `${record.wheelbaseMm} mm`}
          />
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeading>Registration &amp; RTO</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <RtoDetail label="Registered on" value={record.registrationDate} />
          <RtoDetail label="RTO" value={record.rto} />
          <RtoDetail label="RTO code" value={record.rtoCode} />
          <RtoDetail label="Insurer" value={record.insurer} />
          <RtoDetail label="Policy number" value={record.insurancePolicyNumber} />
          <RtoDetail label="PUCC number" value={record.puccNumber} />
          <RtoDetail label="Tax paid until" value={record.tax.paidUntil} />
          <RtoDetail label="Permit type" value={record.permit.type} />
          <RtoDetail label="Permit valid until" value={record.permit.validUntil} />
          <RtoDetail label="National permit" value={record.permit.national.number} />
          <RtoDetail
            label="Financed"
            value={record.financed === null ? null : record.financed ? 'Yes' : 'No'}
          />
          <RtoDetail label="Financer" value={record.financer} />
        </div>
      </section>

      {record.owner || record.engineNumber || record.chassisNumber ? (
        <section className="space-y-2">
          <SectionHeading>Owner &amp; identifiers</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <RtoDetail label="Owner" value={record.owner?.name} />
            <RtoDetail label="Father / husband" value={record.owner?.fatherName} />
            <RtoDetail label="Owner serial" value={record.owner?.serialNumber} />
            <RtoDetail label="Engine number" value={record.engineNumber} />
            <RtoDetail label="Chassis number" value={record.chassisNumber} />
            <RtoDetail label="Mobile" value={record.owner?.mobileNumber} />
            <RtoDetail label="Present address" value={record.owner?.presentAddress} />
            <RtoDetail label="Permanent address" value={record.owner?.permanentAddress} />
          </div>
        </section>
      ) : null}

      {record.blacklistStatus || record.nocDetails || record.nonUse.status ? (
        <section className="space-y-2">
          <SectionHeading>Flags</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <RtoDetail label="Blacklist" value={record.blacklistStatus} />
            <RtoDetail label="NOC" value={record.nocDetails} />
            <RtoDetail label="Non-use status" value={record.nonUse.status} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The two dates that decide whether a licence is valid for the job today. */
export function LicenceValidityRows({ record }: { record: DrivingLicenceRecord }) {
  return (
    <>
      <RtoValidityRow label="Licence" validUntil={record.validUntil} />
      <RtoValidityRow label="Commercial (transport)" validUntil={record.transportValidUntil} />
    </>
  );
}

/** Entitlement codes, e.g. `LMV-NT`, `HTV`. Nothing rendered when none. */
export function LicenceClasses({ record }: { record: DrivingLicenceRecord }) {
  if (record.vehicleClasses.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {record.vehicleClasses.map((entry) => (
        <Badge key={entry} variant="outline" size="sm" className="font-mono">
          {entry}
        </Badge>
      ))}
    </div>
  );
}

export function LicenceRecordDetails({ record }: { record: DrivingLicenceRecord }) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionHeading>Licence</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <RtoDetail label="Number" value={record.licenceNumber} />
          <RtoDetail label="State" value={record.state} />
          <RtoDetail label="Issuing RTO" value={record.issuingAuthority} />
          <RtoDetail label="RTO code" value={record.issuingAuthorityCode} />
          <RtoDetail label="Issued on" value={record.issuedOn} />
          <RtoDetail label="Transport issued on" value={record.transportIssuedOn} />
        </div>
      </section>

      {record.holder ? (
        <section className="space-y-2">
          <SectionHeading>Holder</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <RtoDetail label="Name" value={record.holder.name} />
            <RtoDetail label="Father / husband" value={record.holder.fatherOrHusbandName} />
            <RtoDetail label="Date of birth" value={record.holder.dateOfBirth} />
            <RtoDetail label="Gender" value={record.holder.gender} />
            <RtoDetail label="Blood group" value={record.holder.bloodGroup} />
            <RtoDetail label="Citizenship" value={record.holder.citizenship} />
            <RtoDetail label="Permanent address" value={record.holder.permanentAddress} />
            <RtoDetail label="Permanent PIN" value={record.holder.permanentZip} />
            <RtoDetail label="Present address" value={record.holder.temporaryAddress} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

import type { VehicleRcRecord } from '@saarthi/shared';

/**
 * Vehicle RC provider contract.
 *
 * Everything upstream-specific — endpoint shape, field names, status
 * vocabulary, PDF hosting — lives behind this interface. The service layer
 * only ever sees `VehicleRcRecord`, so swapping the data provider is a new
 * file in this folder and one line in the factory.
 */

export interface VehicleRcLookup {
  /** Already normalised, e.g. `UP32AB1234`. */
  registrationNumber: string;
}

export interface VehicleRcPdfDocument {
  content: Buffer;
  /** Detected from the bytes, never from the provider's content-type header. */
  mimeType: string;
}

export interface VehicleRcLookupResult {
  record: VehicleRcRecord;
  /**
   * Temporary provider URL for the RC document, or `null` when the provider
   * could not produce one. Never handed to the browser.
   */
  pdfUrl: string | null;
  /** Provider-side order/reference id, for support and billing queries. */
  providerReference: string | null;
}

export interface VehicleRcProvider {
  readonly name: string;
  /** False when the environment has no credentials for this provider. */
  readonly configured: boolean;
  lookup(input: VehicleRcLookup): Promise<VehicleRcLookupResult>;
  /** Fetch the temporary document so Saarthi can store its own copy. */
  downloadPdf(url: string): Promise<VehicleRcPdfDocument>;
}

/** An RC record with every field null — the base a normaliser fills in. */
export function emptyVehicleRcRecord(): VehicleRcRecord {
  return {
    registrationNumber: null,
    registrationDate: null,
    registrationStatus: null,
    owner: null,
    vehicleCategory: null,
    vehicleClass: null,
    bodyType: null,
    maker: null,
    model: null,
    variant: null,
    fuelType: null,
    color: null,
    emissionNorms: null,
    manufacturedOn: null,
    engineNumber: null,
    chassisNumber: null,
    cubicCapacity: null,
    cylinders: null,
    seatingCapacity: null,
    sleeperCapacity: null,
    standingCapacity: null,
    wheelbaseMm: null,
    grossVehicleWeight: null,
    unladenWeight: null,
    rto: null,
    rtoCode: null,
    insurer: null,
    insurancePolicyNumber: null,
    insuranceValidUntil: null,
    puccNumber: null,
    puccValidUntil: null,
    fitnessValidUntil: null,
    tax: { validUntil: null, paidUntil: null },
    permit: {
      number: null,
      type: null,
      issuedOn: null,
      validFrom: null,
      validUntil: null,
      national: { number: null, validUntil: null, issuedBy: null },
    },
    financed: null,
    financer: null,
    blacklistStatus: null,
    nocDetails: null,
    nonUse: { status: null, from: null, to: null },
    challanDetails: null,
    dataAsOf: null,
    partialRecord: null,
    maskedByProvider: { ownerName: false, chassisNumber: false, engineNumber: false },
    redacted: false,
  };
}

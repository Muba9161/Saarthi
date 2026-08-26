import type { MaintenanceType, ServiceCategory } from '@saarthi/shared';

/**
 * Service-history provider abstraction.
 *
 * External service history exists in India in fragments: an OEM's own network
 * knows the visits to its dealers, an insurer knows the accident repairs, a
 * fleet knows the roadside jobs nobody else recorded. No provider has the whole
 * picture, and this interface is shaped around that rather than pretending
 * otherwise — `coverageNote` is a first-class field because "we have three of
 * your eleven services" is the honest answer and the UI has to be able to say
 * it.
 */

export interface ProviderServiceRecord {
  /** The provider's own identifier, for de-duplication across syncs. */
  externalId: string;
  serviceDate: string;
  type: MaintenanceType;
  category: ServiceCategory | null;
  title: string;
  description: string | null;
  odometerKm: number | null;
  workshopName: string | null;
  workshopAddress: string | null;
  invoiceNumber: string | null;
  labourCost: number | null;
  partsCost: number | null;
  totalCost: number | null;
  replacedComponents: string[];
  diagnosticCodes: string[];
  warrantyUntil: string | null;
}

export interface ProviderServiceHistory {
  registrationNumber: string;
  records: ProviderServiceRecord[];
  provider: string;
  retrievedAt: string;
  /**
   * What this provider does and does not cover, in plain words. Shown to the
   * operator so an incomplete history is never mistaken for a complete one.
   */
  coverageNote: string;
  /** `true` when the records were generated locally for development. */
  simulated: boolean;
}

export interface ProviderHistoryRequest {
  registrationNumber: string;
  vin: string | null;
  since?: Date | null;
}

export interface ServiceHistoryProvider {
  readonly name: string;
  /** Whether this deployment can retrieve external history at all. */
  readonly supportsRetrieval: boolean;
  readonly retrievalUnavailableReason: string;
  fetchHistory(request: ProviderHistoryRequest): Promise<ProviderServiceHistory>;
}

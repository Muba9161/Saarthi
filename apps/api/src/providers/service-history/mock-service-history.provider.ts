import { MaintenanceType, ServiceCategory, ServiceComponent } from '@saarthi/shared';
import type {
  ProviderHistoryRequest,
  ProviderServiceHistory,
  ProviderServiceRecord,
  ServiceHistoryProvider,
} from './service-history.provider';

/**
 * Local stand-in for an OEM or workshop-network history feed.
 *
 * Returns a *partial* history on purpose — three visits over eighteen months,
 * not a complete one — because partial is what a real network returns. The
 * merge, coverage-note and conflict paths are the ones that break in
 * production, so local development has to exercise them.
 *
 * Dates and readings are derived from the registration number, so the same
 * vehicle produces the same history on every run and a demo is reproducible.
 */
export class MockServiceHistoryProvider implements ServiceHistoryProvider {
  readonly name = 'mock';
  readonly supportsRetrieval = true;
  readonly retrievalUnavailableReason = '';

  async fetchHistory(request: ProviderHistoryRequest): Promise<ProviderServiceHistory> {
    const seed = [...request.registrationNumber].reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    );
    const now = Date.now();
    const day = 86_400_000;

    const template: Array<{
      monthsAgo: number;
      type: MaintenanceType;
      category: ServiceCategory;
      title: string;
      components: string[];
      cost: number;
    }> = [
      {
        monthsAgo: 3,
        type: MaintenanceType.OIL_CHANGE,
        category: ServiceCategory.ROUTINE,
        title: 'Periodic service — engine oil and filters',
        components: [ServiceComponent.ENGINE_OIL, ServiceComponent.OIL_FILTER],
        cost: 8_400,
      },
      {
        monthsAgo: 9,
        type: MaintenanceType.BRAKE,
        category: ServiceCategory.BRAKES,
        title: 'Brake liner replacement — rear axle',
        components: [ServiceComponent.BRAKE_LINER],
        cost: 14_200,
      },
      {
        monthsAgo: 18,
        type: MaintenanceType.PREVENTIVE,
        category: ServiceCategory.ROUTINE,
        title: 'Scheduled service',
        components: [ServiceComponent.ENGINE_OIL, ServiceComponent.AIR_FILTER],
        cost: 9_100,
      },
    ];

    const records: ProviderServiceRecord[] = template
      .filter((entry) => {
        if (!request.since) return true;
        return now - entry.monthsAgo * 30 * day >= request.since.getTime();
      })
      .map((entry, index) => {
        const serviceDate = new Date(now - entry.monthsAgo * 30 * day);
        const parts = Math.round(entry.cost * 0.6);
        return {
          externalId: `SIM-${request.registrationNumber}-${entry.monthsAgo}`,
          serviceDate: serviceDate.toISOString(),
          type: entry.type,
          category: entry.category,
          title: entry.title,
          description: null,
          // Odometer walks backwards from a seeded current reading.
          odometerKm: Math.max(0, 120_000 + (seed % 5_000) - entry.monthsAgo * 4_000),
          workshopName: index % 2 === 0 ? 'Authorised Service Centre' : 'Highway Motors',
          workshopAddress: 'NH-19, Kanpur',
          invoiceNumber: `INV-SIM-${seed % 9000}-${index}`,
          labourCost: entry.cost - parts,
          partsCost: parts,
          totalCost: entry.cost,
          replacedComponents: entry.components,
          diagnosticCodes: [],
          warrantyUntil: null,
        };
      });

    return {
      registrationNumber: request.registrationNumber,
      records,
      provider: this.name,
      retrievedAt: new Date().toISOString(),
      coverageNote:
        'Simulated network covering authorised service centres only. Roadside and independent ' +
        'workshop visits are not included, so this is never a complete history.',
      simulated: true,
    };
  }
}

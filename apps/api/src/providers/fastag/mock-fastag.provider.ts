import { FastagStatus, TollDirection, normalizeRegistrationNumber } from '@saarthi/shared';
import type {
  FastagProvider,
  ProviderTagDetails,
  ProviderTollCrossing,
  ProviderTollHistory,
  TagLookupRequest,
} from './fastag.provider';

/**
 * Local NETC stand-in.
 *
 * Unlike the real adapter this *does* serve a balance, and that is deliberate:
 * the low-balance sweep, the recharge prompt and the blocked-tag banner are the
 * paths most likely to be wrong, and none of them can be exercised locally
 * against a provider that returns tag status alone.
 *
 * Everything it returns is flagged `simulated: true` and stored that way, so a
 * demo balance can never be mistaken for a real one.
 *
 * The state is derived from the registration number, so the same vehicle is the
 * same story on every run: most tags healthy, one low, one blacklisted.
 */
export class MockFastagProvider implements FastagProvider {
  readonly name = 'mock';
  readonly supportsLookup = true;
  readonly supportsBalance = true;
  readonly supportsRecharge = false;
  readonly supportsTransactions = true;
  readonly unavailableReason = '';

  async fetchTagDetails(request: TagLookupRequest): Promise<ProviderTagDetails> {
    const registrationNumber = normalizeRegistrationNumber(request.registrationNumber);
    const seed = seedOf(registrationNumber);

    // One vehicle in seven is blacklisted, one in five is low — frequent enough
    // that a demo fleet always has both to look at.
    const blacklisted = seed % 7 === 0;
    const low = !blacklisted && seed % 5 === 0;

    return {
      tagId: tagIdFor(seed),
      registrationNumber,
      vehicleClass: seed % 3 === 0 ? 'VC12' : 'VC11',
      status: blacklisted
        ? FastagStatus.BLACKLISTED
        : low
          ? FastagStatus.LOW_BALANCE
          : FastagStatus.ACTIVE,
      rawStatus: blacklisted ? 'B' : 'A',
      exceptionCode: blacklisted ? '176' : '00',
      issuerBank: ['ICICI Bank', 'HDFC Bank', 'Paytm Payments Bank', 'IDFC FIRST Bank'][seed % 4]!,
      issuerCode: String(607_000 + (seed % 900)),
      issuedAt: new Date(Date.now() - (300 + (seed % 400)) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      commercialVehicle: true,
      balance: blacklisted ? 0 : low ? 120 + (seed % 300) : 1_800 + (seed % 4_000),
      provider: this.name,
      retrievedAt: new Date().toISOString(),
      simulated: true,
    };
  }

  async fetchTollHistory(request: TagLookupRequest): Promise<ProviderTollHistory> {
    const registrationNumber = normalizeRegistrationNumber(request.registrationNumber);
    const seed = seedOf(registrationNumber);
    const now = Date.now();

    const plazas = [
      { name: 'Ladpalwan Toll Plaza', code: 'LDP01', lat: 32.197881, lng: 75.533697, fare: 285 },
      { name: 'Barabanki Toll Plaza', code: 'BRB02', lat: 26.9124, lng: 81.1861, fare: 430 },
      { name: 'Kannauj Toll Plaza', code: 'KNJ03', lat: 27.0545, lng: 79.9187, fare: 375 },
      { name: 'Sikandra Toll Plaza', code: 'SKD04', lat: 27.2205, lng: 78.0064, fare: 510 },
    ];

    // Three days of crossings, matching the window a real NETC feed serves.
    const crossings: ProviderTollCrossing[] = plazas.slice(0, 3 + (seed % 2)).map((plaza, index) => ({
      externalReference: `SIM-${registrationNumber}-${index}`,
      plazaName: plaza.name,
      plazaCode: plaza.code,
      latitude: plaza.lat,
      longitude: plaza.lng,
      direction: index % 2 === 0 ? TollDirection.INBOUND : TollDirection.OUTBOUND,
      crossedAt: new Date(now - (index * 9 + 3) * 3_600_000).toISOString(),
      amount: plaza.fare,
      balanceAfter: null,
      vehicleClass: 'VC11',
      registrationNumber,
    }));

    return {
      registrationNumber,
      crossings,
      provider: this.name,
      retrievedAt: new Date().toISOString(),
      coverageNote:
        'Simulated NETC feed covering roughly 72 hours, matching what a real provider serves. ' +
        'Not a record of real journeys.',
      simulated: true,
    };
  }
}

function seedOf(value: string): number {
  return [...value].reduce((total, character) => total + character.charCodeAt(0), 0);
}

/** A 24-character hex tag id, shaped like a real NETC EPC. */
function tagIdFor(seed: number): string {
  const body = (seed * 2_654_435_761).toString(16).toUpperCase().padStart(18, '0').slice(0, 18);
  return `34161FA8${body}`.slice(0, 24);
}

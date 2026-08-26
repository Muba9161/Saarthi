import type { FastagStatus, TollDirection } from '@saarthi/shared';

/**
 * FASTag / NETC provider abstraction.
 *
 * The capability flags are the important part of this interface, and they exist
 * because of how the Indian toll ecosystem is actually shaped:
 *
 *   • **Tag status is widely available.** Several aggregators resolve a vehicle
 *     number to its tag id, issuing bank, class and NETC status.
 *   • **The rupee balance is not.** It sits with the issuing bank and is served
 *     to the account holder, not to third parties. Most NETC lookup APIs return
 *     no balance at all — so `supportsBalance` is usually `false`, and Saarthi
 *     shows what the operator recorded rather than inventing a figure.
 *   • **Recharge is a payment rail, not a lookup.** Topping up a tag goes
 *     through the issuer or a BBPS agent. A verification provider cannot do it,
 *     so `supportsRecharge` is usually `false` and Saarthi records a top-up
 *     made elsewhere instead of pretending to perform one.
 *
 * A caller must check the flag before offering the action. Everything else in
 * this module exists to make sure the UI never promises something the
 * configured provider cannot do.
 */

export interface ProviderTagDetails {
  tagId: string | null;
  registrationNumber: string | null;
  /** NETC vehicle class, e.g. VC04, VC11, VC20. */
  vehicleClass: string | null;
  status: FastagStatus;
  /** The raw status letter the provider sent, kept for support. */
  rawStatus: string | null;
  /** NETC exception code. "00" means no exception. */
  exceptionCode: string | null;
  issuerBank: string | null;
  /** NETC bank identifier, when the provider gives one rather than a name. */
  issuerCode: string | null;
  issuedAt: string | null;
  commercialVehicle: boolean | null;
  /**
   * Balance in rupees, or `null` when the provider does not serve one — which
   * is the normal case. Never defaulted to zero.
   */
  balance: number | null;
  provider: string;
  retrievedAt: string;
  simulated: boolean;
}

export interface ProviderTollCrossing {
  /** The provider's own reference. Used to de-duplicate across syncs. */
  externalReference: string | null;
  plazaName: string;
  plazaCode: string | null;
  latitude: number | null;
  longitude: number | null;
  direction: TollDirection;
  crossedAt: string;
  /** `null` when the feed reports crossings without an amount. */
  amount: number | null;
  balanceAfter: number | null;
  vehicleClass: string | null;
  registrationNumber: string | null;
}

export interface ProviderTollHistory {
  registrationNumber: string;
  crossings: ProviderTollCrossing[];
  provider: string;
  retrievedAt: string;
  /**
   * What this feed does and does not cover, in plain words.
   *
   * NETC transaction feeds are short — Masters India keeps 72 hours — and a UI
   * that showed three days of crossings as "your toll history" would be lying
   * by omission.
   */
  coverageNote: string;
  simulated: boolean;
}

export interface TagLookupRequest {
  registrationNumber: string;
  /** Either identifier is accepted; the tag id is the more precise one. */
  tagId?: string | null;
}

export interface FastagProvider {
  readonly name: string;
  /** Can resolve a vehicle or tag id to NETC tag details. */
  readonly supportsLookup: boolean;
  /** Serves the rupee balance. Rare — see the note above. */
  readonly supportsBalance: boolean;
  /** Can initiate a recharge. Requires a payment rail, not a lookup API. */
  readonly supportsRecharge: boolean;
  /** Serves recent toll crossings. */
  readonly supportsTransactions: boolean;
  readonly unavailableReason: string;

  fetchTagDetails(request: TagLookupRequest): Promise<ProviderTagDetails>;
  fetchTollHistory(request: TagLookupRequest): Promise<ProviderTollHistory>;
}

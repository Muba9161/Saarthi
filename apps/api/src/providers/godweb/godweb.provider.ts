/**
 * GODWeb salesman-identity contract.
 *
 * GODWeb is an existing, working project and Saarthi does not modify it. This
 * interface is the *only* way Saarthi may learn anything about a salesperson,
 * and it is deliberately narrow: one read, one question — "is this GODID a
 * salesperson you recognise, and what may I display for them".
 *
 * What is deliberately absent, and must stay absent:
 *
 *   * any create, update or delete — Saarthi never provisions a GODWeb account;
 *   * any direct database access — the adapter speaks HTTP to an approved
 *     endpoint and nothing else;
 *   * any password, session or token belonging to GODWeb — Saarthi's own
 *     authentication is the only credential a salesperson uses here;
 *   * any "assume valid" path. A GODID that cannot be checked is unverified,
 *     which is a different state from verified and is treated as one.
 *
 * ## The outstanding dependency
 *
 * At the time of writing, the read-only validation endpoint this interface
 * needs has not been published by GODWeb. `GODWEB_VALIDATE_PATH` is therefore
 * configuration rather than a constant, and the response mapping in
 * `http-godweb.provider.ts` accepts several plausible field spellings so that
 * pointing Saarthi at the real endpoint is an `.env` change rather than a code
 * change. Until it exists, verification is *unavailable* on this environment —
 * see `index.ts`. Nothing here fabricates a GODWeb-side system.
 */

/** What GODWeb is prepared to tell Saarthi about one of its salespeople. */
export interface GodWebSalesperson {
  /** The GODID, as GODWeb spells it. Normalised by the caller. */
  godId: string;
  /** Display name. Shown to the salesperson and on a referral landing page. */
  name: string | null;
  phone: string | null;
  email: string | null;
  /** The sales organization's own staff identifier, where GODWeb holds one. */
  externalSalespersonId: string | null;
  territory: string | null;
  /**
   * Whether GODWeb considers this person currently able to sell.
   *
   * Distinct from "the record exists": a salesperson who has left is a record
   * GODWeb still holds and Saarthi must stop crediting. A `false` here
   * suspends the Saarthi profile rather than deleting it, because their past
   * commissions still have to reconcile.
   */
  active: boolean;
}

/**
 * The result of one validation call.
 *
 * `found: false` is a **successful** call with a negative answer — GODWeb was
 * asked and does not recognise the GODID — and the caller records that as a
 * rejection. Failing to get an answer at all throws instead, because "we could
 * not ask" and "the answer is no" must never be conflated: the first must
 * leave a profile pending, and the second must reject it.
 */
export interface GodWebValidationOutcome {
  found: boolean;
  salesperson: GodWebSalesperson | null;
  /** GODWeb's own reference for this call, kept for support. */
  providerReference: string | null;
  /** GODWeb's explanation of a negative answer, when it gave one. */
  message: string | null;
}

export interface GodWebProvider {
  readonly name: string;
  readonly configured: boolean;
  /**
   * Validate one GODID.
   *
   * Throws `providerUnavailable` / `providerTimeout` when GODWeb could not be
   * reached, and `provider` when it answered with something unreadable.
   */
  validateGodId(godId: string): Promise<GodWebValidationOutcome>;
}

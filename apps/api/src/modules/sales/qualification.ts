import { CommissionTrigger, type PlanTier } from '@saarthi/shared';
import { logger } from '../../lib/logger';
import { generateForPayment } from './commission.service';
import { liveAttributionFor } from './referral.service';
import { syncFromCustomerState } from './lead.service';
import { markInstalledIfFitted } from './handover.service';
import { prisma } from '../../database/prisma';

/**
 * The one seam between the money and the commission.
 *
 * The subscription module calls exactly this, from exactly the points where a
 * gateway has confirmed that a customer's money moved. Keeping the seam to one
 * function has a purpose beyond tidiness: it means the answer to "what can
 * cause a commission to exist?" is a single call site list, which is the
 * question an audit asks.
 *
 * ## Contract with its callers
 *
 * `qualifyPayment` **never throws and never rejects.** Its callers have already
 * taken a customer's money and provisioned what they bought; a commission
 * failure must not roll any of that back, and must not surface to a customer
 * who has no idea a salesperson exists. Every failure is logged and swallowed.
 *
 * ## Why the base amount is pre-tax
 *
 * Commission is paid on Saarthi's revenue, and GST is not Saarthi's revenue —
 * it is collected on the government's behalf and passed on. Paying a percentage
 * of the GST-inclusive figure would mean paying commission on tax. Every caller
 * therefore passes the catalogue subtotal, not the charged total.
 */

const qualifyLogger = logger.child({ module: 'sales:qualification' });

export interface QualifyPaymentInput {
  organizationId: string;
  /** Pre-GST amount, in rupees. See the note above. */
  baseAmount: number;
  /** The gateway's reference for the successful payment. The idempotency key. */
  paymentReference: string | null;
  trigger: CommissionTrigger;
  planTier?: PlanTier | null;
  subscriptionId?: string | null;
}

/**
 * Record whatever commission this payment earns, if any.
 *
 * Returns nothing. A caller that wanted the outcome would be a caller that
 * might branch on it, and none of them should: the customer's purchase has
 * already succeeded either way.
 */
export async function qualifyPayment(input: QualifyPaymentInput): Promise<void> {
  try {
    if (!input.paymentReference) {
      // Without a gateway reference there is no idempotency key, so a retry
      // could pay twice. Refusing is the safe answer; the mock provider always
      // supplies one, and so does every real gateway.
      qualifyLogger.debug(
        { organizationId: input.organizationId, trigger: input.trigger },
        'Payment carried no provider reference — no commission recorded',
      );
      return;
    }

    // Cheap short-circuit for the ordinary case: most customers arrive
    // self-serve and are attributed to nobody, and there is no point resolving
    // a rule for them.
    const attribution = await liveAttributionFor(input.organizationId);
    if (!attribution) return;

    await generateForPayment({
      organizationId: input.organizationId,
      baseAmount: input.baseAmount,
      paymentReference: input.paymentReference,
      trigger: input.trigger,
      planTier: input.planTier ?? null,
      subscriptionId: input.subscriptionId ?? null,
    });

    await advanceSalesRecords(input.organizationId);
  } catch (error) {
    qualifyLogger.error(
      {
        err: error,
        organizationId: input.organizationId,
        trigger: input.trigger,
        paymentReference: input.paymentReference,
      },
      'Commission qualification failed for a successful payment',
    );
  }
}

/**
 * Bring the salesperson's own records into line after a payment.
 *
 * Two side effects, both derived from real state rather than asserted:
 *
 *   * the lead's stage is recomputed from the customer's subscription, tracker
 *     and vehicle state;
 *   * a tracker that has since been fitted is marked installed, from the
 *     device assignment.
 *
 * Best-effort and separate from the commission itself, so a failure here cannot
 * cost somebody their earnings.
 */
async function advanceSalesRecords(organizationId: string): Promise<void> {
  const [leads, handovers] = await Promise.all([
    prisma.salesLead.findMany({
      where: { organizationId },
      select: { id: true },
      take: 10,
    }),
    prisma.trackerHandover.findMany({
      where: { organizationId, status: 'HANDED_TO_CUSTOMER' },
      select: { id: true },
      take: 50,
    }),
  ]);

  for (const lead of leads) {
    await syncFromCustomerState(lead.id).catch((error: unknown) => {
      qualifyLogger.warn({ err: error, leadId: lead.id }, 'Lead stage could not be refreshed');
      return null;
    });
  }

  for (const handover of handovers) {
    await markInstalledIfFitted(handover.id).catch((error: unknown) => {
      qualifyLogger.warn(
        { err: error, handoverId: handover.id },
        'Tracker handover could not be refreshed',
      );
      return false;
    });
  }
}

/**
 * The subscription-plan hook, for when plan billing charges for a plan.
 *
 * Called by nothing today, and that is a statement about Saarthi rather than an
 * oversight: a plan is taken out on trial and there is no recurring invoice run
 * in this codebase, so **no payment for a plan has ever been taken** and there
 * is nothing honest to qualify. The specification is explicit that commission
 * must not be payable merely because a subscription record exists, so the hook
 * waits here for the payment rather than firing on the record.
 *
 * When plan billing lands, its success path calls this and nothing else needs
 * to change — the rule resolution, the idempotency and the qualification period
 * already handle `CommissionTrigger.SUBSCRIPTION`.
 */
export async function qualifySubscriptionPayment(input: {
  organizationId: string;
  /** Pre-GST plan charge. */
  baseAmount: number;
  paymentReference: string;
  planTier: PlanTier;
  subscriptionId?: string | null;
}): Promise<void> {
  await qualifyPayment({
    ...input,
    trigger: CommissionTrigger.SUBSCRIPTION,
  });
}

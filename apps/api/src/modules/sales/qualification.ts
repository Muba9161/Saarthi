import { PaymentTrigger, type PlanTier } from '@saarthi/shared';
import { logger } from '../../lib/logger';
import { liveAttributionFor, markConverted } from './referral.service';
import { syncFromCustomerState } from './lead.service';
import { markInstalledIfFitted } from './handover.service';
import { prisma } from '../../database/prisma';
import { qualifyForPayment as qualifyReferralProgram } from '../referral-program/referral-program.service';

/**
 * The one seam between a customer's money and the referral records.
 *
 * The subscription module calls exactly this, from exactly the points where a
 * gateway has confirmed that a customer's money moved. What it does with that:
 *
 *   * a Refer & Earn referral is marked qualified on the first subscription
 *     payment — reporting only, since its reward was paid at signup;
 *   * a salesperson's customer is marked converted on the same event, and
 *     their lead and tracker records are brought up to date.
 *
 * Nothing here pays anybody. Rewards are credited when a referral succeeds —
 * see `rewardSalesperson` and the Refer & Earn signup.
 *
 * ## Contract with its callers
 *
 * `qualifyPayment` **never throws and never rejects.** Its callers have already
 * taken a customer's money and provisioned what they bought; a failure here
 * must not roll any of that back, and must not surface to a customer who has
 * no idea a salesperson exists. Every failure is logged and swallowed.
 */

const qualifyLogger = logger.child({ module: 'sales:qualification' });

export interface QualifyPaymentInput {
  organizationId: string;
  /** Pre-GST amount, in rupees. */
  baseAmount: number;
  /** The gateway's reference for the successful payment. The idempotency key. */
  paymentReference: string | null;
  trigger: PaymentTrigger;
  planTier?: PlanTier | null;
  subscriptionId?: string | null;
}

/**
 * Bring the referral records in line with a successful payment.
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
        'Payment carried no provider reference — nothing qualified',
      );
      return;
    }

    /*
     * Refer & Earn qualifies on the first subscription payment, and only that:
     * a tracker or a top-up is not the "qualifying subscription" the program
     * is defined by. Ahead of the salesman short-circuit below because the two
     * programs are independent — a customer can arrive through either. It
     * records the payment and computes nothing; see the program's own module.
     */
    if (input.trigger === PaymentTrigger.SUBSCRIPTION) {
      await qualifyReferralProgram({
        organizationId: input.organizationId,
        paymentReference: input.paymentReference,
        baseAmount: input.baseAmount,
      });
    }

    // Most customers arrive self-serve and are attributed to nobody.
    const attribution = await liveAttributionFor(input.organizationId);
    if (!attribution) return;

    if (input.trigger === PaymentTrigger.SUBSCRIPTION) {
      await markConverted(attribution.id);
    }

    await advanceSalesRecords(input.organizationId);
  } catch (error) {
    qualifyLogger.error(
      {
        err: error,
        organizationId: input.organizationId,
        trigger: input.trigger,
        paymentReference: input.paymentReference,
      },
      'Payment qualification failed for a successful payment',
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

/** The subscription-plan hook, called when plan billing takes a plan payment. */
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
    trigger: PaymentTrigger.SUBSCRIPTION,
  });
}

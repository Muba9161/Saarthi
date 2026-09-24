import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PLAN_LIMITS,
  PaymentPurpose,
  PlanTier,
  VEHICLE_TOPUP,
  quoteSubscription,
  trackerProduct,
  type TrackerProduct,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { completeSettledPayment, openPayment } from '../payments/payment-settlement.service';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';

/**
 * What the registrant configured on the pricing card, provisioned.
 *
 * The pricing card is a quote: it lets somebody set their fleet size and their
 * trackers and shows the total for exactly that. If signup then created a
 * bare one-vehicle plan, the customer would have agreed to one thing and
 * received another — so the order travels through registration and lands here.
 *
 * Two rules govern everything below.
 *
 * The first is that **a payment problem must never cost somebody their
 * account**. The user, the organization and the subscription are already
 * committed by the time this runs. So nothing here throws: a declined charge
 * records a `PAYMENT_FAILED` row, notifies the owner and returns — they are
 * signed in on the base plan with a clear message and can retry from the
 * subscription screen. Losing a registration over a gateway timeout is a far
 * worse outcome than a tenant who has to click "add capacity" once.
 *
 * The second is that **the quote is the source of truth for the price**. It is
 * recomputed here from the shared catalogue rather than accepted from the
 * client, so a tampered form cannot buy nine vehicles for the price of one.
 */

const orderLogger = logger.child({ module: 'subscriptions:signup-order' });

export interface SignupOrder {
  vehicles: number;
  trackers: number;
  trackerProduct: TrackerProduct;
}

export interface SignupOrderResult {
  vehicleTopUps: number;
  trackers: number;
  /** Total actually charged, GST included. `0` when the order was just the plan. */
  charged: number;
  paymentReference: string | null;
  /** Set when the charge failed — the caller reports it, nobody throws. */
  failure: string | null;
  /** True while a hosted checkout is waiting to be completed. */
  pending: boolean;
}

/**
 * Provision the ordered top-ups and trackers for a brand-new organization.
 *
 * Called after the registration transaction commits, so the subscription row it
 * hangs off already exists. Safe to call with an empty order, which is the
 * common case — a single-vehicle customer with no hardware.
 */
/**
 * Tell a new Personal customer why their trackers are not on the account yet.
 *
 * Fire-and-forget, and deliberately so: this runs moments after registration,
 * outside the transaction that created the account, and a notification that
 * cannot be written must never be the reason somebody's signup fails. It is
 * logged and stepped over for the same reason the referral capture beside it
 * is.
 *
 * The wording has one job — to make clear that nothing was lost and nothing was
 * charged. Somebody who configured two trackers, saw a total, and then found no
 * hardware on the account would otherwise reasonably assume they had paid for
 * it.
 */
function notifyTrackersHeld(organizationId: string): void {
  void notifyOrganization(organizationId, {
    type: NotificationType.SUBSCRIPTION_UPDATED,
    title: 'Verify your Aadhaar to get your trackers',
    body:
      'Saarthi Personal asks for your own Aadhaar before hardware goes on the account, so your ' +
      'trackers are waiting rather than bought - you have not been charged for them. Verify on ' +
      'your profile, then order them from the subscription screen.',
    priority: NotificationPriority.HIGH,
    actionUrl: '/settings/profile',
    roles: OPERATOR_OWNER_ROLES,
  }).catch((error: unknown) => {
    orderLogger.warn({ organizationId, error }, 'Could not notify about held trackers');
  });
}

export async function provisionSignupOrder(input: {
  organizationId: string;
  userId: string;
  organizationName: string;
  customer: { name: string; email: string; phone: string };
  tier: PlanTier;
  order: SignupOrder;
}): Promise<SignupOrderResult> {
  const limits = PLAN_LIMITS[input.tier] ?? PLAN_LIMITS[PlanTier.PERSONAL];

  /*
   * Clamped to what the plan can actually hold, rather than refused.
   *
   * Somebody who configured eleven vehicles on Personal is over its ceiling —
   * but they have just created an account and paid attention to a price, and
   * the useful outcome is the capacity the plan allows plus a note, not a
   * failed signup. The pricing card already blocks its own Subscribe button in
   * that case, so this is the belt to that braces.
   */
  const included = limits.maxTrucks ?? 1;
  const requestedTopUps = Math.max(0, input.order.vehicles - included);
  const vehicleTopUps = Math.min(requestedTopUps, limits.maxVehicleTopUps);

  const trackerCeiling =
    limits.maxTrackers === null
      ? input.order.vehicles
      : Math.min(limits.maxTrackers, input.order.vehicles);

  /*
   * On Personal, hardware waits until the account holder is verified.
   *
   * A Personal subscription asks the person for their own Aadhaar before a
   * vehicle or a tracker goes on the account, and this is the one path that
   * would otherwise slip past that rule: the trackers priced on the pricing
   * card are provisioned here, seconds after registration, when nobody has had
   * the chance to verify anything yet.
   *
   * Held rather than refused, and that distinction is the whole point. The
   * registration still succeeds, the vehicle top-ups are still provisioned, and
   * — critically — the customer is not charged for hardware they cannot yet
   * fit. They verify on their profile, which takes a minute, and buy the
   * trackers from the subscription screen where `purchaseTracker` applies the
   * same rule. That is a better outcome than a charge followed by a refund, and
   * a far better one than a tracker sitting unusable against their name.
   *
   * The clamp is deliberately unconditional for Personal rather than a lookup
   * of the verification state: at this moment in registration the account is
   * always seconds old, so the answer is always the same, and asking would only
   * add a query that can have one result.
   */
  const trackersHeldForVerification =
    input.tier === PlanTier.PERSONAL && input.order.trackers > 0;

  const trackers = trackersHeldForVerification
    ? 0
    : Math.max(0, Math.min(input.order.trackers, trackerCeiling));

  if (vehicleTopUps === 0 && trackers === 0) {
    if (trackersHeldForVerification) notifyTrackersHeld(input.organizationId);

    return {
      vehicleTopUps: 0,
      trackers: 0,
      charged: 0,
      paymentReference: null,
      failure: null,
      pending: false,
    };
  }

  // Priced from the catalogue, never from the request — see the note above.
  const quote = quoteSubscription({
    tier: input.tier,
    vehicles: included + vehicleTopUps,
    trackers,
    trackerProduct: input.order.trackerProduct,
  });
  const tracker = trackerProduct(quote.trackerProduct);

  /*
   * Only the add-ons are charged here — the plan itself is billed by the
   * subscription, which is on trial at this point — and the charge is the
   * final figure: top-ups at their GST-inclusive price, trackers with GST
   * added, which is what the customer was shown next to "total to pay".
   *
   * `quote.addOns` is computed rather than recovered by subtracting the plan
   * from the invoice total: a derived charge is one rounding change away from
   * being wrong by a rupee, and that rupee is somebody's money.
   */
  const addOns = quote.addOns;

  const reference = `SIGNUP-${input.organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

  /*
   * One payment for the whole order rather than one per unit.
   *
   * A customer who ordered three vehicles and two trackers agreed to one
   * figure and should see one charge. Buying them individually would also mean
   * a partial failure halfway through, leaving an account holding two of the
   * three things it paid for.
   */
  const { paymentId, intent } = await openPayment({
    reference,
    purpose: PaymentPurpose.SUBSCRIPTION,
    organizationId: input.organizationId,
    userId: input.userId,
    amount: addOns.total,
    description: `Saarthi signup — ${input.organizationName}`,
    customer: input.customer,
    returnPath: '/settings/subscription',
    metadata: {
      kind: 'signup_order',
      vehicleTopUps: String(vehicleTopUps),
      trackers: String(trackers),
      // On the intent so a reconciliation or a refund can see how the charge
      // was made up without recomputing it from a catalogue that may have
      // moved on since.
      subtotal: addOns.subtotal.toFixed(2),
      gst: addOns.gst.toFixed(2),
    },
  });

  if (intent.status === 'FAILED') {
    const failure =
      intent.failureMessage ??
      'The payment was declined, so the extra vehicles and trackers were not added.';

    // Recorded rather than discarded: "I paid for three vehicles at signup" is
    // a support conversation that needs rows to point at.
    await createOrderRows('PAYMENT_FAILED', intent.providerReference, failure);

    await notifyOrganization(input.organizationId, {
      type: NotificationType.PAYMENT_FAILED,
      title: 'Signup payment failed',
      body: `${failure} Your account is ready — add them from the subscription screen when you are.`,
      priority: NotificationPriority.HIGH,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });

    orderLogger.warn(
      { organizationId: input.organizationId, vehicleTopUps, trackers, reference },
      'Signup order payment declined',
    );

    return {
      vehicleTopUps: 0,
      trackers: 0,
      charged: 0,
      paymentReference: intent.providerReference,
      failure,
      pending: false,
    };
  }

  // Pending until the payment settles — at once on the mock gateway, after
  // checkout on a hosted one. `activatePaidAddOns` then puts them live.
  await createOrderRows('PENDING_PAYMENT', intent.providerReference, 'Ordered at signup.');

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_SIGNUP_ORDER,
    entityType: 'Subscription',
    entityId: input.organizationId,
    actorUserId: input.userId,
    organizationId: input.organizationId,
    after: {
      tier: input.tier,
      trackerProduct: tracker.product,
      vehicleTopUps,
      trackers,
      charged: addOns.total,
      subtotal: addOns.subtotal,
      gst: addOns.gst,
      reference: intent.providerReference,
    },
  });

  if (intent.status === 'SUCCEEDED') {
    await completeSettledPayment(paymentId);
  } else {
    await notifyOrganization(input.organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: 'Finish paying for your order',
      body: 'Your account is ready. Complete the payment for your extra vehicles and trackers from the subscription screen to add them.',
      priority: NotificationPriority.HIGH,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });
  }

  orderLogger.info(
    {
      organizationId: input.organizationId,
      tier: input.tier,
      vehicleTopUps,
      trackers,
      charged: addOns.total,
      status: intent.status,
    },
    'Signup order provisioned',
  );

  return {
    vehicleTopUps,
    trackers,
    charged: intent.status === 'SUCCEEDED' ? addOns.total : 0,
    paymentReference: intent.providerReference,
    failure: null,
    pending: intent.status === 'PENDING',
  };

  /** The order's rows, in the state the payment left them. */
  async function createOrderRows(
    status: 'PAYMENT_FAILED' | 'PENDING_PAYMENT',
    paymentReference: string,
    note: string,
  ): Promise<void> {
    if (trackers > 0) {
      await prisma.vehicleTracker.createMany({
        data: Array.from({ length: trackers }, () => ({
          organizationId: input.organizationId,
          status,
          product: tracker.product,
          pricePaid: tracker.priceOneTime,
          paymentReference,
          purchasedById: input.userId,
          // Unassigned: there are no vehicles on the account yet. Fitted from
          // the subscription screen once the fleet is added.
          truckId: null,
          note,
        })),
      });
    }
    if (vehicleTopUps > 0) {
      await prisma.vehicleSubscriptionTopUp.createMany({
        data: Array.from({ length: vehicleTopUps }, () => ({
          organizationId: input.organizationId,
          status,
          priceMonthly: VEHICLE_TOPUP.priceMonthly,
          paymentReference,
          purchasedById: input.userId,
          note,
        })),
      });
    }
  }
}

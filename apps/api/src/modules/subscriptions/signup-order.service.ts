import {
  CommissionTrigger,
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PLAN_LIMITS,
  PlanTier,
  VEHICLE_TOPUP,
  VEHICLE_TRACKER,
  quoteSubscription,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { paymentProvider } from '../../providers/payments';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { qualifyPayment } from '../sales/qualification';
import { invalidateEntitlements } from './entitlements.service';

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
  billing: 'monthly' | 'yearly';
}

export interface SignupOrderResult {
  vehicleTopUps: number;
  trackers: number;
  /** Total actually charged, GST included. `0` when the order was just the plan. */
  charged: number;
  paymentReference: string | null;
  /** Set when the charge failed — the caller reports it, nobody throws. */
  failure: string | null;
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
    };
  }

  // Priced from the catalogue, never from the request — see the note above.
  const quote = quoteSubscription({
    tier: input.tier,
    vehicles: included + vehicleTopUps,
    trackers,
    billing: input.order.billing,
  });

  /*
   * Only the add-ons are charged here — the plan itself is billed by the
   * subscription, which is on trial at this point — and the charge is the
   * GST-inclusive figure, because that is the number the customer was shown
   * next to "total to pay" and the number that has to leave their account.
   *
   * `quote.addOns` is computed rather than recovered by subtracting the plan
   * from the invoice total: a derived charge is one rounding change away from
   * being wrong by a rupee, and that rupee is somebody's money.
   */
  const addOns = quote.addOns;

  const reference = `SIGNUP-${input.organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;

  /*
   * One intent for the whole order rather than one per unit.
   *
   * A customer who ordered three vehicles and two trackers agreed to one
   * figure and should see one charge. Buying them individually would also mean
   * a partial failure halfway through, leaving an account holding two of the
   * three things it paid for.
   */
  const payment = await paymentProvider.createIntent({
    reference,
    amount: addOns.total,
    currency: 'INR',
    description: `Saarthi signup — ${input.organizationName}`,
    customerName: input.customer.name,
    customerEmail: input.customer.email,
    customerPhone: input.customer.phone,
    metadata: {
      organizationId: input.organizationId,
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

  if (payment.status === 'FAILED') {
    const failure =
      payment.failureMessage ??
      'The payment was declined, so the extra vehicles and trackers were not added.';

    // Recorded rather than discarded: "I paid for three vehicles at signup" is
    // a support conversation that needs rows to point at.
    if (trackers > 0) {
      await prisma.vehicleTracker.createMany({
        data: Array.from({ length: trackers }, () => ({
          organizationId: input.organizationId,
          status: 'PAYMENT_FAILED' as const,
          pricePaid: VEHICLE_TRACKER.priceOneTime,
          paymentReference: payment.providerReference,
          purchasedById: input.userId,
          note: failure,
        })),
      });
    }
    if (vehicleTopUps > 0) {
      await prisma.vehicleSubscriptionTopUp.createMany({
        data: Array.from({ length: vehicleTopUps }, () => ({
          organizationId: input.organizationId,
          status: 'PAYMENT_FAILED' as const,
          priceMonthly: VEHICLE_TOPUP.priceMonthly,
          paymentReference: payment.providerReference,
          purchasedById: input.userId,
          note: failure,
        })),
      });
    }

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
      paymentReference: payment.providerReference,
      failure,
    };
  }

  const now = new Date();

  if (vehicleTopUps > 0) {
    await prisma.vehicleSubscriptionTopUp.createMany({
      data: Array.from({ length: vehicleTopUps }, () => ({
        organizationId: input.organizationId,
        status: 'ACTIVE' as const,
        priceMonthly: VEHICLE_TOPUP.priceMonthly,
        paymentReference: payment.providerReference,
        purchasedById: input.userId,
        startsAt: now,
        // A monthly window like any other top-up; the renewal sweep extends it
        // while it stays active. A yearly commitment still renews monthly here,
        // because the window is about capacity, not about the invoice.
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        note: 'Ordered at signup.',
      })),
    });
  }

  if (trackers > 0) {
    await prisma.vehicleTracker.createMany({
      data: Array.from({ length: trackers }, () => ({
        organizationId: input.organizationId,
        status: 'ACTIVE' as const,
        pricePaid: VEHICLE_TRACKER.priceOneTime,
        paymentReference: payment.providerReference,
        purchasedById: input.userId,
        purchasedAt: now,
        // Unassigned: there are no vehicles on the account yet. Fitted from the
        // subscription screen once the fleet is added.
        truckId: null,
        note: 'Ordered at signup.',
      })),
    });
  }

  invalidateEntitlements(input.organizationId);
  await cache.delete(cacheKeys.subscriptionEntitlement(input.organizationId));

  await recordAudit({
    action: AuditAction.SUBSCRIPTION_SIGNUP_ORDER,
    entityType: 'Subscription',
    entityId: input.organizationId,
    actorUserId: input.userId,
    organizationId: input.organizationId,
    after: {
      tier: input.tier,
      billing: input.order.billing,
      vehicleTopUps,
      trackers,
      charged: addOns.total,
      subtotal: addOns.subtotal,
      gst: addOns.gst,
      reference: payment.providerReference,
    },
  });

  if (trackers > 0) {
    await notifyOrganization(input.organizationId, {
      type: NotificationType.SUBSCRIPTION_UPDATED,
      title: `${trackers} tracker${trackers === 1 ? '' : 's'} ordered`,
      body: 'Add your vehicles, then fit each tracker to one from the subscription screen.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/settings/subscription',
      roles: OPERATOR_OWNER_ROLES,
    });
  }

  /*
   * Commission on what the customer actually paid at signup.
   *
   * Split by trigger rather than recorded as one lump, because the two are
   * commercially different sales and may carry different rates: `trackers` is
   * hardware, `vehicleTopUps` is recurring capacity. The unique index is on
   * `(trigger, paymentReference)`, so one payment legitimately producing two
   * commissions is expected — and each is still capped at one.
   *
   * Both use the pre-tax subtotal (GST is not Saarthi's revenue), and neither
   * can throw. Note also what is *not* qualified here: the plan itself, which
   * is on trial at signup and has taken no payment — see
   * `qualifySubscriptionPayment`.
   */
  if (trackers > 0 && payment.providerReference) {
    await qualifyPayment({
      organizationId: input.organizationId,
      baseAmount: VEHICLE_TRACKER.priceOneTime * trackers,
      paymentReference: payment.providerReference,
      trigger: CommissionTrigger.TRACKER,
      planTier: input.tier,
    });
  }

  if (vehicleTopUps > 0 && payment.providerReference) {
    await qualifyPayment({
      organizationId: input.organizationId,
      baseAmount: VEHICLE_TOPUP.priceMonthly * vehicleTopUps,
      paymentReference: payment.providerReference,
      trigger: CommissionTrigger.VEHICLE_TOPUP,
      planTier: input.tier,
    });
  }

  orderLogger.info(
    {
      organizationId: input.organizationId,
      tier: input.tier,
      vehicleTopUps,
      trackers,
      charged: addOns.total,
    },
    'Signup order provisioned',
  );

  return {
    vehicleTopUps,
    trackers,
    charged: addOns.total,
    paymentReference: payment.providerReference,
    failure: null,
  };
}

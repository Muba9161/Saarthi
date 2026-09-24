import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  PLAN_LIMITS,
  PaymentPurpose,
  VEHICLE_TOPUP,
  accountRunsVehicles,
  canAddVehicleTopUp,
  canAddVehicleTracker,
  inclusiveOfGst,
  sumTotals,
  trackerCharge,
  trackerProduct,
  type CheckoutSession,
  type OrganizationType,
  type PlanTier,
  type PurchaseVehicleOrderInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { withLock } from '../../infra/lock';
import { completeSettledPayment, openPayment } from '../payments/payment-settlement.service';
import { notifyOrganization } from '../notifications/notification.service';
import { assertPersonalIdentityVerified } from '../identity-verification/personal-onboarding.guard';
import { countActiveTrackers } from './entitlements.service';
import { countActiveTopUps } from './topup.service';
import type { AuthContext } from '../../auth/context';

/**
 * The add-vehicle form's one payment.
 *
 * A vehicle added to a full plan needs its `+1 vehicle` slot, and the owner may
 * choose a tracker for it at the same time. Both are paid together — one
 * Cashfree payment for one final amount — *before* the vehicle is created, so
 * the owner agrees to a single total rather than a charge per item.
 *
 * The rows are written pending under the payment's reference and go live the
 * moment it settles (`activatePaidAddOns`, as for the signup order): the slot
 * lifts the plan's capacity, the tracker waits unfitted until the vehicle
 * exists and the form fits it.
 *
 * The tracker ceiling is checked against the fleet *with* the vehicle being
 * added — the tracker is for it — which is the one difference from buying a
 * tracker on its own.
 */

const orderLogger = logger.child({ module: 'subscriptions:vehicle-order' });

export async function purchaseVehicleOrder(
  auth: AuthContext,
  organizationId: string,
  input: PurchaseVehicleOrderInput,
): Promise<{ checkout: CheckoutSession | null; trackerId: string | null; total: number }> {
  const result = await withLock(`subscription:vehicle-order:${organizationId}`, 30_000, async () => {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!subscription) throw errors.businessRule('This organization has no subscription.');

    const tier = subscription.plan.tier as PlanTier;
    const tenant = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { type: true, name: true },
    });
    if (!accountRunsVehicles({ tier, organizationType: tenant.type as OrganizationType })) {
      throw errors.businessRule('This account does not run vehicles.');
    }

    const [activeTopUps, activeTrackers, vehicleCount] = await Promise.all([
      countActiveTopUps(organizationId),
      countActiveTrackers(organizationId),
      prisma.truck.count({ where: { organizationId, archivedAt: null } }),
    ]);

    if (input.slot && !canAddVehicleTopUp(tier, activeTopUps)) {
      throw errors.planLimitReached(
        'vehicleTopUpLimit',
        `The ${subscription.plan.name} plan cannot take more vehicles.`,
      );
    }

    const product = input.trackerProduct ? trackerProduct(input.trackerProduct) : null;
    if (product) {
      // Before anything is charged: a Personal holder confirms who they are first.
      await assertPersonalIdentityVerified(auth, organizationId, 'tracker');
      if (!canAddVehicleTracker({ tier, activeTrackers, vehicleCount: vehicleCount + 1 })) {
        const ceiling = PLAN_LIMITS[tier].maxTrackers;
        throw errors.planLimitReached(
          'maxTrackers',
          ceiling !== null && activeTrackers >= ceiling
            ? `The ${subscription.plan.name} plan covers up to ${ceiling} trackers.`
            : 'Every vehicle already has a tracker.',
        );
      }
    }

    // Every price final, GST inside it — what the form showed as the total.
    const charge = sumTotals(
      inclusiveOfGst(input.slot ? VEHICLE_TOPUP.priceMonthly : 0),
      product ? trackerCharge(product.priceOneTime) : inclusiveOfGst(0),
    );

    const reference = `VEHICLE-${organizationId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
    const { paymentId, intent } = await openPayment({
      reference,
      purpose: PaymentPurpose.SUBSCRIPTION,
      organizationId,
      userId: auth.user.id,
      amount: charge.total,
      description: [input.slot ? VEHICLE_TOPUP.name : null, product?.name].filter(Boolean).join(' + '),
      customer: {
        name: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
        email: auth.user.email,
        phone: auth.user.phone,
      },
      returnPath: '/fleet/vehicles',
      metadata: {
        kind: 'vehicle_order',
        slot: String(input.slot),
        ...(product ? { tracker: product.product } : {}),
        subtotal: charge.subtotal.toFixed(2),
        gst: charge.gst.toFixed(2),
      },
    });

    const status = intent.status === 'FAILED' ? 'PAYMENT_FAILED' : 'PENDING_PAYMENT';
    const note = intent.status === 'FAILED' ? (intent.failureMessage ?? 'Payment declined.') : 'Ordered with a new vehicle.';
    if (input.slot) {
      await prisma.vehicleSubscriptionTopUp.create({
        data: {
          organizationId,
          status,
          priceMonthly: VEHICLE_TOPUP.priceMonthly,
          paymentReference: intent.providerReference,
          purchasedById: auth.user.id,
          note,
        },
      });
    }
    const tracker = product
      ? await prisma.vehicleTracker.create({
          data: {
            organizationId,
            status,
            product: product.product,
            pricePaid: product.priceOneTime,
            paymentReference: intent.providerReference,
            purchasedById: auth.user.id,
            note,
          },
        })
      : null;

    if (intent.status === 'FAILED') {
      await notifyOrganization(organizationId, {
        type: NotificationType.PAYMENT_FAILED,
        title: 'Vehicle payment failed',
        body: intent.failureMessage ?? 'The payment was declined. Nothing was added.',
        priority: NotificationPriority.HIGH,
        actionUrl: '/fleet/vehicles',
        roles: OPERATOR_OWNER_ROLES,
      });
      throw errors.businessRule(intent.failureMessage ?? 'The payment was declined, so nothing was added.');
    }

    if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);

    orderLogger.info(
      { organizationId, slot: input.slot, tracker: product?.product ?? null, total: charge.total, status: intent.status },
      'Vehicle order opened',
    );
    return { checkout: intent.checkout, trackerId: tracker?.id ?? null, total: charge.total };
  });

  if (!result) {
    throw errors.conflict('Another payment for this organization is already in progress. Try again in a moment.');
  }
  return result;
}

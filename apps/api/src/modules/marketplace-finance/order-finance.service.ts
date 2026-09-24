import {
  NotificationPriority,
  NotificationType,
  OrderFinanceStage,
  OrderStatus,
  PaymentPurpose,
  PaymentStatus,
  balanceDue,
  confirmationAmount,
  finalCustomerAmount,
  profitCommission,
  type CheckoutSession,
  type ConfirmDeliveryInput,
  type ProcurementPaymentInput,
} from '@saarthi/shared';
import { prisma, type Db } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { paymentProvider } from '../../providers/payments';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import {
  completeSettledPayment,
  openPayment,
  registerSettlementHandler,
  settlePayment,
  type SettledPayment,
} from '../payments/payment-settlement.service';
import { markRequirementFulfilled } from '../requirements/fulfilment.service';
import { recordCommission, recordLedgerEntry } from './ledger.service';
import { requireUsablePayoutAccount } from './payout-account.service';
import { createSettlement, reconcilePayment } from './settlement.service';
import type { AuthContext } from '../../auth/context';

/**
 * The money of a fleet-sourced freight order.
 *
 *   award → PAYMENT_30_REQUIRED → customer pays 30% (routed to the fleet)
 *   → PAYMENT_30_PAID → fleet pays its supplier (routed to the supplier)
 *   → PROCUREMENT_PAID → loading, trip, delivery
 *   → customer confirms what arrived → PAYMENT_70_REQUIRED
 *   → customer pays the balance: the fleet's share less Saarthi's commission
 *     is routed to the fleet, the commission stays with Saarthi
 *   → PAYMENT_70_PAID → FINALIZED, and the order completes.
 *
 * Every amount is worked out here from stored figures — the accepted bid, the
 * confirmed delivery, what the fleet actually paid its supplier — never from
 * the request. Money only moves through the payment provider; this records
 * what moved.
 */

const financeLogger = logger.child({ module: 'marketplace:order-finance' });

/** Payment reference prefixes, one per money leg of an order. */
const PREFIX = {
  confirmation: 'ORD30-',
  procurement: 'PROC-',
  final: 'ORD70-',
} as const;

type FinanceRow = NonNullable<Awaited<ReturnType<typeof loadFinance>>>;

async function loadFinance(orderId: string) {
  return prisma.orderFinance.findUnique({
    where: { orderId },
    include: {
      order: {
        select: {
          id: true,
          reference: true,
          status: true,
          quantity: true,
          unit: true,
          customerOrganizationId: true,
        },
      },
    },
  });
}

async function requireFinance(orderId: string): Promise<FinanceRow> {
  const finance = await loadFinance(orderId);
  if (!finance) {
    throw errors.businessRule('This order has no marketplace payment plan — it was not a fleet-delivered bid.');
  }
  return finance;
}

function reference(prefix: string, orderReference: string): string {
  return `${prefix}${orderReference}-${Date.now().toString(36).toUpperCase()}`.slice(0, 45);
}

async function payer(auth: AuthContext) {
  return {
    name: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
    email: auth.user.email,
    phone: auth.user.phone,
  };
}

async function moveStage(
  db: Db,
  financeId: string,
  from: OrderFinanceStage,
  to: OrderFinanceStage,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  const moved = await db.orderFinance.updateMany({
    where: { id: financeId, stage: from },
    data: { stage: to, ...data },
  });
  return moved.count === 1;
}

/**
 * A still-open checkout for this leg, settled first and reused if it can still
 * be paid, so paying twice cannot charge twice.
 */
async function reuseOpenPayment(
  orderId: string,
  prefix: string,
): Promise<{ settled: boolean; checkout: CheckoutSession | null } | null> {
  const open = await prisma.payment.findFirst({
    where: { orderId, status: PaymentStatus.PROCESSING, reference: { startsWith: prefix } },
    orderBy: { createdAt: 'desc' },
  });
  if (!open) return null;
  if ((await settlePayment(open.reference)) === PaymentStatus.SUCCEEDED) {
    return { settled: true, checkout: null };
  }
  const checkout = await paymentProvider.resumeCheckout(open.providerReference ?? open.reference);
  return checkout ? { settled: false, checkout } : null;
}

// ---------------------------------------------------------------------------
// Creation — when the customer accepts a fleet's delivered bid
// ---------------------------------------------------------------------------

export async function createOrderFinance(
  db: Db,
  input: {
    orderId: string;
    sellerOrganizationId: string;
    supplierOrganizationId: string | null;
    customerOrganizationId: string;
    agreedAmount: number;
    orderedQuantity: number;
    procurementReference: number | null;
  },
): Promise<void> {
  await db.orderFinance.upsert({
    where: { orderId: input.orderId },
    create: {
      orderId: input.orderId,
      sellerOrganizationId: input.sellerOrganizationId,
      supplierOrganizationId: input.supplierOrganizationId,
      customerOrganizationId: input.customerOrganizationId,
      agreedAmount: input.agreedAmount,
      confirmationAmount: confirmationAmount(input.agreedAmount),
      orderedQuantity: input.orderedQuantity,
      procurementReference: input.procurementReference,
    },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Customer: the 30% confirmation payment
// ---------------------------------------------------------------------------

export async function payConfirmation(
  auth: AuthContext,
  orderId: string,
): Promise<{ checkout: CheckoutSession | null }> {
  const finance = await requireFinance(orderId);
  if (finance.customerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the customer pays for this order.');
  }
  if (finance.stage !== OrderFinanceStage.PAYMENT_30_REQUIRED) {
    throw errors.invalidTransition('The confirmation payment is not due on this order.');
  }

  const reused = await reuseOpenPayment(orderId, PREFIX.confirmation);
  if (reused) return { checkout: reused.checkout };

  const fleetVendor = await requireUsablePayoutAccount(finance.sellerOrganizationId, "The fleet's");
  const amount = Number(finance.confirmationAmount);

  const { paymentId, intent } = await openPayment({
    reference: reference(PREFIX.confirmation, finance.order.reference),
    purpose: PaymentPurpose.ORDER,
    organizationId: finance.customerOrganizationId,
    userId: auth.user.id,
    orderId,
    amount,
    description: `Order ${finance.order.reference} — 30% on confirmation`,
    customer: await payer(auth),
    returnPath: `/orders/${orderId}`,
    metadata: { kind: 'order_confirmation', orderId },
    // The whole 30% goes to the fleet: it pays the supplier from it.
    splits: [{ vendorId: fleetVendor, amount }],
  });
  if (intent.status === 'FAILED') {
    throw errors.businessRule(intent.failureMessage ?? 'The payment was declined. Please try again.');
  }
  if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);
  return { checkout: intent.checkout };
}

// ---------------------------------------------------------------------------
// Fleet: paying its supplier — a separate money leg
// ---------------------------------------------------------------------------

export async function payProcurement(
  auth: AuthContext,
  orderId: string,
  input: ProcurementPaymentInput,
): Promise<{ checkout: CheckoutSession | null }> {
  const finance = await requireFinance(orderId);
  if (finance.sellerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the fleet that won this order pays its supplier.');
  }
  if (finance.stage !== OrderFinanceStage.PAYMENT_30_PAID) {
    throw errors.invalidTransition(
      finance.stage === OrderFinanceStage.PAYMENT_30_REQUIRED
        ? "Wait for the customer's 30% confirmation payment before paying the supplier."
        : 'The supplier has already been paid for this order.',
    );
  }
  if (!finance.supplierOrganizationId) {
    throw errors.businessRule('This order names no supplier to pay.');
  }

  const amount = input.amount ?? Number(finance.procurementReference ?? 0);
  if (amount <= 0) throw errors.validation('Enter what you are paying the supplier.');
  if (amount > Number(finance.agreedAmount)) {
    throw errors.businessRule("The supplier payment cannot exceed the customer's order amount.");
  }

  const reused = await reuseOpenPayment(orderId, PREFIX.procurement);
  if (reused) return { checkout: reused.checkout };

  const supplierVendor = await requireUsablePayoutAccount(finance.supplierOrganizationId, "The supplier's");

  const { paymentId, intent } = await openPayment({
    reference: reference(PREFIX.procurement, finance.order.reference),
    purpose: PaymentPurpose.ORDER,
    organizationId: finance.sellerOrganizationId,
    userId: auth.user.id,
    orderId,
    amount,
    description: `Order ${finance.order.reference} — material from supplier`,
    customer: await payer(auth),
    returnPath: `/orders/${orderId}`,
    metadata: { kind: 'order_procurement', orderId },
    splits: [{ vendorId: supplierVendor, amount }],
  });
  if (intent.status === 'FAILED') {
    throw errors.businessRule(intent.failureMessage ?? 'The payment was declined. Please try again.');
  }
  if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);
  return { checkout: intent.checkout };
}

// ---------------------------------------------------------------------------
// Customer: confirming what was delivered, then the balance
// ---------------------------------------------------------------------------

export async function confirmDelivery(
  auth: AuthContext,
  orderId: string,
  input: ConfirmDeliveryInput,
): Promise<OrderFinanceSummary | null> {
  const finance = await requireFinance(orderId);
  if (finance.customerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the customer confirms what was delivered.');
  }
  if (finance.order.status !== OrderStatus.DELIVERED) {
    throw errors.invalidTransition('The delivery can be confirmed once the trip has completed.');
  }
  if (finance.stage !== OrderFinanceStage.PROCUREMENT_PAID) {
    throw errors.invalidTransition('This order is not waiting for delivery confirmation.');
  }
  if (input.deliveredQuantity > finance.orderedQuantity) {
    throw errors.validation(
      `More than the ${finance.orderedQuantity} ${finance.order.unit?.toLowerCase() ?? 'units'} ordered cannot be confirmed.`,
    );
  }

  const finalAmount = finalCustomerAmount({
    agreedAmount: Number(finance.agreedAmount),
    orderedQuantity: finance.orderedQuantity,
    deliveredQuantity: input.deliveredQuantity,
  });

  const moved = await moveStage(prisma, finance.id, OrderFinanceStage.PROCUREMENT_PAID, OrderFinanceStage.PAYMENT_70_REQUIRED, {
    deliveredQuantity: input.deliveredQuantity,
    finalAmount,
    deliveryConfirmedAt: new Date(),
    deliveryNote: input.note ?? null,
  });
  if (!moved) throw errors.conflict('This delivery was confirmed a moment ago.');

  await recordAudit({
    action: AuditAction.MARKETPLACE_DELIVERY_CONFIRMED,
    entityType: 'Order',
    entityId: orderId,
    actorUserId: auth.user.id,
    organizationId: finance.customerOrganizationId,
    after: { deliveredQuantity: input.deliveredQuantity, ordered: finance.orderedQuantity, finalAmount },
  });

  // Nothing left to pay — a short delivery the 30% already covers.
  if (balanceDue({ finalAmount, paidSoFar: Number(finance.confirmationAmount) }) === 0) {
    await finalize(orderId, null);
  } else {
    void notifyOrganization(finance.sellerOrganizationId, {
      type: NotificationType.ORDER_UPDATED,
      title: 'Delivery confirmed',
      body: `The customer confirmed ${input.deliveredQuantity} ${finance.order.unit?.toLowerCase() ?? ''} on ${finance.order.reference}. The balance is due.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/orders/${orderId}`,
    });
  }

  return financialSummary(auth, orderId);
}

export async function payFinal(
  auth: AuthContext,
  orderId: string,
): Promise<{ checkout: CheckoutSession | null }> {
  const finance = await requireFinance(orderId);
  if (finance.customerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the customer pays for this order.');
  }
  if (finance.stage !== OrderFinanceStage.PAYMENT_70_REQUIRED) {
    throw errors.invalidTransition(
      finance.stage === OrderFinanceStage.PROCUREMENT_PAID || finance.stage === OrderFinanceStage.PAYMENT_30_PAID
        ? 'The balance is due once you have confirmed the delivery.'
        : 'The balance is not due on this order.',
    );
  }

  const reused = await reuseOpenPayment(orderId, PREFIX.final);
  if (reused) return { checkout: reused.checkout };

  const finalAmount = Number(finance.finalAmount ?? finance.agreedAmount);
  const amount = balanceDue({ finalAmount, paidSoFar: Number(finance.confirmationAmount) });
  const commission = profitCommission({
    revenue: finalAmount,
    costBasis: Number(finance.procurementAmount ?? 0),
  });
  // Saarthi's 2% of profit stays with Saarthi; the rest of the balance is the fleet's.
  const fleetShare = Math.max(0, Math.round((amount - commission.amount) * 100) / 100);
  const fleetVendor = await requireUsablePayoutAccount(finance.sellerOrganizationId, "The fleet's");

  const { paymentId, intent } = await openPayment({
    reference: reference(PREFIX.final, finance.order.reference),
    purpose: PaymentPurpose.ORDER,
    organizationId: finance.customerOrganizationId,
    userId: auth.user.id,
    orderId,
    amount,
    description: `Order ${finance.order.reference} — balance after delivery`,
    customer: await payer(auth),
    returnPath: `/orders/${orderId}`,
    metadata: { kind: 'order_final', orderId },
    splits: fleetShare > 0 ? [{ vendorId: fleetVendor, amount: fleetShare }] : [],
  });
  if (intent.status === 'FAILED') {
    throw errors.businessRule(intent.failureMessage ?? 'The payment was declined. Please try again.');
  }
  if (intent.status === 'SUCCEEDED') await completeSettledPayment(paymentId);
  return { checkout: intent.checkout };
}

// ---------------------------------------------------------------------------
// Settlement — what each confirmed payment does
// ---------------------------------------------------------------------------

/**
 * Close the order's money: profit, commission, the fleet's settlement, and the
 * order itself. Idempotent — only the first call moves the stage.
 */
async function finalize(orderId: string, finalPayment: SettledPayment | null): Promise<void> {
  const finance = await requireFinance(orderId);
  const from = finalPayment ? OrderFinanceStage.PAYMENT_70_PAID : OrderFinanceStage.PAYMENT_70_REQUIRED;
  const finalAmount = Number(finance.finalAmount ?? finance.agreedAmount);
  const costBasis = Number(finance.procurementAmount ?? 0);

  const done = await prisma.$transaction(async (tx) => {
    if (!(await moveStage(tx, finance.id, from, OrderFinanceStage.FINALIZED, { finalizedAt: new Date() }))) {
      return null;
    }
    // Retained from the balance when there was one; otherwise owed by the
    // fleet (a short delivery the 30% already covered).
    const commission = await recordCommission(tx, {
      kind: 'FREIGHT_ORDER',
      orderId,
      providerOrganizationId: finance.sellerOrganizationId,
      revenue: finalAmount,
      costBasis,
      settled: finalPayment !== null,
    });
    await recordLedgerEntry(tx, {
      entryKey: `commission:order:${orderId}`,
      type: 'COMMISSION',
      orderId,
      organizationId: finance.sellerOrganizationId,
      amount: Number(commission.amount),
      stage: 'FINAL',
      note: `2% of profit ${Number(commission.profitBasis)} (${commission.ruleVersion})`,
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'STATUS_CHANGED',
        description: 'Paid in full — order completed.',
        metadata: { from: finance.order.status, to: OrderStatus.COMPLETED },
      },
    });
    return commission;
  });
  if (!done) return;

  await recordAudit({
    action: AuditAction.MARKETPLACE_COMMISSION_CALCULATED,
    entityType: 'Order',
    entityId: orderId,
    actorUserId: null,
    organizationId: finance.sellerOrganizationId,
    after: {
      revenue: Number(done.revenueAmount),
      cost: Number(done.costAmount),
      profitBasis: Number(done.profitBasis),
      rate: Number(done.rate),
      commission: Number(done.amount),
      ruleVersion: done.ruleVersion,
    },
  });
  await markRequirementFulfilled({ orderId }, `Order ${finance.order.reference} paid in full.`);
  void notifyOrganization(finance.sellerOrganizationId, {
    type: NotificationType.ORDER_UPDATED,
    title: 'Order paid in full',
    body: `${finance.order.reference} is complete. Saarthi's commission is ₹${Number(done.amount)} — 2% of your ₹${Number(done.profitBasis)} profit.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/orders/${orderId}`,
  });
  financeLogger.info({ orderId, commission: Number(done.amount) }, 'Order finance finalized');
}

async function onOrderPaymentSucceeded(payment: SettledPayment): Promise<void> {
  if (!payment.orderId) return;
  const finance = await requireFinance(payment.orderId);
  const ref = payment.providerReference ?? payment.reference;

  if (payment.reference.startsWith(PREFIX.confirmation)) {
    if (!(await moveStage(prisma, finance.id, OrderFinanceStage.PAYMENT_30_REQUIRED, OrderFinanceStage.PAYMENT_30_PAID))) return;
    await recordLedgerEntry(prisma, {
      entryKey: `payment:${payment.reference}`,
      type: 'CUSTOMER_PAYMENT',
      orderId: payment.orderId,
      organizationId: finance.customerOrganizationId,
      counterpartyOrganizationId: finance.sellerOrganizationId,
      amount: payment.amount,
      stage: 'CONFIRMATION_30',
      paymentReference: ref,
    });
    await createSettlement(prisma, {
      settlementKey: `settle:${payment.reference}:${finance.sellerOrganizationId}`,
      paymentReference: ref,
      orderId: payment.orderId,
      recipientOrganizationId: finance.sellerOrganizationId,
      vendorId: await vendorOf(finance.sellerOrganizationId),
      amount: payment.amount,
      routed: true,
    });
    void notifyOrganization(finance.sellerOrganizationId, {
      type: NotificationType.ORDER_UPDATED,
      title: '30% received — pay your supplier',
      body: `The customer paid the 30% on ${finance.order.reference}. Pay your supplier to release the material.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/orders/${payment.orderId}`,
    });
  } else if (payment.reference.startsWith(PREFIX.procurement)) {
    if (
      !(await moveStage(prisma, finance.id, OrderFinanceStage.PAYMENT_30_PAID, OrderFinanceStage.PROCUREMENT_PAID, {
        procurementAmount: payment.amount,
      }))
    ) {
      return;
    }
    await recordLedgerEntry(prisma, {
      entryKey: `payment:${payment.reference}`,
      type: 'PROCUREMENT_PAYMENT',
      orderId: payment.orderId,
      organizationId: finance.sellerOrganizationId,
      counterpartyOrganizationId: finance.supplierOrganizationId,
      amount: payment.amount,
      stage: 'PROCUREMENT',
      paymentReference: ref,
    });
    if (finance.supplierOrganizationId) {
      await createSettlement(prisma, {
        settlementKey: `settle:${payment.reference}:${finance.supplierOrganizationId}`,
        paymentReference: ref,
        orderId: payment.orderId,
        recipientOrganizationId: finance.supplierOrganizationId,
        vendorId: await vendorOf(finance.supplierOrganizationId),
        amount: payment.amount,
        routed: true,
      });
      void notifyOrganization(finance.supplierOrganizationId, {
        type: NotificationType.ORDER_UPDATED,
        title: 'Payment received for material',
        body: `The fleet paid ₹${payment.amount} for ${finance.order.reference}. Release the material for loading.`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/orders/${payment.orderId}`,
      });
    }
  } else if (payment.reference.startsWith(PREFIX.final)) {
    if (!(await moveStage(prisma, finance.id, OrderFinanceStage.PAYMENT_70_REQUIRED, OrderFinanceStage.PAYMENT_70_PAID))) return;
    const finalAmount = Number(finance.finalAmount ?? finance.agreedAmount);
    const commission = profitCommission({
      revenue: finalAmount,
      costBasis: Number(finance.procurementAmount ?? 0),
    });
    await recordLedgerEntry(prisma, {
      entryKey: `payment:${payment.reference}`,
      type: 'CUSTOMER_PAYMENT',
      orderId: payment.orderId,
      organizationId: finance.customerOrganizationId,
      counterpartyOrganizationId: finance.sellerOrganizationId,
      amount: payment.amount,
      stage: 'FINAL_70',
      paymentReference: ref,
    });
    await createSettlement(prisma, {
      settlementKey: `settle:${payment.reference}:${finance.sellerOrganizationId}`,
      paymentReference: ref,
      orderId: payment.orderId,
      recipientOrganizationId: finance.sellerOrganizationId,
      vendorId: await vendorOf(finance.sellerOrganizationId),
      amount: Math.max(0, Math.round((payment.amount - commission.amount) * 100) / 100),
      routed: true,
    });
    await finalize(payment.orderId, payment);
  }

  // The mock pays vendors out at once; on Cashfree the sweep confirms it.
  if (paymentProvider.settlesSynchronously) await reconcilePayment(ref);
}

async function vendorOf(organizationId: string): Promise<string | null> {
  const row = await prisma.payoutAccount.findUnique({
    where: { organizationId },
    select: { vendorId: true },
  });
  return row?.vendorId ?? null;
}

registerSettlementHandler(PaymentPurpose.ORDER, {
  onSucceeded: onOrderPaymentSucceeded,
  onFailed: async (payment, message) => {
    if (!payment.orderId) return;
    void notifyOrganization(payment.organizationId, {
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment failed',
      body: `${message} Nothing was charged — try again from the order.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/orders/${payment.orderId}`,
    });
  },
});

// ---------------------------------------------------------------------------
// Guards the order and trip lifecycles consult
// ---------------------------------------------------------------------------

/**
 * Loading waits for the money: the customer's 30% and the supplier's payment.
 * Returns the reason to refuse, or null when the order may be loaded.
 */
export async function loadingBlockedReason(orderId: string | null): Promise<string | null> {
  if (!orderId) return null;
  const finance = await prisma.orderFinance.findUnique({ where: { orderId }, select: { stage: true } });
  if (!finance) return null;
  if (finance.stage === OrderFinanceStage.PAYMENT_30_REQUIRED) {
    return "Waiting for the customer's 30% confirmation payment.";
  }
  if (finance.stage === OrderFinanceStage.PAYMENT_30_PAID) {
    return 'Pay the supplier for the material before loading.';
  }
  return null;
}

/** Before the supplier is paid, an order can still be called off. */
const CANCELLABLE_STAGES: readonly OrderFinanceStage[] = [
  OrderFinanceStage.PAYMENT_30_REQUIRED,
  OrderFinanceStage.PAYMENT_30_PAID,
];

/** An order with a payment plan completes itself when it is paid in full. */
export async function assertOrderStatusAllowed(orderId: string, status: OrderStatus): Promise<void> {
  const finance = await prisma.orderFinance.findUnique({ where: { orderId }, select: { stage: true } });
  if (!finance) return;
  if (status === OrderStatus.COMPLETED && finance.stage !== OrderFinanceStage.FINALIZED) {
    throw errors.invalidTransition('This order completes itself once the customer has paid in full.');
  }
  if (
    status === OrderStatus.CANCELLED &&
    !CANCELLABLE_STAGES.includes(finance.stage as OrderFinanceStage)
  ) {
    throw errors.businessRule(
      'The supplier has already been paid for this order, so it cannot simply be cancelled. Contact Saarthi support to resolve it.',
    );
  }
}

/**
 * An order cancelled before its supplier was paid: the customer's 30% goes back
 * and nothing is earned, so no commission arises.
 */
export async function onOrderCancelled(orderId: string, actorUserId: string): Promise<void> {
  const finance = await loadFinance(orderId);
  if (!finance) return;
  const paid30 = finance.stage === OrderFinanceStage.PAYMENT_30_PAID;
  if (!(await moveStage(prisma, finance.id, finance.stage as OrderFinanceStage, OrderFinanceStage.CANCELLED))) return;
  if (!paid30) return;

  const payment = await prisma.payment.findFirst({
    where: { orderId, status: PaymentStatus.SUCCEEDED, reference: { startsWith: PREFIX.confirmation } },
  });
  if (!payment?.providerReference) return;

  const refund = await paymentProvider.refund({
    providerReference: payment.providerReference,
    amount: Number(payment.amount),
    reason: 'Order cancelled before procurement',
  });
  if (refund.status === 'FAILED') {
    financeLogger.error({ orderId }, 'Refund of the confirmation payment failed — needs manual action');
    return;
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.REFUNDED, refundedAmount: payment.amount, refundedAt: new Date() },
  });
  await recordLedgerEntry(prisma, {
    entryKey: `refund:${payment.reference}`,
    type: 'REFUND',
    orderId,
    organizationId: finance.customerOrganizationId,
    counterpartyOrganizationId: finance.sellerOrganizationId,
    amount: Number(payment.amount),
    stage: 'CONFIRMATION_30',
    paymentReference: payment.providerReference,
  });
  await recordAudit({
    action: AuditAction.MARKETPLACE_REFUND_ISSUED,
    entityType: 'Order',
    entityId: orderId,
    actorUserId,
    organizationId: finance.customerOrganizationId,
    after: { amount: Number(payment.amount), stage: 'CONFIRMATION_30' },
  });
}

// ---------------------------------------------------------------------------
// The financial summary each party sees
// ---------------------------------------------------------------------------

export interface OrderFinanceSummary {
  orderId: string;
  stage: OrderFinanceStage;
  role: 'CUSTOMER' | 'FLEET' | 'SUPPLIER' | 'ADMIN';
  agreedAmount: number;
  confirmationAmount: number;
  orderedQuantity: number;
  deliveredQuantity: number | null;
  finalAmount: number | null;
  /** What the customer still owes. */
  balanceDue: number;
  payments: { stage: string; amount: number; status: string; reference: string; at: string }[];
  /** The fleet's view: procurement, profit and Saarthi's commission. Null for others. */
  provider: {
    procurementReference: number | null;
    procurementAmount: number | null;
    profitBasis: number;
    commissionRate: number;
    commissionAmount: number;
    netAfterCommission: number;
    /** False while it is an estimate — before the order is finalized. */
    final: boolean;
    ruleVersion: string;
  } | null;
  /** The supplier's view: what it was paid. Null for others. */
  supplier: { procurementAmount: number | null } | null;
}

const STAGE_LABEL: Record<string, string> = {
  [PREFIX.confirmation]: 'CONFIRMATION_30',
  [PREFIX.procurement]: 'PROCUREMENT',
  [PREFIX.final]: 'FINAL_70',
};

/**
 * Null when the order has no marketplace payment plan — most orders do not, and
 * the order screen shows no finance panel for them.
 */
export async function financialSummary(
  auth: AuthContext,
  orderId: string,
): Promise<OrderFinanceSummary | null> {
  const finance = await loadFinance(orderId);
  if (!finance) return null;
  const org = auth.organizationId;
  const role = auth.isPlatformAdmin
    ? 'ADMIN'
    : org === finance.sellerOrganizationId
      ? 'FLEET'
      : org === finance.customerOrganizationId
        ? 'CUSTOMER'
        : org === finance.supplierOrganizationId
          ? 'SUPPLIER'
          : null;
  if (!role) throw errors.notFound('Order');

  const payments = await prisma.payment.findMany({
    where: {
      orderId,
      // The customer does not see the fleet's supplier payment, and the
      // supplier sees only that one.
      ...(role === 'CUSTOMER' ? { NOT: { reference: { startsWith: PREFIX.procurement } } } : {}),
      ...(role === 'SUPPLIER' ? { reference: { startsWith: PREFIX.procurement } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  const agreed = Number(finance.agreedAmount);
  const finalAmount = finance.finalAmount !== null ? Number(finance.finalAmount) : null;
  const paidByCustomer = payments
    .filter((payment) => payment.status === PaymentStatus.SUCCEEDED && !payment.reference.startsWith(PREFIX.procurement))
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  const commissionRow = await prisma.marketplaceCommission.findUnique({ where: { orderId } });
  const estimate = profitCommission({
    revenue: finalAmount ?? agreed,
    costBasis: Number(finance.procurementAmount ?? finance.procurementReference ?? 0),
  });
  const profitBasis = commissionRow ? Number(commissionRow.profitBasis) : estimate.profitBasis;
  const commissionAmount = commissionRow ? Number(commissionRow.amount) : estimate.amount;

  return {
    orderId,
    stage: finance.stage as OrderFinanceStage,
    role,
    agreedAmount: agreed,
    confirmationAmount: Number(finance.confirmationAmount),
    orderedQuantity: finance.orderedQuantity,
    deliveredQuantity: finance.deliveredQuantity,
    finalAmount,
    balanceDue:
      finance.stage === OrderFinanceStage.FINALIZED || finance.stage === OrderFinanceStage.CANCELLED
        ? 0
        : balanceDue({ finalAmount: finalAmount ?? agreed, paidSoFar: paidByCustomer }),
    payments: payments.map((payment) => ({
      stage: Object.entries(STAGE_LABEL).find(([prefix]) => payment.reference.startsWith(prefix))?.[1] ?? 'OTHER',
      amount: Number(payment.amount),
      status: payment.status,
      reference: payment.reference,
      at: payment.createdAt.toISOString(),
    })),
    provider:
      role === 'FLEET' || role === 'ADMIN'
        ? {
            procurementReference: finance.procurementReference !== null ? Number(finance.procurementReference) : null,
            procurementAmount: finance.procurementAmount !== null ? Number(finance.procurementAmount) : null,
            profitBasis,
            commissionRate: commissionRow ? Number(commissionRow.rate) : estimate.rate,
            commissionAmount,
            netAfterCommission: Math.round((profitBasis - commissionAmount) * 100) / 100,
            final: commissionRow !== null,
            ruleVersion: commissionRow?.ruleVersion ?? estimate.ruleVersion,
          }
        : null,
    supplier:
      role === 'SUPPLIER'
        ? { procurementAmount: finance.procurementAmount !== null ? Number(finance.procurementAmount) : null }
        : null,
  };
}

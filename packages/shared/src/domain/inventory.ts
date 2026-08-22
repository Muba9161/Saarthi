/**
 * Stock availability arithmetic.
 *
 * All of it is pure so the API, the supplier console and the customer browse
 * page agree on what "available" means. The three quantities are kept apart on
 * purpose:
 *
 *   onHand   — physically in the yard
 *   reserved — promised to a confirmed order, still physically present
 *   incoming — expected, not yet arrived
 *
 * Collapsing reserved into on-hand is what lets two customers be sold the same
 * 30 tonnes, so nothing here does that.
 */

import {
  MaterialAvailabilityMode,
  type MaterialUnit,
  StockAvailabilityStatus,
  StockMovementType,
} from './enums';

export interface StockQuantities {
  onHandQuantity: number;
  reservedQuantity: number;
  incomingQuantity: number;
  damagedQuantity: number;
}

export interface AvailabilityInput extends StockQuantities {
  lowStockThreshold: number;
  allowBackorder: boolean;
  availabilityMode: MaterialAvailabilityMode;
  /** `false` reproduces the pre-inventory behaviour exactly. */
  stockTracked: boolean;
  /** Used when `stockTracked` is false — the legacy hand-edited column. */
  legacyAvailableQuantity?: number;
}

export interface AvailabilityResult {
  /** Physically free right now: on-hand less reserved and damaged. */
  availableQuantity: number;
  /** What may actually be sold, including incoming when backorder is allowed. */
  sellableQuantity: number;
  status: StockAvailabilityStatus;
  /** True when a buyer can place an order for `sellableQuantity` or less. */
  orderable: boolean;
}

function round(value: number): number {
  // Three decimals keeps kilogram-level precision without float dust.
  return Math.round(value * 1000) / 1000;
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  // Untracked materials keep behaving exactly as they did before inventory
  // existed: the supplier types a number and that number is the truth.
  if (!input.stockTracked) {
    const legacy = Math.max(0, input.legacyAvailableQuantity ?? 0);
    const mode = input.availabilityMode;
    if (mode === MaterialAvailabilityMode.MADE_TO_ORDER) {
      return {
        availableQuantity: legacy,
        sellableQuantity: legacy,
        status: StockAvailabilityStatus.MADE_TO_ORDER,
        orderable: true,
      };
    }
    if (mode === MaterialAvailabilityMode.ON_REQUEST) {
      return {
        availableQuantity: legacy,
        sellableQuantity: legacy,
        status: StockAvailabilityStatus.ON_REQUEST,
        orderable: true,
      };
    }
    return {
      availableQuantity: legacy,
      sellableQuantity: legacy,
      status:
        legacy <= 0
          ? StockAvailabilityStatus.OUT_OF_STOCK
          : legacy <= input.lowStockThreshold
            ? StockAvailabilityStatus.LOW_STOCK
            : StockAvailabilityStatus.IN_STOCK,
      orderable: legacy > 0,
    };
  }

  const available = round(
    Math.max(0, input.onHandQuantity - input.reservedQuantity - input.damagedQuantity),
  );
  const sellable = round(available + (input.allowBackorder ? Math.max(0, input.incomingQuantity) : 0));

  // Made-to-order and on-request are produced on demand, so stock does not gate
  // them. They still report their real numbers for the supplier's own screens.
  if (input.availabilityMode === MaterialAvailabilityMode.MADE_TO_ORDER) {
    return {
      availableQuantity: available,
      sellableQuantity: sellable,
      status: StockAvailabilityStatus.MADE_TO_ORDER,
      orderable: true,
    };
  }
  if (input.availabilityMode === MaterialAvailabilityMode.ON_REQUEST) {
    return {
      availableQuantity: available,
      sellableQuantity: sellable,
      status: StockAvailabilityStatus.ON_REQUEST,
      orderable: true,
    };
  }

  const status =
    sellable <= 0
      ? StockAvailabilityStatus.OUT_OF_STOCK
      : sellable <= input.lowStockThreshold
        ? StockAvailabilityStatus.LOW_STOCK
        : StockAvailabilityStatus.IN_STOCK;

  return {
    availableQuantity: available,
    sellableQuantity: sellable,
    status,
    orderable: sellable > 0,
  };
}

/** Sum several locations into one material-level position. */
export function aggregateStock(items: readonly StockQuantities[]): StockQuantities {
  return items.reduce<StockQuantities>(
    (total, item) => ({
      onHandQuantity: round(total.onHandQuantity + item.onHandQuantity),
      reservedQuantity: round(total.reservedQuantity + item.reservedQuantity),
      incomingQuantity: round(total.incomingQuantity + item.incomingQuantity),
      damagedQuantity: round(total.damagedQuantity + item.damagedQuantity),
    }),
    { onHandQuantity: 0, reservedQuantity: 0, incomingQuantity: 0, damagedQuantity: 0 },
  );
}

/**
 * How a movement type changes the two balances.
 *
 * Returning deltas rather than mutating keeps the ledger honest: the service
 * applies the delta and stores the resulting balance on the movement row, so a
 * later read can verify the arithmetic without replaying every row.
 */
export interface StockDelta {
  onHand: number;
  reserved: number;
  incoming: number;
  damaged: number;
}

export function movementDelta(type: StockMovementType, quantity: number): StockDelta {
  const amount = Math.abs(quantity);
  const zero: StockDelta = { onHand: 0, reserved: 0, incoming: 0, damaged: 0 };

  switch (type) {
    case StockMovementType.OPENING_BALANCE:
    case StockMovementType.RECEIPT:
    case StockMovementType.TRANSFER_IN:
    case StockMovementType.RETURN_IN:
      return { ...zero, onHand: amount };

    case StockMovementType.ISSUE:
    case StockMovementType.TRANSFER_OUT:
      return { ...zero, onHand: -amount };

    // A hold moves nothing physically — it only promises.
    case StockMovementType.RESERVE:
      return { ...zero, reserved: amount };

    case StockMovementType.RELEASE:
      return { ...zero, reserved: -amount };

    // Consumption is the moment goods actually leave against a hold.
    case StockMovementType.CONSUME:
      return { ...zero, onHand: -amount, reserved: -amount };

    case StockMovementType.DAMAGE:
      return { ...zero, damaged: amount };

    // Adjustment and count correction are signed: the caller states direction.
    case StockMovementType.ADJUSTMENT:
    case StockMovementType.COUNT_CORRECTION:
      return { ...zero, onHand: quantity };

    default:
      return zero;
  }
}

/** Movement types that require an explicit reason before they are accepted. */
export const REASON_REQUIRED_MOVEMENTS: StockMovementType[] = [
  StockMovementType.ADJUSTMENT,
  StockMovementType.COUNT_CORRECTION,
  StockMovementType.DAMAGE,
];

export function movementRequiresReason(type: StockMovementType): boolean {
  return REASON_REQUIRED_MOVEMENTS.includes(type);
}

/**
 * Volume pricing.
 *
 * Tiers are "at or above this quantity", so the applicable tier is the highest
 * whose `minQuantity` the order meets. Falls back to the base price.
 */
export interface PriceTier {
  minQuantity: number;
  pricePerUnit: number;
}

export function resolveUnitPrice(
  basePrice: number,
  tiers: readonly PriceTier[],
  quantity: number,
): { pricePerUnit: number; tierApplied: PriceTier | null } {
  const eligible = tiers
    .filter((tier) => quantity >= tier.minQuantity)
    .sort((a, b) => b.minQuantity - a.minQuantity);
  const best = eligible[0];
  return best
    ? { pricePerUnit: best.pricePerUnit, tierApplied: best }
    : { pricePerUnit: basePrice, tierApplied: null };
}

/**
 * Buyer-safe quantity buckets.
 *
 * A competitor must not be able to read a supplier's exact yard position off a
 * public browse page, but a buyer does need to know whether their 40 tonnes is
 * realistic. Buckets answer the buyer's question without answering the
 * competitor's.
 */
export const STOCK_BUCKETS = [
  { floor: 500, label: '500+' },
  { floor: 100, label: '100-500' },
  { floor: 50, label: '50-100' },
  { floor: 10, label: '10-50' },
  { floor: 1, label: 'Under 10' },
] as const;

export function bucketQuantity(quantity: number): string {
  if (quantity <= 0) return 'None';
  const bucket = STOCK_BUCKETS.find((entry) => quantity >= entry.floor);
  return bucket?.label ?? 'Under 10';
}

/** Human label for an availability status. */
export function availabilityLabel(status: StockAvailabilityStatus): string {
  switch (status) {
    case StockAvailabilityStatus.IN_STOCK:
      return 'In stock';
    case StockAvailabilityStatus.LOW_STOCK:
      return 'Low stock';
    case StockAvailabilityStatus.OUT_OF_STOCK:
      return 'Out of stock';
    case StockAvailabilityStatus.MADE_TO_ORDER:
      return 'Made to order';
    case StockAvailabilityStatus.ON_REQUEST:
      return 'Price on request';
    case StockAvailabilityStatus.DISCONTINUED:
      return 'Discontinued';
    default:
      return 'Unknown';
  }
}

/**
 * Can this order quantity be accepted?
 *
 * Returns a human-readable problem rather than a boolean so the API and the form
 * show the buyer the same sentence.
 */
export function validateOrderQuantity(
  availability: AvailabilityResult,
  input: {
    quantity: number;
    minimumOrderQty: number;
    maximumOrderQty?: number | null;
    unit: MaterialUnit;
    leadTimeDays?: number | null;
  },
): string | null {
  if (input.quantity <= 0) return 'Enter a quantity greater than zero.';

  if (input.quantity < input.minimumOrderQty) {
    return `The minimum order for this item is ${input.minimumOrderQty} ${input.unit.toLowerCase()}.`;
  }
  if (
    input.maximumOrderQty !== null &&
    input.maximumOrderQty !== undefined &&
    input.quantity > input.maximumOrderQty
  ) {
    return `The maximum order for this item is ${input.maximumOrderQty} ${input.unit.toLowerCase()}.`;
  }

  // Made-to-order and on-request items are not gated by stock at all.
  if (
    availability.status === StockAvailabilityStatus.MADE_TO_ORDER ||
    availability.status === StockAvailabilityStatus.ON_REQUEST
  ) {
    return null;
  }

  if (availability.status === StockAvailabilityStatus.DISCONTINUED) {
    return 'This item has been discontinued.';
  }
  if (!availability.orderable) {
    return 'This item is out of stock.';
  }
  if (input.quantity > availability.sellableQuantity) {
    return `Only ${availability.sellableQuantity} ${input.unit.toLowerCase()} is available right now.`;
  }
  return null;
}

import { z } from 'zod';
import {
  InventoryLocationKind,
  MaterialAvailabilityMode,
  MaterialUnit,
  StockAvailabilityStatus,
  StockMovementType,
  StockReservationStatus,
} from '../domain/enums';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  optionalTrimmedString,
  paginationSchema,
  sortOrderSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Inventory validation.
 *
 * Quantities are non-negative everywhere except adjustments and count
 * corrections, which are deliberately signed — a stock correction has to be able
 * to go both ways, and forcing a direction flag alongside a positive number
 * makes the ledger harder to read, not safer.
 */

const minutesOfDaySchema = z.coerce.number().int().min(0).max(1439);

export const quantitySchema = z
  .number()
  .min(0, 'Quantity cannot be negative.')
  .max(10_000_000, 'Quantity is unrealistically large.')
  .refine((value) => Number.isFinite(value), 'Enter a valid quantity.');

export const positiveMovementQuantitySchema = z
  .number()
  .positive('Quantity must be greater than zero.')
  .max(10_000_000, 'Quantity is unrealistically large.');

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const createInventoryLocationSchema = z.object({
  name: trimmedString(2, 120),
  code: trimmedString(1, 32).transform((value) => value.toUpperCase()),
  kind: z.nativeEnum(InventoryLocationKind).default(InventoryLocationKind.YARD),
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  postalCode: optionalTrimmedString(20),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  contactName: optionalTrimmedString(120),
  contactPhone: optionalTrimmedString(20),
  openFromMinutes: minutesOfDaySchema.optional(),
  openToMinutes: minutesOfDaySchema.optional(),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type CreateInventoryLocationInput = z.infer<typeof createInventoryLocationSchema>;

export const updateInventoryLocationSchema = createInventoryLocationSchema.partial();
export type UpdateInventoryLocationInput = z.infer<typeof updateInventoryLocationSchema>;

export const inventoryLocationListQuerySchema = paginationSchema.extend({
  kind: csvEnum([
    InventoryLocationKind.YARD,
    InventoryLocationKind.WAREHOUSE,
    InventoryLocationKind.DEPOT,
    InventoryLocationKind.QUARRY,
    InventoryLocationKind.PLANT,
    InventoryLocationKind.RETAIL_COUNTER,
    InventoryLocationKind.TRANSIT,
  ]),
  activeOnly: z.coerce.boolean().optional(),
  search: optionalTrimmedString(160),
});
export type InventoryLocationListQuery = z.infer<typeof inventoryLocationListQuerySchema>;

// ---------------------------------------------------------------------------
// Stock items
// ---------------------------------------------------------------------------

export const createStockItemSchema = z.object({
  materialId: uuidSchema,
  locationId: uuidSchema,
  /** Opening physical balance. Written to the ledger as OPENING_BALANCE. */
  onHandQuantity: quantitySchema.default(0),
  incomingQuantity: quantitySchema.default(0),
  lowStockThreshold: quantitySchema.default(0),
  reorderLevel: quantitySchema.optional(),
  reorderQuantity: quantitySchema.optional(),
  binReference: optionalTrimmedString(60),
  nextRestockAt: z.coerce.date().optional(),
});
export type CreateStockItemInput = z.infer<typeof createStockItemSchema>;

export const updateStockItemSchema = z.object({
  lowStockThreshold: quantitySchema.optional(),
  reorderLevel: quantitySchema.optional(),
  reorderQuantity: quantitySchema.optional(),
  incomingQuantity: quantitySchema.optional(),
  binReference: optionalTrimmedString(60),
  nextRestockAt: z.coerce.date().nullable().optional(),
});
export type UpdateStockItemInput = z.infer<typeof updateStockItemSchema>;

export const stockListQuerySchema = paginationSchema.extend({
  materialId: uuidSchema.optional(),
  locationId: uuidSchema.optional(),
  status: csvEnum([
    StockAvailabilityStatus.IN_STOCK,
    StockAvailabilityStatus.LOW_STOCK,
    StockAvailabilityStatus.OUT_OF_STOCK,
    StockAvailabilityStatus.MADE_TO_ORDER,
    StockAvailabilityStatus.ON_REQUEST,
    StockAvailabilityStatus.DISCONTINUED,
  ]),
  lowOnly: z.coerce.boolean().optional(),
  search: optionalTrimmedString(160),
  sortBy: z.enum(['material', 'available', 'onHand', 'updatedAt']).default('material'),
  sortOrder: sortOrderSchema,
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export const receiveStockSchema = z.object({
  quantity: positiveMovementQuantitySchema,
  unitCost: moneySchema.optional(),
  reference: optionalTrimmedString(120),
  note: optionalTrimmedString(500),
  occurredAt: z.coerce.date().optional(),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

/** Signed on purpose — a correction must be able to go either way. */
export const adjustStockSchema = z.object({
  quantity: z
    .number()
    .refine((value) => Number.isFinite(value) && value !== 0, 'Enter a non-zero adjustment.')
    .refine((value) => Math.abs(value) <= 10_000_000, 'Adjustment is unrealistically large.'),
  reason: trimmedString(3, 200),
  note: optionalTrimmedString(500),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const countStockSchema = z.object({
  /** The physical count. The service derives the correction from it. */
  countedQuantity: quantitySchema,
  reason: optionalTrimmedString(200),
  note: optionalTrimmedString(500),
});
export type CountStockInput = z.infer<typeof countStockSchema>;

export const recordDamageSchema = z.object({
  quantity: positiveMovementQuantitySchema,
  reason: trimmedString(3, 200),
  note: optionalTrimmedString(500),
});
export type RecordDamageInput = z.infer<typeof recordDamageSchema>;

export const transferStockSchema = z
  .object({
    materialId: uuidSchema,
    fromLocationId: uuidSchema,
    toLocationId: uuidSchema,
    quantity: positiveMovementQuantitySchema,
    note: optionalTrimmedString(500),
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    message: 'Choose two different locations.',
    path: ['toLocationId'],
  });
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export const stockMovementListQuerySchema = paginationSchema.extend({
  materialId: uuidSchema.optional(),
  locationId: uuidSchema.optional(),
  stockItemId: uuidSchema.optional(),
  type: csvEnum([
    StockMovementType.OPENING_BALANCE,
    StockMovementType.RECEIPT,
    StockMovementType.ISSUE,
    StockMovementType.RESERVE,
    StockMovementType.RELEASE,
    StockMovementType.CONSUME,
    StockMovementType.ADJUSTMENT,
    StockMovementType.TRANSFER_IN,
    StockMovementType.TRANSFER_OUT,
    StockMovementType.RETURN_IN,
    StockMovementType.DAMAGE,
    StockMovementType.COUNT_CORRECTION,
  ]),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export const reservationListQuerySchema = paginationSchema.extend({
  materialId: uuidSchema.optional(),
  orderId: uuidSchema.optional(),
  status: csvEnum([
    StockReservationStatus.HELD,
    StockReservationStatus.CONFIRMED,
    StockReservationStatus.CONSUMED,
    StockReservationStatus.RELEASED,
    StockReservationStatus.EXPIRED,
  ]),
});
export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

export const releaseReservationSchema = z.object({
  reason: optionalTrimmedString(200),
});
export type ReleaseReservationInput = z.infer<typeof releaseReservationSchema>;

// ---------------------------------------------------------------------------
// Material inventory settings & price tiers
// ---------------------------------------------------------------------------

export const materialInventorySettingsSchema = z.object({
  sku: optionalTrimmedString(64),
  hsnCode: optionalTrimmedString(20),
  brand: optionalTrimmedString(120),
  stockTracked: z.boolean().optional(),
  availabilityMode: z.nativeEnum(MaterialAvailabilityMode).optional(),
  lowStockThreshold: quantitySchema.optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  maximumOrderQty: quantitySchema.optional(),
  allowBackorder: z.boolean().optional(),
  nextRestockAt: z.coerce.date().nullable().optional(),
});
export type MaterialInventorySettingsInput = z.infer<typeof materialInventorySettingsSchema>;

export const priceTierSchema = z.object({
  minQuantity: positiveMovementQuantitySchema,
  pricePerUnit: moneySchema,
});

export const setPriceTiersSchema = z.object({
  tiers: z.array(priceTierSchema).max(10),
});
export type SetPriceTiersInput = z.infer<typeof setPriceTiersSchema>;

// ---------------------------------------------------------------------------
// Buyer-facing availability check
// ---------------------------------------------------------------------------

export const availabilityCheckQuerySchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  unit: z.nativeEnum(MaterialUnit).optional(),
  /** Rank pickup locations by distance from here. */
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
});
export type AvailabilityCheckQuery = z.infer<typeof availabilityCheckQuerySchema>;

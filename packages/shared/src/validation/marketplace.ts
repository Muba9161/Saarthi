import { z } from 'zod';
import { MaterialStatus, MaterialUnit, OrderStatus, TruckType } from '../domain/enums';
import {
  addressSchema,
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  optionalTrimmedString,
  paginationSchema,
  positiveQuantitySchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Marketplace contracts: supplier materials, customer requirements, fleet
 * quotes and the order lifecycle.
 */

export const materialUnitSchema = z.nativeEnum(MaterialUnit);

export const createMaterialSchema = z.object({
  name: trimmedString(2, 120),
  category: optionalTrimmedString(60),
  description: optionalTrimmedString(2000),
  unit: materialUnitSchema.default(MaterialUnit.TON),
  pricePerUnit: moneySchema,
  availableQuantity: z.coerce.number().min(0).max(100_000_000).default(0),
  minimumOrderQty: z.coerce.number().min(0).max(1_000_000).default(1),
  status: z.nativeEnum(MaterialStatus).default(MaterialStatus.ACTIVE),
  pickupAddress: optionalTrimmedString(300),
  pickupLatitude: latitudeSchema.optional(),
  pickupLongitude: longitudeSchema.optional(),
});
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = createMaterialSchema.partial();
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;

export const materialListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  category: optionalTrimmedString(60),
  status: csvEnum([MaterialStatus.ACTIVE, MaterialStatus.INACTIVE, MaterialStatus.OUT_OF_STOCK]),
  supplierId: uuidSchema.optional(),
  /** Marketplace browsing: only show what a customer could actually order. */
  availableOnly: z.coerce.boolean().default(false),
  maxPrice: z.coerce.number().min(0).optional(),
  /** Rank by distance from this point when supplied. */
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(2000).optional(),
  sortBy: z.enum(['name', 'pricePerUnit', 'createdAt', 'distance']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type MaterialListQuery = z.infer<typeof materialListQuerySchema>;

export const supplierProfileSchema = z.object({
  businessDescription: optionalTrimmedString(2000),
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(80),
  state: optionalTrimmedString(80),
  postalCode: optionalTrimmedString(12),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  contactName: optionalTrimmedString(80),
  contactPhone: optionalTrimmedString(20),
});
export type SupplierProfileInput = z.infer<typeof supplierProfileSchema>;

export const customerProfileSchema = z.object({
  businessType: optionalTrimmedString(80),
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(80),
  state: optionalTrimmedString(80),
  postalCode: optionalTrimmedString(12),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * A customer requirement. Either an existing material is selected (the
 * supplier then fulfils it) or the customer names the goods they already own
 * and needs transport only.
 */
export const createOrderSchema = z
  .object({
    materialId: uuidSchema.optional(),
    materialName: optionalTrimmedString(120),
    quantity: positiveQuantitySchema,
    unit: materialUnitSchema.default(MaterialUnit.TON),
    origin: addressSchema,
    destination: addressSchema,
    requiredCapacityTons: z.coerce
      .number()
      .positive('Enter the truck capacity you need.')
      .max(200),
    requiredTruckType: z.nativeEnum(TruckType).optional(),
    pickupAt: z.coerce.date().optional(),
    deliverBy: z.coerce.date().optional(),
    budget: moneySchema.optional(),
    notes: optionalTrimmedString(2000),
  })
  .superRefine((value, ctx) => {
    if (!value.materialId && !value.materialName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['materialName'],
        message: 'Select a material from the marketplace or describe what needs to be moved.',
      });
    }
    if (value.pickupAt && value.deliverBy && value.pickupAt > value.deliverBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deliverBy'],
        message: 'The delivery deadline must be after the pickup time.',
      });
    }
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object({
  quantity: positiveQuantitySchema.optional(),
  pickupAt: z.coerce.date().optional(),
  deliverBy: z.coerce.date().optional(),
  budget: moneySchema.optional(),
  notes: optionalTrimmedString(2000),
  requiredCapacityTons: z.coerce.number().positive().max(200).optional(),
  requiredTruckType: z.nativeEnum(TruckType).optional(),
});
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const orderListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  status: csvEnum([
    OrderStatus.DRAFT,
    OrderStatus.REQUESTED,
    OrderStatus.QUOTED,
    OrderStatus.CONFIRMED,
    OrderStatus.ASSIGNED,
    OrderStatus.PICKUP,
    OrderStatus.IN_TRANSIT,
    OrderStatus.DELIVERED,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
    OrderStatus.FAILED,
  ]),
  /** `active` collapses every in-flight status into one filter. */
  activeOnly: z.coerce.boolean().default(false),
  customerOrganizationId: uuidSchema.optional(),
  fleetOrganizationId: uuidSchema.optional(),
  truckId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'deliverBy', 'totalPrice', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

/** Open requirements a fleet can bid on. */
export const marketplaceQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  minCapacityTons: z.coerce.number().min(0).optional(),
  maxCapacityTons: z.coerce.number().min(0).optional(),
  nearLatitude: latitudeSchema.optional(),
  nearLongitude: longitudeSchema.optional(),
  radiusKm: z.coerce.number().min(1).max(2000).default(250),
  /** Hide requirements this fleet has already quoted. */
  excludeQuoted: z.coerce.boolean().default(false),
});
export type MarketplaceQuery = z.infer<typeof marketplaceQuerySchema>;

export const createQuoteSchema = z.object({
  truckId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  price: moneySchema,
  estimatedPickupAt: z.coerce.date().optional(),
  estimatedArrivalAt: z.coerce.date().optional(),
  message: optionalTrimmedString(1000),
  expiresAt: z.coerce.date().optional(),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export const acceptQuoteSchema = z.object({
  quoteId: uuidSchema,
});
export type AcceptQuoteInput = z.infer<typeof acceptQuoteSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  reason: optionalTrimmedString(500),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const cancelOrderSchema = z.object({
  reason: trimmedString(5, 500),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const rateOrderSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  punctuality: z.coerce.number().int().min(1).max(5).optional(),
  communication: z.coerce.number().int().min(1).max(5).optional(),
  cargoCondition: z.coerce.number().int().min(1).max(5).optional(),
  comment: optionalTrimmedString(1000),
});
export type RateOrderInput = z.infer<typeof rateOrderSchema>;

/**
 * Matching request: "find me transport for this requirement". Used both by the
 * customer comparison screen and by the AI assignment recommender.
 */
export const matchTransportSchema = z.object({
  originLatitude: latitudeSchema,
  originLongitude: longitudeSchema,
  destinationLatitude: latitudeSchema,
  destinationLongitude: longitudeSchema,
  requiredCapacityTons: z.coerce.number().positive().max(200),
  requiredTruckType: z.nativeEnum(TruckType).optional(),
  pickupAt: z.coerce.date().optional(),
  radiusKm: z.coerce.number().min(5).max(1000).default(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type MatchTransportInput = z.infer<typeof matchTransportSchema>;

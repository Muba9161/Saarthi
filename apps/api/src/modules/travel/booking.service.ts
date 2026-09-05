import {
  ACTIVE_BOOKING_STATUSES,
  ASSIGNABLE_TRUCK_STATUSES,
  BookingEventType,
  BookingStatus,
  CANCELLABLE_BOOKING_STATUSES,
  CancelledBy,
  DEFAULT_CANCELLATION_POLICY,
  NotificationPriority,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  PricingModel,
  TravelPackageStatus,
  TripStatus,
  TruckStatus,
  bookingStateMachine,
  buildPaginationMeta,
  calculateRefund,
  journeyDistanceKm,
  platformFeeFor,
  quotePackage,
  type TravelServiceKind,
  type BookingListQuery,
  type CancelBookingInput,
  type ConfirmBookingInput,
  type CreateBookingInput,
  type DeclineBookingInput,
  type Paginated,
  type PayBookingInput,
  type RateBookingInput,
  type VehicleType,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { paymentProvider } from '../../providers/payments';
import { notify, notifyOrganization } from '../notifications/notification.service';
import { broadcastBooking } from '../../realtime/realtime.service';
import type { AuthContext } from '../../auth/context';
import { recalculatePackageRating } from './package.service';
import { recalculateProviderRating } from './provider.service';
import {
  markRequirementCancelled,
  markRequirementFulfilled,
} from '../requirements/fulfilment.service';

/**
 * Travel bookings.
 *
 *   book → pay → provider confirms → trip → tracking → complete → rate
 *
 * This lifecycle is deliberately *not* shared with freight orders. A freight
 * order is quoted by carriers, awarded, then invoiced; a travel booking is paid
 * up front and then accepted or declined by one named provider. Forcing both
 * through one state machine would mean every rule carried an "unless it is
 * travel" clause. What they do share is the infrastructure underneath —
 * organizations, vehicles, drivers, trips, live tracking, notifications — which
 * is why a customer sees freight and travel as two tabs of one account.
 *
 * A paid booking is a *request*, not a guarantee: the provider still has to
 * confirm that a vehicle and driver are free that day. Money therefore moves
 * before confirmation, and a decline refunds in full.
 */

const bookingLogger = logger.child({ module: 'travel-bookings' });

export interface BookingSummary {
  id: string;
  reference: string;
  status: BookingStatus;
  packageId: string;
  packageTitle: string;
  packageSummary: string;
  packageImageUrl: string | null;
  serviceKind: string;
  destinations: string[];
  providerOrganizationId: string;
  providerName: string | null;
  providerPhone: string | null;
  customerOrganizationId: string;
  customerName: string | null;
  startDate: string;
  endDate: string;
  durationDays: number;
  passengers: number;
  pickupAddress: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  dropoffAddress: string | null;
  dropoffLatitude: number | null;
  dropoffLongitude: number | null;
  /** Pickup to drop-off, as measured when the fare was agreed. */
  distanceKm: number | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  specialRequests: string | null;
  pricingModel: PricingModel;
  subtotal: number;
  platformFee: number;
  totalAmount: number;
  currency: string;
  priceBreakdown: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: VehicleType;
    model: string | null;
  } | null;
  driver: { id: string; name: string; phone: string | null; overallScore: number | null } | null;
  tripId: string | null;
  paymentStatus: PaymentStatus | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: CancelledBy | null;
  cancellationReason: string | null;
  refundAmount: number | null;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

const bookingInclude = {
  package: {
    select: {
      id: true,
      title: true,
      summary: true,
      imageUrls: true,
      serviceKind: true,
      destinations: true,
      durationDays: true,
      cancellationPolicy: true,
      startLocation: true,
      startLatitude: true,
      startLongitude: true,
      endLocation: true,
      providerId: true,
    },
  },
  vehicle: {
    select: { id: true, registrationNumber: true, vehicleType: true, model: true },
  },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  review: { select: { rating: true } },
} satisfies Prisma.TravelBookingInclude;

type BookingRecord = Prisma.TravelBookingGetPayload<{ include: typeof bookingInclude }>;

async function toSummary(booking: BookingRecord): Promise<BookingSummary> {
  const [providerOrg, customerOrg, driver] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: booking.providerOrganizationId },
      select: { name: true, phone: true },
    }),
    prisma.organization.findUnique({
      where: { id: booking.customerOrganizationId },
      select: { name: true },
    }),
    booking.driverId
      ? prisma.driver.findUnique({
          where: { id: booking.driverId },
          include: { user: { select: { firstName: true, lastName: true, phone: true } } },
        })
      : Promise.resolve(null),
  ]);

  // The provider's number is shared only once the booking is actually confirmed
  // — before that the customer has no reason to be calling them directly, and a
  // pending request should not leak a contact for cold outreach.
  const confirmed =
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.IN_PROGRESS ||
    booking.status === BookingStatus.COMPLETED;

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status as BookingStatus,
    packageId: booking.packageId,
    packageTitle: booking.package.title,
    packageSummary: booking.package.summary,
    packageImageUrl: booking.package.imageUrls[0] ?? null,
    serviceKind: booking.package.serviceKind,
    destinations: booking.package.destinations,
    providerOrganizationId: booking.providerOrganizationId,
    providerName: providerOrg?.name ?? null,
    providerPhone: confirmed ? (providerOrg?.phone ?? null) : null,
    customerOrganizationId: booking.customerOrganizationId,
    customerName: customerOrg?.name ?? null,
    startDate: booking.startDate.toISOString(),
    endDate: booking.endDate.toISOString(),
    durationDays: booking.package.durationDays,
    passengers: booking.passengers,
    pickupAddress: booking.pickupAddress,
    pickupLatitude: booking.pickupLatitude,
    pickupLongitude: booking.pickupLongitude,
    dropoffAddress: booking.dropoffAddress,
    dropoffLatitude: booking.dropoffLatitude,
    dropoffLongitude: booking.dropoffLongitude,
    distanceKm: booking.distanceKm,
    contactName: booking.contactName,
    contactPhone: booking.contactPhone,
    contactEmail: booking.contactEmail,
    specialRequests: booking.specialRequests,
    pricingModel: booking.pricingModel as PricingModel,
    subtotal: Number(booking.subtotal),
    platformFee: Number(booking.platformFee),
    totalAmount: Number(booking.totalAmount),
    currency: booking.currency,
    priceBreakdown: booking.priceBreakdown,
    vehicle: booking.vehicle
      ? {
          id: booking.vehicle.id,
          registrationNumber: booking.vehicle.registrationNumber,
          vehicleType: booking.vehicle.vehicleType as VehicleType,
          model: booking.vehicle.model,
        }
      : null,
    driver: driver
      ? {
          id: driver.id,
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          // Same reasoning as the provider number: only once confirmed.
          phone: confirmed ? driver.user.phone : null,
          overallScore: driver.overallScore,
        }
      : null,
    tripId: booking.tripId,
    paymentStatus: (booking.payments[0]?.status as PaymentStatus) ?? null,
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    declinedAt: booking.declinedAt?.toISOString() ?? null,
    declineReason: booking.declineReason,
    startedAt: booking.startedAt?.toISOString() ?? null,
    completedAt: booking.completedAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancelledBy: booking.cancelledBy as CancelledBy | null,
    cancellationReason: booking.cancellationReason,
    refundAmount: booking.refundAmount === null ? null : Number(booking.refundAmount),
    rating: booking.review?.rating ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

async function publish(booking: BookingRecord, created: boolean): Promise<void> {
  await broadcastBooking(
    {
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status as BookingStatus,
      packageId: booking.packageId,
      packageTitle: booking.package.title,
      customerOrganizationId: booking.customerOrganizationId,
      providerOrganizationId: booking.providerOrganizationId,
      vehicleId: booking.vehicleId,
      vehicleType: (booking.vehicle?.vehicleType as VehicleType) ?? null,
      driverId: booking.driverId,
      tripId: booking.tripId,
      startDate: booking.startDate.toISOString(),
      totalAmount: Number(booking.totalAmount),
      updatedAt: booking.updatedAt.toISOString(),
    },
    created,
  );
}

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.travelBooking.count();
  return `TB-${year}-${String(count + 1).padStart(5, '0')}`;
}

async function recordEvent(
  bookingId: string,
  eventType: BookingEventType,
  description: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.travelBookingEvent.create({
    data: {
      bookingId,
      eventType,
      description,
      actorUserId,
      ...(metadata ? { metadata: metadata as never } : {}),
    },
  });
}

/**
 * Load a booking the caller is entitled to see.
 *
 * Three parties legitimately read a booking — the customer, the provider and
 * the assigned driver — so this cannot use the standard single-tenant check.
 * Anyone else gets "not found" rather than "forbidden", so booking ids cannot
 * be probed.
 */
async function loadBooking(auth: AuthContext, bookingId: string): Promise<BookingRecord> {
  const booking = await prisma.travelBooking.findUnique({
    where: { id: bookingId },
    include: bookingInclude,
  });
  if (!booking) throw errors.notFound('Booking');
  if (auth.isPlatformAdmin) return booking;

  const isCustomer = booking.customerOrganizationId === auth.organizationId;
  const isProvider = booking.providerOrganizationId === auth.organizationId;
  const isDriver = auth.driverId !== null && booking.driverId === auth.driverId;

  if (!isCustomer && !isProvider && !isDriver) throw errors.notFound('Booking');
  return booking;
}

// ---------------------------------------------------------------------------
// Creating a booking
// ---------------------------------------------------------------------------

export async function createBooking(
  auth: AuthContext,
  input: CreateBookingInput,
): Promise<BookingSummary> {
  const customerOrganizationId = auth.organizationId;
  if (!customerOrganizationId) {
    throw errors.organizationRequired('Sign in with a customer account to book travel.');
  }

  const pkg = await prisma.travelPackage.findFirst({
    where: { id: input.packageId, archivedAt: null },
    include: {
      provider: {
        select: {
          organizationId: true,
          status: true,
          organization: { select: { verificationStatus: true } },
        },
      },
    },
  });
  if (!pkg) throw errors.notFound('Package');

  if (pkg.status !== TravelPackageStatus.PUBLISHED) {
    throw errors.businessRule('This package is not currently open for booking.');
  }
  if (pkg.provider.status !== 'ACTIVE') {
    throw errors.businessRule('This provider is not accepting bookings at the moment.');
  }
  if (pkg.provider.organization.verificationStatus !== 'VERIFIED') {
    throw errors.businessRule('This provider is not yet verified on Saarthi.');
  }
  if (pkg.provider.organizationId === customerOrganizationId) {
    throw errors.businessRule('You cannot book your own travel package.');
  }
  if (input.passengers < pkg.minPassengers || input.passengers > pkg.maxPassengers) {
    throw errors.validation(
      `This package takes between ${pkg.minPassengers} and ${pkg.maxPassengers} passengers.`,
    );
  }

  // Respect the provider's stated notice period on top of the platform minimum.
  const leadDays = (input.startDate.getTime() - Date.now()) / 86_400_000;
  if (leadDays < pkg.advanceBookingDays) {
    throw errors.businessRule(
      `${pkg.title} needs at least ${pkg.advanceBookingDays} day(s) notice.`,
    );
  }
  if (pkg.availableFrom && input.startDate < pkg.availableFrom) {
    throw errors.businessRule('This package is not available that early in the season.');
  }
  if (pkg.availableTo && input.startDate > pkg.availableTo) {
    throw errors.businessRule('This package is not available that late in the season.');
  }
  if (
    pkg.availableWeekdays.length > 0 &&
    !pkg.availableWeekdays.includes(input.startDate.getDay())
  ) {
    throw errors.businessRule('This package does not depart on that day of the week.');
  }

  const pickup = {
    address: input.pickupAddress ?? pkg.startLocation,
    latitude: input.pickupLatitude ?? pkg.startLatitude,
    longitude: input.pickupLongitude ?? pkg.startLongitude,
  };
  // Named by the customer, or not named at all — a fixed tour ends where the
  // package says it ends, and only the taxi-shaped packages ask.
  const dropoff =
    input.dropoffAddress &&
    input.dropoffLatitude !== undefined &&
    input.dropoffLongitude !== undefined
      ? {
          address: input.dropoffAddress,
          latitude: input.dropoffLatitude,
          longitude: input.dropoffLongitude,
        }
      : null;

  const distance = journeyDistanceKm(pickup, dropoff, pkg.approxDistanceKm);

  /*
   * A per-kilometre fare has to be charged on the journey actually asked for.
   *
   * The package declares a nominal distance so it can be listed with a "from"
   * price, and falling back to it here would look harmless — the fare would be
   * a real number rather than zero. It would also be the wrong number for
   * every passenger who is not going exactly that far, quietly billing a
   * cross-district run at the price of a station drop. So the destination is
   * required rather than assumed.
   */
  if (pkg.pricingModel === PricingModel.PER_KM && (!dropoff || !(distance && distance > 0))) {
    throw errors.validation(
      'Tell us where you are going — this fare is charged by the kilometre.',
      {
        fields: { dropoffAddress: ['Enter your destination.'] },
      },
    );
  }

  // Price is snapshotted now. A later change to the package price must never
  // silently alter what the customer agreed to pay.
  const quote = quotePackage(
    {
      pricingModel: pkg.pricingModel as PricingModel,
      basePrice: Number(pkg.basePrice),
      durationDays: pkg.durationDays,
      distanceKm: distance,
    },
    input.passengers,
  );

  const endDate = new Date(
    input.startDate.getTime() + Math.max(0, pkg.durationDays - 1) * 86_400_000,
  );

  const customer = await prisma.customer.findFirst({
    where: { organizationId: customerOrganizationId },
    select: { id: true },
  });

  const booking = await prisma.travelBooking.create({
    data: {
      reference: await nextReference(),
      packageId: pkg.id,
      providerOrganizationId: pkg.provider.organizationId,
      customerOrganizationId,
      customerId: customer?.id ?? null,
      bookedByUserId: auth.user.id,
      status: BookingStatus.PENDING_PAYMENT,
      startDate: input.startDate,
      endDate,
      passengers: input.passengers,
      pickupAddress: pickup.address,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      dropoffAddress: dropoff?.address ?? null,
      dropoffLatitude: dropoff?.latitude ?? null,
      dropoffLongitude: dropoff?.longitude ?? null,
      distanceKm: distance,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail ?? null,
      specialRequests: input.specialRequests ?? null,
      pricingModel: pkg.pricingModel,
      subtotal: quote.subtotal,
      platformFee: quote.platformFee,
      totalAmount: quote.total,
      priceBreakdown: quote.breakdown,
    },
    include: bookingInclude,
  });

  await recordEvent(
    booking.id,
    BookingEventType.CREATED,
    `${input.passengers} passenger(s) for ${pkg.title} on ${input.startDate.toDateString()}.`,
    auth.user.id,
  );

  await prisma.travelPackage.update({
    where: { id: pkg.id },
    data: { bookingCount: { increment: 1 } },
  });

  await publish(booking, true);
  return toSummary(booking);
}

// ---------------------------------------------------------------------------
// Bookings raised by awarding a travel requirement
// ---------------------------------------------------------------------------

export interface RequirementBookingInput {
  requirementId: string;
  requirementReference: string;
  requirementTitle: string;
  providerOrganizationId: string;
  customerOrganizationId: string;

  serviceKind: TravelServiceKind;
  startDate: Date;
  endDate: Date;
  passengers: number;

  startLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLocation: string;
  destinations: string[];
  durationDays: number;
  durationNights: number | null;
  approxDistanceKm: number | null;

  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  specialRequests: string | null;

  /** The awarded bid: what the operator offered and at what price. */
  offeredVehicleType: VehicleType;
  agreedPrice: number;
  priceBreakdown: string | null;
  inclusions: string[];
  exclusions: string[];
  itinerarySummary: string | null;
  driverIncluded: boolean;
  fuelIncluded: boolean;
}

/**
 * Turn an awarded travel bid into a booking.
 *
 * A bespoke journey has no catalogue entry, and `TravelBooking.packageId` is
 * required — so the award mints one. The minted package is owned by the winning
 * operator, carries `sourceRequirementId`, and is left in DRAFT, which keeps it
 * out of customer search and out of the operator's own catalogue listing while
 * still giving the booking something real to hang from.
 *
 * That choice is what let the entire travel pipeline be reused unchanged:
 * payment, provider confirmation, vehicle and driver assignment, the trip, live
 * tracking, completion and the review all run on the code that was already
 * there. Making `packageId` nullable instead would have meant a null check at
 * roughly thirty call sites in this file alone, each one a chance to regress a
 * flow that works today.
 *
 * The booking is created in PENDING_PAYMENT for the same reason a catalogue
 * booking is: the operator has committed to a price, and the customer pays
 * before the operator is asked to hold a vehicle for the date.
 */
export async function createBookingFromRequirement(
  auth: AuthContext,
  input: RequirementBookingInput,
): Promise<{ bookingId: string; packageId: string; totalAmount: number }> {
  const provider = await prisma.serviceProviderProfile.findUnique({
    where: { organizationId: input.providerOrganizationId },
    select: { id: true, status: true },
  });
  if (!provider) {
    throw errors.businessRule('The winning operator no longer has a provider profile.');
  }

  const customer = await prisma.customer.findFirst({
    where: { organizationId: input.customerOrganizationId },
    select: { id: true },
  });

  // The operator quoted a single all-in figure, so the price is fixed for this
  // party rather than recomputed per head.
  const platformFee = platformFeeFor(input.agreedPrice);

  const created = await prisma.$transaction(async (tx) => {
    const pkg = await tx.travelPackage.create({
      data: {
        providerId: provider.id,
        organizationId: input.providerOrganizationId,
        sourceRequirementId: input.requirementId,
        title: input.requirementTitle,
        summary: `Built for requirement ${input.requirementReference}.`,
        description: input.itinerarySummary,
        serviceKind: input.serviceKind,
        imageUrls: [],
        destinations: input.destinations.length > 0 ? input.destinations : [input.endLocation],
        startLocation: input.startLocation,
        startLatitude: input.startLatitude,
        startLongitude: input.startLongitude,
        endLocation: input.endLocation,
        durationDays: input.durationDays,
        durationNights: input.durationNights,
        approxDistanceKm: input.approxDistanceKm,
        vehicleType: input.offeredVehicleType,
        minPassengers: 1,
        maxPassengers: input.passengers,
        pricingModel: PricingModel.FIXED_PACKAGE,
        basePrice: input.agreedPrice,
        inclusions: input.inclusions,
        exclusions: input.exclusions,
        advanceBookingDays: 0,
        availableWeekdays: [],
        driverIncluded: input.driverIncluded,
        fuelIncluded: input.fuelIncluded,
        // Never PUBLISHED: this was built for one customer, not for sale.
        status: TravelPackageStatus.DRAFT,
        createdById: auth.user.id,
      },
    });

    const bookingCount = await tx.travelBooking.count();
    const booking = await tx.travelBooking.create({
      data: {
        reference: `TB-${new Date().getFullYear()}-${String(bookingCount + 1).padStart(5, '0')}`,
        packageId: pkg.id,
        providerOrganizationId: input.providerOrganizationId,
        customerOrganizationId: input.customerOrganizationId,
        customerId: customer?.id ?? null,
        bookedByUserId: auth.user.id,
        status: BookingStatus.PENDING_PAYMENT,
        startDate: input.startDate,
        endDate: input.endDate,
        passengers: input.passengers,
        pickupAddress: input.startLocation,
        pickupLatitude: input.startLatitude,
        pickupLongitude: input.startLongitude,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        specialRequests: input.specialRequests,
        pricingModel: PricingModel.FIXED_PACKAGE,
        subtotal: input.agreedPrice,
        platformFee,
        totalAmount: input.agreedPrice + platformFee,
        priceBreakdown:
          input.priceBreakdown ?? `Agreed price for requirement ${input.requirementReference}`,
      },
    });

    await tx.travelPackage.update({
      where: { id: pkg.id },
      data: { bookingCount: { increment: 1 } },
    });

    return { bookingId: booking.id, packageId: pkg.id, totalAmount: Number(booking.totalAmount) };
  });

  await recordEvent(
    created.bookingId,
    BookingEventType.CREATED,
    `Created from awarded requirement ${input.requirementReference}.`,
    auth.user.id,
  );

  const booking = await prisma.travelBooking.findUnique({
    where: { id: created.bookingId },
    include: bookingInclude,
  });
  if (booking) await publish(booking, true);

  return created;
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

/**
 * Pay for a booking.
 *
 * The payment row is written *before* the gateway is called, so a crash between
 * the two leaves an auditable PENDING record rather than money with no trace.
 */
export async function payBooking(
  auth: AuthContext,
  bookingId: string,
  input: PayBookingInput,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);

  if (booking.customerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the customer who made this booking can pay for it.');
  }
  if (booking.status !== BookingStatus.PENDING_PAYMENT) {
    throw errors.invalidTransition(
      booking.status === BookingStatus.AWAITING_CONFIRMATION
        ? 'This booking is already paid and waiting for the provider to confirm.'
        : `A booking in ${booking.status} cannot be paid.`,
    );
  }

  const amount = Number(booking.totalAmount);
  const payment = await prisma.payment.create({
    data: {
      reference: `PAY-${booking.reference}`,
      purpose: PaymentPurpose.TRAVEL_BOOKING,
      status: PaymentStatus.PROCESSING,
      method: input.method,
      organizationId: booking.customerOrganizationId,
      initiatedByUserId: auth.user.id,
      bookingId: booking.id,
      amount,
      currency: booking.currency,
      provider: paymentProvider.name,
    },
  });

  await recordEvent(
    booking.id,
    BookingEventType.PAYMENT_INITIATED,
    `Payment of ₹${amount.toLocaleString('en-IN')} initiated.`,
    auth.user.id,
    { paymentId: payment.id, method: input.method },
  );

  const intent = await paymentProvider.createIntent({
    reference: payment.reference,
    amount,
    currency: booking.currency,
    description: `${booking.package.title} — ${booking.reference}`,
    customerName: booking.contactName,
    customerEmail: booking.contactEmail,
    customerPhone: booking.contactPhone,
    metadata: {
      bookingId: booking.id,
      // Only the mock provider honours this; it is how the decline path stays
      // exercisable without a real gateway.
      simulateFailure: input.simulateFailure && config.demo.enabled ? 'true' : 'false',
    },
  });

  if (intent.status === 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        providerReference: intent.providerReference,
        failureCode: intent.failureCode,
        failureMessage: intent.failureMessage,
      },
    });
    await recordEvent(
      booking.id,
      BookingEventType.PAYMENT_FAILED,
      intent.failureMessage ?? 'The payment was declined.',
      auth.user.id,
    );

    void notify({
      userId: auth.user.id,
      organizationId: booking.customerOrganizationId,
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment failed',
      body: intent.failureMessage ?? 'Your payment could not be completed. Please try again.',
      priority: NotificationPriority.HIGH,
      actionUrl: `/travel/bookings/${booking.id}`,
    });

    // The booking stays PENDING_PAYMENT so the customer can retry.
    throw errors.businessRule(
      intent.failureMessage ?? 'The payment was declined. Please try another method.',
      { paymentId: payment.id, failureCode: intent.failureCode },
    );
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: intent.status === 'SUCCEEDED' ? PaymentStatus.SUCCEEDED : PaymentStatus.PROCESSING,
      providerReference: intent.providerReference,
      processedAt: intent.processedAt,
    },
  });

  // A gateway that redirects has not settled yet: the booking only advances
  // once the money is actually confirmed, whether now or by webhook later.
  if (intent.status !== 'SUCCEEDED') {
    bookingLogger.info(
      { bookingId: booking.id, providerReference: intent.providerReference },
      'Payment is pending settlement at the gateway',
    );
    return toSummary(booking);
  }

  const check = bookingStateMachine.assertTransition(
    booking.status as BookingStatus,
    BookingStatus.AWAITING_CONFIRMATION,
  );
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const updated = await prisma.travelBooking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.AWAITING_CONFIRMATION },
    include: bookingInclude,
  });

  await recordEvent(
    booking.id,
    BookingEventType.PAYMENT_SUCCEEDED,
    `Payment of ₹${amount.toLocaleString('en-IN')} received.`,
    auth.user.id,
    { providerReference: intent.providerReference },
  );

  void notifyOrganization(booking.providerOrganizationId, {
    type: NotificationType.BOOKING_CREATED,
    title: 'New travel booking to confirm',
    body: `${booking.contactName} booked ${booking.package.title} for ${booking.startDate.toDateString()}.`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/travel/provider/bookings/${booking.id}`,
  });

  void notify({
    userId: auth.user.id,
    organizationId: booking.customerOrganizationId,
    type: NotificationType.PAYMENT_SUCCEEDED,
    title: 'Payment received',
    body: `We have your payment for ${booking.package.title}. The provider will confirm shortly.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/travel/bookings/${booking.id}`,
  });

  await publish(updated, false);
  return toSummary(updated);
}

// ---------------------------------------------------------------------------
// Provider decisions
// ---------------------------------------------------------------------------

/**
 * Provider confirms, optionally assigning the vehicle and driver.
 *
 * Confirmation creates the trip, which is what plugs travel into the existing
 * tracking pipeline: from here the customer's live map, ETA and trip events all
 * come from the same code that moves a truck.
 */
export async function confirmBooking(
  auth: AuthContext,
  bookingId: string,
  input: ConfirmBookingInput,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);

  if (booking.providerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the provider can confirm this booking.');
  }

  const check = bookingStateMachine.assertTransition(
    booking.status as BookingStatus,
    BookingStatus.CONFIRMED,
  );
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  // Validate the vehicle before writing anything: a confirmation that assigns
  // an unavailable vehicle is worse than a refused confirmation.
  if (input.vehicleId) {
    const vehicle = await prisma.truck.findUnique({
      where: { id: input.vehicleId },
      select: {
        organizationId: true,
        status: true,
        archivedAt: true,
        passengerCapacity: true,
        registrationNumber: true,
      },
    });
    if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');
    if (vehicle.organizationId !== booking.providerOrganizationId) {
      throw errors.notFound('Vehicle');
    }
    if (!ASSIGNABLE_TRUCK_STATUSES.includes(vehicle.status as TruckStatus)) {
      throw errors.businessRule(
        `${vehicle.registrationNumber} is ${vehicle.status.toLowerCase()} and cannot be assigned.`,
      );
    }
    if (
      vehicle.passengerCapacity !== null &&
      booking.passengers > vehicle.passengerCapacity
    ) {
      throw errors.businessRule(
        `${vehicle.registrationNumber} seats ${vehicle.passengerCapacity} but this booking is for ${booking.passengers}.`,
      );
    }
  }

  if (input.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: input.driverId },
      select: { organizationId: true, verificationStatus: true, archivedAt: true },
    });
    if (!driver || driver.archivedAt) throw errors.notFound('Driver');
    if (driver.organizationId !== booking.providerOrganizationId) throw errors.notFound('Driver');
    if (driver.verificationStatus !== 'VERIFIED') {
      throw errors.businessRule('Only a verified driver can be assigned to a passenger trip.');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    let tripId = booking.tripId;

    // Create the trip only when there is a vehicle to attach it to — a trip
    // without a vehicle cannot be tracked, and a placeholder would show the
    // customer an empty map.
    if (!tripId && input.vehicleId) {
      const tripCount = await tx.trip.count();
      const trip = await tx.trip.create({
        data: {
          reference: `TR-${new Date().getFullYear()}-${String(tripCount + 1).padStart(5, '0')}`,
          organizationId: booking.providerOrganizationId,
          truckId: input.vehicleId,
          driverId: input.driverId ?? null,
          originAddress: booking.pickupAddress ?? booking.package.startLocation,
          originLatitude: booking.pickupLatitude ?? booking.package.startLatitude,
          originLongitude: booking.pickupLongitude ?? booking.package.startLongitude,
          // Where the customer said they are going, when they said it. A fixed
          // tour names no destination of its own, and a package describes a
          // round trip in the common case — so that falls back to the start
          // point rather than inventing a location the itinerary never gave.
          destinationAddress: booking.dropoffAddress ?? booking.package.endLocation,
          destinationLatitude: booking.dropoffLatitude ?? booking.package.startLatitude,
          destinationLongitude: booking.dropoffLongitude ?? booking.package.startLongitude,
          plannedDistanceKm: booking.distanceKm,
          plannedStartAt: booking.startDate,
          plannedArrivalAt: booking.endDate,
          status: TripStatus.ASSIGNED,
          price: booking.subtotal,
          notes: `Travel booking ${booking.reference}: ${booking.package.title}`,
          createdById: auth.user.id,
          events: {
            create: [
              {
                type: 'CREATED',
                description: `Created from travel booking ${booking.reference}.`,
              },
            ],
          },
        },
      });
      tripId = trip.id;
    }

    return tx.travelBooking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CONFIRMED,
        confirmedAt: new Date(),
        confirmedById: auth.user.id,
        vehicleId: input.vehicleId ?? booking.vehicleId,
        driverId: input.driverId ?? booking.driverId,
        tripId,
      },
      include: bookingInclude,
    });
  });

  if (input.vehicleId) {
    await recordEvent(
      booking.id,
      BookingEventType.VEHICLE_ASSIGNED,
      `Vehicle assigned for ${booking.startDate.toDateString()}.`,
      auth.user.id,
    );
  }
  if (input.driverId) {
    await recordEvent(
      booking.id,
      BookingEventType.DRIVER_ASSIGNED,
      'Driver assigned.',
      auth.user.id,
    );
  }
  if (updated.tripId && !booking.tripId) {
    await recordEvent(
      booking.id,
      BookingEventType.TRIP_CREATED,
      'Trip created — live tracking is now available.',
      auth.user.id,
    );
  }
  await recordEvent(
    booking.id,
    BookingEventType.CONFIRMED,
    input.note ?? 'Provider confirmed the booking.',
    auth.user.id,
  );

  void notify({
    userId: booking.bookedByUserId,
    organizationId: booking.customerOrganizationId,
    type: NotificationType.BOOKING_CONFIRMED,
    title: 'Your trip is confirmed',
    body: `${booking.package.title} on ${booking.startDate.toDateString()} is confirmed.`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/travel/bookings/${booking.id}`,
  });

  if (updated.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: updated.driverId },
      select: { userId: true },
    });
    if (driver) {
      void notify({
        userId: driver.userId,
        organizationId: booking.providerOrganizationId,
        type: NotificationType.TRIP_ASSIGNED,
        title: 'New passenger trip assigned',
        body: `${booking.package.title} on ${booking.startDate.toDateString()}, ${booking.passengers} passenger(s).`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/driver/bookings/${booking.id}`,
      });
    }
  }

  await publish(updated, false);
  return toSummary(updated);
}

/** Provider declines. The customer is refunded in full — they did nothing wrong. */
export async function declineBooking(
  auth: AuthContext,
  bookingId: string,
  input: DeclineBookingInput,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);
  if (booking.providerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the provider can decline this booking.');
  }

  const check = bookingStateMachine.assertTransition(
    booking.status as BookingStatus,
    BookingStatus.DECLINED,
  );
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const updated = await prisma.travelBooking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.DECLINED,
      declinedAt: new Date(),
      declineReason: input.reason,
    },
    include: bookingInclude,
  });

  await recordEvent(booking.id, BookingEventType.DECLINED, input.reason, auth.user.id);
  await issueRefund(booking, CancelledBy.PROVIDER, input.reason, auth.user.id);

  void notify({
    userId: booking.bookedByUserId,
    organizationId: booking.customerOrganizationId,
    type: NotificationType.BOOKING_CANCELLED,
    title: 'Booking declined — full refund issued',
    body: `${booking.package.title}: ${input.reason}`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/travel/bookings/${booking.id}`,
  });

  await publish(updated, false);
  return toSummary(updated);
}

// ---------------------------------------------------------------------------
// Running and finishing the trip
// ---------------------------------------------------------------------------

export async function startBooking(
  auth: AuthContext,
  bookingId: string,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);

  const isProvider = booking.providerOrganizationId === auth.organizationId;
  const isDriver = auth.driverId !== null && booking.driverId === auth.driverId;
  if (!isProvider && !isDriver && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the provider or the assigned driver can start this trip.');
  }

  const check = bookingStateMachine.assertTransition(
    booking.status as BookingStatus,
    BookingStatus.IN_PROGRESS,
  );
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const updated = await prisma.travelBooking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.IN_PROGRESS, startedAt: new Date() },
    include: bookingInclude,
  });

  if (booking.tripId) {
    await prisma.trip.update({
      where: { id: booking.tripId },
      data: { status: TripStatus.STARTED, actualStartAt: new Date() },
    });
  }

  await recordEvent(booking.id, BookingEventType.STARTED, 'Trip started.', auth.user.id);

  void notify({
    userId: booking.bookedByUserId,
    organizationId: booking.customerOrganizationId,
    type: NotificationType.TRIP_STARTED,
    title: 'Your trip has started',
    body: 'You can follow the vehicle live from your booking.',
    priority: NotificationPriority.NORMAL,
    actionUrl: `/travel/bookings/${booking.id}`,
  });

  await publish(updated, false);
  return toSummary(updated);
}

export async function completeBooking(
  auth: AuthContext,
  bookingId: string,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);

  const isProvider = booking.providerOrganizationId === auth.organizationId;
  const isDriver = auth.driverId !== null && booking.driverId === auth.driverId;
  if (!isProvider && !isDriver && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the provider or the assigned driver can complete this trip.');
  }

  const check = bookingStateMachine.assertTransition(
    booking.status as BookingStatus,
    BookingStatus.COMPLETED,
  );
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const updated = await prisma.travelBooking.update({
    where: { id: booking.id },
    data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
    include: bookingInclude,
  });

  if (booking.tripId) {
    await prisma.trip.update({
      where: { id: booking.tripId },
      data: { status: TripStatus.COMPLETED, actualArrivalAt: new Date() },
    });
  }

  await prisma.serviceProviderProfile.updateMany({
    where: { organizationId: booking.providerOrganizationId },
    data: { bookingsCompleted: { increment: 1 }, bookingsTotal: { increment: 1 } },
  });

  await recordEvent(booking.id, BookingEventType.COMPLETED, 'Trip completed.', auth.user.id);

  // A booking raised from a requirement closes that requirement out, so the
  // customer's requirement list reflects the journey that actually happened.
  void markRequirementFulfilled(
    { bookingId: booking.id },
    `Booking ${booking.reference} completed.`,
  );

  void notify({
    userId: booking.bookedByUserId,
    organizationId: booking.customerOrganizationId,
    type: NotificationType.BOOKING_COMPLETED,
    title: 'Trip complete — how did it go?',
    body: `Rate ${booking.package.title} to help other travellers.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/travel/bookings/${booking.id}`,
  });

  await publish(updated, false);
  return toSummary(updated);
}

// ---------------------------------------------------------------------------
// Cancellation & refunds
// ---------------------------------------------------------------------------

/**
 * Issue a refund through the payment provider.
 *
 * Never throws into the caller's transaction: a refund that fails at the
 * gateway must leave the cancellation intact and an auditable record behind,
 * not roll back the customer's cancellation.
 */
async function issueRefund(
  booking: BookingRecord,
  cancelledBy: CancelledBy,
  reason: string,
  actorUserId: string,
): Promise<number> {
  const payment = await prisma.payment.findFirst({
    where: { bookingId: booking.id, status: PaymentStatus.SUCCEEDED },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment || !payment.providerReference) return 0;

  const policy = Array.isArray(booking.package.cancellationPolicy)
    ? (booking.package.cancellationPolicy as unknown as {
        hoursBefore: number;
        refundPercent: number;
      }[])
    : DEFAULT_CANCELLATION_POLICY;

  const outcome = calculateRefund(
    Number(booking.subtotal),
    Number(booking.platformFee),
    booking.startDate,
    new Date(),
    cancelledBy,
    policy,
  );

  if (outcome.refundAmount <= 0) {
    await recordEvent(
      booking.id,
      BookingEventType.NOTE,
      outcome.explanation,
      actorUserId,
    );
    return 0;
  }

  try {
    const refund = await paymentProvider.refund({
      providerReference: payment.providerReference,
      amount: outcome.refundAmount,
      reason,
    });

    if (refund.status === 'FAILED') {
      bookingLogger.error(
        { bookingId: booking.id, paymentId: payment.id },
        'Refund was declined by the payment provider',
      );
      await recordEvent(
        booking.id,
        BookingEventType.NOTE,
        `Refund of ₹${outcome.refundAmount} could not be processed automatically and needs manual action.`,
        actorUserId,
      );
      return 0;
    }

    const fullyRefunded = outcome.refundAmount >= Number(payment.amount);
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        refundedAmount: outcome.refundAmount,
        refundedAt: refund.processedAt ?? new Date(),
      },
    });

    await prisma.travelBooking.update({
      where: { id: booking.id },
      data: { refundAmount: outcome.refundAmount, refundedAt: new Date() },
    });

    await recordEvent(
      booking.id,
      BookingEventType.REFUNDED,
      outcome.explanation,
      actorUserId,
      { refundAmount: outcome.refundAmount, refundPercent: outcome.refundPercent },
    );

    void notify({
      userId: booking.bookedByUserId,
      organizationId: booking.customerOrganizationId,
      type: NotificationType.PAYMENT_REFUNDED,
      title: `Refund of ₹${outcome.refundAmount.toLocaleString('en-IN')} issued`,
      body: outcome.explanation,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/travel/bookings/${booking.id}`,
    });

    return outcome.refundAmount;
  } catch (error) {
    bookingLogger.error({ err: error, bookingId: booking.id }, 'Refund failed');
    await recordEvent(
      booking.id,
      BookingEventType.NOTE,
      'Automatic refund failed — Saarthi support will process it manually.',
      actorUserId,
    );
    return 0;
  }
}

export async function cancelBooking(
  auth: AuthContext,
  bookingId: string,
  input: CancelBookingInput,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);

  const isCustomer = booking.customerOrganizationId === auth.organizationId;
  const isProvider = booking.providerOrganizationId === auth.organizationId;
  if (!isCustomer && !isProvider && !auth.isPlatformAdmin) {
    throw errors.forbidden('You cannot cancel this booking.');
  }

  if (!CANCELLABLE_BOOKING_STATUSES.includes(booking.status as BookingStatus)) {
    throw errors.businessRule(
      `A booking in ${booking.status.toLowerCase().replace(/_/g, ' ')} can no longer be cancelled.`,
    );
  }

  // Who cancelled decides the refund, so it is derived from the caller rather
  // than trusted from the request body.
  const cancelledBy = auth.isPlatformAdmin
    ? (input.cancelledBy ?? CancelledBy.PLATFORM)
    : isCustomer
      ? CancelledBy.CUSTOMER
      : CancelledBy.PROVIDER;

  const updated = await prisma.travelBooking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy,
      cancellationReason: input.reason,
    },
    include: bookingInclude,
  });

  await recordEvent(
    booking.id,
    BookingEventType.CANCELLED,
    `${cancelledBy.toLowerCase()} cancelled: ${input.reason}`,
    auth.user.id,
  );

  void markRequirementCancelled(
    { bookingId: booking.id },
    `Booking ${booking.reference} was cancelled: ${input.reason}`,
  );

  // Free the vehicle and close the trip so the provider's fleet is accurate.
  if (booking.tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: booking.tripId } });
    if (trip && trip.status !== TripStatus.COMPLETED) {
      await prisma.trip.update({
        where: { id: booking.tripId },
        data: { status: TripStatus.CANCELLED, cancellationReason: input.reason },
      });
    }
  }

  await issueRefund(booking, cancelledBy, input.reason, auth.user.id);

  const notifyOrg =
    cancelledBy === CancelledBy.CUSTOMER
      ? booking.providerOrganizationId
      : booking.customerOrganizationId;

  void notifyOrganization(notifyOrg, {
    type: NotificationType.BOOKING_CANCELLED,
    title: 'Travel booking cancelled',
    body: `${booking.reference} — ${booking.package.title}: ${input.reason}`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/travel/bookings/${booking.id}`,
  });

  await publish(updated, false);
  return toSummary(updated);
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export async function rateBooking(
  auth: AuthContext,
  bookingId: string,
  input: RateBookingInput,
): Promise<BookingSummary> {
  const booking = await loadBooking(auth, bookingId);

  if (booking.customerOrganizationId !== auth.organizationId) {
    throw errors.forbidden('Only the customer who travelled can rate this booking.');
  }
  if (booking.status !== BookingStatus.COMPLETED) {
    throw errors.businessRule('Rate the trip once it is complete.');
  }
  if (booking.review) {
    throw errors.conflict('You have already rated this trip.');
  }

  await prisma.travelReview.create({
    data: {
      bookingId: booking.id,
      providerOrganizationId: booking.providerOrganizationId,
      packageId: booking.packageId,
      rating: input.rating,
      vehicleRating: input.vehicleRating ?? null,
      driverRating: input.driverRating ?? null,
      comment: input.comment ?? null,
      ratedByUserId: auth.user.id,
    },
  });

  await Promise.all([
    recalculatePackageRating(booking.packageId),
    recalculateProviderRating(booking.providerOrganizationId),
  ]);

  await recordEvent(
    booking.id,
    BookingEventType.RATED,
    `Rated ${input.rating}/5.`,
    auth.user.id,
  );

  // A driver rating is a real signal about the trip, so it feeds the same
  // explainable score the freight side uses rather than a separate reputation.
  if (booking.driverId && input.driverRating) {
    const positive = input.driverRating >= 4;
    await prisma.driverScoreEvent.create({
      data: {
        driverId: booking.driverId,
        eventType: positive ? 'CUSTOMER_POSITIVE_RATING' : 'CUSTOMER_NEGATIVE_RATING',
        category: 'RELIABILITY',
        points: positive ? 3 : -3,
        reason: `Passenger rated this trip ${input.driverRating}/5.`,
        sourceType: 'TRAVEL_BOOKING',
        sourceId: booking.id,
      },
    });
    const { recalculateDriverScore } = await import('../drivers/driver.service');
    await recalculateDriverScore(booking.driverId);
  }

  const updated = await prisma.travelBooking.findUniqueOrThrow({
    where: { id: booking.id },
    include: bookingInclude,
  });
  return toSummary(updated);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listBookings(
  auth: AuthContext,
  query: BookingListQuery,
  side: 'customer' | 'provider' | 'driver',
): Promise<Paginated<BookingSummary>> {
  const organizationId = auth.organizationId;

  const scope: Prisma.TravelBookingWhereInput =
    auth.isPlatformAdmin && !organizationId
      ? {}
      : side === 'customer'
        ? { customerOrganizationId: organizationId ?? '__none__' }
        : side === 'provider'
          ? { providerOrganizationId: organizationId ?? '__none__' }
          : { driverId: auth.driverId ?? '__none__' };

  const where: Prisma.TravelBookingWhereInput = {
    AND: [
      scope,
      {
        ...(query.status ? { status: { in: query.status as BookingStatus[] } } : {}),
        ...(query.activeOnly ? { status: { in: ACTIVE_BOOKING_STATUSES } } : {}),
        ...(query.packageId ? { packageId: query.packageId } : {}),
        ...(query.search
          ? {
              OR: [
                { reference: { contains: query.search, mode: 'insensitive' } },
                { contactName: { contains: query.search, mode: 'insensitive' } },
                { package: { title: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
        ...(query.from || query.to
          ? {
              startDate: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
    ],
  };

  const [total, bookings] = await Promise.all([
    prisma.travelBooking.count({ where }),
    prisma.travelBooking.findMany({
      where,
      include: bookingInclude,
      orderBy: { startDate: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: await Promise.all(bookings.map(toSummary)),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export interface BookingDetail extends BookingSummary {
  events: {
    id: string;
    eventType: BookingEventType;
    description: string | null;
    createdAt: string;
  }[];
}

export async function getBooking(auth: AuthContext, bookingId: string): Promise<BookingDetail> {
  const booking = await loadBooking(auth, bookingId);
  const [summary, events] = await Promise.all([
    toSummary(booking),
    prisma.travelBookingEvent.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    ...summary,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType as BookingEventType,
      description: event.description,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/**
 * Simplified live position for a travel customer.
 *
 * Returns location, heading, speed and progress only. Raw telemetry — engine
 * data, fuel, diagnostics — is never exposed to a passenger: they need to know
 * where the car is and when it will arrive, not the coolant temperature of a
 * vehicle they do not own.
 */
export async function bookingTracking(
  auth: AuthContext,
  bookingId: string,
): Promise<{
  available: boolean;
  reason: string | null;
  vehicleRegistration: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string | null;
  tripStatus: string | null;
  progressPercent: number | null;
  etaAt: string | null;
  driverName: string | null;
}> {
  const booking = await loadBooking(auth, bookingId);

  const unavailable = (reason: string) => ({
    available: false,
    reason,
    vehicleRegistration: null,
    latitude: null,
    longitude: null,
    speedKph: null,
    heading: null,
    recordedAt: null,
    tripStatus: null,
    progressPercent: null,
    etaAt: null,
    driverName: null,
  });

  if (!booking.vehicleId) return unavailable('No vehicle has been assigned yet.');
  if (
    booking.status !== BookingStatus.CONFIRMED &&
    booking.status !== BookingStatus.IN_PROGRESS
  ) {
    return unavailable('Tracking is available once the trip is confirmed and under way.');
  }

  const vehicle = await prisma.truck.findUnique({
    where: { id: booking.vehicleId },
    select: {
      registrationNumber: true,
      lastLatitude: true,
      lastLongitude: true,
      lastSpeedKph: true,
      lastHeading: true,
      lastLocationAt: true,
      shareLocation: true,
    },
  });
  if (!vehicle) return unavailable('The assigned vehicle is no longer available.');
  if (!vehicle.shareLocation) {
    return unavailable('The operator has turned off location sharing for this vehicle.');
  }
  if (vehicle.lastLatitude === null || vehicle.lastLongitude === null) {
    return unavailable('The vehicle has not reported a position yet.');
  }

  const trip = booking.tripId
    ? await prisma.trip.findUnique({
        where: { id: booking.tripId },
        select: {
          status: true,
          etaAt: true,
          actualDistanceKm: true,
          plannedDistanceKm: true,
        },
      })
    : null;

  const driver = booking.driverId
    ? await prisma.driver.findUnique({
        where: { id: booking.driverId },
        include: { user: { select: { firstName: true, lastName: true } } },
      })
    : null;

  const progressPercent =
    trip?.plannedDistanceKm && trip.plannedDistanceKm > 0
      ? Math.min(100, Math.round((trip.actualDistanceKm / trip.plannedDistanceKm) * 100))
      : null;

  return {
    available: true,
    reason: null,
    vehicleRegistration: vehicle.registrationNumber,
    latitude: vehicle.lastLatitude,
    longitude: vehicle.lastLongitude,
    speedKph: vehicle.lastSpeedKph,
    heading: vehicle.lastHeading,
    recordedAt: vehicle.lastLocationAt?.toISOString() ?? null,
    tripStatus: trip?.status ?? null,
    progressPercent,
    etaAt: trip?.etaAt?.toISOString() ?? null,
    driverName: driver ? `${driver.user.firstName} ${driver.user.lastName}`.trim() : null,
  };
}

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

/**
 * Demo data for the mobility expansion: truck associations, travel providers,
 * tour packages, customer bookings and connected hardware.
 *
 * Written as its own module, and deliberately self-sufficient: it looks up the
 * organizations and users it needs rather than being handed them, so it can be
 * called from anywhere in the seed without threading a context object through.
 *
 * Everything it creates supports one of the three demo scenarios in sections
 * 44–46 of the spec:
 *
 *  * a truck emergency that reaches a district association,
 *  * a travel booking from search through payment to a rated trip,
 *  * a mock Freematics device streaming telemetry that raises an alert.
 */

const DEMO_PASSWORD = 'Saarthi@2026';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function daysAhead(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

export interface MobilitySeedCounts {
  associations: number;
  associationAlerts: number;
  providers: number;
  packages: number;
  bookings: number;
  devices: number;
  telemetryReadings: number;
  telemetryAlerts: number;
}

export async function seedMobilityDemo(prisma: PrismaClient): Promise<MobilitySeedCounts> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const [platformOrg, fleetA, customerOrg] = await Promise.all([
    prisma.organization.findFirst({ where: { type: 'PLATFORM' } }),
    prisma.organization.findFirst({ where: { name: 'Sharma Transport Company' } }),
    prisma.organization.findFirst({ where: { type: 'CUSTOMER' } }),
  ]);

  if (!fleetA || !customerOrg) {
    // The core demo dataset has not been created, so there is nothing to hang
    // associations, bookings or devices off. Skip rather than invent orgs.
    return {
      associations: 0,
      associationAlerts: 0,
      providers: 0,
      packages: 0,
      bookings: 0,
      devices: 0,
      telemetryReadings: 0,
      telemetryAlerts: 0,
    };
  }

  // =========================================================================
  // 1. Truck association — the district emergency network
  // =========================================================================

  const associationOrg = await prisma.organization.create({
    data: {
      name: 'Lucknow District Truck Owners Association',
      type: 'TRUCK_ASSOCIATION',
      registrationNumber: 'SOC/UP/2009/00412',
      email: 'office@lucknowtruckers.local',
      phone: '+919220000001',
      addressLine: 'Transport Nagar, Kanpur Road',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      postalCode: '226012',
      latitude: 26.8006,
      longitude: 80.8998,
      inviteCode: 'ASN-LKOTOA-4471',
      // Verified, because an unverified association receives nothing — the demo
      // needs the routing path to actually fire.
      verificationStatus: 'VERIFIED',
      description:
        'Represents 1,240 member trucks across Lucknow, Unnao and Barabanki. Runs a 24-hour roadside assistance desk.',
    },
  });

  const associationRole = await prisma.role.findUnique({
    where: { name: 'ASSOCIATION_ADMIN' },
  });

  const associationUser = await prisma.user.create({
    data: {
      email: 'association@saarthi.local',
      phone: '+919220000002',
      passwordHash,
      firstName: 'Sunil',
      lastName: 'Yadav',
      status: 'ACTIVE',
      ...(associationRole ? { roles: { create: { roleId: associationRole.id } } } : {}),
    },
  });

  await prisma.membership.create({
    data: {
      userId: associationUser.id,
      organizationId: associationOrg.id,
      role: 'ASSOCIATION_ADMIN',
      status: 'ACTIVE',
      isPrimary: true,
    },
  });

  // A second member, so assigning a *member* responder is demonstrable rather
  // than only the external-responder path.
  const responderUser = await prisma.user.create({
    data: {
      email: 'responder@saarthi.local',
      phone: '+919220000003',
      passwordHash,
      firstName: 'Imran',
      lastName: 'Qureshi',
      status: 'ACTIVE',
    },
  });
  await prisma.membership.create({
    data: {
      userId: responderUser.id,
      organizationId: associationOrg.id,
      role: 'ASSOCIATION_RESPONDER',
      status: 'ACTIVE',
    },
  });

  const association = await prisma.associationProfile.create({
    data: {
      organizationId: associationOrg.id,
      district: 'Lucknow',
      state: 'Uttar Pradesh',
      officialEmail: 'office@lucknowtruckers.local',
      officialPhone: '+919220000001',
      emergencyPhone: '+919220000009',
      representativeName: 'Sunil Yadav',
      representativeDesignation: 'General Secretary',
      representativePhone: '+919220000002',
      representativeEmail: 'association@saarthi.local',
      memberTruckCount: 1240,
      about:
        'Founded 2009. Operates a 24-hour assistance desk with tie-ups for cranes, tyre repair and hospital transfers across the district.',
      acceptingAlerts: true,
      verifiedAt: daysAgo(120),
      coverageAreas: {
        create: [
          {
            district: 'Lucknow',
            state: 'Uttar Pradesh',
            label: 'Lucknow city and ring road',
            latitude: 26.8467,
            longitude: 80.9462,
            radiusKm: 45,
          },
          {
            district: 'Unnao',
            state: 'Uttar Pradesh',
            label: 'Lucknow–Kanpur highway corridor',
            latitude: 26.5464,
            longitude: 80.4879,
            radiusKm: 60,
          },
          {
            district: 'Barabanki',
            state: 'Uttar Pradesh',
            label: 'Lucknow–Ayodhya corridor',
            latitude: 26.9257,
            longitude: 81.1868,
            radiusKm: 50,
          },
        ],
      },
    },
  });

  // A second association, so geographic scoping is demonstrable: an incident in
  // Lucknow must never reach Kanpur's queue.
  const kanpurOrg = await prisma.organization.create({
    data: {
      name: 'Kanpur Goods Transport Association',
      type: 'TRUCK_ASSOCIATION',
      email: 'office@kanpurgta.local',
      phone: '+919120000001',
      addressLine: 'Fazalganj Industrial Area',
      city: 'Kanpur',
      state: 'Uttar Pradesh',
      latitude: 26.4499,
      longitude: 80.3319,
      inviteCode: 'ASN-KGTA-8823',
      verificationStatus: 'VERIFIED',
      description: 'Kanpur city and Panki industrial belt.',
    },
  });
  await prisma.associationProfile.create({
    data: {
      organizationId: kanpurOrg.id,
      district: 'Kanpur Nagar',
      state: 'Uttar Pradesh',
      officialEmail: 'office@kanpurgta.local',
      officialPhone: '+919120000001',
      emergencyPhone: '+919120000009',
      representativeName: 'Deepak Nigam',
      representativeDesignation: 'President',
      representativePhone: '+919120000002',
      memberTruckCount: 860,
      verifiedAt: daysAgo(90),
      coverageAreas: {
        create: [
          {
            district: 'Kanpur Nagar',
            state: 'Uttar Pradesh',
            label: 'Kanpur city',
            latitude: 26.4499,
            longitude: 80.3319,
            radiusKm: 40,
          },
        ],
      },
    },
  });

  // A third, still pending, so the platform verification queue has an
  // association in it.
  const pendingOrg = await prisma.organization.create({
    data: {
      name: 'Agra Truck Operators Union',
      type: 'TRUCK_ASSOCIATION',
      email: 'office@agratou.local',
      phone: '+919620000001',
      addressLine: 'Transport Nagar, Sikandra',
      city: 'Agra',
      state: 'Uttar Pradesh',
      latitude: 27.1767,
      longitude: 78.0081,
      inviteCode: 'ASN-ATOU-1190',
      verificationStatus: 'SUBMITTED',
    },
  });
  await prisma.associationProfile.create({
    data: {
      organizationId: pendingOrg.id,
      district: 'Agra',
      state: 'Uttar Pradesh',
      officialEmail: 'office@agratou.local',
      officialPhone: '+919620000001',
      emergencyPhone: '+919620000009',
      representativeName: 'Mahesh Gupta',
      representativePhone: '+919620000002',
      memberTruckCount: 410,
      coverageAreas: {
        create: [
          {
            district: 'Agra',
            state: 'Uttar Pradesh',
            latitude: 27.1767,
            longitude: 78.0081,
            radiusKm: 45,
          },
        ],
      },
    },
  });

  // --- A resolved alert, so the queue has history --------------------------
  const existingIncident = await prisma.sosIncident.findFirst({
    orderBy: { triggeredAt: 'desc' },
  });

  let associationAlerts = 0;
  if (existingIncident) {
    const truck = existingIncident.truckId
      ? await prisma.truck.findUnique({
          where: { id: existingIncident.truckId },
          select: { registrationNumber: true, vehicleType: true },
        })
      : null;

    const alert = await prisma.associationAlert.create({
      data: {
        associationId: association.id,
        incidentId: existingIncident.id,
        reference: 'ASN-2026-00001',
        severity: 'WARNING',
        status: 'RESOLVED',
        incidentType: existingIncident.type,
        vehicleRegistration: truck?.registrationNumber ?? null,
        vehicleType: truck?.vehicleType ?? null,
        fleetName: fleetA.name,
        latitude: existingIncident.latitude,
        longitude: existingIncident.longitude,
        address: existingIncident.address,
        district: 'Lucknow',
        state: 'Uttar Pradesh',
        description: existingIncident.description,
        driverName: 'Demo driver',
        driverPhone: '+919810000010',
        contactPhone: existingIncident.contactPhone,
        distanceKm: 12.4,
        notifiedAt: daysAgo(6),
        acknowledgedAt: daysAgo(5.99),
        acknowledgedById: associationUser.id,
        respondingAt: daysAgo(5.98),
        resolvedAt: daysAgo(5.9),
        resolvedById: associationUser.id,
        outcome:
          'Tyre replaced on site by Shakti Tyre Works. Driver continued to Kanpur the same evening.',
        assistanceProvided: true,
        events: {
          create: [
            {
              eventType: 'CREATED',
              description: 'Breakdown reported 12.4 km from Lucknow.',
              createdAt: daysAgo(6),
            },
            {
              eventType: 'ACKNOWLEDGED',
              description: 'Association desk acknowledged within a minute.',
              actorUserId: associationUser.id,
              createdAt: daysAgo(5.99),
            },
            {
              eventType: 'RESPONDER_ASSIGNED',
              description: 'Assigned Shakti Tyre Works (external), ETA 35 min.',
              actorUserId: associationUser.id,
              createdAt: daysAgo(5.98),
            },
            {
              eventType: 'RESOLVED',
              description: 'Tyre replaced on site.',
              actorUserId: associationUser.id,
              createdAt: daysAgo(5.9),
            },
          ],
        },
        responders: {
          create: [
            {
              kind: 'EXTERNAL',
              status: 'COMPLETED',
              name: 'Shakti Tyre Works',
              phone: '+919220000045',
              organisation: 'Shakti Tyre Works, Kanpur Road',
              etaMinutes: 35,
              note: 'Carries 10.00R20 stock.',
              assignedById: associationUser.id,
              assignedAt: daysAgo(5.98),
              onSceneAt: daysAgo(5.95),
              completedAt: daysAgo(5.9),
            },
          ],
        },
      },
    });
    associationAlerts = 1;

    await prisma.associationProfile.update({
      where: { id: association.id },
      data: {
        alertsReceived: 1,
        alertsAcknowledged: 1,
        alertsResolved: 1,
        avgResponseMinutes: 1.4,
      },
    });
    void alert;
  }

  // =========================================================================
  // 2. Travel provider, packages and a booking
  // =========================================================================

  const travelOrg = await prisma.organization.create({
    data: {
      name: 'Awadh Voyages',
      type: 'MOBILITY_PROVIDER',
      registrationNumber: 'U63040UP2019PTC120987',
      email: 'hello@awadhvoyages.local',
      phone: '+919220000101',
      addressLine: '14 Vidhan Sabha Marg, Hazratganj',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      postalCode: '226001',
      latitude: 26.8467,
      longitude: 80.9462,
      inviteCode: 'SR-AWADH',
      verificationStatus: 'VERIFIED',
      description: 'Taxi, intercity transfer and pilgrimage tour operator based in Lucknow.',
    },
  });

  // Travel sits in the Basic tier on purpose — a small operator monetises
  // through the booking fee, not a fleet subscription.
  const basicPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: 'BASIC' } });
  if (basicPlan) {
    await prisma.subscription.create({
      data: {
        organizationId: travelOrg.id,
        planId: basicPlan.id,
        status: 'ACTIVE',
        startsAt: daysAgo(200),
      },
    });
  }

  const travelOwnerRole = await prisma.role.findUnique({ where: { name: 'FLEET_OWNER' } });
  const travelOwner = await prisma.user.create({
    data: {
      email: 'travel@saarthi.local',
      phone: '+919220000101',
      passwordHash,
      firstName: 'Neha',
      lastName: 'Srivastava',
      status: 'ACTIVE',
      ...(travelOwnerRole ? { roles: { create: { roleId: travelOwnerRole.id } } } : {}),
    },
  });
  await prisma.membership.create({
    data: {
      userId: travelOwner.id,
      organizationId: travelOrg.id,
      role: 'FLEET_OWNER',
      status: 'ACTIVE',
      isPrimary: true,
    },
  });

  const provider = await prisma.serviceProviderProfile.create({
    data: {
      organizationId: travelOrg.id,
      displayName: 'Awadh Voyages',
      serviceTypes: ['TAXI', 'TRAVEL', 'TOUR'],
      about:
        'Family-run since 2019. Airport transfers, intercity taxis and multi-day pilgrimage tours with experienced drivers.',
      contactPhone: '+919220000101',
      contactEmail: 'hello@awadhvoyages.local',
      whatsappPhone: '+919220000102',
      businessRegistrationNumber: 'U63040UP2019PTC120987',
      yearsInBusiness: 7,
      languages: ['Hindi', 'English', 'Awadhi'],
      status: 'ACTIVE',
      ratingAverage: 4.6,
      ratingCount: 38,
      bookingsTotal: 44,
      bookingsCompleted: 41,
      serviceAreas: {
        create: [
          {
            city: 'Lucknow',
            state: 'Uttar Pradesh',
            latitude: 26.8467,
            longitude: 80.9462,
            radiusKm: 250,
          },
          {
            city: 'Ayodhya',
            state: 'Uttar Pradesh',
            latitude: 26.7922,
            longitude: 82.1998,
            radiusKm: 120,
          },
        ],
      },
    },
  });

  // --- Passenger vehicles, on the same table as the trucks ----------------
  const suv = await prisma.truck.create({
    data: {
      organizationId: travelOrg.id,
      registrationNumber: 'UP32EA4412',
      vehicleType: 'SUV',
      truckType: 'OTHER',
      manufacturer: 'Toyota',
      model: 'Innova Crysta',
      year: 2023,
      colour: 'Pearl White',
      capacityTons: 0,
      passengerCapacity: 6,
      airConditioned: true,
      fuelType: 'DIESEL',
      fuelEfficiency: 8.5,
      odometerKm: 84_500,
      status: 'AVAILABLE',
      verificationStatus: 'VERIFIED',
      shareLocation: true,
      notes: 'Primary tour vehicle. Fitted with a connected telematics device.',
    },
  });

  const tempo = await prisma.truck.create({
    data: {
      organizationId: travelOrg.id,
      registrationNumber: 'UP32EA7788',
      vehicleType: 'TEMPO',
      truckType: 'MINI_TRUCK',
      manufacturer: 'Force',
      model: 'Urbania 17-seat',
      year: 2024,
      colour: 'White',
      capacityTons: 0,
      passengerCapacity: 16,
      airConditioned: true,
      fuelType: 'DIESEL',
      odometerKm: 21_300,
      status: 'AVAILABLE',
      verificationStatus: 'VERIFIED',
    },
  });

  const taxi = await prisma.truck.create({
    data: {
      organizationId: travelOrg.id,
      registrationNumber: 'UP32EA1001',
      vehicleType: 'TAXI',
      truckType: 'OTHER',
      manufacturer: 'Maruti Suzuki',
      model: 'Dzire',
      year: 2022,
      colour: 'Silver',
      capacityTons: 0,
      passengerCapacity: 4,
      airConditioned: true,
      fuelType: 'CNG',
      odometerKm: 132_800,
      status: 'AVAILABLE',
      verificationStatus: 'VERIFIED',
    },
  });

  // --- A driver for the travel side ---------------------------------------
  const driverRole = await prisma.role.findUnique({ where: { name: 'DRIVER' } });
  const travelDriverUser = await prisma.user.create({
    data: {
      email: 'taxidriver@saarthi.local',
      phone: '+919220000110',
      passwordHash,
      firstName: 'Ramesh',
      lastName: 'Verma',
      status: 'ACTIVE',
      ...(driverRole ? { roles: { create: { roleId: driverRole.id } } } : {}),
    },
  });
  await prisma.membership.create({
    data: {
      userId: travelDriverUser.id,
      organizationId: travelOrg.id,
      role: 'DRIVER',
      status: 'ACTIVE',
      isPrimary: true,
    },
  });

  const travelDriver = await prisma.driver.create({
    data: {
      userId: travelDriverUser.id,
      organizationId: travelOrg.id,
      licenseNumber: 'UP3220190004412',
      licenseClass: 'LMV-TR',
      licenseExpiryDate: daysAhead(900),
      dateOfBirth: new Date('1988-04-17'),
      experienceYears: 11,
      bloodGroup: 'B+',
      addressLine: 'Alambagh',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      emergencyContactName: 'Sita Verma',
      emergencyContactPhone: '+919220000111',
      verificationStatus: 'VERIFIED',
      availability: 'AVAILABLE',
      overallScore: 88,
      totalTrips: 312,
      currentTruckId: suv.id,
    },
  });

  await prisma.truck.update({
    where: { id: suv.id },
    data: { currentDriverId: travelDriver.id, status: 'ASSIGNED' },
  });
  await prisma.truckAssignment.create({
    data: {
      truckId: suv.id,
      driverId: travelDriver.id,
      organizationId: travelOrg.id,
      status: 'ACTIVE',
      note: 'Regular tour driver.',
    },
  });

  // --- Packages ------------------------------------------------------------
  const ayodhyaPackage = await prisma.travelPackage.create({
    data: {
      providerId: provider.id,
      organizationId: travelOrg.id,
      title: 'Lucknow → Ayodhya → Varanasi Pilgrimage',
      summary: 'Three days across the Sarayu and the Ganga, with a private SUV and driver.',
      description:
        'A three-day circuit taking in Ram Janmabhoomi and Hanuman Garhi at Ayodhya, then the Ganga Aarti and Kashi Vishwanath at Varanasi. Air-conditioned SUV, experienced driver, all fuel and tolls included.',
      serviceKind: 'PILGRIMAGE',
      imageUrls: [],
      destinations: ['Ayodhya', 'Varanasi', 'Sarnath'],
      startLocation: 'Lucknow',
      startLatitude: 26.8467,
      startLongitude: 80.9462,
      endLocation: 'Lucknow',
      durationDays: 3,
      durationNights: 2,
      approxDistanceKm: 640,
      vehicleType: 'SUV',
      vehicleId: suv.id,
      minPassengers: 2,
      maxPassengers: 6,
      pricingModel: 'FIXED_PACKAGE',
      basePrice: 18_000,
      inclusions: ['Air-conditioned SUV', 'Driver', 'Fuel and tolls', 'Sightseeing as per itinerary'],
      exclusions: ['Hotel', 'Meals', 'Temple donations', 'Personal expenses'],
      cancellationPolicy: [
        { hoursBefore: 168, refundPercent: 100 },
        { hoursBefore: 72, refundPercent: 75 },
        { hoursBefore: 24, refundPercent: 50 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
      advanceBookingDays: 2,
      availableWeekdays: [],
      driverIncluded: true,
      fuelIncluded: true,
      status: 'PUBLISHED',
      publishedAt: daysAgo(60),
      ratingAverage: 4.7,
      ratingCount: 22,
      bookingCount: 26,
      viewCount: 412,
      createdById: travelOwner.id,
      itinerary: {
        create: [
          {
            dayNumber: 1,
            title: 'Lucknow to Ayodhya',
            description:
              'Morning departure, arrive Ayodhya by midday. Afternoon darshan and evening at the Sarayu ghats.',
            highlights: ['Ram Janmabhoomi', 'Hanuman Garhi', 'Sarayu Aarti'],
            overnightAt: 'Ayodhya',
            approxDistanceKm: 135,
          },
          {
            dayNumber: 2,
            title: 'Ayodhya to Varanasi',
            description: 'Drive to Varanasi, evening Ganga Aarti at Dashashwamedh Ghat.',
            highlights: ['Kashi Vishwanath', 'Ganga Aarti', 'Dashashwamedh Ghat'],
            overnightAt: 'Varanasi',
            approxDistanceKm: 210,
          },
          {
            dayNumber: 3,
            title: 'Sarnath and return',
            description: 'Morning at Sarnath, then the drive back to Lucknow.',
            highlights: ['Sarnath Stupa', 'Archaeological Museum'],
            approxDistanceKm: 295,
          },
        ],
      },
    },
  });

  await prisma.travelPackage.create({
    data: {
      providerId: provider.id,
      organizationId: travelOrg.id,
      title: 'Lucknow Airport Transfer',
      summary: 'Fixed-price sedan transfer between the city and Chaudhary Charan Singh airport.',
      serviceKind: 'AIRPORT_TRANSFER',
      destinations: ['Lucknow Airport'],
      startLocation: 'Lucknow city',
      startLatitude: 26.8467,
      startLongitude: 80.9462,
      endLocation: 'Chaudhary Charan Singh International Airport',
      durationDays: 1,
      approxDistanceKm: 16,
      vehicleType: 'TAXI',
      vehicleId: taxi.id,
      minPassengers: 1,
      maxPassengers: 4,
      pricingModel: 'FIXED_PACKAGE',
      basePrice: 850,
      inclusions: ['Air-conditioned sedan', 'Driver', 'One suitcase per passenger'],
      exclusions: ['Parking beyond 30 minutes', 'Waiting charges'],
      advanceBookingDays: 0,
      availableWeekdays: [],
      status: 'PUBLISHED',
      publishedAt: daysAgo(45),
      ratingAverage: 4.5,
      ratingCount: 14,
      bookingCount: 18,
      viewCount: 236,
      createdById: travelOwner.id,
    },
  });

  await prisma.travelPackage.create({
    data: {
      providerId: provider.id,
      organizationId: travelOrg.id,
      title: 'Nainital & Corbett — 5 Day Group Tour',
      summary: 'Sixteen-seat tempo traveller for a five-day hills and wildlife circuit.',
      serviceKind: 'MULTI_DAY_TOUR',
      destinations: ['Nainital', 'Jim Corbett', 'Bhimtal'],
      startLocation: 'Lucknow',
      startLatitude: 26.8467,
      startLongitude: 80.9462,
      endLocation: 'Lucknow',
      durationDays: 5,
      durationNights: 4,
      approxDistanceKm: 1150,
      vehicleType: 'TEMPO',
      vehicleId: tempo.id,
      minPassengers: 8,
      maxPassengers: 16,
      pricingModel: 'PER_PERSON',
      basePrice: 7_400,
      inclusions: ['Tempo traveller', 'Driver', 'Fuel and tolls', 'Corbett safari transfer'],
      exclusions: ['Hotel', 'Meals', 'Safari permits', 'Guide charges'],
      advanceBookingDays: 7,
      availableWeekdays: [5, 6],
      status: 'PUBLISHED',
      publishedAt: daysAgo(20),
      bookingCount: 3,
      viewCount: 88,
      createdById: travelOwner.id,
    },
  });

  // A draft, so the provider screen shows the unpublished state too.
  await prisma.travelPackage.create({
    data: {
      providerId: provider.id,
      organizationId: travelOrg.id,
      title: 'Lucknow Heritage Half-Day',
      summary: 'Bara Imambara, Rumi Darwaza and Chowk on a four-hour city loop.',
      serviceKind: 'LOCAL_SIGHTSEEING',
      destinations: ['Bara Imambara', 'Rumi Darwaza', 'Chowk'],
      startLocation: 'Lucknow',
      startLatitude: 26.8467,
      startLongitude: 80.9462,
      endLocation: 'Lucknow',
      durationDays: 1,
      vehicleType: 'SUV',
      minPassengers: 1,
      maxPassengers: 6,
      pricingModel: 'FIXED_PACKAGE',
      basePrice: 2_600,
      inclusions: ['Vehicle', 'Driver'],
      exclusions: ['Entry tickets', 'Guide'],
      status: 'DRAFT',
      createdById: travelOwner.id,
    },
  });

  // --- A completed, rated booking -----------------------------------------
  const customer = await prisma.customer.findFirst({
    where: { organizationId: customerOrg.id },
  });
  const customerUser = await prisma.user.findFirst({
    where: { email: 'customer@saarthi.local' },
  });

  let bookings = 0;
  if (customerUser) {
    const completed = await prisma.travelBooking.create({
      data: {
        reference: 'TB-2026-00001',
        packageId: ayodhyaPackage.id,
        providerOrganizationId: travelOrg.id,
        customerOrganizationId: customerOrg.id,
        customerId: customer?.id ?? null,
        bookedByUserId: customerUser.id,
        status: 'COMPLETED',
        startDate: daysAgo(18),
        endDate: daysAgo(16),
        passengers: 4,
        pickupAddress: 'Gomti Nagar, Lucknow',
        pickupLatitude: 26.8512,
        pickupLongitude: 81.0009,
        contactName: 'Priya Nair',
        contactPhone: '+919845000001',
        contactEmail: 'customer@saarthi.local',
        specialRequests: 'Early 5 am start, child seat for a 4-year-old.',
        pricingModel: 'FIXED_PACKAGE',
        subtotal: 18_000,
        platformFee: 900,
        totalAmount: 18_900,
        priceBreakdown: 'Fixed package price for up to the stated capacity',
        vehicleId: suv.id,
        driverId: travelDriver.id,
        confirmedAt: daysAgo(24),
        confirmedById: travelOwner.id,
        startedAt: daysAgo(18),
        completedAt: daysAgo(16),
        events: {
          create: [
            {
              eventType: 'CREATED',
              description: '4 passengers for the Ayodhya pilgrimage.',
              actorUserId: customerUser.id,
              createdAt: daysAgo(25),
            },
            {
              eventType: 'PAYMENT_SUCCEEDED',
              description: 'Payment of ₹18,900 received.',
              actorUserId: customerUser.id,
              createdAt: daysAgo(25),
            },
            {
              eventType: 'CONFIRMED',
              description: 'Provider confirmed and assigned UP32EA4412.',
              actorUserId: travelOwner.id,
              createdAt: daysAgo(24),
            },
            {
              eventType: 'COMPLETED',
              description: 'Trip completed.',
              createdAt: daysAgo(16),
            },
            {
              eventType: 'RATED',
              description: 'Rated 5/5.',
              actorUserId: customerUser.id,
              createdAt: daysAgo(15),
            },
          ],
        },
        payments: {
          create: [
            {
              reference: 'PAY-TB-2026-00001',
              purpose: 'TRAVEL_BOOKING',
              status: 'SUCCEEDED',
              method: 'MOCK',
              organizationId: customerOrg.id,
              initiatedByUserId: customerUser.id,
              amount: 18_900,
              provider: 'mock',
              providerReference: 'MOCK-8F31A2C4',
              processedAt: daysAgo(25),
            },
          ],
        },
        review: {
          create: {
            providerOrganizationId: travelOrg.id,
            packageId: ayodhyaPackage.id,
            rating: 5,
            vehicleRating: 5,
            driverRating: 5,
            comment:
              'Ramesh ji was punctual and drove carefully the whole way. The Innova was spotless. Would book again.',
            ratedByUserId: customerUser.id,
            createdAt: daysAgo(15),
          },
        },
      },
    });
    bookings += 1;
    void completed;

    // An upcoming booking waiting on the provider, so the confirm/decline
    // actions have something to act on in the demo.
    await prisma.travelBooking.create({
      data: {
        reference: 'TB-2026-00002',
        packageId: ayodhyaPackage.id,
        providerOrganizationId: travelOrg.id,
        customerOrganizationId: customerOrg.id,
        customerId: customer?.id ?? null,
        bookedByUserId: customerUser.id,
        status: 'AWAITING_CONFIRMATION',
        startDate: daysAhead(11),
        endDate: daysAhead(13),
        passengers: 3,
        pickupAddress: 'Hazratganj, Lucknow',
        pickupLatitude: 26.8467,
        pickupLongitude: 80.9462,
        contactName: 'Priya Nair',
        contactPhone: '+919845000001',
        contactEmail: 'customer@saarthi.local',
        pricingModel: 'FIXED_PACKAGE',
        subtotal: 18_000,
        platformFee: 900,
        totalAmount: 18_900,
        priceBreakdown: 'Fixed package price for up to the stated capacity',
        events: {
          create: [
            {
              eventType: 'CREATED',
              description: '3 passengers for the Ayodhya pilgrimage.',
              actorUserId: customerUser.id,
              createdAt: daysAgo(1),
            },
            {
              eventType: 'PAYMENT_SUCCEEDED',
              description: 'Payment of ₹18,900 received.',
              actorUserId: customerUser.id,
              createdAt: daysAgo(1),
            },
          ],
        },
        payments: {
          create: [
            {
              reference: 'PAY-TB-2026-00002',
              purpose: 'TRAVEL_BOOKING',
              status: 'SUCCEEDED',
              method: 'MOCK',
              organizationId: customerOrg.id,
              initiatedByUserId: customerUser.id,
              amount: 18_900,
              provider: 'mock',
              providerReference: 'MOCK-1B77E093',
              processedAt: daysAgo(1),
            },
          ],
        },
      },
    });
    bookings += 1;
  }

  // =========================================================================
  // 3. Hardware devices and telemetry
  // =========================================================================

  const fleetTrucks = await prisma.truck.findMany({
    where: { organizationId: fleetA.id, archivedAt: null },
    orderBy: { registrationNumber: 'asc' },
    take: 3,
    select: { id: true, registrationNumber: true, lastLatitude: true, lastLongitude: true },
  });

  const deviceSecretHash = await bcrypt.hash('demo-device-secret', 10);
  let devices = 0;
  let telemetryReadings = 0;
  let telemetryAlerts = 0;

  // A mock device on a truck, so the hardware demo runs against the fleet the
  // owner login already sees.
  if (fleetTrucks[0]) {
    const truck = fleetTrucks[0];
    const mockDevice = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleetA.id,
        deviceIdentifier: 'MOCK-FRM-0001',
        provider: 'MOCK',
        deviceType: 'OBD_TELEMATICS',
        serialNumber: 'SIM-0001',
        manufacturer: 'Saarthi Simulator',
        model: 'Mock ONE+ H',
        firmwareVersion: 'mock-1.0.0',
        secretHash: deviceSecretHash,
        status: 'ACTIVE',
        supportedMetrics: [
          'LOCATION',
          'SPEED',
          'HEADING',
          'RPM',
          'ENGINE_LOAD',
          'COOLANT_TEMPERATURE',
          'FUEL_LEVEL',
          'BATTERY_VOLTAGE',
          'ODOMETER',
          'ACCELEROMETER',
        ],
        observedMetrics: [
          'LOCATION',
          'SPEED',
          'HEADING',
          'RPM',
          'COOLANT_TEMPERATURE',
          'FUEL_LEVEL',
          'BATTERY_VOLTAGE',
          'ACCELEROMETER',
        ],
        notes:
          'Simulated device for demonstrations. Drive it from Devices → Simulate. Never mistaken for real hardware: every reading it produces is flagged simulated.',
        installedAt: daysAgo(30),
        activatedAt: daysAgo(30),
        lastSeenAt: daysAgo(0.01),
        lastTelemetryAt: daysAgo(0.01),
        readingCount: 240,
        assignments: {
          create: [
            {
              vehicleId: truck.id,
              organizationId: fleetA.id,
              status: 'ACTIVE',
              assignedAt: daysAgo(30),
              installedAt: daysAgo(30),
              note: 'Fitted at the Delhi workshop.',
            },
          ],
        },
        events: {
          create: [
            {
              organizationId: fleetA.id,
              eventType: 'REGISTERED',
              description: 'Mock device registered for demonstrations.',
              createdAt: daysAgo(30),
            },
            {
              organizationId: fleetA.id,
              eventType: 'ASSIGNED',
              description: `Fitted to ${truck.registrationNumber}.`,
              createdAt: daysAgo(30),
            },
          ],
        },
      },
    });
    devices += 1;

    // A short telemetry trail, so the dashboard has history before the
    // simulator is ever started. Values are plausible and consistent with each
    // other — speed, rpm and fuel all move together.
    const baseLat = truck.lastLatitude ?? 28.5355;
    const baseLng = truck.lastLongitude ?? 77.271;
    const readings: {
      speedKph: number;
      rpm: number;
      coolant: number;
      fuel: number;
      minutesAgo: number;
    }[] = Array.from({ length: 24 }, (_, index) => ({
      speedKph: 42 + Math.sin(index / 3) * 18,
      rpm: 1350 + Math.sin(index / 3) * 260,
      coolant: 86 + Math.sin(index / 5) * 4,
      fuel: 72 - index * 0.35,
      minutesAgo: (24 - index) * 5,
    }));

    for (const [index, sample] of readings.entries()) {
      const recordedAt = new Date(Date.now() - sample.minutesAgo * 60_000);
      await prisma.telemetryReading.create({
        data: {
          deviceId: mockDevice.id,
          vehicleId: truck.id,
          organizationId: fleetA.id,
          metrics: [
            'LOCATION',
            'SPEED',
            'HEADING',
            'RPM',
            'COOLANT_TEMPERATURE',
            'FUEL_LEVEL',
            'BATTERY_VOLTAGE',
            'ACCELEROMETER',
          ],
          latitude: baseLat + index * 0.0026,
          longitude: baseLng + index * 0.0031,
          speedKph: Number(sample.speedKph.toFixed(1)),
          heading: 118,
          rpm: Math.round(sample.rpm),
          coolantTemperature: Number(sample.coolant.toFixed(1)),
          fuelLevel: Number(sample.fuel.toFixed(1)),
          batteryVoltage: 13.9,
          accelerationX: 0.04,
          accelerationY: -0.02,
          accelerationZ: 0.99,
          simulated: true,
          sequence: index + 1,
          recordedAt,
          receivedAt: recordedAt,
        },
      });
      telemetryReadings += 1;
    }

    // One open alert and one already resolved, so both states render.
    await prisma.telemetryAlert.create({
      data: {
        organizationId: fleetA.id,
        vehicleId: truck.id,
        deviceId: mockDevice.id,
        type: 'OVERSPEED',
        severity: 'WARNING',
        status: 'OPEN',
        message: 'Travelling at 96 km/h, above the 80 km/h limit.',
        observedValue: 96,
        threshold: 80,
        unit: 'km/h',
        latitude: baseLat + 0.02,
        longitude: baseLng + 0.024,
        occurredAt: daysAgo(0.08),
      },
    });
    await prisma.telemetryAlert.create({
      data: {
        organizationId: fleetA.id,
        vehicleId: truck.id,
        deviceId: mockDevice.id,
        type: 'HARSH_BRAKING',
        severity: 'WARNING',
        status: 'RESOLVED',
        message: 'Harsh braking detected at -0.58 g.',
        observedValue: -0.58,
        threshold: 0.45,
        unit: 'g',
        note: 'Driver reported a cow on the carriageway near Palwal. No action needed.',
        resolvedAt: daysAgo(1.8),
        occurredAt: daysAgo(2),
      },
    });
    telemetryAlerts += 2;
  }

  // A real Freematics unit registered but never seen, so the "registered vs
  // active" distinction is visible and the Freematics adapter path has a device.
  if (fleetTrucks[1]) {
    await prisma.hardwareDevice.create({
      data: {
        organizationId: fleetA.id,
        deviceIdentifier: 'FRM-ONEPLUS-H-0042',
        provider: 'FREEMATICS',
        deviceType: 'OBD_TELEMATICS',
        serialNumber: 'FRM0042H',
        imei: '356938035643809',
        manufacturer: 'Freematics',
        model: 'ONE+ Model H',
        firmwareVersion: '4.2.1',
        simIccid: '89910123456789012345',
        simMsisdn: '+919899000042',
        simOperator: 'Airtel IoT',
        secretHash: deviceSecretHash,
        status: 'REGISTERED',
        supportedMetrics: [
          'LOCATION',
          'SPEED',
          'HEADING',
          'ALTITUDE',
          'SATELLITES',
          'RPM',
          'ENGINE_LOAD',
          'COOLANT_TEMPERATURE',
          'FUEL_LEVEL',
          'THROTTLE_POSITION',
          'BATTERY_VOLTAGE',
          'DTC',
          'ACCELEROMETER',
        ],
        observedMetrics: [],
        notes:
          'Physical unit awaiting installation. Payload format must be verified against the device before this is relied on in production — see the note in freematics.adapter.ts.',
        assignments: {
          create: [
            {
              vehicleId: fleetTrucks[1].id,
              organizationId: fleetA.id,
              status: 'ACTIVE',
              assignedAt: daysAgo(2),
              note: 'Awaiting first telemetry.',
            },
          ],
        },
        events: {
          create: [
            {
              organizationId: fleetA.id,
              eventType: 'REGISTERED',
              description: 'Freematics ONE+ Model H registered.',
              createdAt: daysAgo(2),
            },
          ],
        },
      },
    });
    devices += 1;
  }

  // A spare, unassigned, so the assignment flow has something to fit.
  await prisma.hardwareDevice.create({
    data: {
      organizationId: fleetA.id,
      deviceIdentifier: 'MOCK-FRM-0002',
      provider: 'MOCK',
      deviceType: 'GPS_TRACKER',
      serialNumber: 'SIM-0002',
      manufacturer: 'Saarthi Simulator',
      model: 'Mock GPS',
      secretHash: deviceSecretHash,
      status: 'REGISTERED',
      supportedMetrics: ['LOCATION', 'SPEED', 'HEADING'],
      observedMetrics: [],
      notes: 'Spare unit held at the workshop.',
    },
  });
  devices += 1;

  // A device on the travel SUV, so the customer-facing tracking view has data.
  const travelDevice = await prisma.hardwareDevice.create({
    data: {
      organizationId: travelOrg.id,
      deviceIdentifier: 'MOCK-TAXI-0001',
      provider: 'MOCK',
      deviceType: 'OBD_TELEMATICS',
      serialNumber: 'SIM-TAXI-1',
      manufacturer: 'Saarthi Simulator',
      model: 'Mock ONE+ H',
      secretHash: deviceSecretHash,
      status: 'ACTIVE',
      supportedMetrics: ['LOCATION', 'SPEED', 'HEADING', 'RPM', 'FUEL_LEVEL'],
      observedMetrics: ['LOCATION', 'SPEED', 'HEADING'],
      installedAt: daysAgo(15),
      activatedAt: daysAgo(15),
      lastSeenAt: daysAgo(0.02),
      lastTelemetryAt: daysAgo(0.02),
      readingCount: 60,
      assignments: {
        create: [
          {
            vehicleId: suv.id,
            organizationId: travelOrg.id,
            status: 'ACTIVE',
            assignedAt: daysAgo(15),
          },
        ],
      },
    },
  });
  devices += 1;

  // Give the travel SUV a last known position so its map marker is not empty.
  await prisma.truck.update({
    where: { id: suv.id },
    data: {
      lastLatitude: 26.8467,
      lastLongitude: 80.9462,
      lastSpeedKph: 0,
      lastHeading: 90,
      lastLocationAt: daysAgo(0.02),
    },
  });
  void travelDevice;

  // Default alert rules for the fleet, so the rules screen is not empty and the
  // overspeed threshold matches the seeded alert.
  await prisma.telemetryAlertRule.createMany({
    data: [
      { organizationId: fleetA.id, type: 'OVERSPEED', enabled: true, threshold: 80 },
      { organizationId: fleetA.id, type: 'ENGINE_TEMPERATURE', enabled: true, threshold: 105 },
      { organizationId: fleetA.id, type: 'LOW_VOLTAGE', enabled: true, threshold: 11.8 },
    ],
  });

  void platformOrg;
  void responderUser;
  void kanpurOrg;

  return {
    associations: 3,
    associationAlerts,
    providers: 1,
    packages: 4,
    bookings,
    devices,
    telemetryReadings,
    telemetryAlerts,
  };
}

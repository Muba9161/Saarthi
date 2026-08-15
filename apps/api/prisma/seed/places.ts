import { NearbyCategory } from '@saarthi/shared';
import type { PrismaClient } from '@prisma/client';
import { DEMO_ROUTES } from './routes';

/**
 * Local POI dataset for the nearby-services feature.
 *
 * Places are generated deterministically along the demo corridors so a driver
 * anywhere on a route always has fuel, food, workshops and emergency services
 * within a believable distance. In production this table is replaced by a map
 * provider's places API behind the same `NearbyProvider` interface.
 */

interface PlaceTemplate {
  category: NearbyCategory;
  names: string[];
  /** Roughly how many of these appear per 100 km of corridor. */
  densityPer100Km: number;
  open24Hours: boolean;
  /** Metres perpendicular to the route the place sits at. */
  offsetMeters: number;
}

const TEMPLATES: PlaceTemplate[] = [
  {
    category: NearbyCategory.FUEL,
    names: [
      'Indian Oil Highway Fuel Station',
      'Bharat Petroleum Truck Point',
      'HP Petrol Pump',
      'Reliance Fuel Stop',
      'Nayara Energy Station',
    ],
    densityPer100Km: 6,
    open24Hours: true,
    offsetMeters: 120,
  },
  {
    category: NearbyCategory.FOOD,
    names: [
      'Sharma Ji Da Dhaba',
      'Highway Punjabi Dhaba',
      'Amrit Truckers Dhaba',
      'Green Valley Family Restaurant',
      'Gurukripa Bhojanalaya',
      'National Highway Dhaba',
    ],
    densityPer100Km: 8,
    open24Hours: true,
    offsetMeters: 90,
  },
  {
    category: NearbyCategory.WORKSHOP,
    names: [
      'Singh Truck Repair Works',
      'Highway Motors Garage',
      'Tata Motors Service Point',
      'Ashok Leyland Authorised Workshop',
      'Balaji Auto Electricals',
    ],
    densityPer100Km: 4,
    open24Hours: false,
    offsetMeters: 200,
  },
  {
    category: NearbyCategory.TYRE_SHOP,
    names: ['MRF Tyre Point', 'Apollo Tyre Service', 'JK Tyre Highway Centre', 'Puncture Repair Point'],
    densityPer100Km: 4,
    open24Hours: false,
    offsetMeters: 150,
  },
  {
    category: NearbyCategory.PARKING,
    names: ['Truck Parking Yard', 'Highway Transport Nagar', 'Secure Truck Halt'],
    densityPer100Km: 3,
    open24Hours: true,
    offsetMeters: 250,
  },
  {
    category: NearbyCategory.HOSPITAL,
    names: [
      'District Community Health Centre',
      'Highway Trauma Care Centre',
      'Life Care Multispeciality Hospital',
    ],
    densityPer100Km: 2,
    open24Hours: true,
    offsetMeters: 1200,
  },
  {
    category: NearbyCategory.PHARMACY,
    names: ['Apollo Pharmacy', 'Jan Aushadhi Kendra', 'City Medical Store'],
    densityPer100Km: 3,
    open24Hours: false,
    offsetMeters: 800,
  },
  {
    category: NearbyCategory.POLICE,
    names: ['Highway Police Chowki', 'District Police Station', 'Traffic Police Post'],
    densityPer100Km: 2,
    open24Hours: true,
    offsetMeters: 400,
  },
  {
    category: NearbyCategory.REST_AREA,
    names: ['NHAI Wayside Amenity', 'Driver Rest Point', 'Highway Rest Plaza'],
    densityPer100Km: 2,
    open24Hours: true,
    offsetMeters: 180,
  },
  {
    category: NearbyCategory.CHARGING,
    names: ['Tata Power EZ Charge', 'Statiq Charging Hub', 'Highway EV Charging Point'],
    densityPer100Km: 1,
    open24Hours: true,
    offsetMeters: 140,
  },
  {
    category: NearbyCategory.WEIGHBRIDGE,
    names: ['Public Weighbridge', 'Highway Dharam Kanta', 'Electronic Weighbridge'],
    densityPer100Km: 2,
    open24Hours: false,
    offsetMeters: 100,
  },
];

/** Deterministic pseudo-random so repeated seeds produce the same world. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}

function interpolate(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  t: number,
): { latitude: number; longitude: number } {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

export async function seedNearbyPlaces(prisma: PrismaClient): Promise<number> {
  const rows: {
    externalId: string;
    category: NearbyCategory;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    phone: string;
    open24Hours: boolean;
    rating: number;
    attributes: Record<string, unknown>;
  }[] = [];

  for (const [routeIndex, route] of DEMO_ROUTES.entries()) {
    const random = seededRandom(1000 + routeIndex * 97);

    for (const [templateIndex, template] of TEMPLATES.entries()) {
      const count = Math.max(2, Math.round((route.distanceKm / 100) * template.densityPer100Km));

      for (let index = 0; index < count; index += 1) {
        // Spread evenly along the corridor with a little jitter.
        const position = (index + 0.5) / count + (random() - 0.5) * 0.04;
        const clamped = Math.max(0, Math.min(0.999, position));
        const segmentPosition = clamped * (route.points.length - 1);
        const segmentIndex = Math.floor(segmentPosition);
        const from = route.points[segmentIndex]!;
        const to = route.points[Math.min(segmentIndex + 1, route.points.length - 1)]!;
        const base = interpolate(from, to, segmentPosition - segmentIndex);

        // Offset perpendicular-ish to the corridor so places are not on the line.
        const offsetDegrees = template.offsetMeters / 111_320;
        const side = random() > 0.5 ? 1 : -1;
        const latitude = base.latitude + offsetDegrees * side * (0.5 + random());
        const longitude = base.longitude + offsetDegrees * side * (random() - 0.5) * 2;

        const name = template.names[index % template.names.length]!;
        rows.push({
          externalId: `${route.key}-${templateIndex}-${index}`,
          category: template.category,
          name: count > template.names.length ? `${name} ${Math.floor(index / template.names.length) + 1}` : name,
          address: `${route.name}, km ${Math.round(clamped * route.distanceKm)}`,
          latitude: Number(latitude.toFixed(6)),
          longitude: Number(longitude.toFixed(6)),
          phone: `+91${String(7000000000 + Math.floor(random() * 999999999)).slice(0, 10)}`,
          open24Hours: template.open24Hours,
          rating: Number((3.2 + random() * 1.7).toFixed(1)),
          attributes: {
            corridor: route.name,
            truckFriendly: true,
            ...(template.category === NearbyCategory.FUEL
              ? { fuels: ['Diesel', 'Petrol'], hasAdBlue: random() > 0.5 }
              : {}),
            ...(template.category === NearbyCategory.FOOD
              ? { cuisine: 'North Indian', parkingSpaces: 10 + Math.floor(random() * 40) }
              : {}),
            ...(template.category === NearbyCategory.PARKING
              ? { spaces: 20 + Math.floor(random() * 80), secured: random() > 0.4 }
              : {}),
          },
        });
      }
    }
  }

  await prisma.nearbyPlace.deleteMany({ where: { source: 'local' } });
  await prisma.nearbyPlace.createMany({
    data: rows.map((row) => ({
      externalId: row.externalId,
      category: row.category,
      name: row.name,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      phone: row.phone,
      open24Hours: row.open24Hours,
      rating: row.rating,
      attributes: row.attributes as never,
      source: 'local',
      active: true,
    })),
    skipDuplicates: true,
  });

  return rows.length;
}

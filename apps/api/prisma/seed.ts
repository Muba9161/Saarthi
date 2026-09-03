import path from 'node:path';
import dotenv from 'dotenv';

// The monorepo keeps a single .env at the repository root; load it before the
// Prisma client reads DATABASE_URL.
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from './seed/reference';

/**
 * Seed entrypoint.
 *
 *   npm run db:seed    roles, subscription plans and feature entitlements
 *
 * Reference data only, and idempotent — safe to run on every deploy, in every
 * environment, including production.
 *
 * There is deliberately no demo dataset. Fabricated fleets, orders, packages
 * and bookings made a fresh install look busy, but they also made it lie: a
 * marketplace seeded with fake demand tells an operator there is work to bid on
 * that does not exist, and a bidding board is worth precisely what its contents
 * are true. Every organization, vehicle, requirement and bid in a Saarthi
 * database is now something a real person actually created.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    console.log('› Seeding reference data (roles, plans, features)…');
    await seedReferenceData(prisma);
    console.log('  ✓ reference data ready');

    console.log('\n✓ Seed complete.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✗ Seed failed:', error);
  process.exit(1);
});

import path from 'node:path';
import dotenv from 'dotenv';

// The monorepo keeps a single .env at the repository root; load it before the
// Prisma client reads DATABASE_URL.
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from './seed/reference';
import { seedDemoData } from './seed/demo';

/**
 * Seed entrypoint.
 *
 *   npm run db:seed              reference data + full local demo dataset
 *   SEED_DEMO=false npm run db:seed   reference data only (production-safe)
 *
 * Reference data (roles, plans, features) is required for the application to
 * function. Demo data is local-only and is skipped in production.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const includeDemo =
    process.env.SEED_DEMO !== 'false' && process.env.NODE_ENV !== 'production';

  try {
    console.log('› Seeding reference data (roles, plans, features)…');
    await seedReferenceData(prisma);
    console.log('  ✓ reference data ready');

    if (includeDemo) {
      console.log('› Seeding local demo dataset…');
      await seedDemoData(prisma);
    } else {
      console.log('› Skipping demo dataset (production or SEED_DEMO=false)');
    }

    console.log('\n✓ Seed complete.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n✗ Seed failed:', error);
  process.exit(1);
});

import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// The monorepo keeps a single .env at the repository root; the Prisma CLI runs
// with apps/api as its working directory, so load it explicitly before the
// schema's env("DATABASE_URL") is resolved.
const repoRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});

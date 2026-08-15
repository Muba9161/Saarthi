import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * One-time test database provisioning: create `saarthi_test` if it does not
 * exist, bring it to the latest migration, and load reference data (roles,
 * plans, features) which the application requires to function.
 */
export async function setup(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const baseUrl =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/saarthi';
  const testUrl = baseUrl.replace(/\/saarthi(\?|$)/, '/saarthi_test$1');

  const adminUrl = baseUrl.replace(/\/saarthi(\?|$)/, '/postgres$1');
  const { Client } = (await import('pg')) as unknown as {
    Client: new (config: { connectionString: string }) => {
      connect(): Promise<void>;
      query(text: string): Promise<{ rowCount: number | null }>;
      end(): Promise<void>;
    };
  };

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  const existing = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'saarthi_test'`);
  if (!existing.rowCount) {
    await client.query('CREATE DATABASE saarthi_test');
  }
  await client.end();

  const apiDir = path.resolve(__dirname, '..');
  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  const { seedReferenceData } = await import('../prisma/seed/reference');
  await seedReferenceData(prisma);
  await prisma.$disconnect();
}

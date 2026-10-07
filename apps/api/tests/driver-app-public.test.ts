import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleName } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { createRelease, publishRelease } from '../src/modules/terminal/release.service';
import { apk } from './apk-fixture';
import {
  closeApp,
  createOrganization,
  createUser,
  request,
  requestRaw,
  unique,
} from './helpers';

/**
 * The driver app, offered to anybody from the marketing site.
 *
 * The risks worth testing are the ones a visitor would hit first: a button
 * pointing at a draft, a lookup that leaks the notes written for drivers, or a
 * public route that quietly still wants a session.
 */
describe('public driver app download', () => {
  let uploaderId: string;

  beforeEach(async () => {
    await prisma.$connect();
    await prisma.terminalRelease.deleteMany();

    // Its own uploader, for the reason given in terminal-release.test.ts:
    // neighbouring suites truncate `users` without re-seeding.
    const existing = await prisma.user.findFirst({ select: { id: true } });
    uploaderId = existing?.id ?? (
      await prisma.user.create({
        data: {
          email: unique('driver-app-uploader') + '@saarthi.local',
          passwordHash: 'not-used-by-these-tests',
          firstName: 'Release',
          lastName: 'Uploader',
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await closeApp();
  });

  async function uploadDriverApp(versionCode: number, versionName: string): Promise<{
    id: string;
    bytes: Buffer;
  }> {
    const bytes = apk({ versionCode, versionName, packageName: 'com.saarthi.driver' });
    const { id } = await createRelease({
      bytes,
      fileName: 'saarthi-driver.apk',
      notes: 'Internal: fixes the checklist crash for fleet 42.',
      mandatory: false,
      uploadedById: uploaderId,
    });
    return { id, bytes };
  }

  it('offers nothing, and serves nothing, until a driver build is published', async () => {
    await uploadDriverApp(5, '1.5.0');

    const lookup = await request({ method: 'GET', url: '/api/v1/driver-app/public' });
    expect(lookup.status).toBe(200);
    expect(lookup.body.data).toBeNull();

    const download = await requestRaw({ method: 'GET', url: '/api/v1/driver-app/public/download' });
    expect(download.status).toBe(404);
  });

  it('describes the newest published build without its release notes', async () => {
    const { id } = await uploadDriverApp(6, '1.6.0');
    await publishRelease(id, uploaderId);

    const lookup = await request<Record<string, unknown>>({
      method: 'GET',
      url: '/api/v1/driver-app/public',
    });

    expect(lookup.status).toBe(200);
    expect(lookup.body.data).toMatchObject({ versionName: '1.6.0', versionCode: 6 });
    expect(lookup.body.data).not.toHaveProperty('notes');
  });

  it('streams the APK to a visitor with no session', async () => {
    const { id, bytes } = await uploadDriverApp(7, '1.7.0');
    await publishRelease(id, uploaderId);

    const download = await requestRaw({ method: 'GET', url: '/api/v1/driver-app/public/download' });

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(download.headers['content-disposition']).toBe(
      'attachment; filename="saarthi-driver-1.7.0.apk"',
    );
    expect(download.body.equals(bytes)).toBe(true);
  });

  it("keeps the dashboard's signed-in download serving the same build", async () => {
    const { id, bytes } = await uploadDriverApp(8, '1.8.0');
    await publishRelease(id, uploaderId);
    const fleet = await createOrganization();
    const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });

    const download = await requestRaw({
      method: 'GET',
      url: '/api/v1/terminal/driver-app/download',
      user: driver,
    });

    expect(download.status).toBe(200);
    expect(download.headers['cache-control']).toBe('private, max-age=86400, immutable');
    expect(download.body.equals(bytes)).toBe(true);
  });
});

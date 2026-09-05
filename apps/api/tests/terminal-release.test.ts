import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TerminalReleaseStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  archiveRelease,
  createRelease,
  publishRelease,
  updateOfferFor,
} from '../src/modules/terminal/release.service';
import { apk } from './apk-fixture';

/**
 * Getting a build onto vehicles.
 *
 * The tests worth having here are the ones where a plausible implementation
 * does damage rather than nothing: offering a draft, offering a build to a
 * tablet that cannot run it, accepting a debug APK signed with a throwaway key,
 * or letting two builds share a version code so "is this newer?" stops having
 * an answer. Each of those reaches a truck three states away, where the cost of
 * being wrong is a driver who cannot work.
 */
describe('terminal releases', () => {
  let uploaderId: string;

  /*
   * No app and no `closeApp`: these call the service directly, and `closeApp`
   * disconnects the shared Prisma client out from under whichever file runs
   * next. Opening a connection is all that is needed.
   */
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.terminalRelease.deleteMany();
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error('The seeded database has no users.');
    uploaderId = user.id;
  });

  /** Upload a build, as the admin console would. */
  async function upload(options: {
    versionCode: number;
    versionName?: string;
    packageName?: string;
    minSdk?: number;
    mandatory?: boolean;
    notes?: string;
  }): Promise<string> {
    const { id } = await createRelease({
      bytes: apk({
        versionCode: options.versionCode,
        versionName: options.versionName ?? `1.${options.versionCode}.0`,
        packageName: options.packageName,
        minSdk: options.minSdk,
      }),
      fileName: 'saarthi-terminal.apk',
      notes: options.notes ?? null,
      mandatory: options.mandatory ?? false,
      uploadedById: uploaderId,
    });
    return id;
  }

  it('records what the binary says, not what the uploader claims', async () => {
    const id = await upload({ versionCode: 12, versionName: '3.4.5', minSdk: 26 });

    const release = await prisma.terminalRelease.findUniqueOrThrow({ where: { id } });
    expect(release.versionCode).toBe(12);
    expect(release.versionName).toBe('3.4.5');
    expect(release.minSdk).toBe(26);
    expect(release.applicationId).toBe('com.saarthi.terminal');
    expect(release.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('offers nothing until a release is published', async () => {
    /*
     * The whole reason uploading and shipping are separate acts. Picking the
     * wrong file must never be capable of changing what a thousand vehicles
     * are running.
     */
    await upload({ versionCode: 5 });

    expect(await updateOfferFor({ currentVersionCode: 1, deviceSdk: 33 })).toBeNull();
  });

  it('offers a published release to a terminal running something older', async () => {
    const id = await upload({ versionCode: 5, versionName: '1.5.0', notes: 'Faster search' });
    await publishRelease(id, uploaderId);

    const offer = await updateOfferFor({ currentVersionCode: 4, deviceSdk: 33 });
    expect(offer?.versionCode).toBe(5);
    expect(offer?.versionName).toBe('1.5.0');
    expect(offer?.notes).toBe('Faster search');
    expect(offer?.mandatory).toBe(false);
  });

  it('offers nothing to a terminal already on that build', async () => {
    // The answer nearly every time this is asked — a whole fleet on the current
    // build asks it on every heartbeat.
    const id = await upload({ versionCode: 5 });
    await publishRelease(id, uploaderId);

    expect(await updateOfferFor({ currentVersionCode: 5, deviceSdk: 33 })).toBeNull();
    // And never a downgrade: Android would refuse the install, so the button
    // would fail every time it was pressed.
    expect(await updateOfferFor({ currentVersionCode: 6, deviceSdk: 33 })).toBeNull();
  });

  it('treats a terminal that cannot report its version as behind', async () => {
    /*
     * A build predating this pipeline sends no version code. Reading that
     * silence as "up to date" would strand exactly the terminals most in need
     * of the update, and nothing on the tablet would say why.
     */
    const id = await upload({ versionCode: 3 });
    await publishRelease(id, uploaderId);

    expect((await updateOfferFor({ currentVersionCode: null, deviceSdk: null }))?.versionCode).toBe(
      3,
    );
  });

  it('does not offer a build to a tablet too old to install it', async () => {
    // Android would refuse it, and to a driver a button that always fails reads
    // as a broken app rather than an old one. Silence is the better failure.
    const id = await upload({ versionCode: 9, minSdk: 30 });
    await publishRelease(id, uploaderId);

    expect(await updateOfferFor({ currentVersionCode: 1, deviceSdk: 26 })).toBeNull();
    expect((await updateOfferFor({ currentVersionCode: 1, deviceSdk: 30 }))?.versionCode).toBe(9);
  });

  it('stops offering an archived release', async () => {
    const id = await upload({ versionCode: 7 });
    await publishRelease(id, uploaderId);
    await archiveRelease(id);

    expect(await updateOfferFor({ currentVersionCode: 1, deviceSdk: 33 })).toBeNull();
  });

  it('offers the highest published build when several are out', async () => {
    const older = await upload({ versionCode: 4, versionName: '1.4.0' });
    const newer = await upload({ versionCode: 6, versionName: '1.6.0' });
    await publishRelease(older, uploaderId);
    await publishRelease(newer, uploaderId);

    expect((await updateOfferFor({ currentVersionCode: 3, deviceSdk: 33 }))?.versionName).toBe(
      '1.6.0',
    );
  });

  it('refuses a second upload of the same version code', async () => {
    /*
     * Two builds sharing a code are indistinguishable to Android: a terminal
     * that installed the first would never be offered the second, and one that
     * had not would get whichever row happened to be newest. Bumping the code
     * is the only correct answer, so the message says so.
     */
    await upload({ versionCode: 11, versionName: '1.11.0' });

    await expect(upload({ versionCode: 11, versionName: '1.11.1' })).rejects.toThrow(
      /already uploaded/,
    );
  });

  it('refuses a debug build', async () => {
    /*
     * A debug APK carries the telemetry simulator and the developer tools, and
     * is signed with a throwaway key no fitted terminal will accept. It is also
     * the single likeliest wrong file to pick — it sits in a sibling folder.
     */
    await expect(
      upload({ versionCode: 20, packageName: 'com.saarthi.terminal.debug' }),
    ).rejects.toThrow(/debug build/);
  });

  it('refuses an APK for an entirely different app', async () => {
    await expect(upload({ versionCode: 21, packageName: 'com.whatsapp' })).rejects.toThrow(
      /com\.whatsapp/,
    );
  });

  it('refuses to publish behind a newer published release', async () => {
    /*
     * Publishing an older build changes nothing — the check only ever offers
     * the highest published code — so it would look like it worked and quietly
     * do nothing. Archiving the newer one is the operation that means that, and
     * the error says so.
     */
    const older = await upload({ versionCode: 2, versionName: '1.2.0' });
    const newer = await upload({ versionCode: 8, versionName: '1.8.0' });
    await publishRelease(newer, uploaderId);

    await expect(publishRelease(older, uploaderId)).rejects.toThrow(/already published/);
  });

  it('carries the mandatory flag through to the terminal', async () => {
    const id = await upload({ versionCode: 15, mandatory: true });
    await publishRelease(id, uploaderId);

    expect((await updateOfferFor({ currentVersionCode: 14, deviceSdk: 33 }))?.mandatory).toBe(true);
  });

  it('publishing twice is not an error', async () => {
    // The admin console shows a button, and a button gets double-tapped in a
    // browser tab that has not repainted yet.
    const id = await upload({ versionCode: 30 });
    await publishRelease(id, uploaderId);
    await publishRelease(id, uploaderId);

    const release = await prisma.terminalRelease.findUniqueOrThrow({ where: { id } });
    expect(release.status).toBe(TerminalReleaseStatus.PUBLISHED);
  });
});

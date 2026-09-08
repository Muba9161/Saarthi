import { beforeEach, describe, expect, it } from 'vitest';
import { TerminalReleaseStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  archiveRelease,
  createRelease,
  latestDriverApp,
  publishRelease,
  updateOfferFor,
} from '../src/modules/terminal/release.service';
import { apk } from './apk-fixture';
import { unique } from './helpers';

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
  /*
   * Connected before every test, not once before the file.
   *
   * Other suites in this project boot Fastify and close it again, and `closeApp`
   * disconnects the *shared* Prisma client — so whichever file runs next finds a
   * dead engine partway through, with "Engine is not yet connected" instead of
   * anything to do with the code under test. A `beforeAll` reconnect is not
   * enough because the disconnect can land after it. Connecting an already
   * connected client is free.
   */
  beforeEach(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.terminalRelease.deleteMany();

    /*
     * This suite makes its own uploader rather than borrowing a seeded one.
     *
     * It used to call `findFirst` on users, which passed alone and failed the
     * moment a neighbouring file ran first: several suites truncate `users` in
     * their own setup and do not re-seed, so "the first user" is whatever the
     * previous file happened to leave behind — or nothing at all. A test whose
     * result depends on its neighbours is worse than no test, because it fails
     * for a reason that has nothing to do with the code under test.
     */
    const existing = await prisma.user.findFirst({ select: { id: true } });
    uploaderId = existing?.id ?? (
      await prisma.user.create({
        data: {
          email: unique('release-uploader') + '@saarthi.local',
          passwordHash: 'not-used-by-these-tests',
          firstName: 'Release',
          lastName: 'Uploader',
        },
        select: { id: true },
      })
    ).id;
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

  // -------------------------------------------------------------------------
  // Two apps, one pipeline
  // -------------------------------------------------------------------------

  it("never offers one app the other app's build", async () => {
    /*
     * The rule with the worst consequence if broken.
     *
     * The tablet app and the driver app are separate packages that both start
     * at version code 1. A phone handed the terminal build would lose its
     * sign-in and gain a kiosk; a tablet handed the driver build would lose its
     * kiosk and be asked for an email address. Neither is recoverable from the
     * cab.
     */
    const tablet = await upload({ versionCode: 40, versionName: '2.0.0' });
    const phone = await upload({
      versionCode: 40,
      versionName: '9.9.9',
      packageName: 'com.saarthi.driver',
    });
    await publishRelease(tablet, uploaderId);
    await publishRelease(phone, uploaderId);

    const forTablet = await updateOfferFor({
      currentVersionCode: 1,
      deviceSdk: 33,
      applicationId: 'com.saarthi.terminal',
    });
    const forPhone = await updateOfferFor({
      currentVersionCode: 1,
      deviceSdk: 33,
      applicationId: 'com.saarthi.driver',
    });

    expect(forTablet?.versionName).toBe('2.0.0');
    expect(forPhone?.versionName).toBe('9.9.9');
  });

  it('lets both apps use the same version code', async () => {
    // They are independent packages. A driver build must not be blocked
    // because a tablet build happens to share a number.
    await upload({ versionCode: 7 });
    await expect(
      upload({ versionCode: 7, packageName: 'com.saarthi.driver' }),
    ).resolves.toBeTruthy();
  });

  it('offers the terminal build to a device that does not say which app it is', async () => {
    // A build predating the driver app sends no application id. Reading that
    // silence as "the driver app" would push a phone build onto every fitted
    // tablet in the field.
    const tablet = await upload({ versionCode: 50, versionName: '3.0.0' });
    await publishRelease(tablet, uploaderId);

    const offer = await updateOfferFor({ currentVersionCode: 1, deviceSdk: 33 });
    expect(offer?.versionName).toBe('3.0.0');
  });

  it('gives a driver the newest published driver app, and nothing else', async () => {
    const tablet = await upload({ versionCode: 60, versionName: '4.0.0' });
    const oldPhone = await upload({
      versionCode: 3,
      versionName: '1.3.0',
      packageName: 'com.saarthi.driver',
    });
    const newPhone = await upload({
      versionCode: 4,
      versionName: '1.4.0',
      packageName: 'com.saarthi.driver',
    });
    await publishRelease(tablet, uploaderId);
    await publishRelease(oldPhone, uploaderId);
    await publishRelease(newPhone, uploaderId);

    const app = await latestDriverApp();
    expect(app?.versionName).toBe('1.4.0');
  });

  it('offers a driver nothing until a driver build is published', async () => {
    // A dashboard showing a download button that fails would be worse than one
    // showing none, so this is null rather than a throw.
    const tablet = await upload({ versionCode: 70 });
    await publishRelease(tablet, uploaderId);
    await upload({ versionCode: 5, packageName: 'com.saarthi.driver' });

    expect(await latestDriverApp()).toBeNull();
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

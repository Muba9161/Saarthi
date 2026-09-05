import { TerminalReleaseStatus } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { storageProvider } from '../../providers/storage';
import { ApkInspectionError, inspectApk, type ApkInfo } from './apk-inspector';

/**
 * Getting a new Terminal build onto vehicles.
 *
 * Fitted terminals are the hardest software in Saarthi to update: the tablet is
 * bolted into a cab that is three states away, and the person nearest it is
 * driving. So the build comes to them — the app asks whether a newer release
 * exists and offers the driver a button.
 *
 * Three rules shape everything here.
 *
 * **Uploading is not shipping.** A release arrives as a DRAFT and reaches
 * nobody until somebody publishes it. Nothing about picking a file should be
 * capable of changing what a thousand vehicles are running.
 *
 * **The binary is the source of truth.** Version, package and SDK floor are
 * read out of the APK, never typed. See `apk-inspector.ts` for why.
 *
 * **Only forwards.** A terminal is offered a release only when its version code
 * is higher than the one running. Android refuses a downgrade anyway, so
 * offering one would produce a button that fails every time it is pressed.
 */

const releaseLogger = logger.child({ module: 'terminal-release' });

/**
 * The package a release must declare.
 *
 * A debug build has `.debug` appended to this and so is refused, which is the
 * intent: a debug APK carries the simulator and the developer tools, and it is
 * signed with a throwaway key that no fitted terminal will accept.
 */
const TERMINAL_APPLICATION_ID = 'com.saarthi.terminal';

/** Where release binaries live within the storage provider. */
const RELEASE_PREFIX = 'terminal-releases';

/**
 * The largest APK accepted.
 *
 * The universal split of this app is about 85 MB and a release with more
 * assets will be larger, so the ceiling is generous. It exists to stop a
 * mistaken upload of something enormous, not to be tight.
 */
export const MAX_RELEASE_BYTES = 200 * 1024 * 1024;

/** What a terminal is told about a build it could install. */
export interface TerminalUpdateOffer {
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  /** Lower-case hex; the terminal refuses to install if the download differs. */
  sha256: string;
  notes: string | null;
  mandatory: boolean;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Take in an uploaded APK.
 *
 * The bytes are inspected before they are stored, so a file that is not a
 * Terminal APK never reaches the storage provider at all.
 */
export async function createRelease(input: {
  bytes: Buffer;
  fileName: string;
  notes: string | null;
  mandatory: boolean;
  uploadedById: string;
}): Promise<{ id: string; info: ApkInfo }> {
  if (input.bytes.length === 0) {
    throw errors.validation('The uploaded file is empty.');
  }
  if (input.bytes.length > MAX_RELEASE_BYTES) {
    throw errors.payloadTooLarge(
      `A release may be at most ${Math.round(MAX_RELEASE_BYTES / 1024 / 1024)} MB.`,
    );
  }

  let info: ApkInfo;
  try {
    info = inspectApk(input.bytes);
  } catch (error) {
    // The inspector's messages are written for the person holding the file, so
    // they are passed through rather than replaced with something generic.
    if (error instanceof ApkInspectionError) throw errors.validation(error.message);
    throw error;
  }

  if (info.applicationId !== TERMINAL_APPLICATION_ID) {
    throw errors.validation(
      `That APK is ${info.applicationId}, not the Saarthi Terminal (${TERMINAL_APPLICATION_ID}). ` +
        (info.applicationId === `${TERMINAL_APPLICATION_ID}.debug`
          ? 'It is a debug build — release builds are the only ones a terminal will accept.'
          : 'Check which file you selected.'),
    );
  }

  /*
   * A repeated version code is refused, not overwritten.
   *
   * Two builds sharing a code are indistinguishable to Android and to this
   * pipeline: a terminal that already installed the first would never be
   * offered the second, and one that had not would get whichever row happened
   * to be newest. Bumping the code is the only correct answer, and saying so
   * here is cheaper than the confusion of a silent replacement.
   */
  const clash = await prisma.terminalRelease.findUnique({
    where: { versionCode: info.versionCode },
    select: { id: true, versionName: true, status: true },
  });
  if (clash) {
    throw errors.conflict(
      `Version code ${info.versionCode} is already uploaded as ${clash.versionName}. ` +
        'Raise versionCode in build.gradle.kts and build again.',
    );
  }

  const stored = await storageProvider.upload({
    prefix: RELEASE_PREFIX,
    fileName: input.fileName,
    // Deliberately not sniffed against the image/PDF allow-list the document
    // uploader uses: this file has already been proved to be an APK by reading
    // its manifest, which is a far stronger check than a magic-byte guess.
    mimeType: 'application/vnd.android.package-archive',
    content: input.bytes,
  });

  const release = await prisma.terminalRelease.create({
    data: {
      versionCode: info.versionCode,
      versionName: info.versionName,
      applicationId: info.applicationId,
      minSdk: info.minSdk,
      storageKey: stored.storageKey,
      fileName: input.fileName,
      fileSize: input.bytes.length,
      sha256: info.sha256,
      notes: input.notes,
      mandatory: input.mandatory,
      status: TerminalReleaseStatus.DRAFT,
      uploadedById: input.uploadedById,
    },
    select: { id: true },
  });

  releaseLogger.info(
    { releaseId: release.id, versionCode: info.versionCode, versionName: info.versionName },
    'Terminal release uploaded',
  );

  return { id: release.id, info };
}

/**
 * Offer a release to the fleet.
 *
 * Publishing a version older than one already published is refused. The check
 * endpoint only ever offers the highest published code, so an older publish
 * would change nothing while appearing to have worked — and somebody would
 * spend an afternoon wondering why the rollback did not roll back. Archive the
 * newer one instead, which is the operation that actually means that.
 */
export async function publishRelease(id: string, publishedById: string): Promise<void> {
  const release = await prisma.terminalRelease.findUnique({
    where: { id },
    select: { id: true, versionCode: true, versionName: true, status: true },
  });
  if (!release) throw errors.notFound('Release');
  if (release.status === TerminalReleaseStatus.PUBLISHED) return;

  const newest = await prisma.terminalRelease.findFirst({
    where: { status: TerminalReleaseStatus.PUBLISHED },
    orderBy: { versionCode: 'desc' },
    select: { versionCode: true, versionName: true },
  });

  if (newest && newest.versionCode > release.versionCode) {
    throw errors.businessRule(
      `${newest.versionName} is already published and is newer. Terminals are only ever ` +
        `offered the highest published version, so publishing ${release.versionName} would ` +
        `change nothing. Archive ${newest.versionName} first if you mean to withdraw it.`,
    );
  }

  await prisma.terminalRelease.update({
    where: { id },
    data: {
      status: TerminalReleaseStatus.PUBLISHED,
      publishedAt: new Date(),
      publishedById,
    },
  });

  releaseLogger.info(
    { releaseId: id, versionCode: release.versionCode },
    'Terminal release published to the fleet',
  );
}

/**
 * Withdraw a release.
 *
 * Terminals stop being offered it. The ones that already installed it keep
 * running it — an install cannot be recalled, and the honest thing is to say so
 * rather than let an "unpublish" button imply a reach it does not have.
 */
export async function archiveRelease(id: string): Promise<void> {
  const release = await prisma.terminalRelease.findUnique({
    where: { id },
    select: { id: true, versionCode: true },
  });
  if (!release) throw errors.notFound('Release');

  await prisma.terminalRelease.update({
    where: { id },
    data: { status: TerminalReleaseStatus.ARCHIVED },
  });

  releaseLogger.warn(
    { releaseId: id, versionCode: release.versionCode },
    'Terminal release archived — no longer offered',
  );
}

// ---------------------------------------------------------------------------
// What a terminal is told
// ---------------------------------------------------------------------------

/**
 * Is there anything newer for this terminal?
 *
 * Returns null when there is not, which is the answer nearly every time it is
 * asked — a fleet on the current build asks this on every heartbeat.
 *
 * `currentVersionCode` comes from the app itself. A terminal that cannot report
 * one (an old build predating this pipeline) is treated as version 0, so it is
 * offered the update rather than left behind by its own silence.
 */
export async function updateOfferFor(input: {
  currentVersionCode: number | null;
  deviceSdk: number | null;
}): Promise<TerminalUpdateOffer | null> {
  const newest = await prisma.terminalRelease.findFirst({
    where: { status: TerminalReleaseStatus.PUBLISHED },
    orderBy: { versionCode: 'desc' },
    select: {
      versionCode: true,
      versionName: true,
      fileSize: true,
      sha256: true,
      notes: true,
      mandatory: true,
      minSdk: true,
    },
  });
  if (!newest) return null;

  const current = input.currentVersionCode ?? 0;
  if (newest.versionCode <= current) return null;

  /*
   * A tablet below the build's floor is not offered it.
   *
   * Android would refuse the install, so the button would fail every time it
   * was pressed — and to the driver that reads as a broken app rather than an
   * old one. Silence is the better failure: the terminal keeps working on the
   * build it has.
   */
  if (input.deviceSdk !== null && input.deviceSdk < newest.minSdk) return null;

  return {
    versionCode: newest.versionCode,
    versionName: newest.versionName,
    sizeBytes: newest.fileSize,
    sha256: newest.sha256,
    notes: newest.notes,
    mandatory: newest.mandatory,
  };
}

/** The stored bytes of the newest published release, for a terminal to download. */
export async function openPublishedRelease(versionCode: number): Promise<{
  stream: Awaited<ReturnType<typeof storageProvider.download>>['stream'];
  size: number;
  fileName: string;
  sha256: string;
}> {
  const release = await prisma.terminalRelease.findFirst({
    where: { versionCode, status: TerminalReleaseStatus.PUBLISHED },
    select: { storageKey: true, fileName: true, fileSize: true, sha256: true },
  });
  // Not found *or* not published reads the same on purpose: a device has no
  // business learning which draft versions exist.
  if (!release) throw errors.notFound('Release');

  const download = await storageProvider.download(release.storageKey);
  return {
    stream: download.stream,
    size: release.fileSize,
    fileName: release.fileName,
    sha256: release.sha256,
  };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

/** Every release, newest first, with how much of the fleet is on each. */
export async function listReleases(): Promise<
  {
    id: string;
    versionCode: number;
    versionName: string;
    status: TerminalReleaseStatus;
    mandatory: boolean;
    notes: string | null;
    fileSize: number;
    sha256: string;
    minSdk: number;
    publishedAt: Date | null;
    createdAt: Date;
    terminalsOnThisVersion: number;
  }[]
> {
  const releases = await prisma.terminalRelease.findMany({
    orderBy: { versionCode: 'desc' },
    select: {
      id: true,
      versionCode: true,
      versionName: true,
      status: true,
      mandatory: true,
      notes: true,
      fileSize: true,
      sha256: true,
      minSdk: true,
      publishedAt: true,
      createdAt: true,
    },
  });

  /*
   * How many terminals report each version name.
   *
   * Grouped by the string the devices send rather than joined on the release
   * rows, because a terminal running a build that was never uploaded here — a
   * hand-installed one — still has to appear somewhere. Counting from what the
   * fleet says it is running is the only count that reflects reality.
   */
  const counts = await prisma.hardwareDevice.groupBy({
    by: ['appVersion'],
    _count: { _all: true },
  });
  const byVersion = new Map(counts.map((row) => [row.appVersion ?? '', row._count._all] as const));

  return releases.map((release) => ({
    ...release,
    status: release.status as TerminalReleaseStatus,
    terminalsOnThisVersion: byVersion.get(release.versionName) ?? 0,
  }));
}

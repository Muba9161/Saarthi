import { describe, expect, it } from 'vitest';
import { ApkInspectionError, inspectApk } from '../src/modules/terminal/apk-inspector';
import {
  CHUNK_XML,
  TYPE_STRING,
  apk,
  binaryManifest,
  resourceMap,
  startElement,
  stringPool,
  zip,
} from './apk-fixture';

/**
 * Reading an uploaded APK.
 *
 * The parser is the risky part of the release pipeline: everything downstream
 * trusts the version code it returns, and a wrong one either strands the fleet
 * on an old build for ever or pushes an old build over a new one. So the tests
 * build real binary manifests rather than mocking the reader — a synthetic APK
 * that the parser can read is the only evidence worth having.
 *
 * The failure cases matter as much. Somebody will upload an `.aab`, or a zip of
 * the output folder, and the message they get has to name what they did.
 */

// ---------------------------------------------------------------------------

describe('inspectApk', () => {
  it('reads the package, version and floor out of the binary', () => {
    const info = inspectApk(apk({ versionCode: 42, versionName: '2.1.0', minSdk: 26 }));

    expect(info.applicationId).toBe('com.saarthi.terminal');
    expect(info.versionCode).toBe(42);
    expect(info.versionName).toBe('2.1.0');
    expect(info.minSdk).toBe(26);
  });

  it('finds the manifest wherever it sits in the archive', () => {
    // A real APK has thousands of entries and the manifest is rarely first.
    const archive = zip([
      { name: 'resources.arsc', content: Buffer.alloc(512, 7) },
      { name: 'res/layout/main.xml', content: Buffer.from('padding') },
      {
        name: 'AndroidManifest.xml',
        content: binaryManifest({
          packageName: 'com.saarthi.terminal',
          versionCode: 9,
          versionName: '1.9.0',
        }),
      },
    ]);

    expect(inspectApk(archive).versionCode).toBe(9);
  });

  it('hashes the exact bytes it was given', () => {
    const bytes = apk({});
    const first = inspectApk(bytes).sha256;

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    // The same file twice is the same hash — the terminal compares this after
    // downloading, so an unstable hash would fail every install.
    expect(inspectApk(bytes).sha256).toBe(first);
    expect(inspectApk(apk({ versionCode: 8 })).sha256).not.toBe(first);
  });

  it('falls back to the platform default when no floor is declared', () => {
    // Absent is not zero and not a guess: `uses-sdk` is optional, and Android
    // reads its absence as 1.
    expect(inspectApk(apk({})).minSdk).toBe(1);
  });

  it('rejects a file that is not an archive at all', () => {
    // The commonest mistake: a screenshot, a PDF, anything from a file picker.
    expect(() => inspectApk(Buffer.from('this is a screenshot'))).toThrow(ApkInspectionError);
    expect(() => inspectApk(Buffer.alloc(0))).toThrow(/not an APK/);
  });

  it('names the problem when an archive carries no manifest', () => {
    /*
     * An `.aab` is a ZIP too, and uploading one instead of an APK is a mistake
     * a person will make. "Could not parse" would send them looking at the
     * build; naming the bundle sends them to the right file.
     */
    const bundle = zip([{ name: 'base/manifest/AndroidManifest.xml', content: Buffer.from('x') }]);

    expect(() => inspectApk(bundle)).toThrow(/no AndroidManifest\.xml/);
    expect(() => inspectApk(bundle)).toThrow(/\.aab/);
  });

  it('refuses a manifest with no version code rather than assuming one', () => {
    // Assuming 1 here would let the build be published and then never offered,
    // or offered to everyone for ever. Neither failure names itself later.
    const noVersion = zip([
      {
        name: 'AndroidManifest.xml',
        content: (() => {
          const strings = ['package', 'manifest', 'com.saarthi.terminal'];
          const header = Buffer.alloc(8);
          const body = Buffer.concat([
            stringPool(strings),
            resourceMap([0]),
            startElement(1, [{ nameIndex: 0, type: TYPE_STRING, data: 2 }]),
          ]);
          header.writeUInt16LE(CHUNK_XML, 0);
          header.writeUInt16LE(8, 2);
          header.writeUInt32LE(8 + body.length, 4);
          return Buffer.concat([header, body]);
        })(),
      },
    ]);

    expect(() => inspectApk(noVersion)).toThrow(/version code/);
  });
});

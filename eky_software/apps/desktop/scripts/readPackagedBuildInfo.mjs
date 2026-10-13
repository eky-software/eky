import { resolve } from 'node:path';
import { parseDesktopBuildInfo } from '../src/release/desktopBuildInfo.ts';
import { parseStrictJsonObjectBytes } from '../installer/windows-acceptance-harness/strictJsonObject.mjs';

const MAXIMUM_BYTES = 64 * 1024;
const ARCHIVE_PATH = 'dist/build-info.json';

// Metadata only: callers still own whole-payload verification and admission.
export async function readPackagedBuildInfo(installRoot, appVersion) {
  const { extractFile, statFile, uncache } = await import('@electron/asar');
  const archive = resolve(installRoot, 'resources', 'app.asar');
  uncache(archive);
  try {
    const entry = statFile(archive, ARCHIVE_PATH, false);
    if ('files' in entry || 'link' in entry || entry.unpacked === true ||
        !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > MAXIMUM_BYTES) {
      throw new Error('PACKAGED_BUILD_INFO_INVALID');
    }
    const bytes = extractFile(archive, ARCHIVE_PATH, false);
    if (bytes.length !== entry.size) throw new Error('PACKAGED_BUILD_INFO_INVALID');
    return parseDesktopBuildInfo(parseStrictJsonObjectBytes(bytes, {
      errorCode: 'PACKAGED_BUILD_INFO_INVALID', maximumBytes: MAXIMUM_BYTES,
    }), { expectedAppVersion: appVersion });
  } finally { uncache(archive); }
}

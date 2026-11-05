import { resolve } from 'node:path';
import { parseDesktopBuildInfo } from '../src/release/desktopBuildInfo.ts';
import { parseDesktopPackageModeInfo } from '../src/release/desktopPackageMode.ts';
import { parseStrictJsonObjectBytes } from '../installer/windows-acceptance-harness/strictJsonObject.mjs';

const MAXIMUM_BYTES = 64 * 1024;

// Metadata only: callers still own whole-payload verification and admission.
export async function readPackagedBuildInfo(installRoot, appVersion) {
  return parseDesktopBuildInfo(await readMember(installRoot, 'dist/build-info.json'), { expectedAppVersion: appVersion });
}

export async function readPackagedPilotInfo(installRoot) {
  const { parseDesktopReleaseInfo } = await import('../dist/release/desktopReleaseInfo.js');
  const buildInfo = await readPackagedBuildInfo(installRoot);
  const mode = parseDesktopPackageModeInfo(await readMember(installRoot, 'dist/package-mode.json'));
  const releaseInfo = parseDesktopReleaseInfo(await readMember(installRoot, 'dist/release-info.json'), buildInfo.appVersion);
  if (mode.mode !== 'pilot' || buildInfo.buildDirty !== false || releaseInfo.buildRevision !== buildInfo.buildRevision) {
    throw new Error('PACKAGED_PILOT_INFO_INVALID');
  }
  return Object.freeze({ buildInfo, releaseInfo });
}

async function readMember(installRoot, member) {
  const { extractFile, statFile, uncache } = await import('@electron/asar');
  const archive = resolve(installRoot, 'resources', 'app.asar');
  uncache(archive);
  try {
    const entry = statFile(archive, member, false);
    if ('files' in entry || 'link' in entry || entry.unpacked === true ||
        !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > MAXIMUM_BYTES) {
      throw new Error('PACKAGED_BUILD_INFO_INVALID');
    }
    const bytes = extractFile(archive, member, false);
    if (bytes.length !== entry.size) throw new Error('PACKAGED_BUILD_INFO_INVALID');
    return parseStrictJsonObjectBytes(bytes, {
      errorCode: 'PACKAGED_BUILD_INFO_INVALID', maximumBytes: MAXIMUM_BYTES,
    });
  } finally { uncache(archive); }
}

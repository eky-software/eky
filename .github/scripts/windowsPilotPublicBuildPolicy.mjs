import { parseStrictJsonObjectBytes } from '../../eky_software/apps/desktop/installer/windows-acceptance-harness/strictJsonObject.mjs';

export const denied = 'WINDOWS_PUBLIC_BUILD_BASELINE_DENIED';
export const maximumBytes = 64 * 1024;
const publicVersion = '0.2.81';
const publicTestVersion = '0.3.1';

// This allows ordinary public CI only; it is not a release or source attestation.
export function assertPublicBuildBaseline(repository, server, packageBytes, releaseBytes, releaseCandidate = false) {
  if (repository !== 'eky-software/eky' || server !== 'https://github.com' ||
      typeof releaseCandidate !== 'boolean') throw new Error(denied);
  const options = { errorCode: denied, maximumBytes };
  const pkg = parseStrictJsonObjectBytes(packageBytes, options);
  const release = parseStrictJsonObjectBytes(releaseBytes, options);
  const version = pkg.version;
  const versionAllowed = version === publicVersion || (!releaseCandidate && version === publicTestVersion);
  if (pkg.name !== '@eky/desktop' || pkg.private !== true || !versionAllowed ||
      release.appIdentity !== 'Eky' || release.appVersion !== version ||
      release.msiProductVersion !== version || release.platform !== 'win32' ||
      release.architecture !== 'x64' || release.releaseChannel !== 'pilot') throw new Error(denied);
}

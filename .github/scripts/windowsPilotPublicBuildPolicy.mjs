import { parseStrictJsonObjectBytes } from '../../eky_software/apps/desktop/installer/windows-acceptance-harness/strictJsonObject.mjs';

export const denied = 'WINDOWS_PUBLIC_BUILD_BASELINE_DENIED';
export const maximumBytes = 64 * 1024;
const publicVersion = '0.2.81';

// This allows ordinary public CI only; it is not a release or source attestation.
export function assertPublicBuildBaseline(repository, server, packageBytes, releaseBytes) {
  if (repository !== 'eky-software/eky' || server !== 'https://github.com') throw new Error(denied);
  const options = { errorCode: denied, maximumBytes };
  const pkg = parseStrictJsonObjectBytes(packageBytes, options);
  const release = parseStrictJsonObjectBytes(releaseBytes, options);
  if (pkg.name !== '@eky/desktop' || pkg.private !== true || pkg.version !== publicVersion ||
      release.appIdentity !== 'Eky' || release.appVersion !== publicVersion ||
      release.msiProductVersion !== publicVersion || release.platform !== 'win32' ||
      release.architecture !== 'x64' || release.releaseChannel !== 'pilot') throw new Error(denied);
}

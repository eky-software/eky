import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { LocalUnsignedPilotUpdatePackageManifest } from './updatePackageManifest.js';
import type { WindowsInstallerIdentity } from './windowsInstallerIdentity.js';

export type LocalUpdatePackageRole = 'candidate' | 'current';
export type LocalUpdateCacheSlotRole = LocalUpdatePackageRole | 'previous';

export interface TrustedLocalUpdatePackage {
  manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>;
  role: LocalUpdatePackageRole;
}

export interface UpdatePackageTrustPolicy {
  verifyPackage(input: {
    installerIdentity: Readonly<WindowsInstallerIdentity>;
    manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>;
    releaseInfo: Readonly<DesktopReleaseInfo>;
    role: LocalUpdatePackageRole;
  }): Readonly<TrustedLocalUpdatePackage>;
}

export class UpdatePackageTrustError extends Error {
  constructor() {
    super('The local update package is not trusted.');
    this.name = 'UpdatePackageTrustError';
  }
}

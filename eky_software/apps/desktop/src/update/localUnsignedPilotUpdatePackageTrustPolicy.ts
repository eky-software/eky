import { compareSemanticVersions } from './semanticVersionComparison.js';
import {
  type TrustedLocalUpdatePackage,
  type UpdatePackageTrustPolicy,
  UpdatePackageTrustError,
} from './updatePackageTrustPolicy.js';
import { createExpectedWindowsInstallerProductCode } from './windowsInstallerProductCode.js';

export class LocalUnsignedPilotUpdatePackageTrustPolicy
  implements UpdatePackageTrustPolicy
{
  verifyPackage(
    input: Parameters<UpdatePackageTrustPolicy['verifyPackage']>[0],
  ): Readonly<TrustedLocalUpdatePackage> {
    try {
      assertSharedIdentity(input);
      if (input.role === 'current') {
        assertCurrentRelease(input);
      } else {
        assertNewerCandidate(input);
      }
      return Object.freeze({ manifest: input.manifest, role: input.role });
    } catch (error) {
      if (error instanceof UpdatePackageTrustError) {
        throw error;
      }
      throw new UpdatePackageTrustError();
    }
  }
}

export function verifyLocalUnsignedPilotSharedIdentity(
  input: Pick<
    Parameters<UpdatePackageTrustPolicy['verifyPackage']>[0],
    'installerIdentity' | 'manifest' | 'releaseInfo'
  >,
): void {
  try {
    assertSharedIdentity({ ...input, role: 'current' });
  } catch {
    throw new UpdatePackageTrustError();
  }
}

function assertSharedIdentity(
  input: Parameters<UpdatePackageTrustPolicy['verifyPackage']>[0],
): void {
  const expectedUpgradeCode = `{${input.releaseInfo.upgradeCode}}`;
  const expectedProductCode = `{${createExpectedWindowsInstallerProductCode(
    input.manifest.msiProductVersion,
  )}}`;
  if (
    input.manifest.appIdentity !== input.releaseInfo.appIdentity ||
    input.manifest.architecture !== input.releaseInfo.architecture ||
    input.manifest.platform !== input.releaseInfo.platform ||
    input.manifest.releaseChannel !== input.releaseInfo.releaseChannel ||
    input.installerIdentity.architecture !== input.releaseInfo.architecture ||
    input.installerIdentity.packageScope !== 'perUser' ||
    input.installerIdentity.productCode !== expectedProductCode ||
    input.installerIdentity.productVersion !== input.manifest.msiProductVersion ||
    input.installerIdentity.upgradeCode !== expectedUpgradeCode
  ) {
    throw new UpdatePackageTrustError();
  }
}

function assertCurrentRelease(
  input: Parameters<UpdatePackageTrustPolicy['verifyPackage']>[0],
): void {
  if (
    input.manifest.appVersion !== input.releaseInfo.appVersion ||
    input.manifest.buildRevision !== input.releaseInfo.buildRevision ||
    input.manifest.msiProductVersion !== input.releaseInfo.msiProductVersion
  ) {
    throw new UpdatePackageTrustError();
  }
}

function assertNewerCandidate(
  input: Parameters<UpdatePackageTrustPolicy['verifyPackage']>[0],
): void {
  if (
    compareSemanticVersions(
      input.manifest.appVersion,
      input.releaseInfo.appVersion,
    ) <= 0 ||
    compareMsiProductVersions(
      input.manifest.msiProductVersion,
      input.releaseInfo.msiProductVersion,
    ) <= 0
  ) {
    throw new UpdatePackageTrustError();
  }
}

function compareMsiProductVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

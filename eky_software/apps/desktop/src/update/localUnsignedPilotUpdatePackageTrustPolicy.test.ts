import { describe, expect, it } from 'vitest';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { LocalUnsignedPilotUpdatePackageTrustPolicy } from './localUnsignedPilotUpdatePackageTrustPolicy.js';
import type { LocalUnsignedPilotUpdatePackageManifest } from './updatePackageManifest.js';
import { UpdatePackageTrustError } from './updatePackageTrustPolicy.js';
import type { WindowsInstallerIdentity } from './windowsInstallerIdentity.js';
import { createExpectedWindowsInstallerProductCode } from './windowsInstallerProductCode.js';

const releaseInfo: DesktopReleaseInfo = {
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  buildRevision: '123456789abc',
  msiProductVersion: '0.1.1',
  platform: 'win32',
  releaseChannel: 'pilot',
  schemaVersion: 1,
  upgradeCode: '302530B2-D950-41F5-8397-264B485FEE9A',
};
const manifest: LocalUnsignedPilotUpdatePackageManifest = {
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  buildRevision: '123456789abc',
  manifestFormatVersion: 1,
  msiProductVersion: '0.1.1',
  packageFilename: 'Eky-0.1.0-alpha.1-x64.msi',
  packageKind: 'windows-installer-msi',
  packageSha256: 'a'.repeat(64),
  packageSize: 123,
  platform: 'win32',
  releaseChannel: 'pilot',
  signing: {
    publisher: null,
    status: 'unsigned-prototype',
    thumbprint: null,
    timestamped: false,
  },
};
const installerIdentity: WindowsInstallerIdentity = {
  architecture: 'x64',
  packageScope: 'perUser',
  productCode: `{${createExpectedWindowsInstallerProductCode('0.1.1')}}`,
  productVersion: '0.1.1',
  upgradeCode: '{302530B2-D950-41F5-8397-264B485FEE9A}',
};

describe('local unsigned pilot update package trust policy', () => {
  const policy = new LocalUnsignedPilotUpdatePackageTrustPolicy();

  it('accepts only the exact current release for rollback registration', () => {
    expect(
      policy.verifyPackage({
        installerIdentity,
        manifest,
        releaseInfo,
        role: 'current',
      }),
    ).toEqual({ manifest, role: 'current' });

    for (const changedManifest of [
      { ...manifest, appVersion: '0.1.0-alpha.2' },
      { ...manifest, buildRevision: 'abcdef012345' },
      { ...manifest, msiProductVersion: '0.1.2' },
      { ...manifest, packageSha256: 'b'.repeat(64), buildRevision: 'abcdef012345' },
    ]) {
      expect(() =>
        policy.verifyPackage({
          installerIdentity: {
            ...installerIdentity,
            productCode: `{${createExpectedWindowsInstallerProductCode(
              changedManifest.msiProductVersion,
            )}}`,
            productVersion: changedManifest.msiProductVersion,
          },
          manifest: changedManifest as LocalUnsignedPilotUpdatePackageManifest,
          releaseInfo,
          role: 'current',
        }),
      ).toThrow(UpdatePackageTrustError);
    }
  });

  it('accepts only a candidate with newer app and MSI versions', () => {
    const candidate = {
      ...manifest,
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
      packageFilename: 'Eky-0.1.0-alpha.2-x64.msi',
      packageSha256: 'b'.repeat(64),
    } as LocalUnsignedPilotUpdatePackageManifest;
    expect(
      policy.verifyPackage({
        installerIdentity: {
          ...installerIdentity,
          productCode: `{${createExpectedWindowsInstallerProductCode(
            '0.1.2',
          )}}`,
          productVersion: '0.1.2',
        },
        manifest: candidate,
        releaseInfo,
        role: 'candidate',
      }),
    ).toEqual({ manifest: candidate, role: 'candidate' });

    for (const changedManifest of [
      { ...candidate, appVersion: releaseInfo.appVersion },
      { ...candidate, appVersion: '0.0.9' },
      { ...candidate, msiProductVersion: releaseInfo.msiProductVersion },
      { ...candidate, msiProductVersion: '0.1.0' },
    ]) {
      expect(() =>
        policy.verifyPackage({
          installerIdentity: {
            ...installerIdentity,
            productCode: `{${createExpectedWindowsInstallerProductCode(
              changedManifest.msiProductVersion,
            )}}`,
            productVersion: changedManifest.msiProductVersion,
          },
          manifest: changedManifest as LocalUnsignedPilotUpdatePackageManifest,
          releaseInfo,
          role: 'candidate',
        }),
      ).toThrow(UpdatePackageTrustError);
    }
  });

  it('rejects internal identity drift with one safe error', () => {
    for (const changedIdentity of [
      { ...installerIdentity, packageScope: 'perMachine' },
      { ...installerIdentity, architecture: 'x86' },
      { ...installerIdentity, productVersion: '0.1.2' },
      {
        ...installerIdentity,
        productCode: '{02F99C94-ECBD-48A4-8117-1DE7F55C1E09}',
      },
      {
        ...installerIdentity,
        upgradeCode: '{02F99C94-ECBD-48A4-8117-1DE7F55C1E09}',
      },
    ]) {
      expect(() =>
        policy.verifyPackage({
          installerIdentity: changedIdentity as WindowsInstallerIdentity,
          manifest,
          releaseInfo,
          role: 'current',
        }),
      ).toThrow(UpdatePackageTrustError);
    }
  });
});

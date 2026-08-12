import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPackagedUpdateFixturePackage } from './preparePackagedUpdateE2eFixture.mjs';
import {
  getWindowsUpdateFixtureDefinition,
  windowsUpdateFixtureNames,
} from '../../scripts/windows-update-package-fixture.mjs';

describe('packaged update E2E fixture', () => {
  it('uses one strict set of package fixture identities', () => {
    assert.deepEqual(windowsUpdateFixtureNames, ['current', 'next', 'failure']);
    assert.deepEqual(getWindowsUpdateFixtureDefinition('next'), {
      appVersion: '0.0.0-update-fixture.2',
      migrationMode: 'complete',
      msiProductVersion: '0.0.2',
    });
    assert.throws(
      () => getWindowsUpdateFixtureDefinition('custom'),
      /WINDOWS_UPDATE_FIXTURE_NAME_INVALID/,
    );
  });

  it('retains the exact inspected MSI and release identities', () => {
    assert.deepEqual(
      createPackagedUpdateFixturePackage({
        applicationPath: 'C:\\fixture\\Eky-win32-x64',
        installer: {
          installerPath: 'C:\\fixture\\Eky-0.0.0-update-fixture.2-x64.msi',
          manifestPath: 'C:\\fixture\\Eky-0.0.0-update-fixture.2-x64.manifest.json',
          manifest: {
            appVersion: '0.0.0-update-fixture.2',
            msiProductVersion: '0.0.2',
            packageSha256: 'a'.repeat(64),
            packageSize: 123,
          },
          productCode: 'product-code',
          release: {
            appVersion: '0.0.0-update-fixture.2',
            msiProductVersion: '0.0.2',
          },
        },
      }),
      {
        appVersion: '0.0.0-update-fixture.2',
        applicationPath: 'C:\\fixture\\Eky-win32-x64',
        manifestPath: 'C:\\fixture\\Eky-0.0.0-update-fixture.2-x64.manifest.json',
        msiPath: 'C:\\fixture\\Eky-0.0.0-update-fixture.2-x64.msi',
        msiProductVersion: '0.0.2',
        packageSha256: 'a'.repeat(64),
        packageSize: 123,
        productCode: 'product-code',
      },
    );
  });

  it('rejects mismatched manifest and release identities', () => {
    assert.throws(
      () =>
        createPackagedUpdateFixturePackage({
          applicationPath: 'C:\\fixture',
          installer: {
            manifest: {
              appVersion: '0.0.0-update-fixture.1',
              msiProductVersion: '0.0.1',
            },
            release: {
              appVersion: '0.0.0-update-fixture.2',
              msiProductVersion: '0.0.2',
            },
          },
        }),
      /PACKAGED_UPDATE_E2E_RELEASE_IDENTITY_MISMATCH/,
    );
  });
});

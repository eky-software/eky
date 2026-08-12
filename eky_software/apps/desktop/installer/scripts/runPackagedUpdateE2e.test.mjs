import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPackagedUpdateSmokeInvocation,
  createWindowsInstallerArguments,
  formatWindowsInstallerProductCode,
} from './runPackagedUpdateE2e.mjs';

describe('packaged update E2E runner boundaries', () => {
  it('uses argument arrays for quiet non-restarting MSI operations', () => {
    assert.deepEqual(
      createWindowsInstallerArguments({
        logPath: 'C:\\safe root\\install.log',
        operation: 'install',
        packageOrProductCode: 'C:\\safe root\\Eky.msi',
      }),
      [
        '/i',
        'C:\\safe root\\Eky.msi',
        '/qn',
        '/norestart',
        '/l*v',
        'C:\\safe root\\install.log',
      ],
    );
    assert.equal(
      createWindowsInstallerArguments({
        logPath: 'C:\\logs\\uninstall.log',
        operation: 'uninstall',
        packageOrProductCode: '{00000000-0000-4000-8000-000000000001}',
      })[0],
      '/x',
    );
  });

  it('formats only the repository product-code identity for msiexec', () => {
    assert.equal(
      formatWindowsInstallerProductCode(
        'd927d245-1b81-574c-9e2d-d89a4c140bde',
      ),
      '{D927D245-1B81-574C-9E2D-D89A4C140BDE}',
    );
    assert.throws(
      () =>
        formatWindowsInstallerProductCode(
          '{D927D245-1B81-574C-9E2D-D89A4C140BDE}',
        ),
      /PACKAGED_UPDATE_E2E_PRODUCT_CODE_INVALID/,
    );
  });

  it('passes only a reviewed phase and token to the packaged application', () => {
    assert.deepEqual(
      createPackagedUpdateSmokeInvocation(
        'verifyDirectFailure',
        'a'.repeat(32),
      ),
      {
        args: ['--desktop-update-smoke=verifyDirectFailure'],
        environment: { EKY_DESKTOP_UPDATE_SMOKE_TOKEN: 'a'.repeat(32) },
      },
    );
    assert.throws(
      () => createPackagedUpdateSmokeInvocation('--inspect', 'a'.repeat(32)),
      /PACKAGED_UPDATE_E2E_INVOCATION_INVALID/,
    );
    assert.throws(
      () => createPackagedUpdateSmokeInvocation('seed', 'not-a-token'),
      /PACKAGED_UPDATE_E2E_INVOCATION_INVALID/,
    );
  });
});

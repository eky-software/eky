import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertPackagedUpdateSmokeResultStatus,
  createPackagedUpdateSmokeInvocation,
  createWindowsInstallerArguments,
  directoryInventoriesEqual,
  formatWindowsInstallerProductCode,
  validateApplicationPhaseOutcome,
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

  it('recognizes only an exact installed fixture inventory', () => {
    const expected = new Map([
      ['Eky.exe', 'a'.repeat(64)],
      ['resources/app.asar', 'b'.repeat(64)],
    ]);

    assert.equal(directoryInventoriesEqual(expected, new Map(expected)), true);
    assert.equal(
      directoryInventoriesEqual(
        expected,
        new Map([
          ['Eky.exe', 'a'.repeat(64)],
          ['resources/app.asar', 'c'.repeat(64)],
        ]),
      ),
      false,
    );
    assert.equal(
      directoryInventoriesEqual(
        expected,
        new Map([...expected, ['unknown.dll', 'd'.repeat(64)]]),
      ),
      false,
    );
  });

  it('preserves a safe application failure code in status diagnostics', () => {
    assert.doesNotThrow(() =>
      assertPackagedUpdateSmokeResultStatus(
        { appVersion: '1.2.3', phase: 'prepareSuccess', status: 'handoffReady' },
        'handoffReady',
      ),
    );
    assert.throws(
      () =>
        assertPackagedUpdateSmokeResultStatus(
          {
            code: 'DESKTOP_UPDATE_SMOKE_PREPARE_FAILED',
            phase: 'prepareSuccess',
            status: 'failed',
          },
          'handoffReady',
        ),
      /PACKAGED_UPDATE_E2E_APPLICATION_DESKTOP_UPDATE_SMOKE_PREPARE_FAILED/,
    );
    assert.throws(
      () =>
        assertPackagedUpdateSmokeResultStatus(
          {
            code: 'DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED',
            failureStage: 'preMigrationCoordinatedPackageValidation',
            phase: 'verifySuccess',
            status: 'failed',
          },
          'ok',
        ),
      /PACKAGED_UPDATE_E2E_APPLICATION_DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED_AT_preMigrationCoordinatedPackageValidation/,
    );
  });

  it('accepts a missing transitional result only after a clean application exit', () => {
    assert.equal(
      validateApplicationPhaseOutcome({
        allowNoResult: true,
        exit: { code: 0, signal: null },
        result: undefined,
      }),
      undefined,
    );
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          allowNoResult: true,
          exit: { code: 1, signal: null },
          result: undefined,
        }),
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID/,
    );
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          allowNoResult: true,
          exit: { code: 0, signal: 'SIGTERM' },
          result: undefined,
        }),
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID/,
    );
  });

  it('requires a clean exit even when the application wrote a failed result', () => {
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          exit: { code: 1, signal: null },
          result: {
            code: 'DESKTOP_UPDATE_SMOKE_SYNTHETIC_FAILURE',
            phase: 'verifyRollback',
            status: 'failed',
          },
        }),
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID/,
    );
  });
});

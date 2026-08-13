import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertOkResult,
  assertPackagedUpdateSmokeResultStatus,
  createPackagedUpdateSmokeInvocation,
  createWindowsInstallerArguments,
  directoryInventoriesEqual,
  formatWindowsInstallerProductCode,
  readPackagedUpdateE2eArguments,
  readApplicationResultAfterProcessCleanup,
  validateApplicationPhaseOutcome,
} from './runPackagedUpdateE2e.mjs';

describe('packaged update E2E runner boundaries', () => {
  it('accepts only closed local diagnostic scenario arguments', () => {
    assert.deepEqual(readPackagedUpdateE2eArguments([]), {
      reusePreparedFixture: false,
      scenario: undefined,
    });
    assert.deepEqual(
      readPackagedUpdateE2eArguments([
        '--scenario=coordinatedRollback',
        '--reuse-prepared-fixture',
      ]),
      { reusePreparedFixture: true, scenario: 'coordinatedRollback' },
    );
    assert.deepEqual(
      readPackagedUpdateE2eArguments([
        '--scenario=backupForwardRestore',
        '--reuse-prepared-fixture',
      ]),
      { reusePreparedFixture: true, scenario: 'backupForwardRestore' },
    );
    for (const argumentsValue of [
      ['--scenario=coordinatedRollback'],
      ['--scenario=backupForwardRestore'],
      ['--scenario=coordinatedSuccess'],
      ['--scenario=unknown'],
      ['--scenario=coordinatedRollback', '--verbose'],
      ['--reuse-prepared-fixture', '--scenario=coordinatedRollback'],
      ['C:\\private\\fixture.json'],
    ]) {
      assert.throws(
        () => readPackagedUpdateE2eArguments(argumentsValue),
        /PACKAGED_UPDATE_E2E_ARGUMENTS_INVALID/,
      );
    }
  });

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

  it('requires the expected canonical business-data fingerprint', () => {
    const result = {
      acceptedVersion: '1.2.3',
      appVersion: '1.2.3',
      artifactCount: 1,
      businessDataSha256: 'a'.repeat(64),
      journalState: null,
      migrationChainIdentity: 'b'.repeat(64),
      pdfSha256: 'c'.repeat(64),
      phase: 'verifyRollback',
      secretConfigured: true,
      status: 'ok',
    };

    assert.doesNotThrow(() =>
      assertOkResult(result, {
        appVersion: '1.2.3',
        businessDataSha256: 'a'.repeat(64),
        journalState: null,
      }),
    );
    assert.throws(
      () =>
        assertOkResult(result, {
          appVersion: '1.2.3',
          businessDataSha256: 'd'.repeat(64),
          journalState: null,
        }),
      /PACKAGED_UPDATE_E2E_RESULT_BUSINESS_DATA_INVALID/,
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
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_NONZERO/,
    );
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          allowNoResult: true,
          exit: { code: 0, signal: 'SIGTERM' },
          result: undefined,
        }),
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_SIGNALLED/,
    );
  });

  it('reads a late application result only after the full process tree has exited', async () => {
    const events = [];
    const expectedResult = {
      code: 'DESKTOP_UPDATE_SMOKE_SYNTHETIC_FAILURE',
      phase: 'verifyRollback',
      status: 'failed',
    };

    const result = await readApplicationResultAfterProcessCleanup({
      initialResult: undefined,
      async readResult() {
        events.push('read');
        assert.deepEqual(events, ['cleanup', 'read']);
        return expectedResult;
      },
      async waitForProcessCleanup() {
        events.push('cleanup');
      },
    });

    assert.equal(result, expectedResult);
    assert.deepEqual(events, ['cleanup', 'read']);
  });

  it('does not reread an application result that was already observed', async () => {
    const expectedResult = {
      appVersion: '1.2.3',
      phase: 'verifySuccess',
      status: 'ok',
    };
    let readCount = 0;
    let cleanupCount = 0;

    const result = await readApplicationResultAfterProcessCleanup({
      initialResult: expectedResult,
      async readResult() {
        readCount += 1;
        return undefined;
      },
      async waitForProcessCleanup() {
        cleanupCount += 1;
      },
    });

    assert.equal(result, expectedResult);
    assert.equal(cleanupCount, 1);
    assert.equal(readCount, 0);
  });

  it('preserves a reviewed failure stage when the application reports a safe failure', () => {
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          exit: { code: 1, signal: null },
          result: {
            code: 'DESKTOP_UPDATE_SMOKE_SYNTHETIC_FAILURE',
            failureStage: 'preMigrationInstallerNotApplied',
            phase: 'verifyRollback',
            status: 'failed',
          },
        }),
      (error) => {
        assert.equal(
          error.message,
          'PACKAGED_UPDATE_E2E_APPLICATION_REPORTED_FAILURE',
        );
        assert.equal(
          error.failureStage,
          'preMigrationInstallerNotApplied',
        );
        return true;
      },
    );
  });

  it('does not preserve an unreviewed application failure stage', () => {
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          exit: { code: 1, signal: null },
          result: {
            code: 'DESKTOP_UPDATE_SMOKE_SYNTHETIC_FAILURE',
            failureStage: 'C:\\private\\profile',
            phase: 'verifyRollback',
            status: 'failed',
          },
        }),
      (error) => {
        assert.equal(
          error.message,
          'PACKAGED_UPDATE_E2E_APPLICATION_REPORTED_FAILURE',
        );
        assert.equal(error.failureStage, undefined);
        return true;
      },
    );
  });

  it('accepts an expected reported failure only after a clean application exit', () => {
    const result = {
      code: 'DESKTOP_UPDATE_SMOKE_SYNTHETIC_FAILURE',
      failureStage: 'preMigrationInstallerNotApplied',
      phase: 'verifyRollback',
      status: 'failed',
    };

    assert.equal(
      validateApplicationPhaseOutcome({
        exit: { code: 0, signal: null },
        expectReportedFailure: true,
        result,
      }),
      result,
    );
    assert.throws(
      () =>
        validateApplicationPhaseOutcome({
          exit: { code: 1, signal: null },
          expectReportedFailure: true,
          result,
        }),
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_NONZERO/,
    );
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveUpgradeRollbackTerminalOutcome,
  upgradeRollbackFailureDetails,
} from './upgradeRollbackFailureBoundary.mjs';

function supervisor(overrides = {}) {
  return Object.freeze({
    status: 'completed',
    processResultCode: 'processCompleted',
    workerResultCode: 'workerResultValidated',
    cleanupResultCode: 'notRequired',
    processTreeAbsent: true,
    ...overrides,
  });
}

function scenario(overrides = {}) {
  return Object.freeze({
    status: 'completed',
    resultCode: 'upgradeRollbackCompleted',
    errorCode: null,
    cleanupResultCode: 'notRequired',
    ...overrides,
  });
}

function products(
  resultCode = 'exactProductsAbsent',
  installerRegistryPresent = resultCode !== 'exactProductsAbsent',
) {
  return Object.freeze({
    status: 'completed',
    resultCode,
    sourcePresent: ['sourceProductPresent', 'multipleProductsPresent'].includes(
      resultCode,
    ),
    targetPresent: ['targetProductPresent', 'multipleProductsPresent'].includes(
      resultCode,
    ),
    installerRegistryPresent,
  });
}

test('completed supervisor requires a completed scenario and absent products', async () => {
  const expected = scenario();
  const result = await resolveUpgradeRollbackTerminalOutcome({
    supervisorResult: supervisor(),
    readScenarioResult: async () => expected,
    verifyExactProductStates: async () => products(),
    cleanupExactProducts: async () => {
      throw new Error('cleanup must not run');
    },
  });
  assert.equal(result, expected);
});

test('deadline remains primary while cleanup and postcondition stay separate', async () => {
  const inspections = [
    products('targetProductPresent'),
    products(),
  ];
  let cleanupCount = 0;
  await assert.rejects(
    resolveUpgradeRollbackTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        processResultCode: 'deadlineExceeded',
        workerResultCode: 'notChecked',
        cleanupResultCode: 'processTreeAbsent',
      }),
      readScenarioResult: async () => {
        throw new Error('missing');
      },
      verifyExactProductStates: async () => inspections.shift(),
      cleanupExactProducts: async () => {
        cleanupCount += 1;
        return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
      },
    }),
    (error) => {
      const details = upgradeRollbackFailureDetails(error);
      assert.equal(
        details.errorCode,
        'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
      );
      assert.equal(details.scenarioResultCode, 'notAvailable');
      assert.equal(details.initialProductStateResultCode, 'targetProductPresent');
      assert.equal(details.semanticCleanupResultCode, 'semanticCleanupCompleted');
      assert.equal(
        details.postconditionResultCode,
        'exactProductsAbsentAfterCleanup',
      );
      return true;
    },
  );
  assert.equal(cleanupCount, 1);
});

test('worker scenario failure stays primary when semantic cleanup fails', async () => {
  const failedScenario = scenario({
    status: 'failed',
    resultCode: 'upgradeRollbackFailed',
    errorCode: 'majorUpgradeFailed',
    cleanupResultCode: 'cleanupFailed',
  });
  await assert.rejects(
    resolveUpgradeRollbackTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        workerResultCode: 'workerReportedFailure',
      }),
      readScenarioResult: async () => failedScenario,
      verifyExactProductStates: async () => products('sourceProductPresent'),
      cleanupExactProducts: async () => ({
        status: 'failed',
        errorCode: 'semanticCleanupFailed',
      }),
    }),
    (error) => {
      const details = upgradeRollbackFailureDetails(error);
      assert.equal(
        details.errorCode,
        'WINDOWS_ACCEPTANCE_UPGRADE_MAJOR_UPGRADE_FAILED',
      );
      assert.equal(details.semanticCleanupResultCode, 'semanticCleanupFailed');
      assert.equal(details.postconditionResultCode, 'sourceProductPresent');
      return true;
    },
  );
});

test('binary rollback input category crosses the safe command boundary', async () => {
  await assert.rejects(
    resolveUpgradeRollbackTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        workerResultCode: 'workerReportedFailure',
      }),
      readScenarioResult: async () =>
        scenario({
          status: 'failed',
          resultCode: 'upgradeRollbackFailed',
          errorCode: 'binaryRollbackTargetPackagePathInvalid',
        }),
      verifyExactProductStates: async () => products('targetProductPresent'),
      cleanupExactProducts: async () => ({
        status: 'failed',
        errorCode: 'semanticCleanupFailed',
      }),
    }),
    (error) => {
      assert.equal(
        upgradeRollbackFailureDetails(error).errorCode,
        'WINDOWS_ACCEPTANCE_UPGRADE_BINARY_ROLLBACK_TARGET_PATH_INVALID',
      );
      return true;
    },
  );
});

test('owned process tree blocks semantic cleanup without masking failure', async () => {
  let cleanupCount = 0;
  await assert.rejects(
    resolveUpgradeRollbackTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        processResultCode: 'processExitFailed',
        workerResultCode: 'notChecked',
        processTreeAbsent: false,
      }),
      readScenarioResult: async () => scenario(),
      verifyExactProductStates: async () => products('multipleProductsPresent'),
      cleanupExactProducts: async () => {
        cleanupCount += 1;
      },
    }),
    (error) => {
      const details = upgradeRollbackFailureDetails(error);
      assert.equal(
        details.errorCode,
        'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_EXIT_FAILED',
      );
      assert.equal(details.semanticCleanupResultCode, 'blockedByOwnedProcessTree');
      assert.equal(details.postconditionResultCode, 'notChecked');
      return true;
    },
  );
  assert.equal(cleanupCount, 0);
});

test('precondition failure never cleans a pre-existing exact product', async () => {
  let cleanupCount = 0;
  await assert.rejects(
    resolveUpgradeRollbackTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        workerResultCode: 'workerReportedFailure',
      }),
      readScenarioResult: async () =>
        scenario({
          status: 'failed',
          resultCode: 'upgradeRollbackFailed',
          errorCode: 'upgradeLifecyclePreconditionFailed',
        }),
      verifyExactProductStates: async () => products('sourceProductPresent'),
      cleanupExactProducts: async () => {
        cleanupCount += 1;
      },
    }),
    (error) => {
      const details = upgradeRollbackFailureDetails(error);
      assert.equal(
        details.errorCode,
        'WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED',
      );
      assert.equal(details.initialProductStateResultCode, 'sourceProductPresent');
      assert.equal(details.semanticCleanupResultCode, 'blockedByPrecondition');
      assert.equal(details.postconditionResultCode, 'sourceProductPresent');
      return true;
    },
  );
  assert.equal(cleanupCount, 0);
});

test('successful worker with a remaining product fails the independent postcondition', async () => {
  const inspections = [products('sourceProductPresent'), products()];
  await assert.rejects(
    resolveUpgradeRollbackTerminalOutcome({
      supervisorResult: supervisor(),
      readScenarioResult: async () => scenario(),
      verifyExactProductStates: async () => inspections.shift(),
      cleanupExactProducts: async () => ({
        status: 'completed',
        resultCode: 'semanticCleanupCompleted',
      }),
    }),
    (error) => {
      const details = upgradeRollbackFailureDetails(error);
      assert.equal(
        details.errorCode,
        'WINDOWS_ACCEPTANCE_UPGRADE_POSTCONDITION_FAILED',
      );
      assert.equal(
        details.postconditionResultCode,
        'exactProductsAbsentAfterCleanup',
      );
      return true;
    },
  );
});

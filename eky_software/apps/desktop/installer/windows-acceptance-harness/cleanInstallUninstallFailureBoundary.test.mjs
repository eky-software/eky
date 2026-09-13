import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CleanInstallUninstallCommandFailure,
  prepareCleanInstallUninstallTerminalOutcome,
  completeCleanInstallUninstallTerminalOutcome,
  resolveCleanInstallUninstallTerminalOutcome,
} from './cleanInstallUninstallFailureBoundary.mjs';

function failedSupervisor(overrides = {}) {
  return Object.freeze({
    status: 'failed',
    processResultCode: 'deadlineExceeded',
    workerResultCode: 'notChecked',
    cleanupResultCode: 'processTreeAbsent',
    processTreeAbsent: true,
    ...overrides,
  });
}

async function captureFailure(options) {
  try {
    await resolveCleanInstallUninstallTerminalOutcome(options);
    assert.fail('expected a terminal failure');
  } catch (error) {
    assert.ok(error instanceof CleanInstallUninstallCommandFailure);
    return error.details;
  }
}

test('missing scenario result cannot mask a supervisor deadline', async () => {
  let scenarioReadCount = 0;
  const details = await captureFailure({
    supervisorResult: failedSupervisor(),
    async readScenarioResult() {
      scenarioReadCount += 1;
      throw new Error('missing');
    },
    async verifyExactProductState() {
      return {
        status: 'completed',
        resultCode: 'exactProductAbsent',
        exactProductPresent: false,
      };
    },
    async cleanupExactProduct() {
      assert.fail('cleanup must not run for an absent product');
    },
  });

  assert.equal(scenarioReadCount, 0);
  assert.equal(
    details.errorCode,
    'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  );
  assert.equal(details.supervisorProcessResultCode, 'deadlineExceeded');
  assert.equal(details.productStateVerificationResultCode, 'exactProductAbsent');
  assert.equal(details.semanticCleanupResultCode, 'notRequired');
});

test('cleanup decision is separate from execution and requires its verified final result', async () => {
  const plan = await prepareCleanInstallUninstallTerminalOutcome({ supervisorResult: failedSupervisor(),
    readScenarioResult: async () => assert.fail('deadline is primary'),
    verifyExactProductState: async () => ({ status: 'completed', resultCode: 'exactProductPresent', exactProductPresent: true }) });
  assert.equal(plan.cleanupAction, 'cleanupThenVerify');
  for (const cleanup of [undefined, { status: 'failed', errorCode: 'semanticCleanupTimedOut' }]) {
    assert.throws(() => completeCleanInstallUninstallTerminalOutcome(plan, { cleanup }), (error) => {
      assert.equal(error.details.errorCode, 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
      assert.notEqual(error.details.semanticCleanupResultCode, 'semanticCleanupCompleted');
      return true;
    });
  }
  assert.throws(() => completeCleanInstallUninstallTerminalOutcome(plan, {
    cleanup: { status: 'completed', resultCode: 'semanticCleanupCompleted' },
    postcondition: { status: 'completed', resultCode: 'exactProductPresent', exactProductPresent: true },
  }), (error) => error.details.semanticCleanupResultCode === 'semanticCleanupPostconditionFailed');
});

test('missing result after a completed supervisor does not authorize product removal', async () => {
  const details = await captureFailure({ supervisorResult: failedSupervisor({ status: 'completed', processResultCode: 'processCompleted' }),
    readScenarioResult: async () => { throw new Error('missing'); },
    verifyExactProductState: async () => assert.fail('missing result is not cleanup authority'),
    cleanupExactProduct: async () => assert.fail('missing result is not cleanup authority') });
  assert.equal(details.errorCode, 'WINDOWS_ACCEPTANCE_CLEAN_RESULT_MISSING_OR_INVALID');
  assert.equal(details.scenarioResultCode, 'missingOrInvalid');
});

test('hard timeout verifies and removes only the exact present product', async () => {
  let inspectionCount = 0;
  let cleanupCount = 0;
  const details = await captureFailure({
    supervisorResult: failedSupervisor(),
    async readScenarioResult() {
      assert.fail('deadline must not depend on a scenario result');
    },
    async verifyExactProductState() {
      inspectionCount += 1;
      return inspectionCount === 1
        ? {
            status: 'completed',
            resultCode: 'exactProductPresent',
            exactProductPresent: true,
          }
        : {
            status: 'completed',
            resultCode: 'exactProductAbsent',
            exactProductPresent: false,
          };
    },
    async cleanupExactProduct() {
      cleanupCount += 1;
      return {
        status: 'completed',
        resultCode: 'semanticCleanupCompleted',
      };
    },
  });

  assert.equal(inspectionCount, 2);
  assert.equal(cleanupCount, 1);
  assert.equal(
    details.errorCode,
    'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  );
  assert.equal(
    details.productStateVerificationResultCode,
    'exactProductAbsentAfterCleanup',
  );
  assert.equal(details.semanticCleanupResultCode, 'semanticCleanupCompleted');
});

test('semantic cleanup failure remains separate from the primary failure', async () => {
  const details = await captureFailure({
    supervisorResult: failedSupervisor(),
    async readScenarioResult() {
      assert.fail('deadline must not depend on a scenario result');
    },
    async verifyExactProductState() {
      return {
        status: 'completed',
        resultCode: 'exactProductPresent',
        exactProductPresent: true,
      };
    },
    async cleanupExactProduct() {
      return { status: 'failed', errorCode: 'semanticCleanupTimedOut' };
    },
  });

  assert.equal(
    details.errorCode,
    'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  );
  assert.equal(details.semanticCleanupResultCode, 'semanticCleanupTimedOut');
});

test('semantic cleanup is blocked while the owned process tree remains', async () => {
  let cleanupCount = 0;
  const details = await captureFailure({
    supervisorResult: failedSupervisor({
      cleanupResultCode: 'cleanupFailed',
      processTreeAbsent: false,
    }),
    async readScenarioResult() {
      assert.fail('deadline must not depend on a scenario result');
    },
    async verifyExactProductState() {
      return {
        status: 'completed',
        resultCode: 'exactProductPresent',
        exactProductPresent: true,
      };
    },
    async cleanupExactProduct() {
      cleanupCount += 1;
    },
  });

  assert.equal(cleanupCount, 0);
  assert.equal(details.supervisorCleanupResultCode, 'cleanupFailed');
  assert.equal(details.semanticCleanupResultCode, 'blockedByOwnedProcessTree');
});

test('worker-reported scenario failure stays primary when its result exists', async () => {
  let inspectionCount = 0;
  const details = await captureFailure({
    supervisorResult: failedSupervisor({
      processResultCode: 'processCompleted',
      workerResultCode: 'workerReportedFailure',
      cleanupResultCode: 'notRequired',
    }),
    async readScenarioResult() {
      return {
        status: 'failed',
        resultCode: 'cleanInstallUninstallFailed',
        errorCode: 'cleanInstallFailed',
        cleanupResultCode: 'cleanupCompleted',
      };
    },
    async verifyExactProductState() {
      inspectionCount += 1;
      return {
        status: 'completed',
        resultCode: 'exactProductAbsent',
        exactProductPresent: false,
      };
    },
    async cleanupExactProduct() {
      assert.fail('cleanup must not run for an absent product');
    },
  });

  assert.equal(inspectionCount, 1);
  assert.equal(details.errorCode, 'WINDOWS_ACCEPTANCE_CLEAN_INSTALL_FAILED');
  assert.equal(details.scenarioResultCode, 'cleanInstallUninstallFailed');
  assert.equal(details.supervisorProcessResultCode, 'processCompleted');
});

test('completed supervisor still requires the bound scenario result', async () => {
  const result = {
    status: 'completed',
    resultCode: 'cleanInstallUninstallCompleted',
  };
  assert.equal(
    await resolveCleanInstallUninstallTerminalOutcome({
      supervisorResult: { status: 'completed' },
      async readScenarioResult() {
        return result;
      },
      async verifyExactProductState() {
        assert.fail('post-supervisor recovery is failure-only');
      },
      async cleanupExactProduct() {
        assert.fail('post-supervisor recovery is failure-only');
      },
    }),
    result,
  );
});

test('worker precondition rejection cannot authorize removal of an existing product', async () => {
  const details = await captureFailure({
    supervisorResult: failedSupervisor({ processResultCode: 'processCompleted', workerResultCode: 'workerReportedFailure' }),
    readScenarioResult: async () => ({ status: 'failed', resultCode: 'cleanInstallUninstallFailed',
      errorCode: 'cleanLifecyclePreconditionFailed', cleanupResultCode: 'notRequired' }),
    verifyExactProductState: async () => assert.fail('precondition rejection is not recovery authority'),
    cleanupExactProduct: async () => assert.fail('existing installation is not owned'),
  });
  assert.equal(details.errorCode, 'WINDOWS_ACCEPTANCE_CLEAN_PRECONDITION_FAILED');
  assert.equal(details.semanticCleanupResultCode, 'blockedByPrecondition');
});

test('repair failure remains the primary command error after successful cleanup', async () => {
  const details = await captureFailure({
    supervisorResult: failedSupervisor({ processResultCode: 'processCompleted', workerResultCode: 'workerReportedFailure' }),
    readScenarioResult: async () => ({ status: 'failed', resultCode: 'cleanInstallUninstallFailed',
      errorCode: 'cleanRepairFailed', cleanupResultCode: 'cleanupCompleted' }),
    verifyExactProductState: async () => ({ status: 'completed', resultCode: 'exactProductAbsent', exactProductPresent: false }),
    cleanupExactProduct: async () => assert.fail('already absent'),
  });
  assert.equal(details.errorCode, 'WINDOWS_ACCEPTANCE_CLEAN_REPAIR_FAILED');
  assert.equal(details.supervisorProcessResultCode, 'processCompleted');
});

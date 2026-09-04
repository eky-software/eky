import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyUpgradeFailureDetails,
  resolveLegacyUpgradeTerminalOutcome,
} from './legacyUpgradeFailureBoundary.mjs';

function supervisor(overrides = {}) {
  return {
    status: 'completed',
    processResultCode: 'processCompleted',
    workerResultCode: 'workerResultValidated',
    cleanupResultCode: 'notRequired',
    processTreeAbsent: true,
    ...overrides,
  };
}

function scenario(overrides = {}) {
  return {
    status: 'completed',
    resultCode: 'historicalLegacyUpgradeCompleted',
    errorCode: null,
    ...overrides,
  };
}

function products(resultCode) {
  return {
    status: 'completed',
    resultCode,
    sourcePresent: ['sourceProductPresent', 'multipleProductsPresent'].includes(resultCode),
    targetPresent: ['targetProductPresent', 'multipleProductsPresent'].includes(resultCode),
    installerRegistryPresent: resultCode !== 'exactProductsAbsent',
  };
}

test('successful legacy proof validates semantics before exact cleanup', async () => {
  const order = [];
  const inspections = [products('targetProductPresent'), products('exactProductsAbsent')];
  const result = await resolveLegacyUpgradeTerminalOutcome({
    supervisorResult: supervisor(),
    readScenarioResult: async () => scenario(),
    verifyExactProductStates: async () => {
      order.push('inspect');
      return inspections.shift();
    },
    verifySemanticPostcondition: async () => {
      order.push('semantic');
      return { status: 'completed', resultCode: 'legacySemanticProofValidated' };
    },
    cleanupExactProducts: async () => {
      order.push('cleanup');
      return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
    },
  });
  assert.equal(result.semanticProof.resultCode, 'legacySemanticProofValidated');
  assert.deepEqual(order, ['inspect', 'semantic', 'cleanup', 'inspect']);
});

test('semantic proof failure remains primary while cleanup is reported separately', async () => {
  const inspections = [products('targetProductPresent'), products('exactProductsAbsent')];
  await assert.rejects(
    resolveLegacyUpgradeTerminalOutcome({
      supervisorResult: supervisor(),
      readScenarioResult: async () => scenario(),
      verifyExactProductStates: async () => inspections.shift(),
      verifySemanticPostcondition: async () => ({
        status: 'failed',
        errorCode: 'legacySemanticProofFailed',
      }),
      cleanupExactProducts: async () => ({
        status: 'completed',
        resultCode: 'semanticCleanupCompleted',
      }),
    }),
    (error) => {
      const failure = legacyUpgradeFailureDetails(error);
      assert.equal(
        failure.errorCode,
        'WINDOWS_ACCEPTANCE_LEGACY_SEMANTIC_PROOF_FAILED',
      );
      assert.equal(failure.semanticProofResultCode, 'legacySemanticProofFailed');
      assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupCompleted');
      assert.equal(failure.postconditionResultCode, 'exactProductsAbsentAfterCleanup');
      return true;
    },
  );
});

test('supervisor deadline remains primary and cleanup waits for process-tree absence', async () => {
  let cleanupCalls = 0;
  await assert.rejects(
    resolveLegacyUpgradeTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        processResultCode: 'deadlineExceeded',
        workerResultCode: 'notChecked',
        cleanupResultCode: 'cleanupFailed',
        processTreeAbsent: false,
      }),
      readScenarioResult: async () => scenario(),
      verifyExactProductStates: async () => products('sourceProductPresent'),
      verifySemanticPostcondition: async () => ({
        status: 'failed',
        errorCode: 'mustNotRun',
      }),
      cleanupExactProducts: async () => {
        cleanupCalls += 1;
      },
    }),
    (error) => {
      const failure = legacyUpgradeFailureDetails(error);
      assert.equal(
        failure.errorCode,
        'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
      );
      assert.equal(failure.semanticCleanupResultCode, 'blockedByOwnedProcessTree');
      return true;
    },
  );
  assert.equal(cleanupCalls, 0);
});

test('precondition failure never removes a pre-existing installation', async () => {
  let cleanupCalls = 0;
  await assert.rejects(
    resolveLegacyUpgradeTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed',
        workerResultCode: 'workerReportedFailure',
      }),
      readScenarioResult: async () =>
        scenario({
          status: 'failed',
          resultCode: 'historicalLegacyUpgradeFailed',
          errorCode: 'upgradeLifecyclePreconditionFailed',
        }),
      verifyExactProductStates: async () => products('sourceProductPresent'),
      verifySemanticPostcondition: async () => undefined,
      cleanupExactProducts: async () => {
        cleanupCalls += 1;
      },
    }),
    (error) => {
      const failure = legacyUpgradeFailureDetails(error);
      assert.equal(failure.errorCode, 'WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED');
      assert.equal(failure.semanticCleanupResultCode, 'blockedByPrecondition');
      return true;
    },
  );
  assert.equal(cleanupCalls, 0);
});

for (const cleanupFails of [false, true]) {
  test(`worker non-zero exit preserves the scenario error when semantic cleanup ${cleanupFails ? 'fails' : 'succeeds'}`, async () => {
    const inspections = [products('targetProductPresent'), products('exactProductsAbsent')];
    await assert.rejects(resolveLegacyUpgradeTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1,
        workerResultCode: 'notChecked', cleanupResultCode: 'processTreeAbsent',
      }),
      readScenarioResult: async () => scenario({
        status: 'failed', resultCode: 'historicalLegacyUpgradeFailed',
        errorCode: 'targetFirstStartupFailed',
      }),
      verifyExactProductStates: async () => inspections.shift(),
      cleanupExactProducts: async () => cleanupFails
        ? { status: 'failed', errorCode: 'semanticCleanupFailed' }
        : { status: 'completed', resultCode: 'semanticCleanupCompleted' },
    }), (error) => {
      const details = legacyUpgradeFailureDetails(error);
      assert.equal(details.errorCode, 'WINDOWS_ACCEPTANCE_LEGACY_TARGET_FIRST_START_FAILED');
      assert.equal(details.supervisorProcessResultCode, 'processExitFailed');
      assert.equal(details.semanticCleanupResultCode, cleanupFails ? 'semanticCleanupFailed' : 'semanticCleanupCompleted');
      return true;
    });
  });
}

for (const invalidResult of ['missing', 'successful']) {
  test(`a ${invalidResult} scenario result cannot hide the supervisor process failure`, async () => {
    await assert.rejects(resolveLegacyUpgradeTerminalOutcome({
      supervisorResult: supervisor({
        status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1,
        workerResultCode: 'notChecked', cleanupResultCode: 'processTreeAbsent',
      }),
      readScenarioResult: async () => {
        if (invalidResult === 'missing') throw new Error('missing');
        return scenario();
      },
      verifyExactProductStates: async () => products('exactProductsAbsent'),
      cleanupExactProducts: () => assert.fail('No product exists'),
    }), (error) => {
      assert.equal(legacyUpgradeFailureDetails(error).errorCode, 'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_EXIT_FAILED');
      return true;
    });
  });
}

test('non-zero precondition failure does not authorize removal of an existing product', async () => {
  await assert.rejects(resolveLegacyUpgradeTerminalOutcome({
    supervisorResult: supervisor({
      status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1,
      workerResultCode: 'notChecked', cleanupResultCode: 'notRequired',
    }),
    readScenarioResult: async () => scenario({
      status: 'failed', resultCode: 'historicalLegacyUpgradeFailed',
      errorCode: 'upgradeLifecyclePreconditionFailed',
    }),
    verifyExactProductStates: async () => products('sourceProductPresent'),
    cleanupExactProducts: () => assert.fail('Pre-existing product must be preserved'),
  }), (error) => {
    assert.equal(legacyUpgradeFailureDetails(error).semanticCleanupResultCode, 'blockedByPrecondition');
    return true;
  });
});

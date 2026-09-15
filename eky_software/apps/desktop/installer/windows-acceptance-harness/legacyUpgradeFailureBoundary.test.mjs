import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_FOOTPRINT_ERROR_CODES } from './legacyUpgradeContracts.mjs';

import {
  completeLegacyUpgradeTerminalOutcome,
  legacyUpgradeFailureDetails,
  prepareLegacyUpgradeTerminalOutcome,
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

test('legacy terminal preparation is read-only and completion requires both cleanup and final product evidence', async () => {
  const order = [];
  const scenarioResult = scenario();
  const semanticProof = { status: 'completed', resultCode: 'legacySemanticProofValidated' };
  const plan = await prepareLegacyUpgradeTerminalOutcome({
    supervisorResult: supervisor(),
    readScenarioResult: async () => { order.push('scenario'); return scenarioResult; },
    verifyExactProductStates: async () => { order.push('inspect'); return products('targetProductPresent'); },
    verifySemanticPostcondition: async () => { order.push('semantic'); return semanticProof; },
    cleanupExactProducts: () => assert.fail('Preparation must not uninstall'),
  });
  assert.deepEqual(order, ['scenario', 'inspect', 'semantic']);
  assert.equal(plan.cleanupAction, 'cleanupThenVerify');
  const cleanup = { status: 'completed', resultCode: 'semanticCleanupCompleted' };
  assert.throws(() => completeLegacyUpgradeTerminalOutcome(plan), (error) => {
    const failure = legacyUpgradeFailureDetails(error);
    assert.equal(failure.errorCode, 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED');
    assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupFailed');
    assert.equal(failure.postconditionResultCode, 'productStateVerificationFailed');
    return true;
  });
  assert.throws(() => completeLegacyUpgradeTerminalOutcome(plan, { cleanup }), (error) => {
    assert.equal(legacyUpgradeFailureDetails(error).postconditionResultCode, 'productStateVerificationFailed');
    return true;
  });
  assert.deepEqual(completeLegacyUpgradeTerminalOutcome(plan, {
    cleanup, postcondition: products('exactProductsAbsent'),
  }), { scenarioResult, semanticProof });
  assert.deepEqual(order, ['scenario', 'inspect', 'semantic']);
});

test('separated legacy completion preserves the original deadline over uncertain cleanup', async () => {
  const plan = await prepareLegacyUpgradeTerminalOutcome({
    productPrecondition: products('exactProductsAbsent'),
    supervisorResult: supervisor({ status: 'failed', processResultCode: 'deadlineExceeded',
      workerResultCode: 'notChecked', cleanupResultCode: 'processTreeAbsent' }),
    readScenarioResult: () => assert.fail('A deadline does not authorize trusting a partial scenario result'),
    verifyExactProductStates: async () => products('targetProductPresent'),
  });
  assert.equal(plan.cleanupAction, 'cleanupThenVerify');
  assert.throws(() => completeLegacyUpgradeTerminalOutcome(plan, {
    cleanup: { status: 'failed', errorCode: 'semanticCleanupProcessRemains' },
    postcondition: products('exactProductsAbsent'),
  }), (error) => {
    const failure = legacyUpgradeFailureDetails(error);
    assert.equal(failure.errorCode, 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
    assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupProcessRemains');
    assert.equal(failure.postconditionResultCode, 'exactProductsAbsent');
    return true;
  });
});

for (const processTreeAbsent of [false, true]) {
  test(`separated legacy completion cannot lift the cleanup prohibition: processTreeAbsent=${processTreeAbsent}`, async () => {
    const plan = await prepareLegacyUpgradeTerminalOutcome({
      supervisorResult: supervisor({ status: 'failed', processResultCode: 'deadlineExceeded',
        workerResultCode: 'notChecked', cleanupResultCode: processTreeAbsent ? 'processTreeAbsent' : 'cleanupUnverified',
        processTreeAbsent }),
      verifyExactProductStates: async () => {
        assert.equal(processTreeAbsent, true);
        return products('targetProductPresent');
      },
    });
    const blocked = processTreeAbsent ? 'blockedByPrecondition' : 'blockedByOwnedProcessTree';
    assert.equal(plan.cleanupAction, blocked);
    assert.throws(() => completeLegacyUpgradeTerminalOutcome(plan, {
      cleanup: { status: 'completed', resultCode: 'semanticCleanupCompleted' },
      postcondition: products('exactProductsAbsent'),
    }), (error) => {
      const failure = legacyUpgradeFailureDetails(error);
      assert.equal(failure.errorCode, 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
      assert.equal(failure.semanticCleanupResultCode, blocked);
      assert.equal(failure.postconditionResultCode, processTreeAbsent ? 'targetProductPresent' : 'notChecked');
      return true;
    });
  });
}

test('closed footprint cause remains primary after successful semantic cleanup', async () => {
  for (const [errorCode, publicCode] of Object.entries(LEGACY_FOOTPRINT_ERROR_CODES)) {
    const inspections = [products('targetProductPresent'), products('exactProductsAbsent')];
    let cleanupCalls = 0;
    await assert.rejects(resolveLegacyUpgradeTerminalOutcome({
      productPrecondition: products('exactProductsAbsent'),
      supervisorResult: supervisor({
        status: 'failed', processResultCode: 'processExitFailed',
        workerResultCode: 'notChecked', childExitCode: 1,
      }),
      readScenarioResult: async () => scenario({
        status: 'failed', resultCode: 'historicalLegacyUpgradeFailed', errorCode,
      }),
      verifyExactProductStates: async () => inspections.shift(),
      verifySemanticPostcondition: () => assert.fail('No target proof after footprint rejection'),
      cleanupExactProducts: async () => {
        cleanupCalls += 1;
        return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
      },
    }), (error) => {
      const failure = legacyUpgradeFailureDetails(error);
      assert.equal(failure.status, 'failed');
      assert.equal(failure.errorCode, publicCode);
      assert.equal(failure.processTreeAbsent, true);
      assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupCompleted');
      assert.equal(failure.postconditionResultCode, 'exactProductsAbsentAfterCleanup');
      return true;
    });
    assert.equal(cleanupCalls, 1);
  }
});

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
      productPrecondition: products('exactProductsAbsent'),
      supervisorResult: supervisor({
        status: 'failed',
        processResultCode: 'deadlineExceeded',
        workerResultCode: 'notChecked',
        cleanupResultCode: 'cleanupFailed',
        processTreeAbsent: false,
      }),
      readScenarioResult: async () => scenario(),
      verifyExactProductStates: () => assert.fail('Verifier must wait for owned process-tree absence'),
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

for (const supervisorFailed of [false, true]) {
  for (const precondition of [undefined, products('sourceProductPresent'), products('exactProductsAbsent')]) {
    for (const cleanupFails of [false, true]) {
      test(`unreadable scenario: supervisorFailed=${supervisorFailed}, precondition=${precondition?.resultCode}, cleanupFails=${cleanupFails}`, async () => {
        const authorized = precondition?.resultCode === 'exactProductsAbsent';
        const order = [];
        let inspection = 0;
        await assert.rejects(resolveLegacyUpgradeTerminalOutcome({
          productPrecondition: precondition,
          supervisorResult: supervisor(supervisorFailed ? {
            status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1,
            workerResultCode: 'notChecked',
          } : {}),
          readScenarioResult: async () => { throw new Error('private result contents'); },
          verifyExactProductStates: async () => {
            order.push('inspect');
            return products(inspection++ === 0 ? 'targetProductPresent' : 'exactProductsAbsent');
          },
          cleanupExactProducts: async () => {
            order.push('cleanup');
            if (cleanupFails) throw new Error('private cleanup failure');
            return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
          },
          verifySemanticPostcondition: () => assert.fail('No semantic proof without a scenario result'),
        }), (error) => {
          const failure = legacyUpgradeFailureDetails(error);
          assert.equal(failure.errorCode, supervisorFailed
            ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_PROCESS_EXIT_FAILED'
            : 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID');
          assert.equal(failure.scenarioResultCode, 'missingOrInvalid');
          assert.equal(failure.semanticCleanupResultCode, !authorized ? 'blockedByPrecondition'
            : cleanupFails ? 'semanticCleanupFailed' : 'semanticCleanupCompleted');
          assert.doesNotMatch(JSON.stringify(failure), /private/);
          return true;
        });
        assert.deepEqual(order, authorized ? ['inspect', 'cleanup', 'inspect'] : ['inspect']);
      });
    }
  }
}

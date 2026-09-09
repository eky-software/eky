import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireWorkspaceSuccessProductPrecondition, resolveWorkspaceSuccessTerminalOutcome, workspaceSuccessRunRootRemovable,
} from './workspaceSuccessFailureBoundary.mjs';
import { WORKSPACE_SUCCESS_PHASES } from './workspaceSuccessContracts.mjs';

const absent = { status: 'completed', resultCode: 'exactProductsAbsent', sourcePresent: false,
  targetPresent: false, installerRegistryPresent: false };
const target = { ...absent, resultCode: 'targetProductPresent', targetPresent: true, installerRegistryPresent: true };
const supervisor = { status: 'completed', processTreeAbsent: true, processResultCode: 'processCompleted',
  workerResultCode: 'workerResultValidated', cleanupResultCode: 'notRequired', childExitCode: 0 };
const request = { runNonce: 'a'.repeat(64), artifactDescriptorSha256: 'b'.repeat(64) };
const scenario = { ...request, schemaVersion: 1, scenario: 'packagedWorkspaceSuccess',
  status: 'completed', resultCode: 'workspaceSuccessCompleted', errorCode: null, failedPhase: null,
  completedPhases: [...WORKSPACE_SUCCESS_PHASES] };
const failedScenario = { ...scenario, status: 'failed', resultCode: 'workspaceSuccessFailed',
  errorCode: 'firstStartBFailed', failedPhase: 'verifyBFirstStart',
  completedPhases: WORKSPACE_SUCCESS_PHASES.slice(0, WORKSPACE_SUCCESS_PHASES.indexOf('verifyBFirstStart')) };

function fixture(overrides = {}) {
  const calls = [];
  let inspections = 0;
  return { calls, input: {
    request, supervisorResult: supervisor, productPrecondition: absent,
    async readScenarioResult() { calls.push('scenario'); return scenario; },
    async verifyExactProductStates() { calls.push('inspect'); return inspections++ === 0 ? target : absent; },
    async verifySemanticPostcondition() { calls.push('proof'); return { status: 'completed', resultCode: 'workspaceSemanticProofValidated' }; },
    async cleanupExactProducts() { calls.push('cleanup'); return { status: 'completed', resultCode: 'semanticCleanupCompleted' }; },
    async verifyRemovalPostcondition() { calls.push('footprint'); return { status: 'completed', resultCode: 'installerFootprintAbsent' }; },
    ...overrides,
  } };
}

test('success requires semantic proof, exact removal and footprint after an empty Job', async () => {
  const value = fixture();
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.status, 'completed');
  assert.equal(result.errorCode, null);
  assert.deepEqual(value.calls, ['scenario', 'inspect', 'proof', 'cleanup', 'inspect', 'footprint']);
  assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), true);
});

for (const supervisorResult of [null, { ...supervisor, processTreeAbsent: false },
  { ...supervisor, status: 'failed', processTreeAbsent: false,
  processResultCode: 'deadlineExceeded', cleanupResultCode: 'cleanupUnverified' }]) {
  test('missing supervisor or unverified cleanup blocks product queries and preserves the run root', async () => {
    const value = fixture({ supervisorResult });
    const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
    assert.equal(result.status, 'failed');
    assert.equal(typeof result.errorCode, 'string');
    assert.deepEqual(value.calls, []);
    assert.equal(result.semanticCleanupResultCode, 'blockedByOwnedProcessTree');
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), false);
  });
}

test('deadline is retained while exact owned installation is cleaned independently', async () => {
  const value = fixture({ supervisorResult: { ...supervisor, status: 'failed', processResultCode: 'deadlineExceeded',
    workerResultCode: 'notChecked', cleanupResultCode: 'processTreeAbsent', childExitCode: null } });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.errorCode, 'supervisorDeadlineExceeded');
  assert.equal(result.supervisorProcessResultCode, 'deadlineExceeded');
  assert.equal(result.semanticCleanupResultCode, 'semanticCleanupCompleted');
  assert.equal(result.postconditionResultCode, 'exactProductsAbsent');
  assert.deepEqual(value.calls, ['inspect', 'cleanup', 'inspect', 'footprint']);
});

for (const productPrecondition of [undefined, target, { ...absent, targetPresent: true }]) {
  test('missing scenario result never authorizes uninstall without validated absent precondition', async () => {
    const value = fixture({ productPrecondition, async readScenarioResult() { throw new Error('PRIVATE'); } });
    const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
    assert.equal(result.status, 'failed');
    assert.equal(result.scenarioResultCode, 'missingOrInvalid');
    assert.equal(result.semanticCleanupResultCode, 'blockedByPrecondition');
    assert.equal(value.calls.includes('cleanup'), false);
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), false);
  });
}

test('completed supervisor with unreadable scenario still enters controlled exact-product recovery', async () => {
  const value = fixture({ async readScenarioResult() { throw new Error('PRIVATE path'); } });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.errorCode, 'scenarioResultInvalid');
  assert.equal(result.semanticCleanupResultCode, 'semanticCleanupCompleted');
  assert.equal(result.postconditionResultCode, 'exactProductsAbsent');
  assert.equal(value.calls.includes('proof'), false);
});

for (const cleanupResult of [
  { status: 'failed', errorCode: 'semanticCleanupTimedOut' },
  { status: 'failed', errorCode: 'semanticCleanupProcessRemains' },
  { status: 'failed', errorCode: 'PRIVATE path' },
  { status: 'completed', resultCode: 'semanticCleanupCompleted', path: 'PRIVATE' },
]) {
  test('cleanup failure stays failed even when product state is absent', async () => {
    const value = fixture({ async cleanupExactProducts() { return cleanupResult; } });
    const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
    assert.equal(result.status, 'failed');
    assert.equal(result.postconditionResultCode, 'exactProductsAbsent');
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  });
}

test('original worker error survives failed semantic cleanup', async () => {
  const value = fixture({ supervisorResult: { ...supervisor, status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1 },
    async readScenarioResult() { return failedScenario; },
    async cleanupExactProducts() { throw new Error('PRIVATE cleanup'); } });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.errorCode, 'firstStartBFailed');
  assert.equal(result.failedPhase, 'verifyBFirstStart');
  assert.equal(result.semanticCleanupResultCode, 'semanticCleanupFailed');
  assert.equal(result.supervisorProcessResultCode, 'processExitFailed');
  assert.equal(result.semanticProofResultCode, 'notChecked');
});

test('an unverified cleanup process cannot be erased by a later absent product state', async () => {
  const value = fixture({
    async readScenarioResult() { return failedScenario; },
    async cleanupExactProducts() {
      return { status: 'failed', errorCode: 'semanticCleanupProcessRemains' };
    },
  });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'firstStartBFailed');
  assert.equal(result.semanticCleanupResultCode, 'semanticCleanupProcessRemains');
  assert.equal(result.postconditionResultCode, 'exactProductsAbsent');
  assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), false);
});

for (const [errorCode, cleanupFails, expectedCode] of [
  ['sessionProofInvalid', false, 'sessionProofInvalid'],
  ['profileMigrationMismatch', true, 'profileMigrationMismatch'],
  ['sourceInstallFailed', false, 'profileEvidenceInvalid'],
]) {
  test(`semantic rejection retains only its own closed code through cleanup: ${errorCode}`, async () => {
    const value = fixture({
      async verifySemanticPostcondition() { throw new Error(errorCode); },
      async cleanupExactProducts() {
        if (cleanupFails) throw new Error('PRIVATE cleanup');
        return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
      },
    });
    const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, expectedCode);
    assert.equal(result.scenarioResultCode, 'workspaceSuccessCompleted');
    assert.equal(result.semanticProofResultCode, 'workspaceSemanticProofFailed');
    assert.equal(result.semanticCleanupResultCode, cleanupFails ? 'semanticCleanupFailed' : 'semanticCleanupCompleted');
    assert.equal(result.postconditionResultCode, 'exactProductsAbsent');
    assert.equal(result.processTreeAbsent, true);
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), !cleanupFails);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  });
}

test('a failed worker cannot authorize cleanup after a rejected caller precondition', async () => {
  const value = fixture({ productPrecondition: target,
    supervisorResult: { ...supervisor, status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1 },
    async readScenarioResult() { return failedScenario; } });
  const rejected = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.semanticCleanupResultCode, 'blockedByPrecondition');
  assert.equal(rejected.errorCode, 'firstStartBFailed');
  assert.equal(value.calls.filter((call) => call === 'cleanup').length, 0);
});

for (const change of [{ status: 'unknown' }, { path: 'PRIVATE' }, { runNonce: 'c'.repeat(64) }]) {
  test('the terminal boundary validates the scenario binding instead of trusting the reader port', async () => {
    const value = fixture({ async readScenarioResult() { return { ...scenario, ...change }; } });
    const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'scenarioResultInvalid');
    assert.equal(value.calls.includes('proof'), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  });
}

for (const failStage of ['inspect', 'proof', 'cleanup', 'footprint']) {
  test(`a thrown ${failStage} error has a closed result and does not turn green`, async () => {
    const method = { inspect: 'verifyExactProductStates', proof: 'verifySemanticPostcondition',
      cleanup: 'cleanupExactProducts', footprint: 'verifyRemovalPostcondition' }[failStage];
    const value = fixture({ [method]: async () => { throw new Error('PRIVATE'); } });
    const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    if (failStage === 'inspect') assert.equal(value.calls.includes('cleanup'), false);
  });
}

test('wrong product state after cleanup is not removed from the evidence root', async () => {
  const value = fixture({ async verifyExactProductStates() { return target; } });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.errorCode, 'productRemovalUnverified');
  assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), false);
});

test('target product without its installer registration cannot pass the semantic gate', async () => {
  let count = 0;
  const value = fixture({ async verifyExactProductStates() {
    return count++ === 0 ? { ...target, installerRegistryPresent: false } : absent;
  } });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.errorCode, 'targetStateInvalid');
  assert.equal(value.calls.includes('proof'), false);
  assert.equal(result.semanticCleanupResultCode, 'semanticCleanupCompleted');
});

test('precondition preserves a specific bounded inspector failure and rejects contradictory absence', () => {
  assert.equal(requireWorkspaceSuccessProductPrecondition(absent), absent);
  assert.throws(() => requireWorkspaceSuccessProductPrecondition({ status: 'failed', errorCode: 'productStateVerificationTimedOut' }),
    { message: 'productStateVerificationTimedOut' });
  assert.throws(() => requireWorkspaceSuccessProductPrecondition({ ...absent, sourcePresent: true }),
    { message: 'productStateVerificationFailed' });
  assert.throws(() => requireWorkspaceSuccessProductPrecondition(target), { message: 'preconditionFailed' });
});

test('prelaunch fixture cleanup is separate from a launched scenario without terminal evidence', () => {
  assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: false, terminal: null, productProcessAbsent: true }), true);
  assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: null, productProcessAbsent: true }), false);
  for (const productProcessAbsent of [false, undefined]) {
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: false, terminal: null, productProcessAbsent }), false);
  }
});

test('unverified product cleanup blocks the next inspection and preserves the original error', async () => {
  const value = fixture({
    readScenarioResult: async () => failedScenario,
    outcome: () => ({ productProcessAbsent: false }),
    cleanupExactProducts: async () => ({ status: 'failed', errorCode: 'semanticCleanupProcessRemains' }),
  });
  const result = await resolveWorkspaceSuccessTerminalOutcome(value.input);
  assert.equal(result.errorCode, 'firstStartBFailed');
  assert.equal(result.semanticCleanupResultCode, 'semanticCleanupProcessRemains');
  assert.equal(result.postconditionResultCode, 'productStateVerificationProcessRemains');
  assert.deepEqual(value.calls, ['inspect']);
  assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: false }), false);
});

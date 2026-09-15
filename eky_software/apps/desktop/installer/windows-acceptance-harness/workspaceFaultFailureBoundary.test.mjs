import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { WORKSPACE_FAULT_PLANS, createWorkspaceFaultRequest } from './workspaceFaultContracts.mjs';
import { resolveWorkspaceFaultTerminalOutcome, workspaceSuccessRunRootRemovable } from './workspaceSuccessFailureBoundary.mjs';

const absent = { status: 'completed', resultCode: 'exactProductsAbsent', sourcePresent: false,
  targetPresent: false, installerRegistryPresent: false };

function fixture(faultScenario = 'acceptanceInterruption') {
  const calls = [];
  let inspections = 0;
  const request = createWorkspaceFaultRequest({ faultScenario, fixtureRoot: resolve('fixture'),
    buildRevision: 'a'.repeat(40), artifactDescriptorSha256: 'b'.repeat(64) });
  const plan = WORKSPACE_FAULT_PLANS[faultScenario];
  const scenario = { schemaVersion: 1, scenario: request.scenario, faultScenario, runNonce: request.runNonce,
    artifactDescriptorSha256: request.artifactDescriptorSha256, status: 'completed', resultCode: 'workspaceFaultCompleted',
    errorCode: null, failedPhase: null, completedPhases: [...plan.phases] };
  const input = { request, productPrecondition: absent,
    supervisorResult: { status: 'completed', processTreeAbsent: true, processResultCode: 'processCompleted',
      workerResultCode: 'workerResultValidated', cleanupResultCode: 'notRequired', childExitCode: 0 },
    readScenarioResult: async () => { calls.push('scenario'); return scenario; },
    verifyExactProductStates: async () => { calls.push('inspect'); return inspections++ === 0
      ? { ...absent, [`${plan.installedRole}Present`]: true, resultCode: `${plan.installedRole}ProductPresent`, installerRegistryPresent: true } : absent; },
    verifySemanticPostcondition: async () => { calls.push('business'); return { status: 'completed', resultCode: 'workspaceFaultSemanticProofValidated' }; },
    verifySessionPostcondition: async () => { calls.push('sessions'); return { status: 'completed', resultCode: 'workspaceFaultSessionsValidated' }; },
    cleanupExactProducts: async () => { calls.push('cleanup'); return { status: 'completed', resultCode: 'semanticCleanupCompleted' }; },
    verifyRemovalPostcondition: async () => { calls.push('footprint'); return { status: 'completed', resultCode: 'installerFootprintAbsent' }; },
  };
  return { calls, scenario, input, run: () => resolveWorkspaceFaultTerminalOutcome(input) };
}

for (const scenario of Object.keys(WORKSPACE_FAULT_PLANS)) {
  test(`${scenario}: one empty Job, expected installed role, business and sessions, exact uninstall and footprint`, async () => {
    const f = fixture(scenario);
    const result = await f.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.faultScenario, scenario);
    assert.equal(result.semanticProofResultCode, 'workspaceFaultSemanticProofValidated');
    assert.equal(result.sessionProofResultCode, 'workspaceFaultSessionsValidated');
    assert.equal(result.initialProductStateResultCode, `${WORKSPACE_FAULT_PLANS[scenario].installedRole}ProductPresent`);
    assert.deepEqual(f.calls, ['scenario', 'inspect', 'business', 'sessions', 'cleanup', 'inspect', 'footprint']);
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }), true);
  });
}

for (const mode of ['missingSupervisor', 'unverifiedTree', 'deadline', 'missingScenario', 'foreignScenario',
  'noPrecondition', 'foreignPrecondition', 'businessAndSessionsFail', 'sessionsFail', 'cleanupFails', 'workerAndCleanupFail',
  'unknownProductState', 'wrongInstalledRole', 'footprintFails']) {
  test(`fault terminal retains the original result and blocks unsafe cleanup: ${mode}`, async () => {
    const f = fixture('activeWorkspaceFirstStartFailure');
    const { input } = f;
    if (mode === 'missingSupervisor') input.supervisorResult = null;
    if (mode === 'unverifiedTree') Object.assign(input.supervisorResult, {
      status: 'failed', processTreeAbsent: false, processResultCode: 'deadlineExceeded', cleanupResultCode: 'cleanupUnverified',
    });
    if (mode === 'deadline') Object.assign(input.supervisorResult, {
      status: 'failed', processResultCode: 'deadlineExceeded', workerResultCode: 'notChecked', childExitCode: null,
    });
    if (mode === 'missingScenario') input.readScenarioResult = async () => { throw new Error('PRIVATE'); };
    if (mode === 'foreignScenario') f.scenario.faultScenario = 'binaryRollbackFailure';
    if (mode === 'noPrecondition') input.productPrecondition = null;
    if (mode === 'foreignPrecondition') input.productPrecondition = { ...absent,
      sourcePresent: true, installerRegistryPresent: true, resultCode: 'sourceProductPresent' };
    if (mode === 'businessAndSessionsFail') input.verifySemanticPostcondition = async () => { throw new Error('profileBusinessContentChanged'); };
    if (['businessAndSessionsFail', 'sessionsFail'].includes(mode)) input.verifySessionPostcondition = async () => { throw new Error('PRIVATE'); };
    if (['cleanupFails', 'workerAndCleanupFail'].includes(mode)) input.cleanupExactProducts = async () => {
      f.calls.push('cleanup'); return { status: 'failed', errorCode: 'semanticCleanupTimedOut' };
    };
    if (mode === 'workerAndCleanupFail') {
      Object.assign(input.supervisorResult, { status: 'failed', processResultCode: 'processExitFailed', childExitCode: 1 });
      Object.assign(f.scenario, { status: 'failed', resultCode: 'workspaceFaultFailed', errorCode: 'sessionProofInvalid',
        completedPhases: f.scenario.completedPhases.slice(0, 5), failedPhase: 'sourceHandoff' });
    }
    if (mode === 'unknownProductState') input.verifyExactProductStates = async () => ({ status: 'unknown', path: 'PRIVATE' });
    if (mode === 'wrongInstalledRole') {
      let reads = 0;
      input.verifyExactProductStates = async () => reads++ === 0
        ? { ...absent, resultCode: 'targetProductPresent', targetPresent: true, installerRegistryPresent: true } : absent;
    }
    if (mode === 'footprintFails') input.verifyRemovalPostcondition = async () => { throw new Error('PRIVATE'); };
    const result = await f.run();
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    const blocked = ['missingSupervisor', 'unverifiedTree', 'noPrecondition', 'foreignPrecondition', 'unknownProductState'].includes(mode);
    assert.equal(f.calls.includes('cleanup'), !blocked);
    assert.equal(workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal: result, productProcessAbsent: true }),
      !blocked && !['cleanupFails', 'workerAndCleanupFail', 'footprintFails'].includes(mode));
    if (['missingSupervisor', 'unverifiedTree'].includes(mode)) assert.deepEqual(f.calls, []);
    if (mode === 'deadline') assert.equal(result.errorCode, 'supervisorDeadlineExceeded');
    if (mode === 'businessAndSessionsFail') {
      assert.equal(result.errorCode, 'profileBusinessContentChanged');
      assert.equal(result.sessionProofResultCode, 'workspaceFaultSessionsFailed');
    }
    if (mode === 'workerAndCleanupFail') {
      assert.equal(result.errorCode, 'sessionProofInvalid');
      assert.equal(result.failedPhase, 'sourceHandoff');
      assert.equal(result.semanticCleanupResultCode, 'semanticCleanupTimedOut');
      assert.equal(result.sessionProofResultCode, 'notChecked');
    }
    if (mode === 'wrongInstalledRole') assert.equal(result.errorCode, 'sourceStateInvalid');
  });
}

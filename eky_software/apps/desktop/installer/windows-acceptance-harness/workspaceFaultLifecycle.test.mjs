import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { WORKSPACE_FAULT_PLANS, createWorkspaceFaultRequest, validateWorkspaceFaultResult } from './workspaceFaultContracts.mjs';
import { executeWorkspaceFaultLifecycle } from './workspaceFaultLifecycle.mjs';

function fixture(faultScenario, { failPhase, progressThrows = false } = {}) {
  let currentPhase;
  let installed = null;
  const calls = [];
  const evidence = [];
  function record(name) {
    calls.push(name);
    if (currentPhase === failPhase) throw new Error('PRIVATE path and secret');
  }
  const versions = { source: '0.2.7', target: '0.2.8' };
  return { calls, evidence, runtime: {
    versions,
    reportProgress(value) {
      if (value.status === 'started') currentPhase = value.phase;
      evidence.push(value);
      if (progressThrows) throw new Error('PRIVATE output error');
    },
    async inspectState() {
      record('inspect');
      const absent = { productState: -1, productName: null, productVersion: null,
        localPackagePresent: false, ownedRegistryExists: installed !== null };
      return { source: { ...absent }, target: { ...absent },
        ...(installed === null ? {} : { [installed]: { productState: 5, productName: 'Eky',
          productVersion: versions[installed], localPackagePresent: true, ownedRegistryExists: true } }),
        installRootExists: installed !== null, executableExists: installed !== null,
        shortcutExists: installed !== null, installerRegistryExists: installed !== null, ekyProcessCount: 0 };
    },
    async verifyArtifact() { record('artifact'); },
    async installSource() { record('installSource'); installed = 'source'; return 0; },
    async validatePayload(role) { record(`payload:${role}`); },
    async prepareProfile() { record('prepare'); },
    async captureCheckpoint(name) { record(`checkpoint:${name}`); },
    async runProofPhase(phase, status) {
      record(`proof:${phase}:${status}`);
      return { formatVersion: 2, faultScenario, phase, status };
    },
    async waitForInstallation(role) { record(`observe:${role}`); installed = role; },
  } };
}

const COMMON = ['inspect', 'artifact', 'installSource', 'inspect', 'payload:source',
  'prepare', 'checkpoint:sourceBaseline', 'proof:sourceHandoff:completed'];
const TARGET = ['observe:target', 'inspect', 'payload:target', 'artifact'];
const SCENARIO_CALLS = {
  preUpdateRecoveryPointFailure: [],
  activeWorkspaceFirstStartFailure: [...TARGET,
    'proof:targetFirstStartFailure:relaunching', 'proof:businessRollback:relaunching',
    'observe:source', 'inspect', 'payload:source', 'artifact', 'proof:rollbackFirstStart:completed'],
  acceptanceInterruption: [...TARGET, 'proof:targetAcceptanceInterruption:interrupted',
    'proof:targetAcceptanceRecovery:relaunching', 'proof:targetAcceptanceRestart:completed'],
  passiveWorkspaceMigrationFailure: [...TARGET, 'proof:targetFirstStart:completed', 'proof:switchToB:relaunching',
    'proof:passiveWorkspaceMigrationFailure:relaunching', 'proof:passiveWorkspaceRecovery:completed'],
  binaryRollbackFailure: [...TARGET, 'proof:targetFirstStartFailure:relaunching',
    'proof:binaryRollbackFailure:completed', 'proof:failedSafeVerification:completed'],
};

for (const [scenario, expectedCalls] of Object.entries(SCENARIO_CALLS)) {
  test(`${scenario}: exact application fault and recovery order with no worker-owned update or cleanup`, async () => {
    const value = fixture(scenario);
    const result = await executeWorkspaceFaultLifecycle(scenario, value.runtime);
    assert.equal(result.status, 'completed');
    assert.equal(result.errorCode, null);
    assert.equal(result.failedPhase, null);
    const plan = WORKSPACE_FAULT_PLANS[scenario];
    assert.deepEqual(result.completedPhases, plan.phases);
    assert.deepEqual(value.calls, [...COMMON, ...expectedCalls, 'inspect', `payload:${plan.installedRole}`,
      'checkpoint:faultTerminal', 'artifact']);
    assert.equal(value.calls.filter((call) => call === 'installSource').length, 1);
    assert.equal(value.calls.some((call) => /cleanup|kill|uninstall|build/i.test(call)), false);
    const request = createWorkspaceFaultRequest({ faultScenario: scenario, fixtureRoot: resolve('synthetic-artifact'),
      artifactDescriptorSha256: 'a'.repeat(64), buildRevision: 'b'.repeat(40) });
    assert.doesNotThrow(() => validateWorkspaceFaultResult({ ...result, scenario: request.scenario,
      faultScenario: scenario, runNonce: request.runNonce, artifactDescriptorSha256: request.artifactDescriptorSha256 }, request));
  });

  test(`${scenario}: each failed phase preserves the exact prefix and prevents later side effects`, async () => {
    const phases = WORKSPACE_FAULT_PLANS[scenario].phases;
    for (const [index, phase] of phases.entries()) {
      const value = fixture(scenario, { failPhase: phase });
      const result = await executeWorkspaceFaultLifecycle(scenario, value.runtime);
      assert.equal(result.status, 'failed', phase);
      assert.equal(result.failedPhase, phase);
      assert.deepEqual(result.completedPhases, phases.slice(0, index));
      assert.equal(value.evidence.at(-1).status, 'failed');
      assert.equal(value.evidence.at(-1).phase, phase);
      assert.doesNotMatch(JSON.stringify([result, value.evidence]), /PRIVATE|secret/);
      assert.equal(value.calls.some((call) => /cleanup|kill|uninstall/i.test(call)), false);
    }
  });
}

test('invalid scenario is rejected before any runtime call', async () => {
  const value = fixture('acceptanceInterruption');
  await assert.rejects(executeWorkspaceFaultLifecycle('__proto__', value.runtime));
  assert.deepEqual(value.calls, []);
  assert.deepEqual(value.evidence, []);
});

test('foreign product, existing process or unknown footprint cannot authorize installation', async () => {
  for (const change of [
    (state) => { state.source.productName = 'Other'; },
    (state) => { state.ekyProcessCount = 1; },
    (state) => { state.shortcutExists = undefined; },
    (state) => { state.target.ownedRegistryExists = true; },
  ]) {
    const value = fixture('preUpdateRecoveryPointFailure');
    const inspect = value.runtime.inspectState;
    value.runtime.inspectState = async () => { const state = await inspect(); change(state); return state; };
    assert.equal((await executeWorkspaceFaultLifecycle('preUpdateRecoveryPointFailure', value.runtime)).status, 'failed');
    assert.deepEqual(value.calls, ['inspect']);
  }
});

test('non-zero source install cannot prepare a profile', async () => {
  const value = fixture('acceptanceInterruption');
  value.runtime.installSource = async () => 1603;
  const result = await executeWorkspaceFaultLifecycle('acceptanceInterruption', value.runtime);
  assert.equal(result.errorCode, 'sourceInstallFailed');
  assert.equal(value.calls.includes('prepare'), false);
});

test('wrong format, scenario, phase, status, absent proof and extra private fields all stop handoff', async () => {
  const valid = { formatVersion: 2, faultScenario: 'acceptanceInterruption', phase: 'sourceHandoff', status: 'completed' };
  for (const proof of [undefined, { ...valid, formatVersion: 1 },
    { ...valid, faultScenario: 'binaryRollbackFailure' }, { ...valid, phase: 'targetAcceptanceRestart' },
    { ...valid, status: 'relaunching' }, { ...valid, path: 'PRIVATE' }, { ...valid, errorCode: 'PRIVATE' }]) {
    const value = fixture('acceptanceInterruption');
    value.runtime.runProofPhase = async () => proof;
    const result = await executeWorkspaceFaultLifecycle('acceptanceInterruption', value.runtime);
    assert.equal(result.errorCode, 'proofResultInvalid');
    assert.equal(result.failedPhase, 'sourceHandoff');
    assert.equal(value.calls.some((call) => call.startsWith('observe:')), false);
  }
});

test('expected interruption needs the exact interrupted proof, not an arbitrary crash', async () => {
  const value = fixture('acceptanceInterruption');
  const proof = value.runtime.runProofPhase;
  value.runtime.runProofPhase = (phase, status) => phase === 'targetAcceptanceInterruption'
    ? Promise.reject(new Error('ownedProcessExitInvalid')) : proof(phase, status);
  const result = await executeWorkspaceFaultLifecycle('acceptanceInterruption', value.runtime);
  assert.equal(result.errorCode, 'ownedProcessExitInvalid');
  assert.equal(result.failedPhase, 'targetAcceptanceInterruption');
  assert.equal(value.calls.includes('proof:targetAcceptanceRecovery:relaunching'), false);
});

test('unobserved fault preserves the original closed error and cannot pass as recovery', async () => {
  const value = fixture('binaryRollbackFailure');
  value.runtime.runProofPhase = async () => { throw new Error('W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED'); };
  const result = await executeWorkspaceFaultLifecycle('binaryRollbackFailure', value.runtime);
  assert.equal(result.errorCode, 'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED');
  assert.equal(result.status, 'failed');
  assert.equal(result.failedPhase, 'sourceHandoff');
});

test('a finished binary rollback helper is not proof that source binaries were restored', async () => {
  const value = fixture('activeWorkspaceFirstStartFailure');
  const observe = value.runtime.waitForInstallation;
  value.runtime.waitForInstallation = (role) => role === 'source' ? undefined : observe(role);
  const result = await executeWorkspaceFaultLifecycle('activeWorkspaceFirstStartFailure', value.runtime);
  assert.equal(result.failedPhase, 'sourceRollbackInstall');
  assert.equal(result.status, 'failed');
  assert.equal(value.calls.includes('proof:rollbackFirstStart:completed'), false);
});

test('handoff observation must resolve before target startup; no success delay or worker MSI is substituted', async () => {
  const value = fixture('acceptanceInterruption');
  const observe = value.runtime.waitForInstallation;
  const observationEntered = Promise.withResolvers();
  const releaseObservation = Promise.withResolvers();
  value.runtime.waitForInstallation = async (role) => {
    observationEntered.resolve();
    await releaseObservation.promise;
    await observe(role);
  };
  const run = executeWorkspaceFaultLifecycle('acceptanceInterruption', value.runtime);
  await observationEntered.promise;
  assert.equal(value.calls.includes('proof:targetAcceptanceInterruption:interrupted'), false);
  releaseObservation.resolve();
  assert.equal((await run).status, 'completed');
});

test('progress failure cannot change success or failure and evidence contains only closed fields', async () => {
  for (const failPhase of [undefined, 'businessRollback']) {
    const value = fixture('activeWorkspaceFirstStartFailure', { failPhase, progressThrows: true });
    const result = await executeWorkspaceFaultLifecycle('activeWorkspaceFirstStartFailure', value.runtime);
    assert.equal(result.status, failPhase ? 'failed' : 'completed');
    assert.equal(result.failedPhase, failPhase ?? null);
    for (const entry of value.evidence) {
      assert.deepEqual(Object.keys(entry).sort(), [
        'durationMs', 'elapsedMs', 'faultScenario', 'operation', 'phase',
        entry.status === 'failed' ? 'errorCode' : 'resultCode', 'scenario', 'schemaVersion', 'status',
      ].sort());
      assert.ok(Number.isSafeInteger(entry.durationMs) && entry.durationMs >= 0);
      assert.ok(Number.isSafeInteger(entry.elapsedMs) && entry.elapsedMs >= 0);
      assert.doesNotMatch(JSON.stringify(entry), /PRIVATE|secret/);
    }
  }
});

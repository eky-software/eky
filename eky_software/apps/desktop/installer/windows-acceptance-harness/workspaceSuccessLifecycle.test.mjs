import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { executeWorkspaceSuccessLifecycle } from './workspaceSuccessLifecycle.mjs';
import { WORKSPACE_INSTALLATION_INSPECTION_ERRORS, WORKSPACE_SUCCESS_PHASES,
  createWorkspaceSuccessRequest, validateWorkspaceSuccessResult } from './workspaceSuccessContracts.mjs';

function fixture({ failPhase, badProof, progressThrows = false } = {}) {
  let phase;
  let installed = null;
  const calls = [];
  const evidence = [];
  function record(name) {
    calls.push(name);
    if (phase === failPhase) throw new Error('PRIVATE fixture path and secret');
  }
  const absent = { productState: -1, productName: null, productVersion: null,
    localPackagePresent: false, ownedRegistryExists: false };
  const versions = { source: '0.2.7', target: '0.2.8' };
  return {
    calls, evidence,
    runtime: {
      versions,
      reportProgress(value) {
        if (value.status === 'started') phase = value.phase;
        evidence.push(value);
        if (progressThrows) throw new Error('PRIVATE output unavailable');
      },
      async inspectState() {
        record('inspect');
        return { source: { ...absent, ownedRegistryExists: installed !== null },
          target: { ...absent, ownedRegistryExists: installed !== null },
          ...(installed === null ? {} : { [installed]: {
            productState: 5, productName: 'Eky', productVersion: versions[installed],
            localPackagePresent: true, ownedRegistryExists: true,
          } }), installRootExists: installed !== null, executableExists: installed !== null,
          shortcutExists: installed !== null, installerRegistryExists: installed !== null,
          ekyProcessCount: 0 };
      },
      async verifyArtifact() { record('artifact'); },
      async installSource() { record('installSource'); installed = 'source'; return 0; },
      async validatePayload(role) { record(`payload:${role}`); },
      async prepareProfile() { record('prepareProfile'); },
      async captureCheckpoint(checkpoint) { record(`checkpoint:${checkpoint}`); },
      async runProofPhase(proofPhase, status) {
        record(`proof:${proofPhase}:${status}`);
        return badProof ?? { formatVersion: 1, phase: proofPhase, status };
      },
      async waitForTargetInstallation() { record('observeHandoffInstall'); installed = 'target'; },
    },
  };
}

test('success consumes the application handoff and separates B migration, first startup and restart', async () => {
  const value = fixture();
  const result = await executeWorkspaceSuccessLifecycle(value.runtime);
  assert.equal(result.status, 'completed');
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.completedPhases, WORKSPACE_SUCCESS_PHASES);
  assert.deepEqual(value.calls, [
    'inspect', 'artifact', 'installSource', 'inspect', 'payload:source',
    'prepareProfile', 'checkpoint:sourceBaseline', 'proof:sourceHandoff:completed',
    'observeHandoffInstall', 'inspect', 'payload:target', 'artifact',
    'proof:targetFirstStart:completed', 'checkpoint:targetFirstStart',
    'proof:switchToB:relaunching', 'checkpoint:beforeBMigration',
    'proof:verifyBRestart:relaunching', 'proof:verifyBRestart:completed',
    'checkpoint:firstBStartup',
    'proof:verifyBRestart:completed', 'checkpoint:secondBStartup',
    'proof:switchToA:relaunching', 'proof:rejectC:completed',
    'checkpoint:rejectedC', 'artifact',
  ]);
});

test('checkpoint observation never calls the legacy profile verifier that can repair stores', async () => {
  const value = fixture();
  value.runtime.verifyProfile = async () => assert.fail('repairing profile verifier must not run');
  assert.equal((await executeWorkspaceSuccessLifecycle(value.runtime)).status, 'completed');
});

for (const [index, phase] of WORKSPACE_SUCCESS_PHASES.entries()) {
  test(`failure at ${phase} stops at the exact completed prefix without attempting cleanup`, async () => {
    const value = fixture({ failPhase: phase });
    const result = await executeWorkspaceSuccessLifecycle(value.runtime);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedPhase, phase);
    assert.deepEqual(result.completedPhases, WORKSPACE_SUCCESS_PHASES.slice(0, index));
    assert.equal(value.evidence.at(-1).phase, phase);
    assert.equal(value.evidence.at(-1).status, 'failed');
    assert.doesNotMatch(JSON.stringify([result, value.evidence]), /PRIVATE|secret/);
    assert.equal(value.calls.some((call) => /cleanup|kill|uninstall/i.test(call)), false);
  });
}

for (const [name, change, errorCode] of [
  ['foreign installed product', (state) => { state.source.productName = 'Other'; }, 'preconditionFailed'],
  ['unknown footprint', (state) => { state.installRootExists = undefined; }, 'preconditionFailed'],
  ['existing Eky process', (state) => { state.ekyProcessCount = 1; }, 'installedProcessRemains'],
  ['mismatched registry snapshot', (state) => { state.target.ownedRegistryExists = true; }, 'productRegistryObservationMismatch'],
]) {
  test(`${name} rejects before install`, async () => {
    const value = fixture();
    const inspect = value.runtime.inspectState;
    value.runtime.inspectState = async () => { const state = await inspect(); change(state); return state; };
    const result = await executeWorkspaceSuccessLifecycle(value.runtime);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, errorCode);
    assert.deepEqual(value.calls, ['inspect']);
  });
}

test('non-zero MSI result cannot advance to profile creation', async () => {
  const value = fixture();
  value.runtime.installSource = async () => 1603;
  const result = await executeWorkspaceSuccessLifecycle(value.runtime);
  assert.equal(result.errorCode, 'sourceInstallFailed');
  assert.equal(value.calls.includes('prepareProfile'), false);
});

test('installation inspection failures remain exact in progress and strict worker results', async () => {
  const request = createWorkspaceSuccessRequest({ fixtureRoot: resolve('synthetic-artifact'),
    artifactDescriptorSha256: 'a'.repeat(64), buildRevision: 'b'.repeat(40) });
  for (const errorCode of Object.values(WORKSPACE_INSTALLATION_INSPECTION_ERRORS)) {
    const value = fixture();
    value.runtime.waitForTargetInstallation = async () => { throw new Error(errorCode); };
    const result = await executeWorkspaceSuccessLifecycle(value.runtime);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedPhase, 'targetInstall');
    assert.equal(result.errorCode, errorCode);
    assert.equal(value.evidence.at(-1).errorCode, errorCode);
    assert.equal(value.calls.includes('proof:targetFirstStart:completed'), false);
    assert.doesNotThrow(() => validateWorkspaceSuccessResult({ ...result, scenario: request.scenario,
      runNonce: request.runNonce, artifactDescriptorSha256: request.artifactDescriptorSha256 }, request));
  }
});

for (const proof of [
  undefined, { formatVersion: 1, phase: 'sourceHandoff', status: 'relaunching' },
  { formatVersion: 1, phase: 'targetFirstStart', status: 'completed' },
  { formatVersion: 1, phase: 'sourceHandoff', status: 'completed', password: 'PRIVATE' },
]) {
  test(`invalid handoff proof ${JSON.stringify(proof)} cannot advance`, async () => {
    const value = fixture();
    value.runtime.runProofPhase = async () => proof;
    const result = await executeWorkspaceSuccessLifecycle(value.runtime);
    assert.equal(result.errorCode, 'proofResultInvalid');
    assert.equal(result.failedPhase, 'sourceHandoff');
    assert.equal(value.calls.includes('observeHandoffInstall'), false);
  });
}

test('evidence output failure changes neither success nor first failure', async () => {
  const success = await executeWorkspaceSuccessLifecycle(fixture({ progressThrows: true }).runtime);
  assert.equal(success.status, 'completed');
  const failure = await executeWorkspaceSuccessLifecycle(fixture({ progressThrows: true, failPhase: 'migrateB' }).runtime);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failedPhase, 'migrateB');
  assert.equal(failure.errorCode, 'migrationBFailed');
});

test('progress contains only the closed phase contract', async () => {
  const value = fixture();
  await executeWorkspaceSuccessLifecycle(value.runtime);
  for (const entry of value.evidence) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'durationMs', 'elapsedMs', 'operation', 'phase', 'resultCode', 'scenario', 'schemaVersion', 'status',
    ]);
    assert.ok(WORKSPACE_SUCCESS_PHASES.includes(entry.phase));
    assert.ok(Number.isSafeInteger(entry.durationMs) && entry.durationMs >= 0);
    assert.ok(Number.isSafeInteger(entry.elapsedMs) && entry.elapsedMs >= 0);
  }
});

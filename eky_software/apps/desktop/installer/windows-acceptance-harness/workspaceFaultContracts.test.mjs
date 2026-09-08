import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { w6b2PackagedFaultScenarios } from '../scripts/w6b2PackagedFaultRunFixture.mjs';
import {
  WORKSPACE_FAULT_PLANS, createWorkspaceFaultRequest, readWorkspaceFaultRequest,
  readWorkspaceFaultResult, validateWorkspaceFaultRequest, validateWorkspaceFaultResult,
  workspaceFaultErrorCode, workspaceFaultPlan, workspaceFaultResultPath, workspaceFaultWorkerResult,
} from './workspaceFaultContracts.mjs';

function request(faultScenario = 'acceptanceInterruption') {
  return createWorkspaceFaultRequest({ faultScenario, fixtureRoot: resolve('synthetic-artifact'),
    runNonce: 'a'.repeat(64), artifactDescriptorSha256: 'b'.repeat(64), buildRevision: 'c'.repeat(40) });
}
function completed(expected) {
  return { schemaVersion: 1, scenario: expected.scenario, faultScenario: expected.faultScenario,
    runNonce: expected.runNonce, artifactDescriptorSha256: expected.artifactDescriptorSha256,
    status: 'completed', resultCode: 'workspaceFaultCompleted', errorCode: null, failedPhase: null,
    completedPhases: [...workspaceFaultPlan(expected.faultScenario).phases] };
}

test('fault plans cover exactly the existing five private scenarios and their installed terminal roles', () => {
  assert.deepEqual(Object.keys(WORKSPACE_FAULT_PLANS), [...w6b2PackagedFaultScenarios]);
  assert.deepEqual(Object.values(WORKSPACE_FAULT_PLANS).map(({ installedRole }) => installedRole),
    ['source', 'source', 'target', 'target', 'target']);
  assert.deepEqual(Object.values(WORKSPACE_FAULT_PLANS).map(({ verificationOperation }) => verificationOperation), [
    'verifyPreUpdateFailure', 'verifyActiveRollback', 'verifyAcceptanceRecovery', 'verifyPassiveRecovery', 'verifyBinaryFailedSafe',
  ]);
  assert.throws(() => workspaceFaultPlan('toString'));
  assert.throws(() => workspaceFaultPlan('__proto__'));
  assert.throws(() => workspaceFaultPlan(null));
  for (const value of Object.values(WORKSPACE_FAULT_PLANS)) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.isFrozen(value.phases), true);
    assert.equal(new Set(value.phases).size, value.phases.length);
  }
});

test('requests reject unknown fields, identities, scenarios, versions and unsafe roots', () => {
  const valid = request();
  assert.deepEqual(validateWorkspaceFaultRequest(valid), valid);
  for (const patch of [
    { faultScenario: 'unknown' }, { scenario: 'packagedWorkspaceSuccess' }, { schemaVersion: 2 },
    { runNonce: '' }, { runNonce: 'A'.repeat(64) }, { artifactDescriptorSha256: 'b'.repeat(63) },
    { buildRevision: 'c'.repeat(12) }, { fixtureRoot: 'relative' }, { fixtureRoot: `${valid.fixtureRoot}\0` },
    { password: 'PRIVATE' }, { command: 'PRIVATE' }, { timeoutMs: 1 },
  ]) assert.throws(() => validateWorkspaceFaultRequest({ ...valid, ...patch }),
    /WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_REQUEST_INVALID/);
  assert.throws(() => validateWorkspaceFaultRequest(Object.create(valid)));
});

test('each result binds the exact request and only its own complete ordered phase prefix', () => {
  for (const name of Object.keys(WORKSPACE_FAULT_PLANS)) {
    const expected = request(name);
    const valid = completed(expected);
    assert.deepEqual(validateWorkspaceFaultResult(valid, expected), valid);
    assert.deepEqual(Object.keys(workspaceFaultWorkerResult(expected, valid)).sort(), [
      'artifactDescriptorSha256', 'errorCode', 'resultCode', 'runNonce', 'scenario', 'schemaVersion', 'status',
    ]);
    for (const patch of [
      { faultScenario: name === 'acceptanceInterruption' ? 'binaryRollbackFailure' : 'acceptanceInterruption' },
      { scenario: 'packagedWorkspaceSuccess' }, { runNonce: 'd'.repeat(64) },
      { artifactDescriptorSha256: 'd'.repeat(64) }, { resultCode: 'workspaceSuccessCompleted' },
      { completedPhases: valid.completedPhases.slice(1) },
      { completedPhases: [...valid.completedPhases].reverse() },
      { completedPhases: new Array(valid.completedPhases.length) },
      { completedPhases: [...valid.completedPhases, 'uninstall'] },
      { errorCode: 'unexpectedFailure' }, { failedPhase: 'preflight' }, { path: 'PRIVATE' },
    ]) assert.throws(() => validateWorkspaceFaultResult({ ...valid, ...patch }, expected),
      /WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_RESULT_INVALID/);
    for (let index = 0; index < valid.completedPhases.length; index++) {
      const failure = { ...valid, status: 'failed', resultCode: 'workspaceFaultFailed',
        errorCode: 'faultProofFailed', completedPhases: valid.completedPhases.slice(0, index),
        failedPhase: valid.completedPhases[index] };
      assert.deepEqual(validateWorkspaceFaultResult(failure, expected), failure);
      for (const patch of [{ failedPhase: null }, { errorCode: 'PRIVATE' }, { status: 'completed' }]) {
        assert.throws(() => validateWorkspaceFaultResult({ ...failure, ...patch }, expected));
      }
    }
  }
});

test('private JSON readers reject missing, duplicate-key and mismatched results', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v27-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, 'request.json');
  const expected = request();
  await writeFile(path, JSON.stringify(expected));
  assert.deepEqual(await readWorkspaceFaultRequest(path), expected);
  const resultPath = workspaceFaultResultPath(path);
  await assert.rejects(readWorkspaceFaultResult(resultPath, expected));
  await writeFile(resultPath, JSON.stringify(completed(expected)));
  assert.deepEqual(await readWorkspaceFaultResult(resultPath, expected), completed(expected));
  await writeFile(resultPath, '{"status":"completed","status":"failed"}');
  await assert.rejects(readWorkspaceFaultResult(resultPath, expected));
  await writeFile(resultPath, JSON.stringify(completed(request('binaryRollbackFailure'))));
  await assert.rejects(readWorkspaceFaultResult(resultPath, expected));
});

test('safe error mapping retains known proof failures and never returns arbitrary fallback text', () => {
  assert.equal(workspaceFaultErrorCode(new Error('W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED')),
    'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED');
  assert.equal(workspaceFaultErrorCode(new Error('PRIVATE'), 'faultProofFailed'), 'faultProofFailed');
  assert.equal(workspaceFaultErrorCode(new Error('PRIVATE'), 'PRIVATE fallback'), 'unexpectedFailure');
});

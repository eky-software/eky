import assert from 'node:assert/strict';
import { link, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  createWorkspaceSuccessRequest, readWorkspaceSuccessRequest, validateWorkspaceSuccessRequest,
  validateWorkspaceSuccessResult, workspaceSuccessWorkerResult, WORKSPACE_SUCCESS_PHASES,
} from './workspaceSuccessContracts.mjs';

function request() {
  return createWorkspaceSuccessRequest({
    artifactDescriptorSha256: 'a'.repeat(64), buildRevision: 'b'.repeat(40),
    runNonce: 'c'.repeat(64), fixtureRoot: resolve(tmpdir(), 'synthetic-workspace-artifact'),
  });
}
function completed() {
  const { fixtureRoot, buildRevision, ...binding } = request();
  return { ...binding, status: 'completed', resultCode: 'workspaceSuccessCompleted',
    errorCode: null, failedPhase: null, completedPhases: [...WORKSPACE_SUCCESS_PHASES] };
}

test('request and terminal result bind scenario, nonce and artifact without paths in result', () => {
  const input = request();
  const result = validateWorkspaceSuccessResult(completed(), input);
  const terminal = workspaceSuccessWorkerResult(input, result);
  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.artifactDescriptorSha256, input.artifactDescriptorSha256);
  assert.equal(Object.hasOwn(terminal, 'fixtureRoot'), false);
  assert.ok(Object.isFrozen(result.completedPhases));
});

for (const [key, value] of [
  ['schemaVersion', 2], ['scenario', 'historicalLegacyUpgrade'], ['runNonce', 'c'.repeat(63)],
  ['artifactDescriptorSha256', 'A'.repeat(64)], ['buildRevision', 'b'.repeat(12)],
  ['fixtureRoot', 'relative'], ['fixtureRoot', `bad\0path`], ['password', 'PRIVATE'],
]) {
  test(`request rejects ${key} contract violation`, () => {
    assert.throws(() => validateWorkspaceSuccessRequest({ ...request(), [key]: value }),
      { message: 'WINDOWS_ACCEPTANCE_WORKSPACE_REQUEST_INVALID' });
  });
}

for (const [key, value] of [
  ['runNonce', 'd'.repeat(64)], ['artifactDescriptorSha256', 'd'.repeat(64)],
  ['scenario', 'other'], ['schemaVersion', 2], ['errorCode', 'cleanupUnverified'],
  ['failedPhase', 'preflight'], ['completedPhases', []],
  ['completedPhases', [...WORKSPACE_SUCCESS_PHASES].reverse()], ['path', 'PRIVATE'],
]) {
  test(`result rejects ${key} contract violation`, () => {
    assert.throws(() => validateWorkspaceSuccessResult({ ...completed(), [key]: value }, request()),
      { message: 'WINDOWS_ACCEPTANCE_WORKSPACE_RESULT_INVALID' });
  });
}

test('failed result requires a contiguous prefix and the exact next failed phase', () => {
  const result = { ...completed(), status: 'failed', resultCode: 'workspaceSuccessFailed',
    errorCode: 'sourceHandoffFailed', completedPhases: WORKSPACE_SUCCESS_PHASES.slice(0, 5),
    failedPhase: 'sourceHandoff' };
  assert.equal(validateWorkspaceSuccessResult(result, request()).status, 'failed');
  for (const change of [{ failedPhase: 'targetInstall' }, { errorCode: 'PRIVATE raw error' },
    { completedPhases: ['sourceInstall'] }, { completedPhases: WORKSPACE_SUCCESS_PHASES, failedPhase: null }]) {
    assert.throws(() => validateWorkspaceSuccessResult({ ...result, ...change }, request()));
  }
});

test('bounded request reader rejects hardlinks, duplicate keys and oversized files', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-workspace-contract-'));
  const path = join(root, 'request.json');
  try {
    await writeFile(path, JSON.stringify(request()));
    assert.deepEqual(await readWorkspaceSuccessRequest(path), request());
    await link(path, join(root, 'alias.json'));
    await assert.rejects(readWorkspaceSuccessRequest(path), { message: 'WINDOWS_ACCEPTANCE_WORKSPACE_REQUEST_INVALID' });
    await rm(join(root, 'alias.json'));
    await writeFile(path, JSON.stringify(request()).replace('{', '{"schemaVersion":1,'));
    await assert.rejects(readWorkspaceSuccessRequest(path));
    await writeFile(path, ' '.repeat(128 * 1024 + 1));
    await assert.rejects(readWorkspaceSuccessRequest(path));
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { createWorkspaceSuccessRequest, WORKSPACE_SUCCESS_PHASES } from './workspaceSuccessContracts.mjs';
import { createWorkspaceSuccessWorkerRuntime, runWorkspaceSuccessWorker } from './runWorkspaceSuccessWorker.mjs';
import { createWorkspaceSuccessArtifactTestFixture } from './workspaceSuccessArtifactTestFixture.mjs';
import { materializeWorkspaceSuccessArtifactFixture, prepareWorkspaceSuccessRunFixture, workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';

test('real worker composition prepares its ports without installing or starting the application', async (t) => {
  const f = await createWorkspaceSuccessArtifactTestFixture(t);
  const runRoot = resolve(f.root, 'run');
  await mkdir(runRoot);
  const artifact = await materializeWorkspaceSuccessArtifactFixture(f.verification, resolve(runRoot, 'fixture'));
  const scenarioRoot = resolve(runRoot, 'scenario');
  await mkdir(scenarioRoot);
  const path = resolve(scenarioRoot, 'worker-request.json');
  const request = createWorkspaceSuccessRequest({ fixtureRoot: artifact.artifactRoot, buildRevision: artifact.buildRevision,
    artifactDescriptorSha256: artifact.descriptorSha256 });
  const context = workspaceSuccessRunContext(path, request, artifact);
  await prepareWorkspaceSuccessRunFixture(context);
  await assert.rejects(createWorkspaceSuccessWorkerRuntime(path, request, artifact, {
    resolveElectronRuntime: () => { throw new Error('private missing executable path'); },
  }), { message: 'electronRuntimeUnavailable' });
  const runtime = await createWorkspaceSuccessWorkerRuntime(path, request, artifact);
  try {
    assert.equal(typeof runtime.runProofPhase, 'function');
    assert.equal(typeof runtime.prepareProfile, 'function');
    assert.deepEqual(await readdir(resolve(context.proofRoot, 'user-data')), []);
  } finally { runtime.disposeSessionEvidence(); }
});

function fixture() {
  const calls = [];
  const request = createWorkspaceSuccessRequest({ fixtureRoot: resolve('fixture'), buildRevision: 'a'.repeat(40),
    artifactDescriptorSha256: 'b'.repeat(64), runNonce: 'c'.repeat(64) });
  const result = { schemaVersion: 1, status: 'completed', resultCode: 'workspaceSuccessCompleted',
    errorCode: null, failedPhase: null, completedPhases: [...WORKSPACE_SUCCESS_PHASES] };
  const options = { platform: 'win32',
    readRequest: async () => request,
    verifyArtifact: async (input) => { calls.push(['verify', input]); return {}; },
    createRuntime: async () => { calls.push(['runtime']); return { disposeSessionEvidence: () => calls.push(['disposeSessions']) }; },
    execute: async () => { calls.push(['execute']); return result; },
    writeResult: async (path, value) => { calls.push(['write', path, value]); },
  };
  return { calls, request, result, options, run: () => runWorkspaceSuccessWorker(['--request', resolve('worker-request.json')], options) };
}

test('worker verifies exact revision and writes both bound results before successful exit', async () => {
  const f = fixture();
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.calls.map((entry) => entry[0]), ['verify', 'runtime', 'execute', 'disposeSessions', 'write', 'write']);
  assert.equal(f.calls[0][1].expectedBuildRevision, f.request.buildRevision);
  assert.equal(f.calls[0][1].expectedDescriptorSha256, f.request.artifactDescriptorSha256);
  const writes = f.calls.filter((entry) => entry[0] === 'write');
  assert.match(writes[0][1], /workspace-success-result.json$/);
  assert.match(writes[1][1], /worker-result.json$/);
  assert.equal(writes[1][2].runNonce, f.request.runNonce);
  assert.deepEqual(Object.keys(writes[1][2]).sort(), ['artifactDescriptorSha256', 'errorCode', 'resultCode', 'runNonce', 'scenario', 'schemaVersion', 'status']);
});

for (const stage of ['readRequest', 'verifyArtifact', 'createRuntime', 'execute']) {
  test(`worker fails closed at ${stage} without leaking the original exception`, async () => {
    const f = fixture();
    f.options[stage] = async () => { throw new Error('private path and secret'); };
    assert.equal(await f.run(), stage === 'readRequest' ? 64 : 1);
    const writes = f.calls.filter((entry) => entry[0] === 'write');
    assert.equal(writes.length, stage === 'readRequest' ? 0 : 2);
    assert.doesNotMatch(JSON.stringify(writes), /private path and secret/);
  });
}

test('an ordered scenario failure keeps its original stage and safe error', async () => {
  const f = fixture();
  f.result.status = 'failed'; f.result.resultCode = 'workspaceSuccessFailed';
  f.result.completedPhases = WORKSPACE_SUCCESS_PHASES.slice(0, 3);
  f.result.failedPhase = WORKSPACE_SUCCESS_PHASES[3]; f.result.errorCode = 'sourceStateInvalid';
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.at(-1)[2].errorCode, 'sourceStateInvalid');
  assert.equal(f.calls.at(-2)[2].failedPhase, 'sourcePostcondition');
});

test('unavailable Electron runtime has a safe preflight result and never starts the scenario', async () => {
  const f = fixture();
  f.options.createRuntime = async () => { throw new Error('electronRuntimeUnavailable'); };
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.some(([name]) => name === 'execute'), false);
  assert.equal(f.calls.at(-2)[2].failedPhase, 'preflight');
  assert.equal(f.calls.at(-1)[2].errorCode, 'electronRuntimeUnavailable');
});

for (const failAt of [1, 2]) {
  test(`result write ${failAt} failure never returns successful exit`, async () => {
    const f = fixture();
    let writes = 0;
    f.options.writeResult = async () => { if (++writes === failAt) throw new Error('private write error'); };
    assert.equal(await f.run(), 1);
    assert.equal(writes, failAt);
  });
}

test('invalid phase prefix cannot be published as completed', async () => {
  const f = fixture(); f.result.completedPhases.pop();
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.filter((entry) => entry[0] === 'write').length, 0);
});

test('invalid arguments do not read a request or start runtime work', async () => {
  const f = fixture();
  for (const args of [[], ['--request'], ['--other', 'x'], ['--request', 'x\0'], ['--request', 'x', 'extra']]) {
    assert.equal(await runWorkspaceSuccessWorker(args, f.options), 64);
  }
  assert.deepEqual(f.calls, []);
});

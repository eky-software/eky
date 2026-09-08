import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { WORKSPACE_FAULT_PLANS, createWorkspaceFaultRequest } from './workspaceFaultContracts.mjs';
import { createWorkspaceFaultWorkerRuntime } from './workspaceWorkerRuntime.mjs';
import { runWorkspaceFaultWorker } from './runWorkspaceFaultWorker.mjs';
import { createWorkspaceSuccessArtifactTestFixture } from './workspaceSuccessArtifactTestFixture.mjs';
import { materializeWorkspaceSuccessArtifactFixture, prepareWorkspaceSuccessRunFixture, workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';

test('real fault worker composition prepares shared ports without installing or starting Eky', async (t) => {
  const f = await createWorkspaceSuccessArtifactTestFixture(t);
  const runRoot = resolve(f.root, 'run'); await mkdir(runRoot);
  const artifact = await materializeWorkspaceSuccessArtifactFixture(f.verification, resolve(runRoot, 'fixture'));
  const scenarioRoot = resolve(runRoot, 'scenario'); await mkdir(scenarioRoot);
  const path = resolve(scenarioRoot, 'worker-request.json');
  const request = createWorkspaceFaultRequest({ faultScenario: 'acceptanceInterruption',
    fixtureRoot: artifact.artifactRoot, buildRevision: artifact.buildRevision, artifactDescriptorSha256: artifact.descriptorSha256 });
  const context = workspaceSuccessRunContext(path, request, artifact);
  await prepareWorkspaceSuccessRunFixture(context);
  await assert.rejects(createWorkspaceFaultWorkerRuntime(path, request, artifact, {
    resolveElectronRuntime: () => { throw new Error('private missing executable'); },
  }), { message: 'electronRuntimeUnavailable' });
  const runtime = await createWorkspaceFaultWorkerRuntime(path, request, artifact);
  try {
    for (const port of ['runProofPhase', 'prepareProfile', 'captureCheckpoint', 'waitForInstallation']) assert.equal(typeof runtime[port], 'function');
    assert.equal(runtime.waitForTargetInstallation, undefined);
    assert.equal(runtime.cleanup, undefined);
    assert.equal(runtime.build, undefined);
    assert.deepEqual(await readdir(resolve(context.proofRoot, 'user-data')), []);
    await assert.rejects(runtime.captureCheckpoint('faultTerminal'), { message: 'sessionProofInvalid' });
    await assert.rejects(readdir(resolve(context.proofRoot, 'evidence')), { code: 'ENOENT' });
  } finally { runtime.disposeSessionEvidence(); }
});

function fixture(faultScenario = 'acceptanceInterruption') {
  const calls = [];
  const request = createWorkspaceFaultRequest({ faultScenario, fixtureRoot: resolve('fixture'),
    buildRevision: 'a'.repeat(40), artifactDescriptorSha256: 'b'.repeat(64), runNonce: 'c'.repeat(64) });
  const result = { schemaVersion: 1, status: 'completed', resultCode: 'workspaceFaultCompleted',
    errorCode: null, failedPhase: null, completedPhases: [...WORKSPACE_FAULT_PLANS[faultScenario].phases] };
  const options = { platform: 'win32', readRequest: async () => request,
    verifyArtifact: async (input) => { calls.push(['verify', input]); return {}; },
    createRuntime: async () => { calls.push(['runtime']); return { disposeSessionEvidence: () => calls.push(['dispose']) }; },
    execute: async (scenario) => { assert.equal(scenario, faultScenario); calls.push(['execute']); return result; },
    writeResult: async (path, value) => { calls.push(['write', path, value]); },
  };
  return { calls, request, result, options, run: () => runWorkspaceFaultWorker(['--request', resolve('request.json')], options) };
}

test('all five worker results bind the exact scenario, artifact and request before exit zero', async () => {
  for (const scenario of Object.keys(WORKSPACE_FAULT_PLANS)) {
    const f = fixture(scenario);
    assert.equal(await f.run(), 0);
    assert.deepEqual(f.calls.map(([name]) => name), ['verify', 'runtime', 'execute', 'dispose', 'write', 'write']);
    assert.equal(f.calls[0][1].expectedBuildRevision, f.request.buildRevision);
    assert.equal(f.calls[0][1].expectedDescriptorSha256, f.request.artifactDescriptorSha256);
    assert.match(f.calls.at(-2)[1], /workspace-fault-result.json$/);
    assert.match(f.calls.at(-1)[1], /worker-result.json$/);
    assert.equal(f.calls.at(-2)[2].faultScenario, scenario);
    assert.equal(f.calls.at(-1)[2].runNonce, f.request.runNonce);
    assert.deepEqual(Object.keys(f.calls.at(-1)[2]).sort(),
      ['artifactDescriptorSha256', 'errorCode', 'resultCode', 'runNonce', 'scenario', 'schemaVersion', 'status']);
  }
});

for (const stage of ['readRequest', 'verifyArtifact', 'createRuntime', 'execute']) {
  test(`fault worker safely classifies ${stage} failure`, async () => {
    const f = fixture(); f.options[stage] = async () => { throw new Error('private path and secret'); };
    assert.equal(await f.run(), stage === 'readRequest' ? 64 : 1);
    const writes = f.calls.filter(([name]) => name === 'write');
    assert.equal(writes.length, stage === 'readRequest' ? 0 : 2);
    assert.doesNotMatch(JSON.stringify(writes), /private path and secret/);
    assert.equal(f.calls.some(([name]) => name === 'dispose'), stage === 'execute');
  });
}

test('fault worker preserves the failed prefix and clears only memory evidence', async () => {
  const f = fixture();
  Object.assign(f.result, { status: 'failed', resultCode: 'workspaceFaultFailed', errorCode: 'sessionProofInvalid',
    completedPhases: f.result.completedPhases.slice(0, 5), failedPhase: 'sourceHandoff' });
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.at(-2)[2].failedPhase, 'sourceHandoff');
  assert.equal(f.calls.at(-1)[2].errorCode, 'sessionProofInvalid');
  assert.equal(f.calls.filter(([name]) => name === 'dispose').length, 1);
});

test('missing phase and result publication failure cannot turn a fault run green', async () => {
  const f = fixture(); f.result.completedPhases.pop();
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.filter(([name]) => name === 'write').length, 0);
  for (const failAt of [1, 2]) {
    const next = fixture(); let writes = 0;
    next.options.writeResult = async () => { if (++writes === failAt) throw new Error('private write failure'); };
    assert.equal(await next.run(), 1); assert.equal(writes, failAt);
  }
});

test('invalid fault worker arguments or platform never start work', async () => {
  const f = fixture();
  for (const args of [[], ['--request'], ['--other', 'x'], ['--request', 'x\0'], ['--request', 'x', 'extra']]) {
    assert.equal(await runWorkspaceFaultWorker(args, f.options), 64);
  }
  assert.equal(await runWorkspaceFaultWorker(['--request', 'x'], { ...f.options, platform: 'linux' }), 64);
  assert.deepEqual(f.calls, []);
});

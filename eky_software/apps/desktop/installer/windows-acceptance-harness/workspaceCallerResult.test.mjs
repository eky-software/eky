import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { link, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { parseWorkspaceSuccessArguments } from './workspaceCommandAdmission.mjs';
import { parseWorkspaceCallerCliArguments, parseWorkspaceCallerResult, validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { workspaceCallerResultFile } from './workspaceCallerResultFile.mjs';
import { runWorkspaceCallerCli } from './workspaceCallerCli.mjs';
import { runWorkspaceCallerResultProcess } from './workspaceCallerResultProcess.mjs';

const artifactArgs = ['--artifact-descriptor', resolve('workspace-success-artifact.json'), '--expected-descriptor-sha256',
  'b'.repeat(64), '--expected-build-revision', 'a'.repeat(40)];

async function fixture(t) {
  const root = resolve(await realpath(tmpdir()), 'eky-workspace-caller-' + randomBytes(16).toString('hex'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = resolve(root, 'result.json');
  const args = [...artifactArgs, '--result-path', resultPath];
  const binding = parseWorkspaceCallerCliArguments(args, parseWorkspaceSuccessArguments).binding;
  const outcome = { schemaVersion: 1, scenario: 'packagedWorkspaceSuccess', status: 'completed', errorCode: null,
    safetyErrorCode: null, failedPhase: null, processTreeAbsent: true, productProcessAbsent: true, fixtureRemoved: true, businessDataPreserved: true,
    phaseWriterResultCode: 'writerAbsent', phaseDiagnosticResultCode: 'deliveryUnverified', fixtureCleanupResultCode: 'fixtureRemoved',
    supervisorProcessResultCode: 'processCompleted', supervisorWorkerResultCode: 'workerResultValidated',
    supervisorCleanupResultCode: 'notRequired', scenarioResultCode: 'workspaceSuccessCompleted',
    initialProductStateResultCode: 'targetProductPresent', postconditionResultCode: 'exactProductsAbsent',
    removalPostconditionResultCode: 'installerFootprintAbsent', semanticCleanupResultCode: 'semanticCleanupCompleted',
    semanticProofResultCode: 'workspaceSemanticProofValidated', buildRevision: binding.buildRevision,
    artifactDescriptorSha256: binding.artifactDescriptorSha256, sourcePackageSha256: 'c'.repeat(64), targetPackageSha256: 'd'.repeat(64),
    profileFileCountBefore: 0, profileFileCountAfter: 0 };
  return { root, resultPath, args, binding, outcome, payload: { binding, outcome } };
}

test('caller result is closed, bound to this invocation and requires every success postcondition', async (t) => {
  const { payload, binding } = await fixture(t);
  assert.doesNotThrow(() => validateWorkspaceCallerResult(payload, binding));
  for (const key of ['path', 'session', 'companyId', 'pid', 'metadata', 'command', 'stack']) {
    assert.throws(() => validateWorkspaceCallerResult({ ...payload, outcome: { ...payload.outcome, [key]: 'private' } }, binding));
  }
  for (const [key, value] of [['phaseWriterResultCode', 'writerExitUnverified'], ['fixtureRemoved', false],
    ['businessDataPreserved', false], ['processTreeAbsent', false], ['productProcessAbsent', false],
    ['productProcessAbsent', undefined], ['productProcessAbsent', 'true'], ['postconditionResultCode', 'notChecked'],
    ['semanticCleanupResultCode', 'semanticCleanupProcessRemains'], ['errorCode', 'private']]) {
    assert.throws(() => validateWorkspaceCallerResult({ ...payload, outcome: { ...payload.outcome, [key]: value } }, binding));
  }
  assert.throws(() => validateWorkspaceCallerResult(payload, { ...binding, invocationId: '0'.repeat(32) }));
  assert.throws(() => validateWorkspaceCallerResult({ ...payload, outcome: { ...payload.outcome,
    status: 'failed', errorCode: 'scenarioResultInvalid', productProcessAbsent: false } }, binding));
  assert.throws(() => parseWorkspaceCallerResult(Buffer.from('{"binding":{},"binding":{}}'), binding));
  assert.throws(() => parseWorkspaceCallerResult(Buffer.alloc(8193), binding));
  let accessed = false;
  const getter = { ...payload.outcome, get session() { accessed = true; return 'private'; } };
  assert.throws(() => validateWorkspaceCallerResult({ ...payload, outcome: getter }, binding));
  assert.equal(accessed, false);
  assert.throws(() => validateWorkspaceCallerResult({ ...payload, outcome: { ...payload.outcome, [Symbol('hidden')]: 'private' } }, binding));
});

test('result file refuses reuse and preserves separate failed scenario and cleanup evidence', async (t) => {
  const input = await fixture(t);
  await workspaceCallerResultFile('prepare', input.resultPath, input.binding);
  await assert.rejects(workspaceCallerResultFile('prepare', input.resultPath, input.binding));
  const payload = { binding: input.binding, outcome: { ...input.outcome, status: 'failed', errorCode: 'sourceProductResultInvalid',
    failedPhase: 'targetInstall', scenarioResultCode: 'workspaceSuccessFailed',
    phaseWriterResultCode: 'writerExitUnverified', safetyErrorCode: 'phaseWriterExitUnverified',
    fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' } };
  await workspaceCallerResultFile('publish', input.resultPath, payload);
  const bytes = await readFile(input.resultPath);
  const published = parseWorkspaceCallerResult(bytes, input.binding).outcome;
  assert.equal(published.errorCode, 'sourceProductResultInvalid');
  assert.equal(published.failedPhase, 'targetInstall');
  assert.equal(published.safetyErrorCode, 'phaseWriterExitUnverified');
  assert.equal(published.fixtureCleanupResultCode, 'retainedUnverified');
  await assert.rejects(workspaceCallerResultFile('publish', input.resultPath, input.payload));
  assert.deepEqual(await readFile(input.resultPath), bytes);
  await assert.rejects(workspaceCallerResultFile('verify', input.resultPath, input.binding, 0));
  await assert.rejects(workspaceCallerResultFile('verify', input.resultPath, input.binding, 1));
});

test('verifier rejects absent result and nonzero exit even with successful bytes', async (t) => {
  const input = await fixture(t);
  await workspaceCallerResultFile('prepare', input.resultPath, input.binding);
  await assert.rejects(workspaceCallerResultFile('verify', input.resultPath, input.binding, 0));
  await workspaceCallerResultFile('publish', input.resultPath, input.payload);
  await assert.doesNotReject(workspaceCallerResultFile('verify', input.resultPath, input.binding, 0));
  await assert.rejects(workspaceCallerResultFile('verify', input.resultPath, input.binding, 1));
  await link(input.resultPath, resolve(input.root, 'linked-result.json'));
  await assert.rejects(workspaceCallerResultFile('verify', input.resultPath, input.binding, 0));
});

test('result-directory symlinks and unknown output locations are rejected', async (t) => {
  const input = await fixture(t);
  const other = await fixture(t);
  await workspaceCallerResultFile('prepare', other.resultPath, other.binding);
  await symlink(other.root, input.root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(workspaceCallerResultFile('prepare', input.resultPath, input.binding));
  await assert.rejects(workspaceCallerResultFile('publish', input.resultPath, input.payload));
  assert.throws(() => parseWorkspaceCallerCliArguments([...artifactArgs, '--result-path', resolve(dirname(input.root), 'result.json')], parseWorkspaceSuccessArguments));
  await assert.rejects(readFile(other.resultPath), { code: 'ENOENT' });
});

for (const mode of ['completed', 'scenarioFailed', 'prepareFailed', 'publishFailed', 'publisherUnverified', 'invalidOutcome', 'scenarioAndPublisherFailed']) {
  test(`mandatory CLI publication remains separate: ${mode}`, async (t) => {
    const input = await fixture(t);
    let starts = 0;
    const calls = [];
    const original = { ...input.outcome, status: 'failed', errorCode: 'scenarioResultInvalid' };
    const code = await runWorkspaceCallerCli(input.args, {
      parseScenario: parseWorkspaceSuccessArguments,
      runScenario: async () => { starts += 1; if (['scenarioFailed', 'scenarioAndPublisherFailed'].includes(mode)) throw new Error('private');
        return mode === 'invalidOutcome' ? { ...input.outcome, session: 'private' } : input.outcome; },
      failureDetails: () => original, errorCode: () => 'unexpectedFailure',
      resultProcess: async (request) => {
        calls.push(request);
        if ((mode === 'prepareFailed' && request.operation === 'prepare') ||
          (['publishFailed', 'publisherUnverified', 'scenarioAndPublisherFailed'].includes(mode) && request.operation === 'publish')) {
          if (mode === 'scenarioAndPublisherFailed') assert.equal(request.payload.outcome.errorCode, original.errorCode);
          return { status: 'failed', exitCode: null, directProcessAbsent: mode !== 'publisherUnverified' };
        }
        await workspaceCallerResultFile(request.operation, request.resultPath, request.payload);
        return { status: 'completed', exitCode: 0, directProcessAbsent: true };
      },
    });
    assert.equal(code, mode === 'completed' ? 0 : mode === 'scenarioFailed' ? 1 : 2);
    assert.equal(starts, mode === 'prepareFailed' ? 0 : 1);
    if (mode === 'scenarioFailed') {
      const published = parseWorkspaceCallerResult(await readFile(input.resultPath), input.binding);
      assert.equal(published.outcome.errorCode, 'scenarioResultInvalid');
    }
    if (mode === 'invalidOutcome') assert.deepEqual(calls.map((call) => call.operation), ['prepare']);
    if (!['completed', 'scenarioFailed'].includes(mode)) await assert.rejects(readFile(input.resultPath), { code: 'ENOENT' });
  });
}

test('result file adapter keeps its exact operation outcome and bounded cleanup separate', async (t) => {
  const input = await fixture(t);
  for (const result of [
    { status: 'failed', exitCode: null, directProcessAbsent: true, errorCode: 'timedOut' },
    { status: 'failed', exitCode: null, directProcessAbsent: false, errorCode: 'terminationUnconfirmed' },
  ]) {
    const actual = await runWorkspaceCallerResultProcess({ operation: 'publish', resultPath: input.resultPath, payload: input.payload,
      runProcess: async (request) => {
        assert.equal(request.command, process.execPath);
        assert.match(request.arguments[0], /workspaceCallerResultFile.mjs$/);
        assert.equal(request.timeoutMilliseconds, 30_000);
        assert.equal(request.terminationTimeoutMilliseconds, 5_000);
        assert.equal(JSON.parse(Buffer.from(request.arguments[3], 'base64')).outcome.status, 'completed');
        return result;
      } });
    assert.equal(actual, result);
  }
});

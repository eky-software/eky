import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runLegacyUpgradeCli, parseLegacyUpgradeArguments } from './runLegacyUpgrade.mjs';
import { LegacyUpgradeCommandFailure } from './legacyUpgradeFailureBoundary.mjs';
import { parseLegacyCallerArguments, parseLegacyCallerResult, validateLegacyCallerResult } from './legacyCallerResult.mjs';
import { legacyCallerResultFile } from './legacyCallerResultFile.mjs';
import { runLegacyCallerResultProcess } from './legacyCallerResultProcess.mjs';
import { LEGACY_SEMANTIC_POSTCONDITION_FAILURE_CODES } from './legacyUpgradePostcondition.mjs';
import { encodeWorkspacePhaseObservation, parseWorkspacePhaseObservation } from './workspacePhaseObservation.mjs';

async function fixture(t) {
  const root = resolve(await realpath(tmpdir()), 'eky-legacy-caller-' + randomBytes(16).toString('hex'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const args = ['--artifact-descriptor', resolve('legacy-upgrade-artifact.json'), '--expected-descriptor-sha256',
    'b'.repeat(64), '--expected-build-revision', 'a'.repeat(40), '--result-path', resolve(root, 'result.json')];
  const parsed = parseLegacyCallerArguments(args, parseLegacyUpgradeArguments);
  const outcome = { schemaVersion: 1, scenario: 'historicalLegacyUpgrade', status: 'completed',
    resultCode: 'historicalLegacyUpgradeCompleted', sourceClassification: 'historical-source-rebuild',
    sourceVersion: '0.2.6', targetVersion: '0.2.7', sourcePackageSha256: 'c'.repeat(64), targetPackageSha256: 'd'.repeat(64),
    legacyBusinessFixtureValidated: true, adoptedWorkspaceCount: 1, idempotentSecondStartup: true, businessDataPreserved: true,
    profileFileCountBefore: 0, profileFileCountAfter: 0, processTreeAbsent: true, fixtureRemoved: true,
    filesystemProcessAbsent: true, filesystemOperation: 'notFailed', filesystemErrorCode: null,
    phaseWriterResultCode: 'writerAbsent', phaseDiagnosticResultCode: 'deliveryUnverified', fixtureCleanupResultCode: 'fixtureRemoved',
    supervisorProcessResultCode: 'processCompleted', supervisorWorkerResultCode: 'workerResultValidated',
    supervisorCleanupResultCode: 'notRequired', scenarioResultCode: 'historicalLegacyUpgradeCompleted',
    semanticProofResultCode: 'legacySemanticProofValidated', semanticCleanupResultCode: 'semanticCleanupCompleted',
    postconditionResultCode: 'exactProductsAbsent' };
  return { ...parsed, args, outcome, payload: { binding: parsed.binding, outcome } };
}

test('legacy mandatory result is bound, closed and preserves its own success conditions', async (t) => {
  const { payload, binding } = await fixture(t);
  assert.doesNotThrow(() => validateLegacyCallerResult(payload, binding));
  for (const key of ['path', 'session', 'companyId', 'pid', 'stack', 'journal', 'metadata']) {
    assert.throws(() => validateLegacyCallerResult({ ...payload, outcome: { ...payload.outcome, [key]: 'private' } }, binding));
  }
  for (const [key, value] of [['processTreeAbsent', false], ['filesystemProcessAbsent', false],
    ['filesystemErrorCode', 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_TIMED_OUT'], ['phaseWriterResultCode', 'writerExitUnverified'],
    ['supervisorCleanupResultCode', 'cleanupUnverified'], ['fixtureRemoved', false], ['businessDataPreserved', false],
    ['idempotentSecondStartup', false], ['adoptedWorkspaceCount', 2], ['profileFileCountAfter', 1],
    ['sourcePackageSha256', 'private'], ['postconditionResultCode', 'targetProductPresent'], ['semanticCleanupResultCode', 'notRequired']]) {
    assert.throws(() => validateLegacyCallerResult({ ...payload, outcome: { ...payload.outcome, [key]: value } }, binding));
  }
  for (const key of ['invocationId', 'buildRevision', 'artifactDescriptorSha256']) {
    assert.throws(() => validateLegacyCallerResult(payload, { ...binding, [key]: '0'.repeat(binding[key].length) }));
  }
  assert.throws(() => parseLegacyCallerResult(Buffer.from('{"binding":{},"binding":{}}'), binding));
  assert.throws(() => parseLegacyCallerResult(Buffer.alloc(8193), binding));
  assert.throws(() => validateLegacyCallerResult({ ...payload, outcome: { ...payload.outcome,
    get status() { assert.fail('getter must not execute'); } } }, binding), { message: 'callerResultInvalid' });
});

test('legacy result requires actual command success and cannot overwrite evidence', async (t) => {
  const input = await fixture(t);
  await legacyCallerResultFile('prepare', input.resultPath, input.binding);
  await assert.rejects(legacyCallerResultFile('verify', input.resultPath, input.binding, 0));
  await legacyCallerResultFile('publish', input.resultPath, input.payload);
  await assert.doesNotReject(legacyCallerResultFile('verify', input.resultPath, input.binding, 0));
  await assert.rejects(legacyCallerResultFile('verify', input.resultPath, input.binding, 1));
  await assert.rejects(legacyCallerResultFile('publish', input.resultPath, input.payload));
  await assert.rejects(legacyCallerResultFile('prepare', input.resultPath, input.binding));
});

test('legacy required result preserves every closed semantic failure without accepting it', async (t) => {
  const { binding } = await fixture(t);
  for (const semanticProofResultCode of LEGACY_SEMANTIC_POSTCONDITION_FAILURE_CODES) {
    const outcome = { schemaVersion: 1, scenario: 'historicalLegacyUpgrade', status: 'failed',
      errorCode: 'WINDOWS_ACCEPTANCE_LEGACY_SEMANTIC_PROOF_FAILED', semanticProofResultCode,
      semanticCleanupResultCode: 'semanticCleanupFailed', fixtureRemoved: false };
    assert.deepEqual(validateLegacyCallerResult({ binding, outcome }, binding).outcome, outcome);
  }
});

for (const mode of ['completed', 'scenarioFailed', 'prepareFailed', 'publishFailed', 'publicationUnverified', 'invalidOutcome']) {
  test(`legacy CLI publication has separate command and delivery outcomes: ${mode}`, async (t) => {
    const input = await fixture(t);
    const original = { schemaVersion: 1, scenario: 'historicalLegacyUpgrade', status: 'failed',
      errorCode: 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED', processTreeAbsent: false,
      supervisorProcessResultCode: 'deadlineExceeded', supervisorWorkerResultCode: 'notChecked',
      supervisorCleanupResultCode: 'cleanupUnverified', semanticCleanupResultCode: 'blockedByOwnedProcessTree',
      fixtureCleanupResultCode: 'retainedUnverified', fixtureRemoved: false };
    let started = false;
    let supplied;
    const code = await runLegacyUpgradeCli(input.args, {
      async runScenario(args, binding) {
        started = true;
        assert.deepEqual(args, input.scenarioArgs);
        assert.deepEqual(binding, input.binding);
        if (mode === 'completed') return input.outcome;
        if (mode === 'invalidOutcome') return { ...input.outcome, path: 'private' };
        throw new LegacyUpgradeCommandFailure(original);
      },
      async resultProcess(request) {
        if (request.operation === 'publish') supplied = request.payload;
        if (mode === 'prepareFailed' || request.operation === 'publish' && ['publishFailed', 'publicationUnverified'].includes(mode)) {
          return { status: 'failed', exitCode: null, directProcessAbsent: mode !== 'publicationUnverified' };
        }
        await legacyCallerResultFile(request.operation, request.resultPath, request.payload);
        return { status: 'completed', exitCode: 0, directProcessAbsent: true };
      },
    });
    assert.equal(code, mode === 'completed' ? 0 : mode === 'scenarioFailed' ? 1 : 2);
    assert.equal(started, mode !== 'prepareFailed');
    if (['scenarioFailed', 'publishFailed', 'publicationUnverified'].includes(mode)) assert.deepEqual(supplied.outcome, original);
    if (mode === 'scenarioFailed') {
      const saved = parseLegacyCallerResult(await readFile(input.resultPath), input.binding);
      assert.deepEqual(saved.outcome, original);
      await assert.rejects(legacyCallerResultFile('verify', input.resultPath, input.binding, 0));
    }
  });
}

test('legacy result delivery reuses the bounded leaf without changing its result', async (t) => {
  const input = await fixture(t);
  const failure = { status: 'failed', resultCode: 'terminationUnconfirmed', directProcessAbsent: false, exitCode: null };
  const actual = await runLegacyCallerResultProcess({ operation: 'publish', resultPath: input.resultPath, payload: input.payload,
    async runProcess(request) {
      assert.equal(request.timeoutMilliseconds, 30_000);
      assert.equal(request.terminationTimeoutMilliseconds, 5_000);
      assert.match(request.arguments[0], /legacyCallerResultFile.mjs$/);
      return failure;
    } });
  assert.strictEqual(actual, failure);
});

test('legacy phase receipts have a closed namespace and never carry result or private data', () => {
  const observation = { schemaVersion: 1, operation: 'legacyAcceptanceCaller', scenario: 'historicalLegacyUpgrade',
    phase: 'supervisorClose', status: 'completed', durationMs: 0, elapsedMs: 1 };
  assert.deepEqual(parseWorkspacePhaseObservation(encodeWorkspacePhaseObservation(observation)), observation);
  for (const key of ['path', 'errorCode', 'session', 'pid', 'resultCode']) {
    assert.throws(() => encodeWorkspacePhaseObservation({ ...observation, [key]: 'private' }));
  }
  assert.throws(() => encodeWorkspacePhaseObservation({ ...observation, scenario: 'packagedWorkspaceSuccess' }));
  assert.throws(() => encodeWorkspacePhaseObservation({ ...observation, operation: 'workspaceAcceptanceCaller' }));
});

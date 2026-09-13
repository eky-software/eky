import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseCleanCallerArguments, parseCleanCallerResult, validateCleanCallerResult } from './cleanCallerResult.mjs';
import { cleanCallerResultFile } from './cleanCallerResultFile.mjs';
import { CLEAN_COMMAND_ERROR_CODES } from './cleanInstallUninstallFailureBoundary.mjs';

async function fixture(t) {
  const root = resolve(await realpath(tmpdir()), 'eky-clean-caller-' + randomBytes(16).toString('hex'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const args = ['--artifact-descriptor', resolve('clean-install-artifact.json'), '--expected-descriptor-sha256',
    'b'.repeat(64), '--expected-build-revision', 'a'.repeat(40), '--result-path', resolve(root, 'result.json')];
  const parsed = parseCleanCallerArguments(args);
  const outcome = { schemaVersion: 1, scenario: 'cleanInstallUninstall', status: 'completed', resultCode: 'cleanInstallUninstallCompleted',
    appVersion: '0.2.7', packageSha256: 'c'.repeat(64), profileFileCountBefore: 0, profileFileCountAfter: 0,
    processTreeAbsent: true, productProcessAbsent: true, fixtureRemoved: true, fixtureCleanupResultCode: 'fixtureRemoved',
    businessDataPreserved: true, installedStateValidated: true, uninstalledStateValidated: true,
    payloadValidated: true, repairValidated: true, reinstallValidated: true, installExitCode: 0, uninstallExitCode: 0,
    supervisorProcessResultCode: 'processCompleted', supervisorWorkerResultCode: 'workerResultValidated',
    supervisorCleanupResultCode: 'notRequired', scenarioResultCode: 'cleanInstallUninstallCompleted',
    productStateVerificationResultCode: 'exactProductAbsent', semanticCleanupResultCode: 'notRequired' };
  return { ...parsed, args, payload: { binding: parsed.binding, outcome } };
}

test('clean mandatory result preserves repair, reinstall, MSI and separate cleanup requirements', async (t) => {
  const { payload, binding } = await fixture(t);
  assert.doesNotThrow(() => validateCleanCallerResult(payload, binding));
  for (const [key, value] of [['processTreeAbsent', false], ['productProcessAbsent', false],
    ['supervisorCleanupResultCode', 'cleanupUnverified'], ['fixtureRemoved', false], ['businessDataPreserved', false],
    ['repairValidated', false], ['reinstallValidated', false], ['payloadValidated', false], ['installExitCode', 3010],
    ['uninstallExitCode', 1603], ['profileFileCountAfter', 1], ['productStateVerificationResultCode', 'exactProductPresent'],
    ['semanticCleanupResultCode', 'semanticCleanupFailed']]) {
    assert.throws(() => validateCleanCallerResult({ ...payload, outcome: { ...payload.outcome, [key]: value } }, binding));
  }
  for (const key of ['path', 'session', 'pid', 'stack', 'metadata']) {
    assert.throws(() => validateCleanCallerResult({ ...payload, outcome: { ...payload.outcome, [key]: 'private' } }, binding));
  }
  assert.throws(() => validateCleanCallerResult({ ...payload, outcome: { ...payload.outcome,
    get status() { assert.fail('getter must not execute'); } } }, binding), { message: 'callerResultInvalid' });
  for (const key of ['invocationId', 'buildRevision', 'artifactDescriptorSha256'])
    assert.throws(() => validateCleanCallerResult(payload, { ...binding, [key]: '0'.repeat(binding[key].length) }));
  assert.throws(() => parseCleanCallerResult(Buffer.from('{"binding":{},"binding":{}}'), binding));
  assert.throws(() => parseCleanCallerResult(Buffer.alloc(8193), binding));
});

test('clean result publication cannot overwrite evidence or substitute for command exit', async (t) => {
  const input = await fixture(t);
  await cleanCallerResultFile('prepare', input.resultPath, input.binding);
  await assert.rejects(cleanCallerResultFile('verify', input.resultPath, input.binding, 0));
  await cleanCallerResultFile('publish', input.resultPath, input.payload);
  await assert.doesNotReject(cleanCallerResultFile('verify', input.resultPath, input.binding, 0));
  await assert.rejects(cleanCallerResultFile('verify', input.resultPath, input.binding, 1));
  await assert.rejects(cleanCallerResultFile('publish', input.resultPath, input.payload));
});

test('clean failures retain primary error without claiming uncertain cleanup succeeded', async (t) => {
  const { binding } = await fixture(t);
  for (const errorCode of CLEAN_COMMAND_ERROR_CODES) {
    const outcome = { schemaVersion: 1, scenario: binding.scenario, status: 'failed', errorCode,
      processTreeAbsent: false, productProcessAbsent: false, supervisorCleanupResultCode: 'cleanupUnverified',
      fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' };
    assert.deepEqual(validateCleanCallerResult({ binding, outcome }, binding).outcome, outcome);
    assert.throws(() => validateCleanCallerResult({ binding, outcome: { ...outcome, fixtureRemoved: true } }, binding));
  }
});

test('clean CLI requires one explicit artifact with build, hash and result binding', async (t) => {
  const { args } = await fixture(t);
  assert.doesNotThrow(() => parseCleanCallerArguments(args));
  for (const invalid of [[], args.slice(0, 2), [...args, '--extra'], ['--', ...args],
    args.map((value, index) => index === 1 ? 'relative.json' : value)])
    assert.throws(() => parseCleanCallerArguments(invalid));
});

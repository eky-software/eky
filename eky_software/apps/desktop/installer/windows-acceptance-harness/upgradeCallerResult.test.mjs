import assert from 'node:assert/strict';
import { lstat, realpath, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseUpgradeCallerArguments, validateUpgradeCallerBinding, validateUpgradeCallerResult, upgradeCallerResultIdentity } from './upgradeCallerResult.mjs';
import { upgradeCallerResultFile } from './upgradeCallerResultFile.mjs';
import { syntheticUpgradeScenario } from './upgradeCommandFixture.mjs';
import { UPGRADE_COMMAND_ERROR_CODES } from './upgradeRollbackFailureBoundary.mjs';

const binding = validateUpgradeCallerBinding({ schemaVersion: 1, invocationId: 'd'.repeat(32), scenario: 'upgradeRollback',
  buildRevision: 'b'.repeat(40), artifactDescriptorSha256: 'a'.repeat(64) });
const proof = syntheticUpgradeScenario({ runNonce: 'c'.repeat(64), scenario: binding.scenario, artifactDescriptorSha256: binding.artifactDescriptorSha256 });
const completed = () => ({ binding, outcome: { schemaVersion: 1, scenario: binding.scenario, status: 'completed', resultCode: 'upgradeRollbackCompleted',
  sourceVersion: '0.2.7', targetVersion: '0.2.8', sourcePackageSha256: 'c'.repeat(64), targetPackageSha256: 'c'.repeat(64), windowsRollbackPackageSha256: 'c'.repeat(64),
  processTreeAbsent: true, productProcessAbsent: true, businessDataPreserved: true, fixtureRemoved: true, fixtureCleanupResultCode: 'fixtureRemoved',
  supervisorProcessResultCode: 'processCompleted', supervisorWorkerResultCode: 'workerResultValidated', supervisorCleanupResultCode: 'notRequired',
  scenarioResultCode: 'upgradeRollbackCompleted', applicationCleanupResultCode: 'completed', scenarioProof: proof,
  semanticCleanupResultCode: 'notRequired', initialProductStateResultCode: 'exactProductsAbsent',
  postconditionResultCode: 'exactProductsAbsent', profileFileCountBefore: 0, profileFileCountAfter: 0,
  upgradeExitCode: 0, runningUpgradeInitialExitCode: 0, runningUpgradeObservation: null } });

test('upgrade command result retains every scenario invariant and rejects reboot or unverified cleanup', () => {
  assert.equal(validateUpgradeCallerResult(completed(), binding).outcome.status, 'completed');
  for (const patch of [{ upgradeExitCode: 3010 }, { runningUpgradeInitialExitCode: 3010 }, { applicationCleanupResultCode: 'cleanupUnverified' },
    { productProcessAbsent: false }, { postconditionResultCode: 'targetProductPresent' },
    { initialProductStateResultCode: 'targetProductPresent' }, { initialProductStateResultCode: undefined },
    { postconditionResultCode: 'exactProductsAbsentAfterCleanup' }, { semanticCleanupResultCode: 'semanticCleanupCompleted' },
    { privatePath: 'private' }, { scenarioProof: undefined }]) {
    assert.throws(() => validateUpgradeCallerResult({ binding, outcome: { ...completed().outcome, ...patch } }, binding));
  }
  for (const patch of [{ downgradeRejected: false }, { binaryRollbackRestoredSource: false }, { windowsInstallerRollbackRestoredSource: false },
    { runningApplicationUpgradeValidated: false }, { downgradeExitCode: 3010 }, { windowsInstallerRollbackExitCode: 1641 }]) {
    assert.throws(() => validateUpgradeCallerResult({ binding, outcome: { ...completed().outcome, scenarioProof: { ...proof, ...patch } } }, binding));
  }
  const getter = completed();
  Object.defineProperty(getter.outcome, 'upgradeExitCode', { enumerable: true, get() { assert.fail('must not invoke a getter'); } });
  assert.throws(() => validateUpgradeCallerResult(getter, binding), /callerResultInvalid/);
});

test('upgrade result file requires real command success and cannot overwrite a prior result', async (t) => {
  const current = { ...binding, invocationId: randomBytes(16).toString('hex') };
  const parent = join(await realpath(tmpdir()), 'eky-upgrade-caller-' + current.invocationId);
  t.after(() => rm(parent, { recursive: true, force: true }));
  const path = join(parent, 'result.json');
  const value = { ...completed(), binding: current };
  await upgradeCallerResultFile('prepare', path, current);
  await assert.rejects(upgradeCallerResultFile('verify', path, current, 0));
  await upgradeCallerResultFile('publish', path, value);
  await upgradeCallerResultFile('verify', path, current, 0);
  await assert.rejects(upgradeCallerResultFile('verify', path, current, 1));
  await assert.rejects(upgradeCallerResultFile('publish', path, value));
  assert.equal((await lstat(path)).isFile(), true);
});

test('every closed upgrade failure preserves an unverified result without granting fixture removal', () => {
  for (const errorCode of UPGRADE_COMMAND_ERROR_CODES) {
    const result = { binding, outcome: { schemaVersion: 1, scenario: binding.scenario, status: 'failed', errorCode,
      processTreeAbsent: false, productProcessAbsent: false, applicationCleanupResultCode: 'cleanupUnverified',
      supervisorCleanupResultCode: 'cleanupUnverified', fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' } };
    assert.equal(validateUpgradeCallerResult(result, binding).outcome.errorCode, errorCode);
    assert.throws(() => validateUpgradeCallerResult({ ...result, outcome: { ...result.outcome, fixtureRemoved: true } }, binding));
  }
});

test('upgrade command requires the exact descriptor and invocation identity', () => {
  const path = join(tmpdir(), 'eky-upgrade-caller-' + binding.invocationId, 'result.json');
  const args = ['--artifact-descriptor', join(tmpdir(), 'upgrade-rollback-artifact.json'), '--expected-descriptor-sha256', binding.artifactDescriptorSha256,
    '--expected-build-revision', binding.buildRevision, '--result-path', path];
  assert.deepEqual(parseUpgradeCallerArguments(args).binding, upgradeCallerResultIdentity(path, binding));
  assert.throws(() => parseUpgradeCallerArguments([...args, '--extra']));
  assert.throws(() => parseUpgradeCallerArguments(args.map((value, index) => index === 1 ? join(tmpdir(), 'other.json') : value)));
});

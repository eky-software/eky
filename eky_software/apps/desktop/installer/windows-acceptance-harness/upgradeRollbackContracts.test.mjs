import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createUpgradeRollbackWorkerRequest,
  readUpgradeRollbackResult,
  readUpgradeRollbackWorkerRequest,
  upgradeRollbackResultPathForRequest,
  validateUpgradeRollbackResult,
  validateUpgradeRollbackWorkerRequest,
  writeJsonAtomicExclusive,
} from './upgradeRollbackContracts.mjs';

const HASH = 'a'.repeat(64);

function successfulResult(request) {
  return {
    schemaVersion: 1,
    runNonce: request.runNonce,
    scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: 'completed',
    resultCode: 'upgradeRollbackCompleted',
    errorCode: null,
    cleanupResultCode: 'notRequired',
    sourceInstallExitCode: 0,
    upgradeExitCode: 0,
    downgradeExitCode: 1638,
    binaryRollbackExitCode: 0,
    windowsInstallerRollbackExitCode: 1603,
    finalUninstallExitCode: 0,
    sourceInstalledStateValidated: true,
    majorUpgradeValidated: true,
    downgradeRejected: true,
    binaryRollbackRestoredSource: true,
    windowsInstallerRollbackRestoredSource: true,
    finalStateValidated: true,
    artifactBytesValidated: true,
  };
}

test('upgrade request and result require exact bound schemas', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-contract-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const requestPath = resolve(root, 'worker-request.json');
  const request = createUpgradeRollbackWorkerRequest({
    artifactDescriptorSha256: HASH,
    fixtureRoot: resolve(root, 'fixture'),
    runNonce: 'b'.repeat(64),
  });
  await writeJsonAtomicExclusive(requestPath, request);
  assert.deepEqual(await readUpgradeRollbackWorkerRequest(requestPath), request);

  const result = successfulResult(request);
  const resultPath = upgradeRollbackResultPathForRequest(requestPath);
  await writeJsonAtomicExclusive(resultPath, result);
  assert.deepEqual(await readUpgradeRollbackResult(resultPath, request), result);
  assert.throws(
    () => validateUpgradeRollbackWorkerRequest({ ...request, extra: true }),
    /WINDOWS_ACCEPTANCE_UPGRADE_REQUEST_INVALID/,
  );
  assert.throws(
    () =>
      validateUpgradeRollbackResult(
        { ...result, artifactDescriptorSha256: 'c'.repeat(64) },
        request,
      ),
    /WINDOWS_ACCEPTANCE_UPGRADE_RESULT_INVALID/,
  );
});

test('successful result requires each upgrade and rollback invariant', () => {
  const request = createUpgradeRollbackWorkerRequest({
    artifactDescriptorSha256: HASH,
    fixtureRoot: 'C:\\temp\\fixture',
    runNonce: 'b'.repeat(64),
  });
  const result = successfulResult(request);
  assert.deepEqual(validateUpgradeRollbackResult(result, request), result);
  for (const field of [
    'sourceInstalledStateValidated',
    'majorUpgradeValidated',
    'downgradeRejected',
    'binaryRollbackRestoredSource',
    'windowsInstallerRollbackRestoredSource',
    'finalStateValidated',
    'artifactBytesValidated',
  ]) {
    assert.throws(
      () =>
        validateUpgradeRollbackResult({ ...result, [field]: false }, request),
      /WINDOWS_ACCEPTANCE_UPGRADE_RESULT_INVALID/,
    );
  }
  assert.throws(
    () => validateUpgradeRollbackResult({ ...result, downgradeExitCode: 0 }, request),
    /WINDOWS_ACCEPTANCE_UPGRADE_RESULT_INVALID/,
  );
  assert.throws(
    () =>
      validateUpgradeRollbackResult(
        { ...result, windowsInstallerRollbackExitCode: 3010 },
        request,
      ),
    /WINDOWS_ACCEPTANCE_UPGRADE_RESULT_INVALID/,
  );
});

test('duplicate JSON keys and noncanonical paths fail closed', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-invalid-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const requestPath = resolve(root, 'request.json');
  await writeFile(
    requestPath,
    `{"schemaVersion":1,"schemaVersion":1,"runNonce":"${'a'.repeat(64)}"}\n`,
  );
  await assert.rejects(
    readUpgradeRollbackWorkerRequest(requestPath),
    /WINDOWS_ACCEPTANCE_UPGRADE_REQUEST_INVALID/,
  );
  assert.throws(
    () =>
      createUpgradeRollbackWorkerRequest({
        artifactDescriptorSha256: HASH,
        fixtureRoot: 'C:\\temp\\parent\\..\\fixture',
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_REQUEST_INVALID/,
  );
});

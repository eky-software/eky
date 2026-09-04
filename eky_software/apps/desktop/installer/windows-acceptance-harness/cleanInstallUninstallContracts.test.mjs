import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CLEAN_INSTALL_UNINSTALL_SCENARIO,
  createCleanInstallUninstallWorkerRequest,
  readCleanInstallUninstallResult,
  readCleanInstallUninstallWorkerRequest,
  validateCleanInstallUninstallResult,
  validateCleanInstallUninstallWorkerRequest,
  writeJsonAtomicExclusive,
} from './cleanInstallUninstallContracts.mjs';

function expectedBinding() {
  return {
    runNonce: 'a'.repeat(64),
    artifactDescriptorSha256: 'b'.repeat(64),
  };
}

function completedResult() {
  return {
    schemaVersion: 1,
    runNonce: 'a'.repeat(64),
    scenario: CLEAN_INSTALL_UNINSTALL_SCENARIO,
    artifactDescriptorSha256: 'b'.repeat(64),
    status: 'completed',
    resultCode: 'cleanInstallUninstallCompleted',
    errorCode: null,
    cleanupResultCode: 'notRequired',
    installExitCode: 0,
    uninstallExitCode: 0,
    installedStateValidated: true,
    uninstalledStateValidated: true,
  };
}

test('worker request is exact and bound to the clean lifecycle scenario', () => {
  const request = createCleanInstallUninstallWorkerRequest({
    ...expectedBinding(),
    fixtureRoot: join(process.cwd(), 'fixture'),
  });
  assert.equal(request.schemaVersion, 1);
  assert.equal(request.scenario, CLEAN_INSTALL_UNINSTALL_SCENARIO);
  assert.throws(
    () => validateCleanInstallUninstallWorkerRequest({ ...request, extra: true }),
    /WINDOWS_ACCEPTANCE_CLEAN_REQUEST_INVALID/,
  );
  assert.throws(
    () =>
      validateCleanInstallUninstallWorkerRequest({
        ...request,
        artifactDescriptorSha256: 'B'.repeat(64),
      }),
    /WINDOWS_ACCEPTANCE_CLEAN_REQUEST_INVALID/,
  );
});

test('clean lifecycle result requires exact successful postconditions', () => {
  const result = completedResult();
  assert.equal(
    validateCleanInstallUninstallResult(result, expectedBinding()).status,
    'completed',
  );
  assert.throws(
    () =>
      validateCleanInstallUninstallResult(
        { ...result, uninstalledStateValidated: false },
        expectedBinding(),
      ),
    /WINDOWS_ACCEPTANCE_CLEAN_RESULT_INVALID/,
  );
  assert.throws(
    () =>
      validateCleanInstallUninstallResult(
        { ...result, unknown: true },
        expectedBinding(),
      ),
    /WINDOWS_ACCEPTANCE_CLEAN_RESULT_INVALID/,
  );
});

test('atomic result writer refuses an occupied result path', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-contract-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = join(root, 'result.json');
  await writeJsonAtomicExclusive(resultPath, completedResult());
  await assert.rejects(
    writeJsonAtomicExclusive(resultPath, completedResult()),
    /WINDOWS_ACCEPTANCE_RESULT_PATH_OCCUPIED/,
  );
});

test('strict request and result readers reject duplicate JSON object keys', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-contract-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const requestPath = join(root, 'request.json');
  const resultPath = join(root, 'result.json');
  const request = createCleanInstallUninstallWorkerRequest({
    ...expectedBinding(),
    fixtureRoot: join(root, 'fixture'),
  });
  const serializedRequest = JSON.stringify(request);
  const serializedResult = JSON.stringify(completedResult());

  await writeFile(
    requestPath,
    serializedRequest.replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    ),
  );
  await writeFile(
    resultPath,
    serializedResult.replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    ),
  );

  await assert.rejects(
    readCleanInstallUninstallWorkerRequest(requestPath),
    /WINDOWS_ACCEPTANCE_CLEAN_REQUEST_INVALID/,
  );
  await assert.rejects(
    readCleanInstallUninstallResult(resultPath, expectedBinding()),
    /WINDOWS_ACCEPTANCE_CLEAN_RESULT_MISSING_OR_INVALID/,
  );
});

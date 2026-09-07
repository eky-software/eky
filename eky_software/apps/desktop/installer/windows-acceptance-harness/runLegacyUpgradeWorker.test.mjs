import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  cleanupRunContext,
  createRequest,
  createRunContext,
  isProcessAlive,
  startForeignSentinel,
  startSupervisor,
  waitForMarker,
  writeRequest,
} from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import {
  createLegacyUpgradeWorkerRequest,
  legacyUpgradeWorkerResultPathForRequest,
  legacyUpgradeResultPathForRequest,
  readLegacyUpgradeResult,
} from './legacyUpgradeContracts.mjs';
import { executeLegacyUpgradeLifecycle } from './legacyUpgradeLifecycle.mjs';
import { writeLegacyUpgradeWorkerOutcome } from './runLegacyUpgradeWorker.mjs';
import { legacyUpgradeFailureDetails, resolveLegacyUpgradeTerminalOutcome } from './legacyUpgradeFailureBoundary.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

async function createWorkerContext(t) {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = createLegacyUpgradeWorkerRequest({
    artifactDescriptorSha256: 'a'.repeat(64),
    fixtureRoot: resolve(root, 'artifact'),
  });
  return { request, requestPath: resolve(root, 'request.json') };
}

async function failedLifecycle() {
  return executeLegacyUpgradeLifecycle({
    inspectState: async () => { throw new Error('installerStateInspectionFailed'); },
  });
}

test('worker flushes both strict failure results before returning non-zero', async (t) => {
  const { request, requestPath } = await createWorkerContext(t);
  const exitCode = await writeLegacyUpgradeWorkerOutcome(requestPath, request, await failedLifecycle());
  assert.equal(exitCode, 1);
  const result = await readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(requestPath), request);
  assert.equal(result.errorCode, 'installerStateInspectionFailed');
  const terminal = JSON.parse(await readFile(legacyUpgradeWorkerResultPathForRequest(requestPath), 'utf8'));
  assert.deepEqual(terminal, {
    schemaVersion: 1,
    runNonce: request.runNonce,
    scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: 'failed',
    resultCode: 'historicalLegacyUpgradeFailed',
    errorCode: 'installerStateInspectionFailed',
  });
});

test('worker returns success only after writing a fully validated successful result', async (t) => {
  const { request, requestPath } = await createWorkerContext(t);
  const result = {
    ...(await failedLifecycle()),
    status: 'completed',
    resultCode: 'historicalLegacyUpgradeCompleted',
    errorCode: null,
    sourceInstallExitCode: 0,
    upgradeExitCode: 0,
    sourceStateValidated: true,
    sourceNormalStartupValidated: true,
    sourcePackagedSmokeValidated: true,
    legacyBusinessFixtureValidated: true,
    majorUpgradeValidated: true,
    targetFirstStartupValidated: true,
    targetSecondStartupValidated: true,
    artifactBytesValidated: true,
  };
  assert.equal(await writeLegacyUpgradeWorkerOutcome(requestPath, request, result), 0);
  assert.equal((await readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(requestPath), request)).status, 'completed');
});

test('worker result writer failure cannot overwrite an existing result or return success', async (t) => {
  const { request, requestPath } = await createWorkerContext(t);
  const terminalPath = legacyUpgradeWorkerResultPathForRequest(requestPath);
  await writeFile(terminalPath, 'existing-result', { flag: 'wx' });
  assert.equal(await writeLegacyUpgradeWorkerOutcome(requestPath, request, await failedLifecycle()), 1);
  assert.equal(await readFile(terminalPath, 'utf8'), 'existing-result');
});

test('failed legacy worker exits with a live child and the existing Job supervisor cleans it', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const context = await createRunContext('legacy-worker-failure');
  t.after(() => cleanupRunContext(context));
  context.scenario = 'historicalLegacyUpgrade';
  const sentinelContext = await createRunContext('legacy-foreign-sentinel');
  t.after(() => cleanupRunContext(sentinelContext));
  const sentinel = await startForeignSentinel(sentinelContext);
  const fixtureRoot = resolve(context.runRoot, 'artifact');
  await mkdir(fixtureRoot, { recursive: true });
  const request = createLegacyUpgradeWorkerRequest({ ...context, fixtureRoot });
  const workerRequestPath = resolve(context.testRoot, 'legacy-request.json');
  await writeFile(workerRequestPath, JSON.stringify(request), { flag: 'wx' });
  const supervisorRequest = createRequest(context, 'exitZero');
  supervisorRequest.arguments = [
    resolve(DIRECTORY, 'fixtures', 'legacyUpgradeWorkerProcessFixture.mjs'),
    workerRequestPath,
  ];
  await writeRequest(context, supervisorRequest);
  const execution = startSupervisor(context);
  const completion = await execution.completion;
  const supervisorResult = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
    ...context,
    supervisorExitCode: completion.exitCode,
  });
  const phases = [];
  const expectedPhases = ['requestRead', 'childSpawned', 'childReady', 'workerReturned', 'childAliveBeforeExit'];
  let progressText = '';
  try {
    progressText = await readFile(resolve(context.runRoot, 'legacy-worker-progress.jsonl'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('fixtureProgressUnreadable');
  }
  for (const line of progressText.trim().split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    assert.deepEqual(Object.keys(entry).sort(), ['phase', 'runNonce', 'schemaVersion']);
    assert.equal(entry.schemaVersion, 1);
    assert.equal(entry.runNonce, context.runNonce);
    assert.equal(expectedPhases.includes(entry.phase), true);
    phases.push(entry.phase);
  }
  t.diagnostic(JSON.stringify({ schemaVersion: 1, operation: 'legacyWorkerChildContract', phases }));
  assert.deepEqual(phases, expectedPhases, 'The fixture must prove its live child before supervisor cleanup is evaluated');
  const scenarioResult = await readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(workerRequestPath), request);
  assert.equal(scenarioResult.errorCode, 'unexpectedFailure');
  const child = await waitForMarker(context, 'grandchild');
  assert.equal(supervisorResult.processResultCode, 'processExitFailed');
  assert.equal(supervisorResult.childExitCode, 1);
  assert.equal(supervisorResult.cleanupResultCode, 'processTreeAbsent');
  assert.equal(supervisorResult.processTreeAbsent, true);
  assert.equal(completion.evidence.some((entry) => entry.phase === 'deadlineExceeded'), false);
  assert.equal(isProcessAlive(child.processId), false);
  assert.equal(isProcessAlive(sentinel.marker.processId), true);
  await assert.rejects(resolveLegacyUpgradeTerminalOutcome({
    supervisorResult,
    readScenarioResult: () => readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(workerRequestPath), request),
    verifyExactProductStates: async () => ({
      status: 'completed', resultCode: 'exactProductsAbsent',
      sourcePresent: false, targetPresent: false, installerRegistryPresent: false,
    }),
    cleanupExactProducts: () => assert.fail('No product was installed'),
  }), (error) => {
    const details = legacyUpgradeFailureDetails(error);
    assert.equal(details.errorCode, 'WINDOWS_ACCEPTANCE_LEGACY_UNEXPECTED_FAILURE');
    assert.equal(details.supervisorProcessResultCode, 'processExitFailed');
    assert.equal(details.processTreeAbsent, true);
    return true;
  });
});

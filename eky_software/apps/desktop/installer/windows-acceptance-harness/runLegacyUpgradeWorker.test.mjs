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
import { runLegacyUpgradeWorker, writeLegacyUpgradeWorkerOutcome } from './runLegacyUpgradeWorker.mjs';
import { encodeWorkspacePhaseObservation, parseWorkspacePhaseObservation } from './workspacePhaseObservation.mjs';
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

async function failedLifecycle(runtime = {}) {
  return executeLegacyUpgradeLifecycle({
    ...runtime,
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

test('worker publication receipts distinguish a published failure from failed publication', async (t) => {
  for (const conflict of [false, true]) {
    const { request, requestPath } = await createWorkerContext(t);
    if (conflict) await writeFile(legacyUpgradeWorkerResultPathForRequest(requestPath), 'first-result', { flag: 'wx' });
    const statuses = [];
    assert.equal(await writeLegacyUpgradeWorkerOutcome(requestPath, request, await failedLifecycle(), {
      observePublication(status) { statuses.push(status); throw new Error('private-observer'); },
    }), 1);
    assert.deepEqual(statuses, ['started', conflict ? 'failed' : 'completed']);
  }
});

for (const fault of ['none', 'constructor', 'send', 'finish', 'artifact', 'runtime']) {
  test(`worker optional observation preserves the first outcome: ${fault}`, { skip: process.platform !== 'win32' }, async (t) => {
    const { request, requestPath } = await createWorkerContext(t);
    await writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });
    const observations = [];
    let finishes = 0;
    const exitCode = await runLegacyUpgradeWorker(['--request', requestPath], {
      phaseObservation: { timeoutMilliseconds: 4_000, terminationTimeoutMilliseconds: 1_000 },
      createPhaseWriter() {
        if (fault === 'constructor') throw new Error('private-constructor');
        return {
          send(value) {
            observations.push(parseWorkspacePhaseObservation(encodeWorkspacePhaseObservation(value)));
            if (fault === 'send') throw new Error('private-send');
            return false; // Missing delivery is not a scenario failure.
          },
          async finish() { finishes += 1; if (fault === 'finish') throw new Error('private-finish'); },
        };
      },
      async verifyArtifact() {
        if (fault === 'artifact') throw new Error('artifactValidationFailed');
        return { source: { msiProductVersion: '0.2.6' }, target: { msiProductVersion: '0.2.7' } };
      },
      async createRuntime(_request, _artifact, { observeOwnedProcess }) {
        if (fault === 'runtime') throw new Error('runtimePreparationFailed');
        observeOwnedProcess('targetApplication', 'processExited');
        observeOwnedProcess('private-role', 'processExited');
        observeOwnedProcess('targetApplication', 'private-error');
        return {};
      },
      executeLifecycle: failedLifecycle,
    });
    assert.equal(exitCode, 1);
    const result = await readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(requestPath), request);
    assert.equal(result.errorCode, fault === 'artifact' ? 'artifactValidationFailed'
      : fault === 'runtime' ? 'runtimePreparationFailed' : 'installerStateInspectionFailed');
    assert.equal(finishes, fault === 'constructor' ? 0 : 1);
    if (fault !== 'constructor') {
      assert.equal(observations[0].phase, 'requestValidated');
      assert.deepEqual(observations.slice(-2).map(value => [value.phase, value.status]),
        [['resultPublication', 'started'], ['resultPublication', 'completed']]);
      if (['artifact', 'runtime'].includes(fault)) assert.ok(observations.some(value => value.phase ===
        (fault === 'artifact' ? 'artifactVerification' : 'runtimePreparation') && value.status === 'failed'));
      else assert.ok(observations.some(value => value.phase === 'preflight' && value.status === 'started'));
      assert.doesNotMatch(JSON.stringify(observations), /private|companyId|stack|fixtureRoot/);
    }
  });
}

for (const mode of ['heldBeforeLifecycle', 'childExitedBeforeTerminal', 'success']) {
  test(`worker observation crosses the existing Job before terminal: ${mode}`, {
    skip: process.platform !== 'win32', timeout: 30_000,
  }, async (t) => {
    const context = await createRunContext('legacy-worker-observation-' + mode);
    let verified = false;
    t.after(() => cleanupRunContext(context, { preserveEvidence: !verified || t.passed !== true }));
    context.scenario = 'historicalLegacyUpgrade';
    const request = createLegacyUpgradeWorkerRequest({ ...context, fixtureRoot: resolve(context.runRoot, 'artifact') });
    const inputPath = resolve(context.testRoot, 'observation-input.json');
    const requestPath = resolve(context.testRoot, 'legacy-request.json');
    await writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });
    await writeFile(inputPath, JSON.stringify({ mode, requestPath, runRoot: context.runRoot,
      workerResultPath: context.workerResultPath }), { flag: 'wx' });
    const supervisorRequest = createRequest(context, 'exitZero', {
      timeoutMilliseconds: 8_000, cleanupReserveMilliseconds: 1_000,
    });
    supervisorRequest.arguments = [resolve(DIRECTORY, 'fixtures', 'legacyWorkerObservationFixture.mjs'), inputPath];
    await writeRequest(context, supervisorRequest);
    const releasePath = resolve(context.testRoot, 'observation-release');
    let release;
    const execution = startSupervisor(context, {
      observeEvidence(entry) {
        if (mode === 'childExitedBeforeTerminal' && entry.operation === 'legacyUpgradeWorker' &&
            entry.phase === 'targetApplication' && entry.resultCode === 'processClosed' && !release) {
          release = writeFile(releasePath, '', { flag: 'wx' });
          release.catch(() => undefined);
        }
      },
    });
    const completed = await execution.completion;
    if (release) await release;
    const terminal = await readWindowsAcceptanceSupervisorResult(context.resultPath, { ...context,
      supervisorExitCode: completed.exitCode });
    assert.equal(terminal.processTreeAbsent, true);
    const entries = completed.evidence.filter(value => value.operation === 'legacyUpgradeWorker');
    if (mode !== 'success') {
      assert.equal(completed.evidence.some(value => value.phase === 'terminalWait' && value.resultCode === 'rootProcessPending'), true);
      assert.ok(entries.some(value => value.phase === 'artifactVerification' && value.status === 'started'));
    }
    if (mode === 'heldBeforeLifecycle') {
      assert.equal(terminal.processResultCode, 'deadlineExceeded');
      assert.equal(terminal.cleanupResultCode, 'processTreeAbsent');
      assert.equal(entries.some(value => value.phase === 'runtimePreparation'), false);
    } else if (mode === 'childExitedBeforeTerminal') {
      assert.ok(entries.some(value => value.resultCode === 'processExited'));
      assert.ok(entries.some(value => value.resultCode === 'processClosed'));
      assert.equal(terminal.processResultCode, 'processExitFailed');
      // A closed input can let the leaf exit before Job cleanup is needed.
      assert.ok(['notRequired', 'processTreeAbsent'].includes(terminal.cleanupResultCode));
      assert.equal(entries.some(value => value.phase === 'resultPublication'), false);
      await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
    } else {
      assert.equal(completed.exitCode, 0);
      assert.equal(terminal.workerResultCode, 'workerResultValidated');
      assert.equal(terminal.cleanupResultCode, 'notRequired');
      assert.equal((await readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(requestPath), request)).status, 'completed');
    }
    verified = true;
  });
}

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

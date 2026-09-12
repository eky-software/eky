import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanupRunContext, createRunContext }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { INSPECTOR_TIMEOUT_MILLISECONDS } from './installerProductOperationRuntime.mjs';

const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: INSPECTOR_TIMEOUT_MILLISECONDS };
const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);

function runInspector(powershell, resultPath, { failProductState = false, observationMode, observationPath } = {}) {
  const queryFailureCommand = `
    function New-Object {
      param([string]$ComObject)
      if ($ComObject -cne 'WindowsInstaller.Installer') { throw 'unexpectedComRequest' }
      # A real COM handle without ProductState exercises the query failure and release.
      Microsoft.PowerShell.Utility\\New-Object -ComObject Scripting.Dictionary
    }
    & $env:EKY_TEST_INSPECTOR_SCRIPT -ProductCode '{00000000-0000-0000-0000-000000000000}' -ResultPath $env:EKY_TEST_INSPECTOR_RESULT
    exit $LASTEXITCODE
  `;
  const invocation = observationMode
    ? ['-File', join(dirname(SCRIPT_PATH), 'fixtures', 'inspectorObservationFixture.ps1'),
        '-ResultPath', resultPath, '-ObservationPath', observationPath, '-Mode', observationMode]
    : failProductState
    ? [
        '-EncodedCommand',
        Buffer.from(queryFailureCommand, 'utf16le').toString('base64'),
      ]
    : [
        '-File',
        SCRIPT_PATH,
        '-ProductCode',
        '{00000000-0000-0000-0000-000000000000}',
        '-ResultPath',
        resultPath,
      ];
  const child = spawn(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      ...invocation,
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        EKY_TEST_INSPECTOR_SCRIPT: SCRIPT_PATH,
        EKY_TEST_INSPECTOR_RESULT: resultPath,
      },
    },
  );
  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise);
    child.once('close', resolvePromise);
  });
  return Object.freeze({ child, completion });
}

const ABSENT_PRODUCT_PHASES = [
  'scriptStarted', 'requestValidated', 'comCreationStarted', 'comCreationCompleted',
  'productStateStarted', 'productStateCompleted',
  'registryInspectionStarted', 'registryInspectionCompleted',
  'processInspectionStarted', 'processInspectionCompleted',
  'resultSerializeStarted', 'resultSerializeCompleted', 'resultWriteStarted', 'resultWriteCompleted',
  'resultPublishStarted', 'resultPublishCompleted', 'comReleaseStarted', 'comReleaseCompleted', 'scriptFinished',
];

async function observeInspection(context, signal, phases, phase, start) {
  signal.throwIfAborted();
  const started = performance.now();
  const observation = {
    phase, status: 'started', exitCode: null,
    launchDurationMs: null, spawnObserved: false, durationMs: null,
  };
  phases.push(observation);
  const execution = start();
  observation.launchDurationMs = Math.floor(performance.now() - started);
  execution.child.once('spawn', () => { observation.spawnObserved = true; });
  context.fixtureProcesses.add(execution.child);
  try {
    observation.exitCode = await execution.completion;
  } catch (error) {
    observation.status = 'processError';
    throw error;
  } finally {
    observation.durationMs = Math.floor(performance.now() - started);
  }
  observation.status = 'closed';
  signal.throwIfAborted();
  return observation.exitCode;
}

test('inspector cancellation preserves late completion and prevents the next query', async () => {
  const controller = new AbortController();
  const context = { fixtureProcesses: new Set() };
  const phases = [];
  const child = new EventEmitter();
  let close;
  let starts = 0;
  const start = () => {
    starts += 1;
    return { child, completion: new Promise((resolvePromise) => { close = resolvePromise; }) };
  };
  const pending = observeInspection(context, controller.signal, phases, 'canonical', start);
  child.emit('spawn');
  const cancellation = new Error('testCancelled');
  controller.abort(cancellation);
  const rejected = assert.rejects(pending, (error) => error === cancellation);
  close(0);
  await rejected;
  await assert.rejects(
    observeInspection(context, controller.signal, phases, 'transported', start),
    (error) => error === cancellation,
  );
  assert.equal(starts, 1);
  assert.deepEqual(phases.map(({ durationMs, launchDurationMs, ...phase }) => phase), [
    { phase: 'canonical', status: 'closed', exitCode: 0, spawnObserved: true },
  ]);
  assert.ok(Number.isSafeInteger(phases[0].durationMs) && phases[0].durationMs >= 0);
  assert.ok(Number.isSafeInteger(phases[0].launchDurationMs) && phases[0].launchDurationMs >= 0);
  assert.deepEqual([...context.fixtureProcesses], [child]);
});

for (const phase of ['canonical', 'transported', 'rejectedPath', 'queryFailure']) test(
  `Windows PowerShell 5.1 inspector contract: ${phase}`,
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await createRunContext('state-inspector');
    const root = context.testRoot;
    const expectedResultPath = join(root, 'state.json');
    const resultPath = phase === 'transported'
      ? expectedResultPath.replaceAll('\\', '\\\\')
      : phase === 'rejectedPath' ? `${join(root, 'parent')}\\..\\state.json`
        : expectedResultPath;
    const powershell = resolve(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const phases = [];
    let verified = false;
    testContext.after(async () => {
      let cleanup = 'unverified';
      const passed = verified && !testContext.signal.aborted;
      try {
        await cleanupRunContext(context, { preserveEvidence: !passed });
        cleanup = 'verified';
      } finally {
        try { testContext.diagnostic(JSON.stringify({ inspectorPhases: phases, cleanup })); }
        catch { /* Diagnostics cannot replace the test or cleanup failure. */ }
      }
    });
    const exitCode = await observeInspection(
      context, testContext.signal, phases, phase,
      () => runInspector(powershell, resultPath, { failProductState: phase === 'queryFailure' }),
    );
    const expectedExit = phase === 'rejectedPath' ? 64 : phase === 'queryFailure' ? 1 : 0;
    assert.equal(exitCode, expectedExit);
    if (expectedExit === 0) {
      assert.deepEqual(JSON.parse(await readFile(expectedResultPath, 'utf8')), {
        schemaVersion: 1,
        productState: -1,
        productName: null,
        productVersion: null,
        localPackagePresent: false,
        ownedRegistryExists: false,
        ekyProcessCount: 0,
      });
    } else {
      await assert.rejects(access(expectedResultPath), { code: 'ENOENT' });
    }
    verified = true;
  },
);

for (const mode of ['completed', 'queryFailure', 'observerFailure', 'foreignProvider']) test(
  `inspector emits payload-free native boundaries without changing its outcome: ${mode}`,
  WINDOWS_ONLY,
  async (t) => {
    const context = await createRunContext('inspector-observation-' + mode);
    let verified = false;
    t.after(() => cleanupRunContext(context, { preserveEvidence: !verified }));
    const resultPath = join(context.testRoot, 'state.json');
    const observationPath = join(context.testRoot, 'observation.json');
    const powershell = resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const execution = runInspector(powershell, resultPath, { observationMode: mode, observationPath });
    context.fixtureProcesses.add(execution.child);
    const receipts = [];
    execution.child.once('exit', () => receipts.push('exit'));
    execution.child.once('close', () => receipts.push('close'));
    assert.equal(await execution.completion, mode === 'queryFailure' ? 1 : 0);
    assert.deepEqual(receipts, ['exit', 'close']);
    const observation = JSON.parse(await readFile(observationPath, 'utf8'));
    const expected = mode === 'queryFailure'
      ? [...ABSENT_PRODUCT_PHASES.slice(0, 5), 'inspectionFailed', 'comReleaseStarted', 'comReleaseCompleted', 'scriptFinished']
      : ABSENT_PRODUCT_PHASES;
    assert.deepEqual(observation, { schemaVersion: 1, events: expected.map((phase) => ({ phase, payloadCount: 0 })) });
    if (mode === 'queryFailure') await assert.rejects(access(resultPath), { code: 'ENOENT' });
    else assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), {
      schemaVersion: 1, productState: -1, productName: null, productVersion: null,
      localPackagePresent: false, ownedRegistryExists: false, ekyProcessCount: 0,
    });
    verified = true;
  },
);

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanupRunContext, createRunContext }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';

const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: 20_000 };
const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);

function runInspector(powershell, resultPath, { failProductState = false } = {}) {
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
  const invocation = failProductState
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

test(
  'Windows PowerShell 5.1 inspector distinguishes absent products from query failure',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await createRunContext('state-inspector');
    const root = context.testRoot;
    const resultPath = join(root, 'state.json');
    const transportedResultPath = join(root, 'transported-state.json').replaceAll(
      '\\',
      '\\\\',
    );
    const rejectedResultPath = `${join(root, 'parent')}\\..\\rejected.json`;
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
    const inspect = (phase, path, options) => observeInspection(
      context, testContext.signal, phases, phase,
      () => runInspector(powershell, path, options),
    );

    const exitCode = await inspect('canonical', resultPath);
    assert.equal(exitCode, 0);
    const expected = {
      schemaVersion: 1,
      productState: -1,
      productName: null,
      productVersion: null,
      localPackagePresent: false,
      ownedRegistryExists: false,
      ekyProcessCount: 0,
    };
    assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), expected);

    assert.equal(await inspect('transported', transportedResultPath), 0);
    assert.deepEqual(
      JSON.parse(
        await readFile(join(root, 'transported-state.json'), 'utf8'),
      ),
      expected,
    );

    assert.equal(await inspect('rejectedPath', rejectedResultPath), 64);
    await assert.rejects(access(join(root, 'rejected.json')), { code: 'ENOENT' });

    const failedResultPath = join(root, 'query-failed.json');
    const failedExit = await inspect('queryFailure', failedResultPath, {
      failProductState: true,
    });
    assert.equal(failedExit, 1);
    await assert.rejects(access(failedResultPath), { code: 'ENOENT' });
    verified = true;
  },
);

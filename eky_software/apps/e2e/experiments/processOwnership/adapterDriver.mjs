import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bridgeDrainFile, bridgeDrainLimit, bridgeFailureFile, encodeFrame, streamLimit, validateAdapterTerminal,
  parseBridgeDrainCompletion, validateCaseEvidence, workloadOutcomes } from './adapterContract.mjs';
import { beforeDeadline, connectAdapter } from './adapterControl.mjs';
import { captureLaunchOutcome, stopRootBeforeBridge } from './adapterRootExitOrdering.mjs';
import { boundedFailureDetails, observeBoundedChildOutput } from './boundedChildOutput.mjs';

const require = createRequire(import.meta.url);
const { workspace, writeOnce } = require('./adapterFixture.cjs');
const { isExpectedElectronLaunchFailure } = require('./electronLaunchFailure.cjs');
const info = workspace();
const { cwd, root, generation, scenario } = info;
const deadline = performance.now() + 23_000;
let phase = 'setup';
let control;
let owner;
let ownerResult;
let ownerOutput;
let nativeFailure;
let terminal;
let checks;
let failure;
let bridgeExitCode = null;
let rootBeforeStop = null;
let bridgeDrainCompletion = null;
let launchOutcome;

function assertOwnerHealthy() {
  if (nativeFailure) throw nativeFailure;
  ownerOutput?.assertHealthy();
}

function ownerOperation(promise) {
  return beforeDeadline(ownerOutput.guard(promise), deadline);
}

function remainingOperationTime() {
  const remaining = Math.min(10_000, Math.floor(deadline - performance.now()));
  assert.ok(remaining > 0, 'adapterDeadlineExceeded');
  return remaining;
}

async function connectWhenReady() {
  while (performance.now() < deadline) {
    assertOwnerHealthy();
    assert.equal(owner.exitCode, null, 'ownerExitedBeforeReady');
    try { return await connectAdapter(generation, deadline); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(20);
  }
  throw new Error('adapterDeadlineExceeded');
}

function isolatedEnvironment(configPath) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'DOTNET_ROOT']) {
    const entry = Object.entries(process.env).find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (entry) env[name] = entry[1];
  }
  for (const name of ['EKY_E2E', 'EKY_T3C_ROOT', 'EKY_T3C_GENERATION', 'EKY_T3C_TEMP_BASE',
    'EKY_T3C_CASE', 'EKY_T3C_NODE']) env[name] = process.env[name];
  for (const name of ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE']) {
    env[name] = path.join(cwd, name.toLowerCase());
    mkdirSync(env[name], { mode: 0o700 });
  }
  return { ...env, TEMP: path.join(cwd, 'tmp'), TMP: path.join(cwd, 'tmp'),
    EKY_T3C_CONFIG: configPath, EKY_T3C_MARKER: 'synthetic-marker' };
}

function boundedBytes(name, limit = streamLimit) {
  const filename = path.join(cwd, name);
  const info = lstatSync(filename);
  assert.ok(info.isFile() && info.nlink === 1 && info.size <= limit);
  const bytes = readFileSync(filename);
  assert.ok(bytes.length <= limit);
  return bytes;
}

function boundedJson(name) {
  return JSON.parse(boundedBytes(name).toString('utf8'));
}

function assertNoBridgeFailure() {
  try { lstatSync(path.join(cwd, bridgeFailureFile)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('bridgeFailureRecorded');
}

async function stopOwner() {
  if (!terminal) terminal = await control.request('stop');
  return terminal;
}

async function waitState(predicate) {
  while (performance.now() < deadline) {
    assertOwnerHealthy();
    // Let a bounded control request settle before cleanup sends its own stop.
    const state = await control.request('status');
    assertOwnerHealthy();
    assert.equal(state.failure, null);
    if (predicate(state)) return state;
    await delay(20);
  }
  throw new Error('adapterObservationExpired');
}

function markerObserver(stream, marker) {
  assert.ok(stream);
  let buffer = Buffer.alloc(0);
  let overflow = false;
  let error = false;
  stream.on('data', chunk => {
    const remaining = streamLimit - buffer.length;
    overflow ||= chunk.length > remaining;
    buffer = Buffer.concat([buffer, chunk.subarray(0, remaining)]);
  });
  stream.on('error', () => { error = true; });
  return () => !overflow && !error && buffer.includes(Buffer.from(marker + '\n'));
}

async function run() {
  const adapter = realpathSync(process.env.EKY_T3C_ADAPTER);
  assert.ok(statSync(adapter).isFile());
  const electron = realpathSync(process.env.EKY_T3A_ELECTRON);
  const e2ePackage = process.env.EKY_T3A_E2E_PACKAGE;
  assert.equal(JSON.parse(readFileSync(e2ePackage)).name, '@eky/e2e');
  const { _electron, errors } = createRequire(e2ePackage)('@playwright/test');
  const configPath = path.join(cwd, 'adapter-config.json');
  const env = isolatedEnvironment(configPath);
  const launchNonce = process.env.EKY_T3C_NONCE;
  assert.match(launchNonce, /^[a-f0-9]{64}$/);
  const args = [path.join(cwd, 'adapterElectron.cjs'), 'synthetic arg with spaces'];
  const config = { schemaVersion: 1, generation, launchNonce, electron, cwd, tempRoot: root, environment: env };
  encodeFrame({ schemaVersion: 1, generation, nonce: launchNonce, kind: 'launch',
    args: ['--inspect=0', '--remote-debugging-port=0', ...args], cwd, environment: env });
  writeFileSync(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  phase = 'ownerReady';
  owner = spawn(adapter, ['--owner', configPath], {
    cwd, env: { ...env, EKY_T3A_TEMP_BASE: process.env.EKY_T3C_TEMP_BASE },
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  ownerOutput = observeBoundedChildOutput(owner);
  ownerOutput.failed.catch(error => { nativeFailure ??= error; });
  owner.stdin.on('error', error => { if (!terminal) nativeFailure ??= error; });
  ownerResult = new Promise(resolve => {
    owner.once('error', error => { nativeFailure ??= error; });
    owner.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  control = await connectWhenReady();
  assertOwnerHealthy();
  const initial = await control.request('status');
  assertOwnerHealthy();
  assert.equal(initial.launched, false);
  assert.equal(initial.activeProcesses, 0);
  assert.equal(initial.failure, null);
  phase = 'launch';
  mkdirSync(path.join(cwd, 'playwright-artifacts'));
  const launch = () => _electron.launch({ executablePath: adapter, cwd, env, args,
    artifactsDir: path.join(cwd, 'playwright-artifacts'), chromiumSandbox: true, timeout: remainingOperationTime() });
  if (scenario === 'beforeReady') {
    launchOutcome = captureLaunchOutcome(launch);
    ({ rootBeforeStop } = await stopRootBeforeBridge({ deadline, expectedExitCode: 29, stopOwner,
      observeRoot: async () => {
        const state = await waitState(state => state.rootExited && state.rootExitCode === 29 && state.activeProcesses > 0 && state.descendantsAfterRoot);
        assert.deepEqual(boundedJson('adapter-before-ready.json'),
          { schemaVersion: 1, generation, beforeReady: true, leafAcknowledged: true });
        return state;
      },
      settleBridge: async () => {
        const outcome = await ownerOperation(launchOutcome);
        assertOwnerHealthy();
        assert.equal(outcome.status, 'rejected', 'launchUnexpectedlySucceeded');
        assert.ok(isExpectedElectronLaunchFailure(outcome.error, errors.TimeoutError));
        assertNoBridgeFailure();
        bridgeDrainCompletion = parseBridgeDrainCompletion(boundedBytes(bridgeDrainFile, bridgeDrainLimit), generation, 29);
      },
    }));
    checks = { launchRejected: true, beforeReady: true, leafAcknowledged: true, notTimeout: true,
      descendantsAfterRoot: true, bridgeFailureAbsent: true };
  } else {
    const application = await ownerOperation(launch());
    const launched = application.process();
    const bridgeClosed = new Promise((resolve, reject) => {
      launched.once('error', reject);
      launched.once('close', (code, signal) => resolve({ code, signal }));
    });
    bridgeClosed.catch(() => {});
    const page = await ownerOperation(application.firstWindow({ timeout: remainingOperationTime() }));
    assert.equal(await ownerOperation(page.locator('main').textContent({ timeout: remainingOperationTime() })), 'synthetic-marker');
    const stdoutSeen = markerObserver(application.process().stdout, 'T3C_SYNTHETIC_STDOUT');
    const stderrSeen = markerObserver(application.process().stderr, 'T3C_SYNTHETIC_STDERR');
    const observed = await ownerOperation(application.evaluate(({ BrowserWindow }, expectedCwd) => {
      const window = BrowserWindow.getAllWindows()[0];
      const preferences = window.webContents.getLastWebPreferences();
      process.stdout.write('T3C_SYNTHETIC_STDOUT\n');
      process.stderr.write('T3C_SYNTHETIC_STDERR\n');
      return {
        arguments: process.argv.includes('synthetic arg with spaces'),
        environment: process.env.EKY_T3C_MARKER === 'synthetic-marker',
        cwd: process.cwd() === expectedCwd,
        sandbox: preferences.sandbox === true && preferences.contextIsolation === true &&
          preferences.nodeIntegration === false && preferences.webSecurity === true && !window.isVisible(),
      };
    }, cwd));
    for (const result of Object.values(observed)) assert.equal(result, true);
    await waitState(state => state.launched && state.assignedBeforeResume && !state.rootExited && state.activeProcesses > 0);
    phase = 'scenario';
    if (scenario === 'normal') {
      await ownerOperation(application.close());
      assert.deepEqual(await ownerOperation(bridgeClosed), { code: 0, signal: null });
      bridgeExitCode = 0;
      await waitState(state => state.rootExited && state.rootExitCode === 0);
      assert.ok(stdoutSeen() && stderrSeen());
      checks = { pageApi: true, ...observed, stdio: true, normalClose: true };
    } else if (scenario === 'rootFirst') {
      await ownerOperation(application.evaluate(({ app }) => { setImmediate(() => app.exit(0)); }));
      ({ rootBeforeStop } = await stopRootBeforeBridge({ deadline, expectedExitCode: 0, stopOwner,
        observeRoot: () => waitState(state => state.rootExited && state.rootExitCode === 0 && state.descendantsAfterRoot && state.activeProcesses > 0),
        settleBridge: async () => assert.deepEqual(await ownerOperation(bridgeClosed), { code: 0, signal: null }),
      }));
      bridgeExitCode = 0;
      checks = { pageApi: true, rootExitObserved: true, descendantsAfterRoot: true };
    } else {
      await control.request('breakBridge');
      assert.deepEqual(await ownerOperation(bridgeClosed), { code: 41, signal: null });
      bridgeExitCode = 41;
      await waitState(state => state.bridgeLost && !state.rootExited && state.activeProcesses > 0);
      assert.equal(owner.exitCode, null);
      checks = { pageApi: true, bridgeExitObserved: true, rootStillAlive: true, ownerStillAlive: true };
    }
  }
  assertOwnerHealthy();
  phase = 'innerTerminal';
  await stopOwner();
  await control.finish();
  owner.stdin.end();
  phase = 'ownerExit';
  assert.deepEqual(await ownerOperation(ownerResult), { code: 0, signal: null });
  assertOwnerHealthy();
  assert.deepEqual(validateAdapterTerminal(boundedJson('adapter-terminal.json'), generation), terminal);
  if (scenario === 'beforeReady') assertNoBridgeFailure();
  const evidence = { schemaVersion: 1, generation, scenario, workloadOutcome: workloadOutcomes[scenario], bridgeExitCode,
    rootBeforeStop, bridgeDrainCompletion, checks: { ...checks,
    ownerExited: true, terminalAccepted: true, outerInterventionAbsent: true }, terminal };
  validateCaseEvidence(evidence, scenario, generation);
  writeOnce('adapter-evidence.json', evidence);
}

try { await run(); }
catch (error) {
  failure = nativeFailure ?? ownerOutput?.failure ?? error;
  try {
    if (control) await stopOwner();
  } catch { /* The outer Job remains emergency containment, never acceptance. */ }
  if (launchOutcome) {
    try {
      const outcome = await beforeDeadline(launchOutcome, deadline);
      if (outcome.status === 'fulfilled') await beforeDeadline(outcome.application.close(), deadline);
    } catch { /* An unsettled launch remains failed; the outer Job contains it. */ }
  }
  control?.destroy();
  owner?.stdin.end();
  if (ownerResult) {
    try { await beforeDeadline(ownerResult, deadline); } catch { /* Retain failed evidence. */ }
  }
}
if (ownerOutput) {
  try {
    writeFileSync(path.join(cwd, 'adapter-owner-output.private.log'), ownerOutput.output, { flag: 'wx', mode: 0o600 });
  } catch (error) { failure ??= error; }
}
if (failure) writeFileSync(path.join(cwd, 'adapter-error.private.log'),
  boundedFailureDetails(failure), { flag: 'wx', mode: 0o600 });
writeOnce('workload.json', { case: 'electronNormal', stage: failure ? 'failed' : 'ready', phase,
  code: failure ? 'adapterExperimentFailed' : 'adapterExperimentCompleted' });
process.exit(failure ? 1 : 0);

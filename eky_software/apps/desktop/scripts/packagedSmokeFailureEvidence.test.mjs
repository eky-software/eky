import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as preparationFiles from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { createServer } from 'node:net';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { capturePackagedSmokePhaseOutput, observeSmokeOutput } from './packagedSmokeFailureEvidence.mjs';
import { packagedSmokeTimeoutMilliseconds, packagedSmokeWorkflowTimeoutMilliseconds,
  packagedSmokeJobCallerReserveMilliseconds, packagedSmokeJobPublicationReserveMilliseconds,
  packagedSmokeJobStartupReserveMilliseconds } from './packagedSmokeLimits.mjs';
import { createE2eFixtureLifetime } from '../../e2e/src/environment/e2eFixtureLifetime.ts';
import { loopbackPortReleaseTimeoutMilliseconds, waitForLoopbackPortRelease }
  from '../../e2e/src/environment/waitForLoopbackPortRelease.ts';

test('packaged comparison helpers load in the Node runner without Electron', async () => {
  const sourceRoot = new URL('../src/', import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      assert.notEqual(specifier, 'electron', 'comparison helpers must not load the Electron runtime');
      if (context.parentURL?.startsWith(sourceRoot) && specifier.endsWith('.js') && specifier.startsWith('.')) {
        return nextResolve(new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL).href, context);
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url.startsWith(sourceRoot) && new URL(url).pathname.endsWith('.ts')) {
        return { ...loaded, format: 'module', source: stripTypeScriptTypes(String(loaded.source), { mode: 'transform' }) };
      }
      return loaded;
    },
  });
  try {
    const helpers = await import('../src/profileBackup/packagedProfileBackupSmoke.ts');
    for (const name of ['readSmokeState', 'writeSmokeState', 'captureActiveProfileEntries']) {
      assert.equal(typeof helpers[name], 'function');
    }
  } finally { hooks.deregister(); }
});

test('smoke retains bounded independent streams without changing the child exit', async () => {
  const child = spawn(process.execPath, ['-e', 'console.log("synthetic start"); console.error("synthetic failure"); process.exitCode=7'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const read = observeSmokeOutput(child, 'restoreRestart');
  const exit = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  assert.equal(exit, 7);
  const result = read();
  assert.match(result.stdout.text, /synthetic start/u);
  assert.match(result.stderr.text, /synthetic failure/u);
  assert.equal(result.stdout.truncated, false);
  assert.equal(result.stdout.partial, false);
  assert.equal(result.stderr.partial, false);
});

test('overflow and broken output do not throw or silently look complete', () => {
  const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  const read = observeSmokeOutput(child, 'shutdown');
  child.stdout.emit('data', Buffer.alloc(128 * 1024, 'a'));
  child.stderr.emit('error', new Error('synthetic read failure'));
  assert.equal(read().stdout.text.length, 64 * 1024);
  assert.equal(read().stdout.truncated, true);
  assert.equal(read().stderr.readFailed, true);
  assert.equal(read().stdout.partial, true);
  assert.equal(read().stderr.partial, true);
});

test('missing, replaced and prematurely closed output streams remain explicitly partial', () => {
  const original = new EventEmitter();
  const child = { stdout: original, stderr: null };
  const read = observeSmokeOutput(child, 'shutdown');
  original.emit('data', Buffer.from('retained'));
  original.emit('close');
  assert.equal(read().stdout.partial, true);
  assert.equal(read().stdout.ended, false);
  assert.equal(read().stderr.available, false);
  assert.equal(read().stderr.partial, true);
  original.emit('end');
  assert.equal(read().stdout.partial, false);
  child.stdout = new EventEmitter();
  assert.equal(read().stdout.changed, true);
  assert.equal(read().stdout.partial, true);
  assert.equal(read().stdout.text, 'retained');
});

test('smoke preserves failed evidence and only removes the successful root', async () => {
  const source = await readFile(new URL('./run-packaged-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /phaseOutputs\.push\(observeSmokeOutput\(processHandle, expectedStage\)\)/u);
  assert.match(source, /smoke-output\.private\.json/u);
  assert.match(source, /throw error;\s*\} finally \{\s*if \(smokeSucceeded && execution === undefined\) await rm/u);
  assert.equal(packagedSmokeTimeoutMilliseconds, 120_000);
  assert.equal(packagedSmokeWorkflowTimeoutMilliseconds, 300_000);
});

let fixtureId = 0;

// Execute the actual driver with synthetic children, in-memory files and its
// unchanged deadline on Node's test clock. No Electron, MSI or profile is opened.
function startSmokeDriver(t, readResult = async () => ({ stage: 'startup', status: 'started' }), options, controls = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new URL('./run-packaged-smoke.mjs', import.meta.url);
  const key = `__ekySmokeEvidenceFixture${++fixtureId}`;
  target.searchParams.set('fixture', key);
  const children = [];
  const waiting = [];
  const writes = [];
  const removed = [];
  const progressWrites = [];
  const exceptions = [];
  const capture = Object.assign((error, stage) => { exceptions.push({ error, stage }); },
    { waitForDelivery: async () => 'recorded' });
  const mocks = {
    './packagedSmokeFailureEvidence.mjs': {
      capturePackagedSmokePhaseOutput, observeSmokeOutput,
      prepareSmokeExceptionEvidence: async () => ({ capture,
        arguments: ['--startup-exception-evidence'], environment: { EKY_STARTUP_EXCEPTION_TOKEN: 'synthetic' } }),
    },
    'node:child_process': {
      spawn: (_executable, argumentsList) => {
        const child = new EventEmitter();
        child.argumentsList = argumentsList;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.killCalls = 0;
        child.kill = () => { child.killCalls++; return true; };
        if (waiting.length) waiting.shift()(child);
        else children.push(child);
        return child;
      },
    },
    'node:fs/promises': {
      readFile: async () => JSON.stringify(await readResult()),
      writeFile: async (path, text, options) => { writes.push({ path, value: JSON.parse(text), options }); },
      rm: async path => { removed.push(path); },
    },
    '../dist/main/packagedSmoke.js': {
      createPackagedSmokeFailureMessage: (result, code) => `SYNTHETIC_FAILURE:${result?.code ?? 'unknown'}:${code}`,
      createPackagedSmokeTimeoutMessage: () => 'SYNTHETIC_TIMEOUT',
      readPackagedSmokeResult: value => value,
      resolvePackagedSmokeTempPath: path => path,
      packagedSelectorVerificationPhase: 'selectorVerification',
      packagedSelectorVerificationSwitch: 'desktop-smoke-selector-verification',
      writePackagedSmokeResult: async (configuration, result) => {
        progressWrites.push({ configuration, result });
        await controls.onResultWrite?.(configuration, result);
      },
    },
    './read-desktop-electron-version.mjs': { readDesktopElectronVersion: async () => 'synthetic-version' },
    './packaged-release-candidate.mjs': { preparePackagedReleaseCandidateSmoke: async input => {
      await controls.onReleasePreparation?.(input);
    } },
  };
  globalThis[key] = mocks;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === target.href && Object.hasOwn(mocks, specifier)) {
        const source = Object.keys(mocks[specifier]).map(name =>
          `export const ${name} = globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join('\n');
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
  if (controls.cliArguments !== undefined) {
    const previous = process.argv;
    process.argv = [previous[0], fileURLToPath(target), ...controls.cliArguments];
    const outcome = import(target.href).then(() => ({ status: 'passed' }), error => ({ status: 'failed', error }))
      .finally(() => { process.argv = previous; });
    return { outcome, writes, removed, exceptions, progressWrites };
  }
  const outcome = import(target.href).then(module => controls.singlePhase === undefined
    ? module.runPackagedSmoke(options) : module.runPackagedSmokePhase(controls.singlePhase))
    .then(() => ({ status: 'passed' }), error => ({ status: 'failed', error }));
  return { outcome, writes, removed, exceptions, progressWrites,
    nextChild: () => children.length ? Promise.resolve(children.shift()) : new Promise(accept => waiting.push(accept)) };
}

test('explicit release-candidate CLI still invokes and propagates the release gate before any app phase', async t => {
  const first = new Error('SYNTHETIC_RELEASE_GATE_REJECTION'); let calls = 0;
  const fixture = startSmokeDriver(t, undefined, undefined, { cliArguments: ['--release-candidate'],
    async onReleasePreparation() { calls++; throw first; } });
  const result = await fixture.outcome;
  assert.equal(result.status, 'failed'); assert.equal(result.error, first); assert.equal(calls, 1);
  assert.equal(fixture.progressWrites.length, 0); assert.equal(fixture.removed.length, 0);
});

test('release-candidate CLI refuses extra arguments without entering the release gate or app phase', async t => {
  let calls = 0;
  const fixture = startSmokeDriver(t, undefined, undefined, { cliArguments: ['--release-candidate', '--unknown'],
    async onReleasePreparation() { calls++; } });
  const result = await fixture.outcome;
  assert.equal(result.status, 'failed'); assert.match(result.error.message, /Unsupported packaged smoke argument/u);
  assert.equal(calls, 0); assert.equal(fixture.progressWrites.length, 0); assert.equal(fixture.removed.length, 0);
});

function closeChild(child, code) {
  child.stdout?.emit('end');
  child.stderr?.emit('end');
  child.emit('close', code);
}

test('the shared phase entry waits for result, exit and stdio close without driver cleanup', async t => {
  const phases = [];
  const fixture = startSmokeDriver(t, async () => ({ stage: 'restoreRestart', status: 'started' }), undefined, {
    singlePhase: { argumentsList: ['--desktop-smoke'], expectedStage: 'restoreRestart',
      smokeResultPath: 'synthetic-result.json', expectedElectronVersion: 'synthetic-version',
      childEnvironment: {}, phaseOutputs: phases },
  });
  const child = await fixture.nextChild();
  let settled = false; fixture.outcome.then(() => { settled = true; });
  child.emit('exit', 0); await nextTurn();
  assert.equal(settled, false);
  closeChild(child, 0);
  assert.equal((await fixture.outcome).status, 'passed');
  assert.equal(phases.length, 1); assert.equal(phases[0]().phase, 'restoreRestart');
  assert.equal(fixture.writes.length, 0); assert.equal(fixture.removed.length, 0);
});

test('the shared phase keeps the original spawn failure in the existing capture port', async t => {
  const first = new Error('SYNTHETIC_SHARED_PHASE_SPAWN'), captured = [];
  const fixture = startSmokeDriver(t, undefined, undefined, {
    singlePhase: { argumentsList: ['--desktop-smoke'], expectedStage: 'restoreRestart',
      smokeResultPath: 'synthetic-result.json', expectedElectronVersion: 'synthetic-version',
      childEnvironment: {}, phaseOutputs: [], exceptionEvidence: { capture: error => captured.push(error) } },
  });
  const child = await fixture.nextChild(); child.emit('error', first); closeChild(child, 1);
  assert.equal((await fixture.outcome).status, 'failed');
  assert.deepEqual(captured, [first]); assert.equal(fixture.removed.length, 0);
});

test('the shared phase preserves the same 120 second deadline through pending stdio close', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'restoreRestart', status: 'started' }), undefined, {
    singlePhase: { argumentsList: ['--desktop-smoke'], expectedStage: 'restoreRestart',
      smokeResultPath: 'synthetic-result.json', expectedElectronVersion: 'synthetic-version',
      childEnvironment: {}, phaseOutputs: [] },
  });
  const child = await fixture.nextChild(); child.emit('exit', 0); await nextTurn();
  let settled = false; fixture.outcome.then(() => { settled = true; });
  t.mock.timers.tick(119_999); await nextTurn(); assert.equal(settled, false);
  t.mock.timers.tick(1); assert.equal((await fixture.outcome).status, 'failed');
  assert.equal(child.killCalls, 0); assert.equal(fixture.removed.length, 0);
  closeChild(child, 0);
});

for (const code of [0, 17]) {
test(`the shared phase exposes the original result-read error without changing exit ${code} priority`, async t => {
  const first = new Error('SYNTHETIC_SHARED_RESULT_READ'), observed = [];
  const fixture = startSmokeDriver(t, async () => { throw first; }, undefined, {
    singlePhase: { argumentsList: ['--desktop-smoke'], expectedStage: 'restoreRestart',
      smokeResultPath: 'synthetic-result.json', expectedElectronVersion: 'synthetic-version',
      childEnvironment: {}, phaseOutputs: [], observeResultReadFailure: (...args) => observed.push(args) },
  });
  const child = await fixture.nextChild(); child.emit('exit', code); closeChild(child, code);
  const outcome = await fixture.outcome;
  assert.equal(outcome.status, 'failed'); assert.equal(observed.length, 1); assert.equal(observed[0][0], first);
  if (code === 0) assert.equal(observed[0][1], undefined);
  else assert.equal(observed[0][1], outcome.error);
  assert.equal(fixture.removed.length, 0);
});
}

test('driver snapshots exit -> last stderr -> close and retains the failed root', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'startup', status: 'failed', code: 'FIRST_ERROR' }));
  const child = await fixture.nextChild();
  assert.ok(child.argumentsList.includes('--startup-exception-evidence'));
  child.emit('exit', 9);
  await nextTurn();
  assert.equal(fixture.writes.length, 0);
  child.stderr.emit('data', Buffer.from('late original error detail'));
  closeChild(child, 9);
  const result = await fixture.outcome;
  assert.equal(result.error.message, 'SYNTHETIC_FAILURE:FIRST_ERROR:9');
  assert.equal(fixture.writes.length, 1);
  const evidence = fixture.writes[0];
  assert.equal(evidence.options.flag, 'wx');
  assert.equal(evidence.value.cleanup, 'notVerified');
  assert.equal(evidence.value.exceptionDelivery, 'recorded');
  assert.equal(evidence.value.phases[0].stderr.text, 'late original error detail');
  assert.equal(evidence.value.phases[0].stderr.partial, false);
  assert.equal(fixture.removed.length, 0);
  assert.equal(child.killCalls, 0);
});

test('nonzero exit without close keeps the first failure at the original phase deadline', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'startup', status: 'failed', code: 'FIRST_ERROR' }));
  const child = await fixture.nextChild();
  t.mock.timers.tick(119_000);
  child.emit('exit', 9);
  await nextTurn();
  t.mock.timers.tick(999);
  assert.equal(fixture.writes.length, 0);
  t.mock.timers.tick(1);
  const result = await fixture.outcome;
  assert.equal(result.error.message, 'SYNTHETIC_FAILURE:FIRST_ERROR:9');
  assert.equal(fixture.writes[0].value.phases[0].stderr.partial, true);
  assert.equal(fixture.writes[0].value.phases[0].stderr.ended, false);
  assert.equal(child.killCalls, 0);
  assert.equal(fixture.removed.length, 0);
});

test('an observed exit failure survives a pending result read and a late result', async t => {
  let releaseRead;
  const pendingRead = new Promise(accept => { releaseRead = accept; });
  const fixture = startSmokeDriver(t, () => pendingRead);
  const child = await fixture.nextChild();
  child.emit('exit', 9);
  closeChild(child, 9);
  t.mock.timers.tick(120_000);
  const result = await fixture.outcome;
  assert.equal(result.error.message, 'SYNTHETIC_FAILURE:unknown:9');
  releaseRead({ stage: 'startup', status: 'failed', code: 'LATE_ERROR' });
  await nextTurn();
  assert.equal(result.error.message, 'SYNTHETIC_FAILURE:unknown:9');
  assert.equal(fixture.writes.length, 1);
  assert.equal(child.killCalls, 0);
});

test('a pre-exit process error is not replaced by termination failure or timeout', async t => {
  const fixture = startSmokeDriver(t);
  const child = await fixture.nextChild();
  child.emit('error', new Error('synthetic process error'));
  child.kill = () => { child.killCalls++; throw new Error('synthetic termination error'); };
  t.mock.timers.tick(120_000);
  const result = await fixture.outcome;
  assert.equal(result.error.message, 'Packaged desktop smoke process could not be started.');
  assert.equal(fixture.exceptions[0].error.message, 'synthetic process error');
  assert.equal(fixture.exceptions[0].stage, 'packagedRunner');
  assert.equal(child.killCalls, 1);
  assert.equal(fixture.writes[0].value.phases[0].stdout.partial, true);
  assert.equal(fixture.removed.length, 0);
});

test('a running child still times out and is killed at the unchanged deadline', async t => {
  const fixture = startSmokeDriver(t);
  const child = await fixture.nextChild();
  t.mock.timers.tick(119_999);
  assert.equal(child.killCalls, 0);
  t.mock.timers.tick(1);
  const result = await fixture.outcome;
  assert.equal(result.error.message, 'SYNTHETIC_TIMEOUT');
  assert.equal(child.killCalls, 1);
  assert.equal(fixture.writes[0].value.phases[0].stderr.partial, true);
});

test('both successful phases wait for close and preserve their existing result checks', async t => {
  let smokeResult = { stage: 'restoreRestart', status: 'started' };
  const fixture = startSmokeDriver(t, async () => smokeResult);
  const first = await fixture.nextChild();
  first.emit('exit', 0);
  await nextTurn();
  assert.equal(fixture.removed.length, 0);
  closeChild(first, 0);
  const second = await fixture.nextChild();
  smokeResult = { stage: 'shutdown', status: 'ok', electronVersion: 'synthetic-version' };
  second.emit('exit', 0);
  await nextTurn();
  closeChild(second, 0);
  assert.equal((await fixture.outcome).status, 'passed');
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.removed.length, 1);
  assert.equal(first.killCalls + second.killCalls, 0);
});

test('zero exit with an invalid result still fails after close', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'shutdown', status: 'ok' }));
  const child = await fixture.nextChild();
  child.emit('exit', 0);
  await nextTurn();
  closeChild(child, 0);
  assert.equal((await fixture.outcome).error.message, 'SYNTHETIC_FAILURE:unknown:0');
  assert.equal(fixture.removed.length, 0);
});

test('a valid result and zero exit without close cannot become success at the deadline', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'restoreRestart', status: 'started' }));
  const child = await fixture.nextChild();
  child.emit('exit', 0);
  await nextTurn();
  t.mock.timers.tick(120_000);
  assert.equal((await fixture.outcome).error.message, 'SYNTHETIC_TIMEOUT');
  assert.equal(fixture.writes[0].value.phases[0].stderr.partial, true);
  assert.equal(fixture.removed.length, 0);
  assert.equal(child.killCalls, 0);
});

test('a missing result remains a failure even when exit and output close succeed', async t => {
  const fixture = startSmokeDriver(t, async () => undefined);
  const child = await fixture.nextChild();
  child.emit('exit', 0);
  closeChild(child, 0);
  assert.equal((await fixture.outcome).error.message,
    'Packaged desktop smoke check did not produce a result (code 0).');
  assert.equal(fixture.removed.length, 0);
});

test('the final phase still rejects a mismatched Electron version', async t => {
  let smokeResult = { stage: 'restoreRestart', status: 'started' };
  const fixture = startSmokeDriver(t, async () => smokeResult);
  const first = await fixture.nextChild();
  first.emit('exit', 0);
  closeChild(first, 0);
  const second = await fixture.nextChild();
  smokeResult = { stage: 'shutdown', status: 'ok', electronVersion: 'different-version' };
  second.emit('exit', 0);
  closeChild(second, 0);
  assert.equal((await fixture.outcome).error.message, 'SYNTHETIC_FAILURE:unknown:0');
  assert.equal(fixture.writes[0].value.phases.length, 2);
  assert.equal(fixture.removed.length, 0);
});

test('an error observed before exit survives later result validation', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'startup', status: 'failed', code: 'LATER_ERROR' }));
  const child = await fixture.nextChild();
  child.emit('error', new Error('synthetic earlier process error'));
  child.emit('exit', 9);
  await nextTurn();
  closeChild(child, 9);
  assert.equal((await fixture.outcome).error.message, 'Packaged desktop smoke process could not be started.');
  assert.equal(fixture.removed.length, 0);
});

for (const preparationKey of ['legacyPreparation', 'workspaceRecoveryPreparation']) {
test(`${preparationKey} brackets the same two phases and verifies source before cleanup`, async t => {
  let smokeResult = { stage: 'restoreRestart', status: 'started' };
  const calls = [];
  const fixture = startSmokeDriver(t, async () => smokeResult, { [preparationKey]: {
    async prepare(context) { assert.match(context.smokeToken, /^[a-f0-9]{32}$/); calls.push('prepare'); },
    async afterRestoreExit() { calls.push('closedRestore'); },
    async verifySourcePreserved() { calls.push('sourceVerified'); assert.equal(fixture.removed.length, 0); },
  } });
  const first = await fixture.nextChild();
  assert.deepEqual(calls, ['prepare']);
  const switches = preparationKey === 'legacyPreparation' ? ['--desktop-smoke-legacy-invoice'] : [];
  assert.deepEqual(first.argumentsList, ['--desktop-smoke', ...switches, '--startup-exception-evidence']);
  first.emit('exit', 0);
  await nextTurn();
  assert.deepEqual(calls, ['prepare']);
  closeChild(first, 0);
  const second = await fixture.nextChild();
  assert.deepEqual(calls, ['prepare', 'closedRestore']);
  assert.deepEqual(second.argumentsList, ['--desktop-smoke', '--desktop-smoke-restored', ...switches, '--startup-exception-evidence']);
  smokeResult = { stage: 'shutdown', status: 'ok', electronVersion: 'synthetic-version' };
  second.emit('exit', 0);
  closeChild(second, 0);
  assert.equal((await fixture.outcome).status, 'passed');
  assert.deepEqual(calls, ['prepare', 'closedRestore', 'sourceVerified']);
  assert.equal(fixture.removed.length, 1);
});

test(`${preparationKey} failed closed-candidate inspection retains evidence and prevents the second launch`, async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'restoreRestart', status: 'started' }), {
    [preparationKey]: { async prepare() {},
      async afterRestoreExit() { throw new Error('CANDIDATE_INVALID'); },
      async verifySourcePreserved() { assert.fail('must not continue'); },
    },
  });
  const first = await fixture.nextChild();
  first.emit('exit', 0);
  closeChild(first, 0);
  assert.equal((await fixture.outcome).error.message, 'CANDIDATE_INVALID');
  assert.equal(fixture.writes[0].value.phases.length, 1);
  assert.equal(fixture.removed.length, 0);
});
}

test('conflicting preparations are rejected without starting a phase or removing evidence', async t => {
  const prepare = { async prepare() { assert.fail('must reject before preparation'); } };
  const fixture = startSmokeDriver(t, async () => undefined, {
    legacyPreparation: prepare, workspaceRecoveryPreparation: prepare,
  });
  assert.equal((await fixture.outcome).error.message, 'PACKAGED_SMOKE_PREPARATION_CONFLICT');
  assert.equal(fixture.removed.length, 0);
  assert.equal(fixture.writes.length, 0);
});

function closedWorkflowOutput(stage) {
  const stream = () => ({ text: '', truncated: false, readFailed: false, available: true,
    ended: true, changed: false, partial: false });
  return { phase: stage, stdout: stream(), stderr: stream() };
}

test('the owned deletion driver keeps both restore phases and three hooks without deleting its Job terminal root', async t => {
  const calls = [], token = 'd'.repeat(32);
  const preparation = Object.fromEntries(['prepareAfterRestoredExit', 'verifyAfterRecoveryExit', 'verifyAfterRestartExit']
    .map(name => [name, async context => { assert.equal(context.smokeToken, token); calls.push(name); }]));
  const execution = Object.freeze({ smokeToken: token, async runPhase(command) {
    assert.equal(Object.isFrozen(command), true); assert.equal(Object.isFrozen(command.environment), true);
    assert.equal(command.environment.EKY_DESKTOP_SMOKE_TOKEN, token); assert.equal(command.startupException, true);
    calls.push(command.phase);
    return closedWorkflowOutput(command.phase === 'initial' ? 'restoreRestart' : 'shutdown');
  } });
  const f = startSmokeDriver(t, undefined, { workspaceDeletionPreparation: preparation, workspaceDeletionExecution: execution });
  assert.equal((await f.outcome).status, 'passed');
  assert.deepEqual(calls, ['initial', 'restoredProfile', 'prepareAfterRestoredExit', 'selectorRecovery',
    'verifyAfterRecoveryExit', 'selectorRestart', 'verifyAfterRestartExit']);
  assert.equal(f.removed.length, 0); assert.equal(f.writes.length, 0);
});

test('the owned deletion driver waits for an unresolved phase and retains its first failure without preparation', async t => {
  let release, enter;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const first = new Error('SYNTHETIC_OWNED_DRIVER_FIRST', { cause: new Error('SYNTHETIC_OWNED_DRIVER_CAUSE') });
  const calls = [];
  const f = startSmokeDriver(t, undefined, { workspaceDeletionPreparation: {
    async prepareAfterRestoredExit() { calls.push('unexpectedPreparation'); },
    async verifyAfterRecoveryExit() { assert.fail(); }, async verifyAfterRestartExit() { assert.fail(); },
  }, workspaceDeletionExecution: Object.freeze({ smokeToken: 'd'.repeat(32), async runPhase(command) {
    calls.push(command.phase);
    if (command.phase === 'restoredProfile') { enter(); await waiting; throw first; }
    return closedWorkflowOutput('restoreRestart');
  } }) });
  await entered; assert.deepEqual(calls, ['initial', 'restoredProfile']);
  release(); assert.equal((await f.outcome).error, first);
  assert.equal(f.exceptions[0].error, first); assert.equal(f.removed.length, 0);
  assert.equal(f.writes[0].value.phases.length, 1);
});

test('the owned deletion driver cannot prepare from a partial phase observation', async t => {
  let prepared = false;
  const f = startSmokeDriver(t, undefined, { workspaceDeletionPreparation: {
    async prepareAfterRestoredExit() { prepared = true; }, async verifyAfterRecoveryExit() {}, async verifyAfterRestartExit() {},
  }, workspaceDeletionExecution: Object.freeze({ smokeToken: 'd'.repeat(32), async runPhase() {
    const output = closedWorkflowOutput('restoreRestart'); output.stdout.ended = false; output.stdout.partial = true; return output;
  } }) });
  assert.equal((await f.outcome).status, 'failed'); assert.equal(prepared, false); assert.equal(f.removed.length, 0);
});

function startDeletionSmokeDriver(t, overrides = {}) {
  let result;
  const calls = [];
  const preparation = {
    async prepareAfterRestoredExit(context) { calls.push({ phase: 'prepared', context }); },
    async verifyAfterRecoveryExit(context) { calls.push({ phase: 'recovered', context }); },
    async verifyAfterRestartExit(context) { calls.push({ phase: 'restarted', context }); },
    ...overrides,
  };
  const fixture = startSmokeDriver(t, async () => result, { workspaceDeletionPreparation: preparation }, {
    onResultWrite: async (_configuration, next) => { result = next; },
  });
  const publish = stage => {
    result = stage === 'restoreRestart' ? { stage, status: 'started' }
      : { stage, status: 'ok', electronVersion: 'synthetic-version' };
  };
  const complete = (child, stage, code = 0) => {
    publish(stage);
    child.emit('exit', code); closeChild(child, code);
  };
  return { ...fixture, calls, preparation, publish, complete };
}

test('deletion preparation follows both restored exit and close and verifies two independent selector starts', async t => {
  const fixture = startDeletionSmokeDriver(t);
  const initial = await fixture.nextChild();
  assert.deepEqual(fixture.calls, []);
  fixture.complete(initial, 'restoreRestart');
  const restored = await fixture.nextChild();
  assert.deepEqual(fixture.calls, []);
  fixture.publish('shutdown'); restored.emit('exit', 0);
  await nextTurn();
  assert.deepEqual(fixture.calls, []);
  closeChild(restored, 0);
  const recovery = await fixture.nextChild();
  assert.deepEqual(fixture.calls.map(call => call.phase), ['prepared']);
  assert.deepEqual(recovery.argumentsList, ['--desktop-smoke', '--desktop-smoke-selector-verification', '--startup-exception-evidence']);
  assert.deepEqual(fixture.progressWrites.at(-1).result, { stage: 'startup', status: 'started' });
  assert.equal(fixture.progressWrites.at(-1).configuration.phase, 'selectorVerification');
  fixture.complete(recovery, 'shutdown');
  const restart = await fixture.nextChild();
  assert.deepEqual(fixture.calls.map(call => call.phase), ['prepared', 'recovered']);
  assert.deepEqual(restart.argumentsList, recovery.argumentsList);
  assert.deepEqual(fixture.progressWrites.at(-1).result, { stage: 'startup', status: 'started' });
  fixture.complete(restart, 'shutdown');
  assert.equal((await fixture.outcome).status, 'passed');
  assert.deepEqual(fixture.calls.map(call => call.phase), ['prepared', 'recovered', 'restarted']);
  const context = fixture.calls[0].context;
  assert.match(context.smokeToken, /^[a-f0-9]{32}$/u);
  assert.equal(Object.isFrozen(context), true);
  for (const call of fixture.calls) assert.equal(call.context, context);
  assert.equal(fixture.removed.length, 1);
});

for (const failedPhase of ['initial', 'restored']) {
test(`failed ${failedPhase} phase never prepares deletion`, async t => {
  const fixture = startDeletionSmokeDriver(t);
  let child = await fixture.nextChild();
  if (failedPhase === 'restored') { fixture.complete(child, 'restoreRestart'); child = await fixture.nextChild(); }
  fixture.complete(child, failedPhase === 'initial' ? 'restoreRestart' : 'shutdown', 9);
  assert.equal((await fixture.outcome).status, 'failed');
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.removed.length, 0);
  assert.equal(fixture.writes[0].value.phases.length, failedPhase === 'initial' ? 1 : 2);
});
}

test('deletion preparation failure retains the two successful restore phases and starts no selector', async t => {
  const first = new Error('SYNTHETIC_DELETION_PREPARATION_FAILED');
  const fixture = startDeletionSmokeDriver(t, { async prepareAfterRestoredExit() { throw first; } });
  fixture.complete(await fixture.nextChild(), 'restoreRestart');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  assert.equal((await fixture.outcome).error, first);
  assert.equal(fixture.writes[0].value.phases.length, 2);
  assert.equal(fixture.removed.length, 0);
});

for (const staleAt of ['recovery', 'restart']) {
test(`a stale previous ok cannot authorize the ${staleAt} selector phase`, async t => {
  const fixture = startDeletionSmokeDriver(t);
  fixture.complete(await fixture.nextChild(), 'restoreRestart');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  let child = await fixture.nextChild();
  if (staleAt === 'restart') { fixture.complete(child, 'shutdown'); child = await fixture.nextChild(); }
  child.emit('exit', 0); closeChild(child, 0);
  assert.equal((await fixture.outcome).status, 'failed');
  assert.deepEqual(fixture.calls.map(call => call.phase), staleAt === 'recovery' ? ['prepared'] : ['prepared', 'recovered']);
  assert.equal(fixture.writes[0].value.phases.length, staleAt === 'recovery' ? 3 : 4);
  assert.equal(fixture.removed.length, 0);
});
}

test('failed recovery verification prevents the restart and retains its first error', async t => {
  const first = new Error('SYNTHETIC_RECOVERY_COMPARE_FAILED');
  const fixture = startDeletionSmokeDriver(t, { async verifyAfterRecoveryExit() { throw first; } });
  fixture.complete(await fixture.nextChild(), 'restoreRestart');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  assert.equal((await fixture.outcome).error, first);
  assert.equal(fixture.writes[0].value.phases.length, 3);
  assert.equal(fixture.removed.length, 0);
});

test('failed final deletion comparison cannot remove evidence or report success', async t => {
  const first = new Error('SYNTHETIC_DELETION_RESTART_COMPARE_FAILED');
  const fixture = startDeletionSmokeDriver(t, { async verifyAfterRestartExit() { throw first; } });
  fixture.complete(await fixture.nextChild(), 'restoreRestart');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  assert.equal((await fixture.outcome).error, first);
  assert.equal(fixture.writes[0].value.phases.length, 4);
  assert.equal(fixture.removed.length, 0);
});

for (const competing of ['legacyPreparation', 'workspaceRecoveryPreparation']) {
test(`deletion preparation conflicts with ${competing} before any work`, async t => {
  const prepare = { async prepare() { assert.fail('no preparation allowed'); } };
  const fixture = startSmokeDriver(t, async () => undefined, {
    [competing]: prepare, workspaceDeletionPreparation: {},
  });
  assert.equal((await fixture.outcome).error.message, 'PACKAGED_SMOKE_PREPARATION_CONFLICT');
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.progressWrites.length, 0);
  assert.equal(fixture.removed.length, 0);
});
}

for (const missing of ['prepareAfterRestoredExit', 'verifyAfterRecoveryExit', 'verifyAfterRestartExit']) {
test(`missing deletion hook ${missing} is rejected before any profile or child work`, async t => {
  const preparation = { async prepareAfterRestoredExit() {}, async verifyAfterRecoveryExit() {}, async verifyAfterRestartExit() {} };
  delete preparation[missing];
  const fixture = startSmokeDriver(t, async () => undefined, { workspaceDeletionPreparation: preparation });
  assert.equal((await fixture.outcome).error.message, 'PACKAGED_SMOKE_PREPARATION_INVALID');
  assert.equal(fixture.progressWrites.length, 0);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.removed.length, 0);
});
}

for (const expiredAt of ['recovery', 'restart']) {
test(`the ${expiredAt} selector keeps the existing deadline and cannot continue after timeout`, async t => {
  const fixture = startDeletionSmokeDriver(t);
  fixture.complete(await fixture.nextChild(), 'restoreRestart');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  let child = await fixture.nextChild();
  if (expiredAt === 'restart') { fixture.complete(child, 'shutdown'); child = await fixture.nextChild(); }
  t.mock.timers.tick(119_999);
  assert.equal(fixture.writes.length, 0);
  t.mock.timers.tick(1);
  assert.equal((await fixture.outcome).error.message, 'SYNTHETIC_TIMEOUT');
  assert.equal(child.killCalls, 1);
  assert.deepEqual(fixture.calls.map(call => call.phase), expiredAt === 'recovery' ? ['prepared'] : ['prepared', 'recovered']);
  assert.equal(fixture.writes[0].value.cleanup, 'notVerified');
  assert.equal(fixture.writes[0].value.phases.at(-1).stderr.partial, true);
  assert.equal(fixture.removed.length, 0);
});
}

test('selector result reset failure prevents its launch and retains the original error', async t => {
  let result;
  const first = new Error('SYNTHETIC_RESULT_RESET_FAILED');
  const fixture = startSmokeDriver(t, async () => result, { workspaceDeletionPreparation: {
    async prepareAfterRestoredExit() {}, async verifyAfterRecoveryExit() { assert.fail('no verification'); },
    async verifyAfterRestartExit() { assert.fail('no verification'); },
  } }, {
    async onResultWrite(configuration) { if (configuration.phase === 'selectorVerification') throw first; },
  });
  const initial = await fixture.nextChild();
  result = { stage: 'restoreRestart', status: 'started' }; initial.emit('exit', 0); closeChild(initial, 0);
  const restored = await fixture.nextChild();
  result = { stage: 'shutdown', status: 'ok', electronVersion: 'synthetic-version' };
  restored.emit('exit', 0); closeChild(restored, 0);
  assert.equal((await fixture.outcome).error, first);
  assert.equal(fixture.writes[0].value.phases.length, 2);
  assert.equal(fixture.removed.length, 0);
});

test('deletion hook bindings are captured before the first asynchronous phase', async t => {
  const fixture = startDeletionSmokeDriver(t);
  const initial = await fixture.nextChild();
  for (const name of ['prepareAfterRestoredExit', 'verifyAfterRecoveryExit', 'verifyAfterRestartExit']) {
    fixture.preparation[name] = async () => { assert.fail('replaced deletion hook was called'); };
  }
  fixture.complete(initial, 'restoreRestart');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  fixture.complete(await fixture.nextChild(), 'shutdown');
  assert.equal((await fixture.outcome).status, 'passed');
  assert.deepEqual(fixture.calls.map(call => call.phase), ['prepared', 'recovered', 'restarted']);
});

async function deletionPreparationFiles(t, { version = 1, companyCount = 1, controls = {} } = {}) {
  const sourceRoot = new URL('../src/', import.meta.url).href;
  const companion = new URL('./packagedWorkspaceDeletionPreparation.mjs', import.meta.url);
  companion.searchParams.set('fixture', String(++fixtureId));
  const key = `__ekyDeletionPreparationFixture${fixtureId}`, ports = {};
  const heldReservations = new Set();
  globalThis[key] = ports;
  const forbidden = new Set(['electron', 'better-sqlite3', 'node:sqlite', 'node:child_process']);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === companion.href && Object.hasOwn(ports, specifier)) {
        const source = Object.keys(ports[specifier]).map(name =>
          `export const ${name} = globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join('\n');
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      if (context.parentURL === companion.href && specifier.startsWith('../dist/')) {
        return nextResolve(new URL(specifier.replace('../dist/', '../src/').replace(/\.js$/u, '.ts'), import.meta.url).href, context);
      }
      if (context.parentURL?.startsWith(sourceRoot)) {
        assert.equal(forbidden.has(specifier), false, 'PREPARATION_MUST_NOT_OPEN_RUNTIME');
        if (specifier.startsWith('.') && specifier.endsWith('.js')) {
          return nextResolve(new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL).href, context);
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      return url.startsWith(sourceRoot) && new URL(url).pathname.endsWith('.ts')
        ? { ...loaded, format: 'module', source: stripTypeScriptTypes(String(loaded.source), { mode: 'transform' }) } : loaded;
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
  t.after(async () => {
    // The controlled fixture owns these settled handles. Native failure requires worker exit instead.
    for (const reservation of heldReservations) await reservation.release();
  });
  const { resolvePackagedSmokeTempPath } = await import('../src/main/packagedSmoke.ts');
  const { WorkspaceRegistryStore } = await import('../src/workspaces/registry/workspaceRegistryStore.ts');
  const { WORKSPACE_REGISTRY_FILE_NAME } = await import('../src/workspaces/registry/workspaceRegistryPaths.ts');
  const { deriveWorkspaceRoot } = await import('../src/workspaces/registry/deriveWorkspaceRoot.ts');
  const { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } = await import('../src/workspaces/deletion/workspaceDeletionJournalStore.ts');
  const { createWorkspaceDeletionCommand } = await import('../src/workspaces/deletion/workspaceDeletionCommand.ts');
  const reservations = await import('../src/runtime/workspaceProcessReservation.ts');
  const { acquireWorkspaceProcessReservation } = reservations;
  const { InMemoryWorkspaceMaintenanceLease } = await import('../src/workspaces/maintenance/workspaceMaintenanceLease.ts');
  ports['../dist/runtime/workspaceProcessReservation.js'] = {
      readWorkspaceProcessReservationIdentity: reservations.readWorkspaceProcessReservationIdentity,
      async acquireWorkspaceProcessReservation(options) {
        const reservation = await acquireWorkspaceProcessReservation(options);
        heldReservations.add(reservation);
        controls.onReservation?.(reservation);
        return { ...reservation, async release() {
          await controls.beforeReservationRelease?.(reservation);
          await reservation.release();
          heldReservations.delete(reservation);
        } };
      } };
  if (controls.afterFileClose !== undefined) {
    ports['node:fs/promises'] = { lstat: preparationFiles.lstat, readdir: preparationFiles.readdir, async open(path, ...args) {
      const handle = await preparationFiles.open(path, ...args);
      return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() {
        await handle.close(); await controls.afterFileClose(path);
      } };
    } };
  }
  const { createPackagedWorkspaceDeletionPreparation } = await import(companion.href);
  const token = randomBytes(16).toString('hex');
  const root = join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', token);
  await mkdir(dirname(root), { recursive: true }); await mkdir(root, { mode: 0o700 });
  t.after(async () => { if (t.passed === true) await rm(root, { recursive: true, force: true }); });
  const userDataRoot = join(root, 'user-data'); await mkdir(userDataRoot, { mode: 0o700 });
  const context = Object.freeze({ smokeToken: token, smokeRootDirectory: root });
  const registryPath = join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: userDataRoot, filePath: registryPath });
  const entries = Array.from({ length: companyCount }, (_, index) => ({
    workspaceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    workspaceLabel: `Synthetic packaged deletion ${index + 1}`, layoutVersion: 1, lifecycleState: 'ready',
    createdAt: '2026-11-03T00:00:00.000Z', lineageIdentity: { formatVersion: 1, profileId: String(index + 1).repeat(64) },
  }));
  await registry.write({ formatVersion: version, activeWorkspaceId: entries[0]?.workspaceId ?? null, workspaces: entries });
  const targetRoot = entries[0] === undefined ? undefined : deriveWorkspaceRoot(userDataRoot, entries[0].workspaceId, 1).workspaceRoot;
  const targetFile = targetRoot === undefined ? undefined : join(targetRoot, 'runtime', 'data', 'eky.sqlite');
  if (targetFile !== undefined) { await mkdir(dirname(targetFile), { recursive: true }); await writeFile(targetFile, 'synthetic opaque database bytes', { flag: 'wx' }); }
  const retained = [join(root, 'profile-backup', 'packaged-profile.ekybackup'),
    join(root, 'profile-backup', 'restored-profile.ekybackup')];
  if (entries[0] !== undefined) retained.push(join(root, 'invoice-pdf-archive', entries[0].workspaceId, 'Lasku-1.pdf'));
  for (const [index, path] of retained.entries()) {
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, `synthetic retained independent bytes ${index}`, { flag: 'wx' });
  }
  const controller = new AbortController(), phases = [];
  const preparation = createPackagedWorkspaceDeletionPreparation({ signal: controller.signal,
    async assertPreviousPhaseStopped(receipt, phase) {
      assert.equal(receipt, context); phases.push(phase);
      // This is a controlled owner port, not a claim about native process absence.
      controller.signal.throwIfAborted();
    } });
  const journal = new WorkspaceDeletionJournalStore(userDataRoot);
  const assertRetained = async () => {
    for (const [index, path] of retained.entries()) assert.equal(await readFile(path, 'utf8'), `synthetic retained independent bytes ${index}`);
  };
  const resume = async () => {
    const selected = (await journal.inspect(() => controller.signal.throwIfAborted())).plan.selected;
    const reservation = await acquireWorkspaceProcessReservation({ userDataRoot, signal: controller.signal });
    const leases = new InMemoryWorkspaceMaintenanceLease(), lease = await leases.acquire('delete');
    const assertCurrent = leases.captureCurrentOwner(['delete'], lease);
    const assertOwned = async () => { controller.signal.throwIfAborted(); assertCurrent(); await reservation.assertOwned(); assertCurrent(); };
    let failure, result;
    try {
      const command = createWorkspaceDeletionCommand({ userDataRoot, registry, assertWritersAbsent: assertOwned });
      result = await command.resume(selected.target.operationId, { assertCurrent, assertOwned, recordRemoved(receipt) {
        assertCurrent(); assert.equal(receipt.status, 'removed');
      } });
    } catch (error) { failure = { error }; }
    for (const close of [() => lease.release(), () => reservation.release()]) {
      try { await close(); }
      catch (error) { failure = { error: failure === undefined ? error : new AggregateError([failure.error, error], 'PREPARATION_FIXTURE_CLOSE_FAILED', { cause: failure.error }) }; }
    }
    if (failure !== undefined) throw failure.error;
    return result;
  };
  return { preparation, createPackagedWorkspaceDeletionPreparation, context, root, userDataRoot,
    registry, registryPath, targetFile, targetRoot, retained, assertRetained, journal,
    journalPaths: createWorkspaceDeletionJournalPaths(userDataRoot), controller, phases, resume, acquireWorkspaceProcessReservation };
}

for (const version of [1, 2]) {
test(`real-file preparation v${version} publishes the actual journal without deleting or opening the database`, { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t, { version });
  const original = await readFile(f.targetFile);
  await f.preparation.prepareAfterRestoredExit(f.context);
  const selected = await f.journal.inspect(() => {});
  assert.equal(selected.plan.mode, 'published'); assert.equal(selected.plan.selected.phase, 'authorized');
  assert.equal((await f.registry.inspectSlots()).current.value.formatVersion, 2);
  assert.deepEqual(await readFile(f.targetFile), original);
  await f.assertRetained();
  await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context), /PACKAGED_DELETION_PREPARATION_INVALID/u);
  assert.deepEqual(await readFile(f.targetFile), original);
});
}

test('prepared real journal is consumed by the same command and both retained-byte verifiers settle', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  await f.preparation.prepareAfterRestoredExit(f.context);
  assert.deepEqual(await f.resume(), { formatVersion: 1, status: 'completed', navigation: 'selector' });
  await f.preparation.verifyAfterRecoveryExit(f.context);
  await f.preparation.verifyAfterRestartExit(f.context);
  assert.equal((await f.journal.inspect(() => {})).plan.mode, 'absent');
  await assert.rejects(readFile(f.targetFile), { code: 'ENOENT' });
  await f.assertRetained();
});

for (const companyCount of [0, 2]) {
test(`preparation rejects ${companyCount} companies before registry conversion or journal publication`, { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t, { companyCount });
  const before = await readFile(f.registryPath);
  await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context));
  assert.deepEqual(await readFile(f.registryPath), before);
  await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
});
}

test('a busy real OS reservation prevents publication and does not permit replay after release', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  const before = await readFile(f.registryPath);
  const owner = await f.acquireWorkspaceProcessReservation({ userDataRoot: f.userDataRoot, signal: f.controller.signal });
  try { await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context)); }
  finally { await owner.release(); }
  assert.deepEqual(await readFile(f.registryPath), before);
  await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
  await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context));
});

test('uncertain previous phase preserves its exact first error without touching the registry', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t), first = new Error('SYNTHETIC_PREVIOUS_PHASE_UNKNOWN');
  const before = await readFile(f.registryPath);
  const preparation = f.createPackagedWorkspaceDeletionPreparation({ signal: f.controller.signal,
    async assertPreviousPhaseStopped() { throw first; } });
  await assert.rejects(preparation.prepareAfterRestoredExit(f.context), error => error === first);
  assert.deepEqual(await readFile(f.registryPath), before);
  await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
});

test('a phase-owner failure during selected registry conversion keeps its original cause and uncertain bytes', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t), first = new Error('SYNTHETIC_PHASE_OWNER_LOST_DURING_CONVERSION');
  const before = await readFile(f.registryPath);
  let observed = false;
  const preparation = f.createPackagedWorkspaceDeletionPreparation({ signal: f.controller.signal,
    async assertPreviousPhaseStopped() {
      try { await readFile(`${f.registryPath}.next`); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      observed = true; throw first;
    } });
  await assert.rejects(preparation.prepareAfterRestoredExit(f.context), error => error === first || error.cause === first);
  assert.equal(observed, true);
  assert.deepEqual(await readFile(f.registryPath), before);
  await readFile(`${f.registryPath}.next`);
  await assert.rejects(f.acquireWorkspaceProcessReservation({ userDataRoot: f.userDataRoot, signal: f.controller.signal }),
    error => error.reason === 'busy');
  await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
});

test('changed retained bytes after actual deletion prevent recovery verification and final success', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  await f.preparation.prepareAfterRestoredExit(f.context); await f.resume();
  await writeFile(f.retained[0], 'changed synthetic retained bytes');
  await assert.rejects(f.preparation.verifyAfterRecoveryExit(f.context));
  await assert.rejects(f.preparation.verifyAfterRestartExit(f.context));
  assert.equal(await readFile(f.retained[0], 'utf8'), 'changed synthetic retained bytes');
});

test('out-of-order verifier and a context outside the owned smoke root cannot start preparation', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  const before = await readFile(f.registryPath);
  await assert.rejects(f.preparation.verifyAfterRecoveryExit(f.context));
  await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context));
  const preparation = f.createPackagedWorkspaceDeletionPreparation({ signal: f.controller.signal,
    async assertPreviousPhaseStopped() { assert.fail('outside root must reject before owner invocation'); } });
  await assert.rejects(preparation.prepareAfterRestoredExit(Object.freeze({ ...f.context, smokeRootDirectory: dirname(f.root) })));
  assert.deepEqual(await readFile(f.registryPath), before);
  await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
});

for (const hidden of ['nonEnumerable', 'symbol']) {
test(`preparation rejects a frozen context with an extra ${hidden} property before owner work`, { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  const context = { ...f.context };
  Object.defineProperty(context, hidden === 'symbol' ? Symbol('unexpected') : 'unexpected', { value: true });
  const before = await readFile(f.registryPath);
  await assert.rejects(f.preparation.prepareAfterRestoredExit(Object.freeze(context)));
  assert.deepEqual(f.phases, []);
  assert.deepEqual(await readFile(f.registryPath), before);
});
}

for (const mode of ['reentry', 'abort']) {
test(`a ${mode} during awaited reservation release cannot revive the preparation`, { timeout: 60_000 }, async t => {
  let releaseStarted, finishRelease;
  const started = new Promise(resolve => { releaseStarted = resolve; });
  const held = new Promise(resolve => { finishRelease = resolve; });
  const f = await deletionPreparationFiles(t, { controls: { async beforeReservationRelease() {
    releaseStarted(); await held;
  } } });
  const task = f.preparation.prepareAfterRestoredExit(f.context).then(() => ({ passed: true }), error => ({ error }));
  await started;
  try {
    if (mode === 'reentry') await assert.rejects(f.preparation.verifyAfterRecoveryExit(f.context));
    else f.controller.abort(new Error('SYNTHETIC_ABORT_DURING_CLOSE'));
  } finally { finishRelease(); }
  assert.equal((await task).passed, undefined);
  await assert.rejects(f.preparation.verifyAfterRecoveryExit(f.context));
  await f.assertRetained();
});
}

test('a retained-file close rejection keeps real OS exclusion until the test owner settles it', { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_UNCERTAIN_FILE_CLOSE');
  let heldReservation, releases = 0;
  const f = await deletionPreparationFiles(t, { controls: {
    onReservation(value) { heldReservation = value; },
    async beforeReservationRelease() { releases++; },
    async afterFileClose() { throw first; },
  } });
  try {
    await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context), error => error === first || error.cause === first);
    assert.equal(releases, 0);
    await assert.rejects(f.acquireWorkspaceProcessReservation({ userDataRoot: f.userDataRoot, signal: f.controller.signal }),
      error => error.reason === 'busy');
    await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context));
    await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
  } finally {
    // Controlled port rejects after the real handle closed; teardown, not a native uncertain-close proof.
    await heldReservation?.release();
  }
});

test('a semantically equal registry replacement between verification phases is rejected', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  await f.preparation.prepareAfterRestoredExit(f.context); await f.resume();
  await f.preparation.verifyAfterRecoveryExit(f.context);
  const bytes = await readFile(f.registryPath), displaced = `${f.registryPath}.synthetic-displaced`;
  await preparationFiles.rename(f.registryPath, displaced); await writeFile(f.registryPath, bytes, { flag: 'wx', mode: 0o600 });
  await assert.rejects(f.preparation.verifyAfterRestartExit(f.context));
  assert.deepEqual(await readFile(displaced), bytes); await f.assertRetained();
});

for (const parentMode of ['replacement', 'junction', 'absence']) {
test(`a payload parent ${parentMode} cannot turn missing descendants into successful absence`, { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  await f.preparation.prepareAfterRestoredExit(f.context); await f.resume();
  const parent = dirname(f.targetRoot), displaced = `${parent}.synthetic-displaced`;
  await preparationFiles.rename(parent, displaced);
  if (parentMode === 'junction') await preparationFiles.symlink(displaced, parent, process.platform === 'win32' ? 'junction' : 'dir');
  else if (parentMode === 'replacement') await mkdir(parent, { mode: 0o700 });
  await assert.rejects(f.preparation.verifyAfterRecoveryExit(f.context));
  await f.assertRetained();
});
}

test('a changed smoke-root identity is rejected even if the same user-data directory is moved back', { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  await f.preparation.prepareAfterRestoredExit(f.context);
  const displaced = `${f.root}.synthetic-displaced`;
  t.after(async () => { if (t.passed === true) await rm(displaced, { recursive: true }); });
  await preparationFiles.rename(f.root, displaced); await mkdir(f.root, { mode: 0o700 });
  await preparationFiles.rename(join(displaced, 'user-data'), f.userDataRoot);
  await assert.rejects(f.preparation.verifyAfterRecoveryExit(f.context));
  assert.equal((await f.registry.inspectSlots()).current.value.workspaces.length, 1);
  assert.equal((await f.journal.inspect(() => {})).plan.selected.phase, 'authorized');
});

for (const kind of ['creation', 'import', 'adoption', 'switch', 'firstStart', 'update', 'legacyUpdate', 'profileRestore', 'replacement']) {
test(`an unresolved ${kind} owner prevents preparation before v1 conversion`, { timeout: 60_000 }, async t => {
  const f = await deletionPreparationFiles(t);
  const { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } = await import('../src/workspaces/creation/workspaceCreationJournalPaths.ts');
  const { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } = await import('../src/workspaces/import/workspaceBackupImportJournalPaths.ts');
  const { createWorkspaceLegacyAdoptionJournalPaths } = await import('../src/workspaces/adoption/workspaceLegacyAdoptionJournal.ts');
  const { createWorkspaceSwitchJournalPaths } = await import('../src/workspaces/switch/workspaceSwitchJournal.ts');
  const { createWorkspaceFirstStartMigrationJournalPaths } = await import('../src/workspaces/update/workspaceFirstStartMigrationJournalPaths.ts');
  const { createDesktopProfilePaths } = await import('../src/runtime/desktopProfilePaths.ts');
  const { createProfileSnapshotRuntimePaths } = await import('../src/profileBackup/profileSnapshotRuntimePaths.ts');
  const { createLocalUpdateRuntimePaths } = await import('../src/update/localUpdateRuntimePaths.ts');
  const { deriveWorkspaceBackupReplacementOperationsPaths } = await import('../src/workspaces/replacement/workspaceBackupReplacementPaths.ts');
  const legacyRuntimeRoot = createDesktopProfilePaths(f.userDataRoot).runtimeRoot;
  const update = createLocalUpdateRuntimePaths({ userDataPath: f.userDataRoot, legacyRuntimeRoot });
  const paths = {
    creation: createWorkspaceCreationJournalPaths(f.userDataRoot, join(f.userDataRoot, WORKSPACE_CREATION_JOURNAL_FILE_NAME)).currentPath,
    import: createWorkspaceBackupImportJournalPaths(f.userDataRoot, join(f.userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)).currentPath,
    adoption: createWorkspaceLegacyAdoptionJournalPaths(f.userDataRoot).currentPath,
    switch: createWorkspaceSwitchJournalPaths(f.userDataRoot).currentPath,
    firstStart: createWorkspaceFirstStartMigrationJournalPaths(f.userDataRoot).currentPath,
    update: update.journalPath, legacyUpdate: update.legacyJournalPath,
    profileRestore: createProfileSnapshotRuntimePaths(legacyRuntimeRoot).restoreActivationJournalPath,
    replacement: deriveWorkspaceBackupReplacementOperationsPaths(f.userDataRoot).activationJournalPath,
  };
  const path = paths[kind], bytes = Buffer.from('synthetic unresolved owner bytes');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  const before = await readFile(f.registryPath);
  await assert.rejects(f.preparation.prepareAfterRestoredExit(f.context));
  assert.deepEqual(await readFile(f.registryPath), before); assert.deepEqual(await readFile(path), bytes);
  await assert.rejects(f.acquireWorkspaceProcessReservation({ userDataRoot: f.userDataRoot, signal: f.controller.signal }),
    error => error.reason === 'busy');
  await assert.rejects(readFile(f.journalPaths.currentPath), { code: 'ENOENT' });
  await f.assertRetained();
});
}

async function smokeJobProducer(t, { phase = 'initial', control = async () => {}, versionControl = async () => {},
  outputControl = output => output, portControl = async () => {}, requestReadControl } = {}) {
  const f = await deletionPreparationFiles(t, { version: 2 });
  const main = await import('../src/main/packagedSmoke.ts');
  const startup = await import('../src/main/startupExceptionEvidence.ts');
  const calls = [], records = [], portReads = [];
  const target = new URL('./packagedSmokeJobWorker.mjs', import.meta.url);
  const key = `__ekyPackagedPhaseWorkerFixture${++fixtureId}`;
  target.searchParams.set('fixture', key);
  const mocks = {
    ...(requestReadControl === undefined ? {} : {
      '../installer/windows-acceptance-harness/acceptanceCommandPhaseInput.mjs': {
        async readCommandPhaseJson(path) {
          const { readCommandPhaseJson } = await import('../installer/windows-acceptance-harness/acceptanceCommandPhaseInput.mjs');
          const value = await readCommandPhaseJson(path);
          await requestReadControl(path, value);
          return value;
        },
      },
    }),
    './run-packaged-smoke.mjs': { async runPackagedSmoke() { assert.fail('whole workflow is not a phase producer fixture'); },
      async runPackagedSmokePhase(options) {
      calls.push(options); await control(options);
      const stream = () => ({ text: '', truncated: false, readFailed: false,
        available: true, ended: true, changed: false, partial: false });
      const stdout = stream();
      if (!phase.startsWith('selector')) main.reportPackagedSmokeBackend({ enabled: true, phase }, 12345,
        text => { stdout.text += text; });
      options.phaseOutputs.push(() => outputControl({ phase: options.expectedStage, stdout, stderr: stream() }));
    } },
    './read-desktop-electron-version.mjs': { readDesktopElectronVersion: async () => {
      await versionControl(); return 'synthetic-version';
    } },
    '../dist/main/packagedSmoke.js': { packagedSelectorVerificationPhase: main.packagedSelectorVerificationPhase,
      packagedSelectorVerificationSwitch: main.packagedSelectorVerificationSwitch, readPackagedSmokeBackend: main.readPackagedSmokeBackend,
      resolvePackagedSmokeTempPath: main.resolvePackagedSmokeTempPath },
    '../../e2e/src/environment/waitForLoopbackPortRelease.ts': { async waitForLoopbackPortRelease(port) {
      portReads.push(port); await portControl(port);
    } },
    '../src/main/startupExceptionEvidence.ts': { STARTUP_EXCEPTION_SWITCH: startup.STARTUP_EXCEPTION_SWITCH,
      STARTUP_EXCEPTION_TOKEN_ENV: startup.STARTUP_EXCEPTION_TOKEN_ENV },
  };
  globalThis[key] = mocks;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === target.href && Object.hasOwn(mocks, specifier)) {
      const source = Object.keys(mocks[specifier]).map(name =>
        `export const ${name} = globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join('\n');
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
  const worker = await import(target.href);
  const env = { EKY_E2E: '1', EKY_DESKTOP_SMOKE_TOKEN: f.context.smokeToken, ELECTRON_RUN_AS_NODE: '1', RUNNER_TEMP: f.root };
  const input = { schemaVersion: 1, phase, runNonce: randomBytes(32).toString('hex'),
    artifactDescriptorSha256: 'a'.repeat(64), startupException: false };
  const selected = worker.capturePackagedSmokeJobPhase(input, env);
  const request = worker.createPackagedSmokeJobRequest(input, env);
  await mkdir(selected.phaseRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(selected.phaseRoot, 'request.json'), JSON.stringify(request), { flag: 'wx', mode: 0o600 });
  await writeFile(join(f.root, 'result', 'desktop-smoke-result.json'), JSON.stringify({ stage: 'startup', status: 'started' }));
  const sink = { record: value => records.push(value), flush: async () => ({ status: 'recorded' }) };
  return { ...f, worker, env, input, selected, request, calls, records, portReads, sink, startup, main,
    backendObservationPrefix: main.packagedSmokeBackendObservationPrefix,
    terminalPath: join(selected.phaseRoot, 'worker-result.json'),
    outputPath: join(selected.phaseRoot, 'phase-output.private.json'),
    run: () => worker.runPackagedSmokeJobPhase(input, env, sink) };
}

for (const kind of ['unboundRequest', 'duplicateRequestKey', 'oldSuccess', 'unfinishedRestore']) {
test(`the Job producer denies ${kind} before application launch`, { timeout: 60_000 }, async t => {
  const f = await smokeJobProducer(t);
  const request = join(f.selected.phaseRoot, 'request.json');
  const result = join(f.root, 'result', 'desktop-smoke-result.json');
  if (kind === 'unboundRequest') await writeFile(request, '{}');
  if (kind === 'duplicateRequestKey') await writeFile(request, '{"schemaVersion":1,"schemaVersion":1}');
  if (kind === 'oldSuccess') await writeFile(result, JSON.stringify({ stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' }));
  if (kind === 'unfinishedRestore') await writeFile(result, JSON.stringify({ stage: 'restoreRestart', status: 'started' }));
  const original = await readFile(request);
  await assert.rejects(f.run());
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readFile(request), original);
  await assert.rejects(readFile(f.terminalPath), { code: 'ENOENT' });
});
}

test('the Job worker accepts only canonical fixed arguments and an immutable exact request', { timeout: 60_000 }, async t => {
  const f = await smokeJobProducer(t);
  assert.deepEqual(f.worker.parsePackagedSmokeJobArguments(f.request.arguments.slice(1)), f.input);
  assert.equal(Object.isFrozen(f.request), true); assert.equal(Object.isFrozen(f.request.arguments), true);
  assert.equal(f.request.command, process.execPath);
  assert.equal(f.request.workingDirectory, f.selected.phaseRoot);
  assert.equal(f.request.timeoutMilliseconds, 120_000 - packagedSmokeJobCallerReserveMilliseconds);
  assert.equal(f.request.cleanupReserveMilliseconds, 1_000);
  const args = f.request.arguments.slice(1);
  for (const changed of [[], args.slice(0, -1), [...args, '--phase', 'initial'], [...args, '--startup-exception', '--startup-exception'],
    [...args, '--command', process.execPath], [...args, 'positional'], ['--phase=initial', ...args.slice(2)],
    [...args.slice(2), ...args.slice(0, 2)]]) {
    assert.throws(() => f.worker.parsePackagedSmokeJobArguments(changed));
  }
  f.sink.flush = async () => { throw new Error('SYNTHETIC_ARGUMENT_REPORT_FAILURE'); };
  await assert.rejects(f.worker.runPackagedSmokeJobWorker([...args, '--unknown'], f.env, f.sink),
    error => error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION');
  assert.equal(f.records[0].phase, 'packagedPhaseArguments'); assert.equal(f.calls.length, 0);
});

test('the phase worker accepts a reduced bound budget but never a later budget change', { timeout: 60_000 }, async t => {
  const reduced = await smokeJobProducer(t);
  const requestPath = join(reduced.selected.phaseRoot, 'request.json');
  const request = reduced.worker.createPackagedSmokeJobRequest(reduced.input, reduced.env, 5_000);
  await writeFile(requestPath, JSON.stringify(request));
  await reduced.run();
  assert.equal(reduced.calls.length, 1);
  assert.deepEqual(JSON.parse(await readFile(requestPath, 'utf8')), request);
  let changed;
  changed = await smokeJobProducer(t, { async versionControl() {
    await writeFile(join(changed.selected.phaseRoot, 'request.json'),
      JSON.stringify({ ...changed.request, timeoutMilliseconds: changed.request.timeoutMilliseconds - 1 }));
  } });
  await assert.rejects(changed.run(), { message: 'PACKAGED_SMOKE_JOB_INPUT_INVALID' });
  assert.equal(changed.calls.length, 0);
});

test('the workflow worker freezes its reduced budget before admission', { timeout: 60_000 }, async t => {
  let changed = false;
  const f = await smokeJobProducer(t, { phase: 'workspaceDeletion', async requestReadControl(path, value) {
    if (changed || !path.endsWith('request.json')) return;
    changed = true;
    await writeFile(path, JSON.stringify({ ...value, timeoutMilliseconds: value.timeoutMilliseconds - 1 }));
  } });
  const cwd = t.mock.method(process, 'cwd', () => f.selected.phaseRoot);
  try {
    await assert.rejects(f.worker.runPackagedSmokeJobWorker(f.request.arguments.slice(1), f.env, f.sink),
      { message: 'PACKAGED_SMOKE_JOB_INPUT_INVALID' });
  } finally { cwd.mock.restore(); }
  assert.equal(changed, true); assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(f.terminalPath), { code: 'ENOENT' });
});

test('the Job producer checks every request field without changing rejected bytes', { timeout: 60_000 }, async t => {
  const f = await smokeJobProducer(t);
  const path = join(f.selected.phaseRoot, 'request.json');
  for (const change of [{ schemaVersion: 2 }, { runNonce: 'b'.repeat(64) }, { scenario: 'packagedSmokeRestored' },
    { artifactDescriptorSha256: 'b'.repeat(64) }, { command: 'other.exe' }, { arguments: [...f.request.arguments, '--unknown'] },
    { workingDirectory: f.root }, { timeoutMilliseconds: 120_001 }, { cleanupReserveMilliseconds: 2_000 }, { extra: true }]) {
    const bytes = Buffer.from(JSON.stringify({ ...f.request, ...change })); await writeFile(path, bytes);
    await assert.rejects(f.run()); assert.deepEqual(await readFile(path), bytes);
  }
  assert.equal(f.calls.length, 0); await assert.rejects(readFile(f.terminalPath), { code: 'ENOENT' });
});

for (const changed of ['request', 'startup', 'requestLink', 'startupLink']) {
test(`the Job producer refuses ${changed} changed during admission`, { timeout: 60_000 }, async t => {
  let f;
  f = await smokeJobProducer(t, { async versionControl() {
    const path = changed.startsWith('request') ? join(f.selected.phaseRoot, 'request.json') :
      join(f.root, 'result', 'desktop-smoke-result.json');
    if (changed.endsWith('Link')) await preparationFiles.link(path, `${path}.alias`);
    else await writeFile(path, JSON.stringify(changed === 'request' ? { ...f.request, runNonce: 'b'.repeat(64) } :
      { stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' }));
  } });
  await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(f.terminalPath), { code: 'ENOENT' });
});
}

test('the Job producer rejects missing or extended startup data before phase execution', { timeout: 60_000 }, async t => {
  const f = await smokeJobProducer(t), path = join(f.root, 'result', 'desktop-smoke-result.json');
  for (const bytes of ['{"stage":"startup","status":"started","extra":true}',
    '{"stage":"startup","status":"started","status":"started"}']) {
    await writeFile(path, bytes); await assert.rejects(f.run()); assert.equal(await readFile(path, 'utf8'), bytes);
  }
  await rm(path); await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
});

for (const phase of ['initial', 'restoredProfile', 'selectorRecovery', 'selectorRestart']) {
test(`the uncoupled Job producer ${phase} publishes only after its shared phase settles`, { timeout: 60_000 }, async t => {
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { finish = resolve; });
  const f = await smokeJobProducer(t, { phase, async control() { enter(); await held; } });
  const task = f.run(); await entered;
  const early = await readFile(f.terminalPath).then(bytes => ({ bytes }), error => ({ error }));
  f.input.phase = 'changedAfterAdmission'; f.env.EKY_DESKTOP_SMOKE_TOKEN = 'f'.repeat(32);
  finish(); await task;
  assert.equal(early.error?.code, 'ENOENT');
  const terminal = JSON.parse(await readFile(f.terminalPath, 'utf8'));
  assert.deepEqual(terminal, { ...f.selected.binding, status: 'completed', resultCode: 'packagedPhaseCompleted', errorCode: null });
  const output = JSON.parse(await readFile(f.outputPath, 'utf8'));
  assert.deepEqual(output.binding, f.selected.binding); assert.equal(output.cleanup, 'notVerified');
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].argumentsList, f.selected.argumentsList);
  assert.equal(f.calls[0].expectedStage, f.selected.expectedStage);
  assert.equal(f.calls[0].childEnvironment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(f.calls[0].childEnvironment.ELECTRON_ENABLE_SECURITY_WARNINGS, 'true');
  assert.deepEqual(f.portReads, phase.startsWith('selector') ? [] : [12345]);
  assert.equal(f.records.length, 0);
});
}

for (const kind of ['missing', 'stalePhase', 'duplicated', 'partial', 'changed', 'readFailed', 'truncated', 'notEnded', 'unavailable',
  'markerOnly', 'unterminated', 'validPlusMarker']) {
test(`the Job producer rejects ${kind} port evidence before publishing success`, { timeout: 60_000 }, async t => {
  let f;
  f = await smokeJobProducer(t, { outputControl(output) {
    if (kind === 'missing') output.stdout.text = '';
    else if (kind === 'stalePhase') output.stdout.text = output.stdout.text.replace('initial', 'restoredProfile');
    else if (kind === 'duplicated') output.stdout.text += output.stdout.text;
    else if (kind === 'notEnded') output.stdout.ended = false;
    else if (kind === 'unavailable') output.stdout.available = false;
    else if (kind === 'markerOnly') output.stdout.text = f.backendObservationPrefix.trimEnd() + '\n';
    else if (kind === 'unterminated') output.stdout.text = output.stdout.text.trimEnd();
    else if (kind === 'validPlusMarker') output.stdout.text += f.backendObservationPrefix.trimEnd() + '\n';
    else output.stdout[kind] = true;
    return output;
  } });
  await assert.rejects(f.run()); assert.deepEqual(f.portReads, []);
  assert.equal(JSON.parse(await readFile(f.terminalPath, 'utf8')).status, 'failed');
  assert.equal(f.records.some(record => record.phase === 'packagedPhase'), true);
});
}

for (const phase of ['selectorRecovery', 'selectorRestart']) {
test(`the Job producer ${phase} rejects an incomplete backend marker even with a clean stream EOF`, { timeout: 60_000 }, async t => {
  let f;
  f = await smokeJobProducer(t, { phase, outputControl(output) {
    output.stdout.text = f.backendObservationPrefix.trimEnd() + '\n'; return output;
  } });
  await assert.rejects(f.run()); assert.deepEqual(f.portReads, []);
  assert.equal(JSON.parse(await readFile(f.terminalPath, 'utf8')).status, 'failed');
});
}

test('the Job producer waits for independent port release before its successful terminal', { timeout: 60_000 }, async t => {
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { finish = resolve; });
  const f = await smokeJobProducer(t, { async portControl(port) { assert.equal(port, 12345); enter(); await held; } });
  const task = f.run(); task.catch(() => undefined); await entered;
  const early = await readFile(f.terminalPath).then(bytes => ({ bytes }), error => ({ error }));
  finish(); await task;
  assert.equal(early.error?.code, 'ENOENT');
  assert.equal(JSON.parse(await readFile(f.terminalPath, 'utf8')).status, 'completed');
});

test('the Job producer retains the original port failure before terminal and reporting failures', { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_OWNED_PORT_STILL_BUSY', { cause: new Error('SYNTHETIC_PORT_CAUSE') });
  let f;
  f = await smokeJobProducer(t, { async portControl() {
    await writeFile(f.terminalPath, 'synthetic terminal collision', { flag: 'wx' }); throw first;
  } });
  f.sink.flush = async () => { throw new Error('synthetic reporting failure'); };
  await assert.rejects(f.run(), error => error.cause === first);
  assert.equal(f.records.find(record => record.phase === 'packagedPhase').error, first);
  assert.equal(await readFile(f.terminalPath, 'utf8'), 'synthetic terminal collision');
  assert.equal(f.records.some(record => record.phase === 'packagedPhaseTerminal'), true);
});

test('the Job producer retains its original spawn error before terminal and reporting failures', { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_JOB_SPAWN_FIRST', { cause: new Error('SYNTHETIC_JOB_SPAWN_CAUSE') });
  const f = await smokeJobProducer(t, { async control(options) {
    options.exceptionEvidence.capture(first); throw new Error('SYNTHETIC_SAFE_PHASE_FAILURE');
  } });
  f.sink.flush = async () => { throw new Error('SYNTHETIC_REPORT_FAILURE'); };
  await assert.rejects(f.run(), error => error.cause === first);
  assert.equal(f.records[0].error, first); assert.equal(f.records[0].phase, 'packagedPhaseOriginal');
  const terminal = JSON.parse(await readFile(f.terminalPath, 'utf8'));
  assert.equal(terminal.status, 'failed'); assert.equal(terminal.errorCode, 'packagedSmokePhaseFailed');
  const count = f.calls.length;
  await assert.rejects(f.run()); assert.equal(f.calls.length, count);
});

for (const priorExit of [false, true]) {
test(`the Job producer preserves result-read diagnostics with prior exit ${priorExit}`, { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_JOB_RESULT_READ');
  const primary = new Error('SYNTHETIC_JOB_EXIT_FAILED');
  const f = await smokeJobProducer(t, { async control(options) {
    options.observeResultReadFailure(first, priorExit ? primary : undefined); throw primary;
  } });
  await assert.rejects(f.run(), error => priorExit ? error === primary : error.cause === first);
  assert.equal(f.records[0].error, first); assert.equal(f.records[0].phase, 'packagedPhaseResultRead');
  assert.equal(JSON.parse(await readFile(f.terminalPath, 'utf8')).status, 'failed');
});
}

test('the Job producer refuses pre-existing terminal bytes without another application call', { timeout: 60_000 }, async t => {
  const f = await smokeJobProducer(t);
  const bytes = Buffer.from('synthetic previous terminal bytes');
  await writeFile(f.terminalPath, bytes, { flag: 'wx' });
  await assert.rejects(f.run());
  assert.equal(f.calls.length, 0); assert.deepEqual(await readFile(f.terminalPath), bytes);
  await assert.rejects(readFile(f.outputPath), { code: 'ENOENT' });
});

test('the Job producer rejects malformed metadata and startup context without coercion or application launch', { timeout: 60_000 }, async t => {
  const f = await smokeJobProducer(t);
  const coercion = { toString() { assert.fail('phase must not be coerced'); } };
  for (const change of [{ schemaVersion: 2 }, { phase: coercion }, { phase: 'legacyInvoice' },
    { runNonce: 'A'.repeat(64) }, { artifactDescriptorSha256: 'short' }, { startupException: true }]) {
    await assert.rejects(f.worker.runPackagedSmokeJobPhase({ ...f.input, ...change }, f.env, f.sink));
  }
  const extra = { ...f.input }; Object.defineProperty(extra, Symbol('hidden'), { value: true });
  await assert.rejects(f.worker.runPackagedSmokeJobPhase(extra, f.env, f.sink));
  assert.equal(f.calls.length, 0); await assert.rejects(readFile(f.terminalPath), { code: 'ENOENT' });
  f.env[f.startup.STARTUP_EXCEPTION_TOKEN_ENV] = f.context.smokeToken + 'b'.repeat(32);
  const input = { ...f.input, startupException: true };
  await writeFile(join(f.selected.phaseRoot, 'request.json'), JSON.stringify(f.worker.createPackagedSmokeJobRequest(input, f.env)));
  await f.worker.runPackagedSmokeJobPhase(input, f.env, f.sink);
  assert.deepEqual(f.calls[0].exceptionEvidence.arguments, [`--${f.startup.STARTUP_EXCEPTION_SWITCH}`]);
});

test('the Job producer preserves the primary phase error if its terminal cannot be written', { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_JOB_PRIMARY');
  let f;
  f = await smokeJobProducer(t, { async control() {
    await writeFile(f.terminalPath, 'synthetic late terminal', { flag: 'wx' }); throw first;
  } });
  await assert.rejects(f.run(), error => error.cause === first);
  assert.equal(await readFile(f.terminalPath, 'utf8'), 'synthetic late terminal');
  assert.equal(f.records.some(record => record.phase === 'packagedPhaseTerminal'), true);
});

test('the Job producer output-write failure remains separate from its successful phase', { timeout: 60_000 }, async t => {
  let f;
  f = await smokeJobProducer(t, { async control() {
    await writeFile(f.outputPath, 'synthetic output collision', { flag: 'wx' });
  } });
  await f.run();
  assert.equal(JSON.parse(await readFile(f.terminalPath, 'utf8')).status, 'completed');
  assert.equal(await readFile(f.outputPath, 'utf8'), 'synthetic output collision');
  assert.equal(f.records.some(record => record.phase === 'packagedPhaseOutput' && record.error.code === 'EEXIST'), true);
});

test('the Job producer refuses a replaced smoke root even when the same phase directory is moved back', { timeout: 60_000 }, async t => {
  let f;
  f = await smokeJobProducer(t, { async control() {
    await preparationFiles.rename(f.root, `${f.root}.producer-displaced`);
    await mkdir(dirname(f.selected.phaseRoot), { recursive: true, mode: 0o700 });
    await preparationFiles.rename(join(`${f.root}.producer-displaced`, relative(f.root, f.selected.phaseRoot)), f.selected.phaseRoot);
  } });
  const retained = await readFile(f.targetFile);
  t.after(async () => { if (t.passed === true) await rm(`${f.root}.producer-displaced`, { recursive: true }); });
  await assert.rejects(f.run());
  await assert.rejects(readFile(f.terminalPath), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(`${f.root}.producer-displaced`, relative(f.root, f.targetFile))), retained);
});

for (const source of ['phase', 'port', 'parentPort']) {
test(`the Job producer ${source} original cause survives the existing OpenPGP package without adding a raw-output collector path`, {
  timeout: 120_000, skip: !['win32', 'linux'].includes(process.platform),
}, async t => {
  const { gunzipSync } = await import('node:zlib');
  const { createOpenPgpTestFixture } = await import('../installer/windows-acceptance-harness/openPgpTestFixture.mjs');
  const { collectJobFailureEvidence } = await import('../installer/windows-acceptance-harness/ciFailureEvidence.mjs');
  const { encryptArchive } = await import('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs');
  const { createRunnerFailureSink, RUNNER_FAILURE_ROOT_PREFIX, validateRunnerFailureEvidence } =
    await import('../../../test-reporters/runnerFailureEvidence.mjs');
  let first = new Error('SYNTHETIC_JOB_ENCRYPTED_FIRST', { cause: new Error('SYNTHETIC_JOB_ENCRYPTED_CAUSE') });
  const foreign = source === 'parentPort' ? createServer() : undefined;
  t.after(async () => { if (foreign?.listening) await new Promise((accept, reject) => foreign.close(error => error ? reject(error) : accept())); });
  let port;
  if (foreign) {
    await new Promise((accept, reject) => { foreign.once('error', reject); foreign.listen(0, '127.0.0.1', accept); });
    port = foreign.address().port;
    await new Promise((accept, reject) => foreign.close(error => error ? reject(error) : accept()));
  }
  const f = source === 'parentPort' ? await smokeJobParent(t, { backendPort: port, actualPortCheck: true,
    async afterProcess() {
      await new Promise((accept, reject) => { foreign.once('error', reject); foreign.listen(port, '127.0.0.1', accept); });
    } }) : await smokeJobProducer(t, source === 'phase' ? { async control(options) {
    options.exceptionEvidence.capture(first); throw new Error('SYNTHETIC_JOB_SAFE_FAILURE');
  } } : { async portControl() { throw first; } });
  const crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../', import.meta.url)));
  let completed = false, failure;
  try {
    const recipient = await crypto.generate('phase-recipient');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'phase-public.asc');
    const temporary = join(crypto.root, 'runner-temp'), checkout = join(crypto.root, 'empty-checkout');
    await mkdir(temporary); await mkdir(checkout);
    const env = { ...f.env, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'packaged-phase', EKY_EVIDENCE_JOB_KEY: 'packaged-phase-0', GITHUB_SHA: 'a'.repeat(40),
      RUNNER_TEMP: temporary, GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
    const sink = createRunnerFailureSink({ env, tempRoot: temporary });
    await assert.rejects(source === 'parentPort' ? f.run({ environment: env, sink }) :
      f.worker.runPackagedSmokeJobPhase(f.input, env, sink), error => {
        if (source !== 'parentPort') return source === 'phase' ? error.cause === first : error === first;
        assert.equal(error.supervisorResult.status, 'completed'); assert.equal(error.supervisorResult.processTreeAbsent, true);
        assert.deepEqual(error.portRelease, { status: 'failed' });
        assert.equal(error.cause.message, 'E2E_LOOPBACK_PORT_RELEASE_TIMEOUT'); first = error.cause; return true;
      });
    if (foreign) await new Promise((accept, reject) => foreign.close(error => error ? reject(error) : accept()));
    const originals = new Map();
    for (const directory of await preparationFiles.readdir(temporary)) {
      if (!directory.startsWith(RUNNER_FAILURE_ROOT_PREFIX)) continue;
      for (const name of await preparationFiles.readdir(join(temporary, directory))) {
        originals.set(`temporary/${directory}/${name}`, await readFile(join(temporary, directory, name)));
      }
    }
    assert.equal(originals.size, 3);
    const smoke = join(temporary, 'eky-desktop-smoke', f.context.smokeToken);
    const nestedOutput = join(smoke, 'result', 'phase-jobs', f.input.runNonce, 'phase-output.private.json');
    await mkdir(dirname(nestedOutput), { recursive: true });
    await writeFile(nestedOutput, await readFile(f.outputPath), { flag: 'wx' });
    await mkdir(join(smoke, 'user-data'));
    await writeFile(join(smoke, 'user-data', 'uncollected.sqlite'), 'UNEXPORTED_SYNTHETIC_PROFILE', { flag: 'wx' });
    const collected = await collectJobFailureEvidence(env, { nativeTemp: temporary });
    assert.equal(JSON.stringify(collected.manifest).includes(first.message), false);
    assert.equal(collected.manifest.files.every(entry => entry.kind === 'runnerFailure'), true);
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.cleanup, 'notInferred'); assert.equal(archive.manifest.files.length, originals.size);
    const records = archive.manifest.files.map(entry => {
      assert.equal(entry.status, 'retained');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes); assert.deepEqual(bytes, originals.get(entry.source));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
      return validateRunnerFailureEvidence(JSON.parse(bytes));
    });
    const original = records.find(record => record.phase === (source === 'parentPort' ? 'packagedJobOriginal' : 'packagedPhaseOriginal'));
    assert.equal(original.exception.chain[0].message, first.message);
    if (first.cause) assert.equal(original.exception.chain[1].message, first.cause.message);
    else assert.equal(original.exception.chain.length, 1);
    assert.equal(original.exception.chain[0].stack.includes(source === 'parentPort'
      ? 'waitForLoopbackPortRelease.ts' : 'packagedSmokeFailureEvidence.test.mjs'), true);
    const phaseRecord = records.find(record => record.phase === (source === 'parentPort' ? 'packagedJob' : 'packagedPhase'));
    assert.equal(phaseRecord.exception.chain.some(part => part.message === first.message), true);
    if (source === 'parentPort') assert.match(phaseRecord.exception.chain[0].message, /"applicationPhase":"completed"/u);
    assert.equal(JSON.stringify(archive).includes('UNEXPORTED_SYNTHETIC_PROFILE'), false);
    completed = true;
  } catch (error) { failure = { error }; }
  try { await crypto.finish({ completed, failed: !completed }); }
  catch (error) {
    if (failure) throw new AggregateError([failure.error, error], 'PACKAGED_SMOKE_JOB_CRYPTO_FAILED', { cause: failure.error });
    throw error;
  }
  if (failure) throw failure.error;
});
}

async function smokeJobParent(t, controls = {}) {
  const f = await smokeJobProducer(t, { phase: controls.phase ?? 'initial' });
  const workflow = controls.phase === 'workspaceDeletion';
  if (workflow) f.env.EKY_DESKTOP_SMOKE_TOKEN = randomBytes(16).toString('hex');
  const input = { ...f.input, runNonce: randomBytes(32).toString('hex') };
  const selected = f.worker.capturePackagedSmokeJobPhase(input, f.env);
  const calls = [], inventories = [], state = {}, postJobPortReads = [];
  const main = await import('../src/main/packagedSmoke.ts');
  const target = new URL('./packagedSmokeJob.mjs', import.meta.url);
  const key = `__ekyPackagedPhaseParentFixture${++fixtureId}`;
  target.searchParams.set('fixture', key);
  const { ordinaryPath } = await import('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs');
  const mocks = {
    './packagedSmokeJobWorker.mjs': { capturePackagedSmokeJobPhase: f.worker.capturePackagedSmokeJobPhase,
      createPackagedSmokeJobRequest: f.worker.createPackagedSmokeJobRequest, packagedSmokeJobCleanupReserveMilliseconds: 1_000 },
    './run-packaged-smoke.mjs': { packagedSmokeTimeoutMilliseconds: 120_000 },
    './package-artifact-inventory.mjs': { async inspectPackageArtifactInventory(options) {
      if (workflow) {
        const info = await ordinaryPath(selected.temp, selected.root, true);
        state.rootIdentity ??= { dev: info.dev, ino: info.ino };
      }
      inventories.push(options); await controls.inventory?.();
      return { identity: controls.inventoryIdentity ?? selected.binding.artifactDescriptorSha256 };
    } },
    '../dist/main/packagedSmoke.js': { writePackagedSmokeResult: main.writePackagedSmokeResult,
      readPackagedSmokeBackend: main.readPackagedSmokeBackend,
      packagedSelectorVerificationPhase: main.packagedSelectorVerificationPhase },
    '../../e2e/src/environment/waitForLoopbackPortRelease.ts': { loopbackPortReleaseTimeoutMilliseconds,
      async waitForLoopbackPortRelease(port, milliseconds) {
        postJobPortReads.push({ port, milliseconds });
        if (controls.actualPortCheck) return waitForLoopbackPortRelease(port, milliseconds);
        await controls.portControl?.(port, milliseconds);
      } },
    'node:child_process': { spawn: (...args) => controls.spawn(...args) },
    ...(controls.removeRoot === undefined ? {} : { 'node:fs/promises': {
      lstat: preparationFiles.lstat, mkdir: preparationFiles.mkdir, writeFile: preparationFiles.writeFile,
      rm: controls.removeRoot,
    } }),
    ...(controls.waitRetry === undefined ? {} : { 'node:timers/promises': { setTimeout: controls.waitRetry } }),
    ...(controls.afterRootCheck === undefined ? {} : {
      '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs': { async ordinaryPath(...args) {
        const value = await ordinaryPath(...args); await controls.afterRootCheck(...args); return value;
      } },
    }),
  };
  globalThis[key] = mocks;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === target.href && Object.hasOwn(mocks, specifier)) {
      const source = Object.keys(mocks[specifier]).map(name =>
        `export const ${name} = globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join('\n');
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
  const parent = await import(target.href);
  if (workflow) t.after(async () => {
    if (t.passed !== true || state.rootIdentity === undefined || controls.actualBoundedProcess) return;
    let info;
    try { info = await ordinaryPath(selected.temp, selected.root, true); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    assert.deepEqual({ dev: info.dev, ino: info.ino }, state.rootIdentity);
    await rm(selected.root, { recursive: true });
  });
  const stream = () => ({ text: '', truncated: false, readFailed: false, available: true, ended: true, changed: false, partial: false });
  const processResult = { status: 'completed', resultCode: 'processCompleted', exitCode: 0, directProcessAbsent: true,
    ...controls.processResult };
  const runProcess = async options => {
    calls.push(options);
    state.startupAtLaunch = JSON.parse(await readFile(join(selected.root, 'result', 'desktop-smoke-result.json'), 'utf8'));
    state.request = JSON.parse(await readFile(join(selected.phaseRoot, 'request.json'), 'utf8'));
    await controls.enter?.(options);
    const report = { ...selected.binding, status: 'completed', processResultCode: 'processCompleted',
      workerResultCode: 'workerResultValidated', childExitCode: 0, processWin32ErrorCode: null,
      cleanupWin32ErrorCode: null, cleanupResultCode: 'notRequired', processTreeAbsent: true, durationMs: 1, ...controls.report };
    const worker = { ...selected.binding, status: 'completed',
      resultCode: workflow ? 'packagedWorkflowCompleted' : 'packagedPhaseCompleted', errorCode: null, ...controls.worker };
    await writeFile(join(selected.phaseRoot, 'result.json'), JSON.stringify(report), { flag: 'wx' });
    if (!controls.missingWorker) await writeFile(join(selected.phaseRoot, 'worker-result.json'), JSON.stringify(worker), { flag: 'wx' });
    const phases = (workflow ? ['initial', 'restoredProfile', 'selectorRecovery', 'selectorRestart'] : [selected.phase])
      .map(phase => {
        const stdout = stream();
        if (!phase.startsWith('selector')) main.reportPackagedSmokeBackend({ enabled: true, phase },
          controls.backendPort ?? 12345, text => { stdout.text += text; });
        return { phase: phase === 'initial' ? 'restoreRestart' : 'shutdown', stdout, stderr: stream() };
      });
    const output = { schemaVersion: 1, binding: selected.binding, phase: selected.phase, cleanup: 'notVerified',
      phases, ...controls.output };
    controls.transformOutput?.(output);
    if (!controls.missingOutput) await writeFile(join(selected.phaseRoot, 'phase-output.private.json'), JSON.stringify(output), { flag: 'wx' });
    await controls.afterProcess?.();
    state.directReturned = true;
    return processResult;
  };
  return { ...f, root: selected.root, input, selected, parent, calls, inventories, state, postJobPortReads,
    outputPath: join(selected.phaseRoot, 'phase-output.private.json'),
    terminalPath: join(selected.phaseRoot, 'worker-result.json'),
    run: options => parent[workflow ? 'runOwnedPackagedSmokeWorkflow' : 'runOwnedPackagedSmokePhase'](input, { environment: f.env, sink: f.sink,
      runProcess: controls.actualBoundedProcess ? undefined : runProcess, ...options }) };
}

async function workflowExecution(t, controls = {}) {
  const f = await smokeJobProducer(t), input = { ...f.input, phase: 'workspaceDeletion' };
  const controller = new AbortController(), calls = [];
  const owner = f.worker.createPackagedSmokeWorkflowExecution(input, f.env, { signal: controller.signal,
    async runPhase(value, options) {
      calls.push({ value, options }); await controls.enter?.(value, options);
      const selected = f.worker.capturePackagedSmokeJobPhase(value, options.environment);
      const output = closedWorkflowOutput(selected.expectedStage);
      if (!value.phase.startsWith('selector')) f.main.reportPackagedSmokeBackend({ enabled: true, phase: value.phase },
        12345, text => { output.stdout.text += text; });
      const result = { binding: selected.binding, diagnostic: { status: 'verified', phase: output },
        portRelease: { status: value.phase.startsWith('selector') ? 'notStarted' : 'verified' },
        supervisorResult: { ...selected.binding, status: 'completed', processResultCode: 'processCompleted',
          workerResultCode: 'workerResultValidated', childExitCode: 0, processWin32ErrorCode: null,
          cleanupWin32ErrorCode: null, cleanupResultCode: 'notRequired', processTreeAbsent: true, durationMs: 1 } };
      controls.transform?.(result); return result;
    } });
  return { ...f, input, owner, calls, controller,
    call: phase => owner.execution.runPhase(Object.freeze({ phase, environment: Object.freeze({ ...f.env }), startupException: false })) };
}

test('the workflow fixes its request and preserves the existing aggregate and phase budgets', async t => {
  const f = await workflowExecution(t), selected = f.worker.capturePackagedSmokeJobPhase(f.input, f.env);
  const request = f.worker.createPackagedSmokeJobRequest(f.input, f.env);
  assert.equal(selected.phaseRoot, join(f.root, 'result', 'workflow-jobs', f.input.runNonce));
  assert.equal(request.timeoutMilliseconds, 300_000 - packagedSmokeJobCallerReserveMilliseconds);
  assert.equal(request.cleanupReserveMilliseconds, 1_000);
  assert.equal(f.worker.createPackagedSmokeJobRequest(f.input, f.env, 288_000).timeoutMilliseconds, 288_000);
  for (const budget of [300_001, 1_000, NaN, 2500.5]) assert.throws(() => f.worker.createPackagedSmokeJobRequest(f.input, f.env, budget));
  assert.throws(() => f.worker.capturePackagedSmokeJobPhase(f.input, { ...f.env, EKY_E2E: '0' }));
  assert.throws(() => f.worker.capturePackagedSmokeJobPhase({ ...f.input, startupException: true }, f.env));
  await assert.rejects(f.worker.runPackagedSmokeJobPhase(f.input, f.env, f.sink));
  assert.equal(f.calls.length, 0);
});

test('the workflow binds four independent jobs before granting each preparation boundary', async t => {
  const f = await workflowExecution(t);
  await f.call('initial'); await f.call('restoredProfile');
  await f.owner.assertPreviousPhaseStopped(f.context, 'new');
  await f.call('selectorRecovery'); await f.owner.assertPreviousPhaseStopped(f.context, 'prepared');
  await f.call('selectorRestart'); await f.owner.assertPreviousPhaseStopped(f.context, 'recovered');
  assert.deepEqual(f.calls.map(value => value.value.phase), ['initial', 'restoredProfile', 'selectorRecovery', 'selectorRestart']);
  assert.equal(new Set(f.calls.map(value => value.value.runNonce)).size, 4);
  assert.equal(f.owner.readOutputs().length, 4);
  for (const call of f.calls) {
    assert.equal(call.value.artifactDescriptorSha256, f.input.artifactDescriptorSha256);
    assert.equal(call.options.environment.EKY_DESKTOP_SMOKE_TOKEN, f.context.smokeToken);
  }
});

for (const kind of ['binding', 'tree', 'port', 'diagnostic', 'partial', 'backend']) {
test(`the workflow rejects ${kind} proof and never revives its preceding receipt`, async t => {
  const f = await workflowExecution(t, { transform(result) {
    if (kind === 'binding') result.binding = { ...result.binding, runNonce: '0'.repeat(64) };
    if (kind === 'tree') result.supervisorResult.processTreeAbsent = false;
    if (kind === 'port') result.portRelease.status = 'unverified';
    if (kind === 'diagnostic') result.diagnostic.status = 'unavailable';
    if (kind === 'partial') { result.diagnostic.phase.stdout.ended = false; result.diagnostic.phase.stdout.partial = true; }
    if (kind === 'backend') result.diagnostic.phase.stdout.text = '';
  } });
  let first;
  await assert.rejects(f.call('initial'), error => {
    first = error; if (kind === 'binding') assert.equal(error.message, 'PACKAGED_SMOKE_JOB_INPUT_INVALID'); return true;
  });
  await assert.rejects(f.call('initial'), error => error === first);
  await assert.rejects(f.owner.assertPreviousPhaseStopped(f.context, 'new'), error => error === first);
  assert.equal(f.calls.length, 1); assert.equal(f.owner.readOutputs().length, 0);
});
}

test('the workflow revokes a previous receipt while the next owned job is unresolved', async t => {
  let release, enter;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const f = await workflowExecution(t, { async enter(value) { if (value.phase === 'selectorRecovery') { enter(); await waiting; } } });
  await f.call('initial'); await f.call('restoredProfile'); await f.owner.assertPreviousPhaseStopped(f.context, 'new');
  const pending = f.call('selectorRecovery'); pending.catch(() => undefined); await entered;
  let first;
  await assert.rejects(f.owner.assertPreviousPhaseStopped(f.context, 'new'), error => { first = error; return true; });
  release(); await assert.rejects(pending, error => error === first);
  await assert.rejects(f.call('selectorRestart'), error => error === first);
  assert.equal(f.owner.readOutputs().length, 2);
});

test('the workflow drains a cancelled job without replacing cancellation with its later failure', async t => {
  let release, enter;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const first = new Error('SYNTHETIC_WORKFLOW_ABORT_FIRST'), later = new Error('SYNTHETIC_WORKFLOW_JOB_SECOND');
  const f = await workflowExecution(t, { async enter() { enter(); await waiting; throw later; } });
  const pending = f.call('initial'); let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; }); await entered;
  f.controller.abort(first); await nextTurn(); assert.equal(settled, false);
  release(); await assert.rejects(pending, error => error === first);
  assert.equal(f.owner.readOutputs().length, 0);
});

test('workflow metadata and environment are snapshotted before asynchronous work', async t => {
  let release, enter;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const f = await workflowExecution(t, { async enter() { enter(); await waiting; } });
  const expectedDigest = f.input.artifactDescriptorSha256;
  const pending = f.call('initial'); await entered;
  f.input.artifactDescriptorSha256 = 'b'.repeat(64); f.env.EKY_DESKTOP_SMOKE_TOKEN = 'f'.repeat(32);
  release(); await pending;
  assert.equal(f.calls[0].value.artifactDescriptorSha256, expectedDigest);
  assert.equal(f.calls[0].options.environment.EKY_DESKTOP_SMOKE_TOKEN, f.context.smokeToken);
});

for (const phase of ['initial', 'workspaceDeletion']) {
test(`the parent snapshots request metadata before asynchronous inventory: ${phase}`, { timeout: 60_000 }, async t => {
  let f;
  f = await smokeJobParent(t, { phase, async inventory() {
    f.input.runNonce = 'e'.repeat(64); f.input.artifactDescriptorSha256 = 'b'.repeat(64);
    f.env.EKY_DESKTOP_SMOKE_TOKEN = 'f'.repeat(32);
  } });
  const expected = { ...f.input };
  await f.run();
  assert.equal(f.state.request.runNonce, expected.runNonce);
  assert.equal(f.state.request.artifactDescriptorSha256, expected.artifactDescriptorSha256);
  assert.equal(f.state.request.workingDirectory, f.selected.phaseRoot);
});
}

for (const phase of ['initial', 'workspaceDeletion']) {
test(`the parent retains admission cancellation before a later inventory error: ${phase}`, { timeout: 60_000 }, async t => {
  let release, enter;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const first = new Error('SYNTHETIC_ADMISSION_ABORT_FIRST'), later = new Error('SYNTHETIC_ADMISSION_READ_SECOND');
  const controller = new AbortController();
  const f = await smokeJobParent(t, { phase, async inventory() { enter(); await waiting; throw later; } });
  const pending = f.run({ signal: controller.signal }); let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  t.after(async () => { release(); await pending.catch(() => undefined); });
  await entered; controller.abort(first); await nextTurn(); assert.equal(settled, false);
  release(); await assert.rejects(pending, error => error === first || error.cause === first);
  assert.equal(f.calls.length, 0); assert.equal((await preparationFiles.lstat(f.root)).isDirectory(), true);
});
}

test('workflow cleanup cannot retry deletion after its original budget expires', { timeout: 60_000 }, async t => {
  let now = 0, calls = 0;
  const lifetime = createE2eFixtureLifetime(300_000, () => now);
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', async removeRoot(path, options) {
    calls++; now = 299_950;
    if (options.maxRetries > 0) { now = 300_001; await rm(path, { recursive: true }); return; }
    throw Object.assign(new Error('SYNTHETIC_BUSY_CLEANUP'), { code: 'EBUSY' });
  }, async waitRetry(milliseconds) { now += milliseconds; } });
  await assert.rejects(f.run({ lifetime }));
  assert.equal(calls, 1); assert.equal((await preparationFiles.lstat(f.root)).isDirectory(), true);
});

test('workflow cleanup drains its retry wait and cannot delete after cancellation', { timeout: 60_000 }, async t => {
  let release, enter, calls = 0;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const controller = new AbortController(), first = new Error('SYNTHETIC_CLEANUP_ABORT_FIRST');
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', async removeRoot(path, options) {
    calls++;
    if (options.maxRetries > 0) { enter(); await waiting; await rm(path, { recursive: true }); return; }
    throw Object.assign(new Error('SYNTHETIC_BUSY_CLEANUP'), { code: 'EBUSY' });
  }, async waitRetry() { enter(); await waiting; } });
  const pending = f.run({ signal: controller.signal }); let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  t.after(async () => { release(); await pending.catch(() => undefined); });
  await entered; controller.abort(first); await nextTurn(); assert.equal(settled, false);
  release(); await assert.rejects(pending, error => error.cause === first && error.cleanup.status === 'failed');
  assert.equal(calls, 1); assert.equal((await preparationFiles.lstat(f.root)).isDirectory(), true);
});

test('the workflow parent keeps its terminal until both post-Job port checks settle, then owns root cleanup', { timeout: 60_000 }, async t => {
  let release, enter, reads = 0;
  const waiting = new Promise(accept => { release = accept; }), entered = new Promise(accept => { enter = accept; });
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', async portControl() {
    if (++reads === 2) { enter(); await waiting; }
  } });
  const pending = f.run(); pending.catch(() => undefined);
  t.after(async () => { release(); await pending.catch(() => undefined); });
  await entered;
  assert.equal(f.state.directReturned, true); assert.equal((await preparationFiles.lstat(f.terminalPath)).isFile(), true);
  assert.equal((await preparationFiles.lstat(f.root)).isDirectory(), true);
  release(); const result = await pending;
  assert.equal(result.supervisorResult.status, 'completed'); assert.deepEqual(result.portRelease, { status: 'verified' });
  assert.deepEqual(result.cleanup, { status: 'verified' }); assert.equal(result.diagnostic.phases.length, 4);
  assert.deepEqual(f.postJobPortReads.map(value => value.port), [12345, 12345]);
  await assert.rejects(preparationFiles.lstat(f.root), { code: 'ENOENT' });
});

test('the workflow parent retains a completed app and Job without granting cleanup from missing diagnostics', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', missingOutput: true });
  const result = await f.run();
  assert.equal(result.supervisorResult.status, 'completed'); assert.deepEqual(result.portRelease, { status: 'unverified' });
  assert.deepEqual(result.cleanup, { status: 'notAttempted' });
  assert.equal((await preparationFiles.lstat(f.terminalPath)).isFile(), true);
});

test('the workflow parent retains a completed app and Job on a failed port check', { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_WORKFLOW_POST_JOB_PORT');
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', async portControl() { throw first; } });
  await assert.rejects(f.run(), error => error.cause === first && error.supervisorResult.status === 'completed' &&
    error.supervisorResult.processTreeAbsent && error.cleanup.status === 'notAttempted');
  assert.equal((await preparationFiles.lstat(f.terminalPath)).isFile(), true);
});

test('the workflow uses one existing containment budget through inventory, request, process and cleanup', { timeout: 60_000 }, async t => {
  let now = 0;
  const lifetime = createE2eFixtureLifetime(300_000, () => now);
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', async inventory() { now = 280_000; } });
  const result = await f.run({ lifetime });
  assert.equal(f.state.request.timeoutMilliseconds, 20_000 - packagedSmokeJobCallerReserveMilliseconds);
  assert.equal(f.calls[0].timeoutMilliseconds + f.calls[0].terminationTimeoutMilliseconds, 20_000);
  assert.equal(result.cleanup.status, 'verified');
});

for (const phase of ['initial', 'workspaceDeletion']) {
test(`the parent counts preparation and reserves native cleanup and publication before its kill: ${phase}`, { timeout: 60_000 }, async t => {
  let now = 0;
  const cap = phase === 'initial' ? 120_000 : 300_000;
  const lifetime = createE2eFixtureLifetime(cap, () => now);
  const f = await smokeJobParent(t, { phase, async inventory() { now = 2_000; } });
  await f.run({ lifetime });
  const command = f.calls[0], request = f.state.request;
  assert.equal(request.timeoutMilliseconds, cap - 2_000 - packagedSmokeJobCallerReserveMilliseconds);
  assert.equal(request.cleanupReserveMilliseconds, 1_000);
  assert.equal(command.timeoutMilliseconds + command.terminationTimeoutMilliseconds, cap - 2_000);
  assert.equal(request.timeoutMilliseconds + packagedSmokeJobStartupReserveMilliseconds +
    packagedSmokeJobPublicationReserveMilliseconds, command.timeoutMilliseconds);
});

test(`the parent refuses launch if request preparation consumes its startup margin: ${phase}`, { timeout: 60_000 }, async t => {
  let now = 0, advanced = false, f;
  const cap = phase === 'initial' ? 120_000 : 300_000;
  const lifetime = createE2eFixtureLifetime(cap, () => now);
  f = await smokeJobParent(t, { phase, async afterRootCheck() {
    if (advanced) return;
    try { await preparationFiles.lstat(join(f.selected.phaseRoot, 'request.json')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    advanced = true; now += packagedSmokeJobStartupReserveMilliseconds;
  } });
  await assert.rejects(f.run({ lifetime }), { message: 'PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED' });
  assert.equal(advanced, true); assert.equal(f.calls.length, 0);
  assert.equal((await preparationFiles.lstat(join(f.selected.phaseRoot, 'request.json'))).isFile(), true);
});
}

test('an expired workflow cannot reset its budget or launch after inventory', { timeout: 60_000 }, async t => {
  let now = 0;
  const lifetime = createE2eFixtureLifetime(300_000, () => now);
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', async inventory() { now = 300_000; } });
  await assert.rejects(f.run({ lifetime }), { message: 'PACKAGED_SMOKE_WORKFLOW_DEADLINE_EXCEEDED' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(preparationFiles.lstat(join(f.selected.phaseRoot, 'request.json')), { code: 'ENOENT' });
});

test('an individual phase terminal cannot authorize whole-workflow cleanup', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { phase: 'workspaceDeletion', worker: { resultCode: 'packagedPhaseCompleted' } });
  await assert.rejects(f.run(), error => error.supervisorResult.status === 'completed' && error.cleanup.status === 'notAttempted');
  assert.equal((await preparationFiles.lstat(f.terminalPath)).isFile(), true); assert.equal(f.postJobPortReads.length, 0);
});

for (const phase of ['initial', 'restoredProfile', 'selectorRecovery', 'selectorRestart']) {
test(`the parent Job adapter binds ${phase} and resets startup before its fixed command`, { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { phase });
  await writeFile(join(f.root, 'result', 'desktop-smoke-result.json'), JSON.stringify({ stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' }));
  const result = await f.run();
  assert.deepEqual(result.binding, f.selected.binding); assert.equal(result.supervisorResult.processTreeAbsent, true);
  assert.equal(result.diagnostic.status, 'verified'); assert.equal(result.diagnostic.phase.phase, f.selected.expectedStage);
  assert.deepEqual(result.portRelease, { status: phase.startsWith('selector') ? 'notStarted' : 'verified' });
  assert.equal(Object.isFrozen(result.portRelease), true);
  assert.deepEqual(f.postJobPortReads.map(value => value.port), phase.startsWith('selector') ? [] : [12345]);
  for (const value of f.postJobPortReads) assert.ok(value.milliseconds > 0 && value.milliseconds <= 5_000);
  assert.deepEqual(f.state.startupAtLaunch, { stage: 'startup', status: 'started' });
  assert.deepEqual(f.state.request, f.worker.createPackagedSmokeJobRequest(f.input, f.env, f.state.request.timeoutMilliseconds));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].cwd, f.selected.phaseRoot);
  assert.ok(f.calls[0].timeoutMilliseconds + f.calls[0].terminationTimeoutMilliseconds <= 120_000);
  assert.ok(f.calls[0].timeoutMilliseconds > f.state.request.timeoutMilliseconds + packagedSmokeJobPublicationReserveMilliseconds);
  assert.equal(f.calls[0].arguments[1], '--request');
  assert.equal(f.calls[0].arguments[2], join(f.selected.phaseRoot, 'request.json'));
  assert.equal(f.inventories[0].stage, 'packagedApp');
});
}

for (const processResult of [{ directProcessAbsent: false }, { status: 'failed', resultCode: 'timedOut' }, { exitCode: 2 }]) {
test(`the parent Job adapter rejects unconfirmed direct completion ${JSON.stringify(processResult)}`, { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { processResult }); await assert.rejects(f.run());
  assert.equal((await preparationFiles.lstat(join(f.selected.phaseRoot, 'result.json'))).isFile(), true);
});
}

for (const report of [{ runNonce: 'b'.repeat(64) }, { processTreeAbsent: false }, { workerResultCode: 'notChecked' }]) {
test(`the parent Job adapter rejects an invalid supervisor proof ${JSON.stringify(report)}`, { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { report }); await assert.rejects(f.run());
});
}

test('the parent Job adapter retains a verified failed process report without calling it successful', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { processResult: { exitCode: 1 }, report: { status: 'failed',
    processResultCode: 'processExitFailed', childExitCode: 1, workerResultCode: 'notChecked' } });
  await assert.rejects(f.run(), error => error.supervisorResult.status === 'failed' &&
    error.supervisorResult.processTreeAbsent === true && error.cause.message.includes('"processResultCode":"processExitFailed"'));
});

test('the parent Job adapter retains direct-process uncertainty in its error and private record', { timeout: 60_000 }, async t => {
  const processResult = { status: 'failed', resultCode: 'terminationUnconfirmed', exitCode: null, directProcessAbsent: false };
  const f = await smokeJobParent(t, { processResult });
  await assert.rejects(f.run(), error => {
    assert.deepEqual(error.directProcessResult, processResult); assert.equal(error.supervisorResult, undefined);
    return true;
  });
  const record = f.records.find(item => item.phase === 'packagedJobProcess');
  assert.deepEqual(JSON.parse(record.error.message.slice('PACKAGED_SMOKE_JOB_PROCESS_FAILED:'.length)), processResult);
});

test('the parent Job adapter retains an unsigned Windows exit without granting Job success', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { processResult: { exitCode: 0xC0000005 } });
  await assert.rejects(f.run(), error => error.directProcessResult.exitCode === 0xC0000005 &&
    error.directProcessResult.directProcessAbsent === true && error.supervisorResult === undefined);
  const record = f.records.find(item => item.phase === 'packagedJobProcess');
  assert.equal(JSON.parse(record.error.message.slice('PACKAGED_SMOKE_JOB_PROCESS_FAILED:'.length)).exitCode, 0xC0000005);
});

for (const controls of [{ worker: { resultCode: 'unrelatedSuccess' } }, { worker: { extra: true } }, { missingWorker: true }]) {
test(`the parent Job adapter requires its own truthful worker terminal ${JSON.stringify(controls)}`, { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, controls); await assert.rejects(f.run());
});
}

for (const controls of [{ missingOutput: true }, { output: { binding: {} } }, { output: { phases: [] } }]) {
test(`the parent Job adapter keeps output availability separate ${JSON.stringify(controls)}`, { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, controls); const value = await f.run();
  assert.equal(value.supervisorResult.status, 'completed'); assert.equal(value.diagnostic.status, 'unavailable');
  assert.deepEqual(value.portRelease, { status: 'unverified' }); assert.deepEqual(f.postJobPortReads, []);
  assert.equal(f.records.some(record => record.phase === 'packagedJobOutput'), true);
});
}

for (const kind of ['missing', 'stale', 'duplicate', 'partial', 'unframed']) {
test(`the parent Job adapter never turns ${kind} port evidence into preparation authority`, { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { transformOutput(output) {
    const stdout = output.phases[0].stdout;
    if (kind === 'missing') stdout.text = '';
    if (kind === 'stale') stdout.text = stdout.text.replace('initial', 'restoredProfile');
    if (kind === 'duplicate') stdout.text += stdout.text;
    if (kind === 'partial') { stdout.partial = true; stdout.ended = false; }
    if (kind === 'unframed') stdout.text = stdout.text.trimEnd();
  } });
  const result = await f.run();
  assert.equal(result.supervisorResult.status, 'completed'); assert.equal(result.diagnostic.status, 'verified');
  assert.deepEqual(result.portRelease, { status: 'unverified' }); assert.deepEqual(f.postJobPortReads, []);
  assert.equal(f.records.some(value => value.phase === 'packagedJobPortObservation'), true);
});
}

test('the parent Job adapter waits for its fresh post-Job port check before returning a receipt', { timeout: 60_000 }, async t => {
  let enter, finish, f;
  const entered = new Promise(accept => { enter = accept; }), held = new Promise(accept => { finish = accept; });
  f = await smokeJobParent(t, { async portControl() {
    assert.equal(f.state.directReturned, true);
    assert.equal(JSON.parse(await readFile(join(f.selected.phaseRoot, 'result.json'), 'utf8')).processTreeAbsent, true);
    enter(); await held;
  } });
  let returned = false;
  const task = f.run().then(value => { returned = true; return value; }); task.catch(() => undefined);
  await entered; await nextTurn(); const early = returned;
  finish(); const result = await task;
  assert.equal(early, false); assert.deepEqual(result.portRelease, { status: 'verified' });
});

test('the parent Job adapter keeps cancellation ahead of a later port failure and drains the pending check', { timeout: 60_000 }, async t => {
  const controller = new AbortController(), first = new Error('SYNTHETIC_POST_JOB_CANCEL_FIRST');
  const second = new Error('SYNTHETIC_POST_JOB_PORT_SECOND');
  let enter, finish;
  const entered = new Promise(accept => { enter = accept; }), held = new Promise(accept => { finish = accept; });
  const f = await smokeJobParent(t, { async portControl() { enter(); await held; throw second; } });
  let settled = false;
  const task = f.run({ signal: controller.signal });
  const observed = task.then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  await entered; controller.abort(first); await nextTurn(); const early = settled;
  finish(); const result = await observed;
  assert.equal(early, false); assert.equal(result.error.cause, first);
  assert.equal(result.error.supervisorResult.status, 'completed'); assert.deepEqual(result.error.portRelease, { status: 'failed' });
  assert.equal(f.records.find(value => value.phase === 'packagedJobCancellation').error, first);
  assert.equal(f.records.find(value => value.phase === 'packagedJobOriginal').error, second);
});

for (const kind of ['remaining', 'exhausted', 'lateCompletion']) {
test(`the parent Job adapter preserves the total phase budget for ${kind}`, { timeout: 60_000 }, async t => {
  let clock = performance.now();
  const mocked = t.mock.method(performance, 'now', () => clock); t.after(() => mocked.mock.restore());
  const f = await smokeJobParent(t, { async enter() { clock += kind === 'exhausted' ? 120_001 : 119_500; },
    async portControl(_port, milliseconds) {
      assert.equal(milliseconds, 500);
      if (kind === 'lateCompletion') clock += 501;
    } });
  assert.equal(loopbackPortReleaseTimeoutMilliseconds, 5_000);
  if (kind === 'remaining') assert.deepEqual((await f.run()).portRelease, { status: 'verified' });
  else await assert.rejects(f.run(), error => error.cause.message === 'PACKAGED_SMOKE_JOB_PORT_DEADLINE_EXCEEDED' &&
    error.supervisorResult.status === 'completed' && error.portRelease.status === 'failed');
  assert.equal(f.postJobPortReads.length, kind === 'exhausted' ? 0 : 1);
});
}

test('the parent Job adapter rejects expiry during its final asynchronous root validation', { timeout: 60_000 }, async t => {
  let clock = performance.now(), portFinished = false, afterPortRoots = 0, f;
  const mocked = t.mock.method(performance, 'now', () => clock); t.after(() => mocked.mock.restore());
  f = await smokeJobParent(t, { async portControl() { portFinished = true; },
    async afterRootCheck(_root, path, directory) {
      if (portFinished && directory === true && path === f.selected.phaseRoot && ++afterPortRoots === 2) clock += 120_001;
    } });
  const result = await f.run().then(value => ({ value }), error => ({ error }));
  assert.equal(afterPortRoots, 2); assert.equal(f.postJobPortReads.length, 1);
  assert.equal(result.error?.cause.message, 'PACKAGED_SMOKE_JOB_PORT_DEADLINE_EXCEEDED');
  assert.equal(result.error.supervisorResult.status, 'completed');
  assert.deepEqual(result.error.portRelease, { status: 'failed' });
});

test('the parent Job adapter refuses a used nonce before replacing the last result', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t);
  await mkdir(f.selected.phaseRoot);
  const bytes = Buffer.from('synthetic previous state'); await writeFile(join(f.root, 'result', 'desktop-smoke-result.json'), bytes);
  await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  assert.deepEqual(await readFile(join(f.root, 'result', 'desktop-smoke-result.json')), bytes);
});

test('the parent Job adapter refuses different actual package bytes before resetting state', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t, { inventoryIdentity: 'b'.repeat(64) });
  const bytes = await readFile(join(f.root, 'result', 'desktop-smoke-result.json'));
  await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  assert.deepEqual(await readFile(join(f.root, 'result', 'desktop-smoke-result.json')), bytes);
  await assert.rejects(preparationFiles.lstat(f.selected.phaseRoot), { code: 'ENOENT' });
});

test('the parent Job adapter cannot overwrite a hardlinked startup file', { timeout: 60_000 }, async t => {
  const f = await smokeJobParent(t), path = join(f.root, 'result', 'desktop-smoke-result.json');
  const bytes = await readFile(path);
  await preparationFiles.link(path, `${path}.retained`);
  await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  assert.deepEqual(await readFile(path), bytes); assert.deepEqual(await readFile(`${path}.retained`), bytes);
});

test('the parent Job adapter snapshots metadata and waits for active work on cancellation', { timeout: 60_000 }, async t => {
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { finish = resolve; });
  const f = await smokeJobParent(t, { async enter() { enter(); await held; } });
  const controller = new AbortController(), first = new Error('SYNTHETIC_PARENT_CANCEL_FIRST');
  let settled = false;
  const task = f.run({ signal: controller.signal }).then(value => ({ value }), error => ({ error }))
    .then(value => { settled = true; return value; });
  await entered; f.input.phase = 'changed'; f.env.EKY_DESKTOP_SMOKE_TOKEN = 'b'.repeat(32); controller.abort(first);
  await nextTurn();
  try { assert.equal(settled, false); assert.equal(f.state.request.scenario, f.selected.binding.scenario); }
  finally { finish(); await task; }
  assert.equal((await task).error.cause, first);
});

test('the parent Job adapter retains an actual direct-spawn error before its safe result and reporting errors', { timeout: 60_000 }, async t => {
  const first = new Error('SYNTHETIC_PARENT_SPAWN_FIRST', { cause: new Error('SYNTHETIC_PARENT_SPAWN_CAUSE') });
  const f = await smokeJobParent(t, { actualBoundedProcess: true, spawn() { throw first; } });
  f.sink.flush = async () => { throw new Error('SYNTHETIC_PARENT_REPORT_SECOND'); };
  await assert.rejects(f.run(), error => error.cause === first);
  assert.equal(f.records[0].error, first); assert.equal(f.records[0].phase, 'packagedJobOriginal');
});

test('the parent Job adapter keeps its earlier deadline ahead of a later signal error', { timeout: 60_000 }, async t => {
  const later = new Error('SYNTHETIC_PARENT_KILL_SECOND');
  const child = new EventEmitter(); child.pid = 1234;
  const f = await smokeJobParent(t, { spawn: () => child, processResult: { status: 'failed', resultCode: 'timedOut' },
    async enter(options) {
      options.observe?.('deadline', 'failed');
      options.spawnProcess('synthetic-dotnet', [], {}).emit('error', later);
    } });
  await assert.rejects(f.run(), error => error.cause?.message === 'PACKAGED_SMOKE_JOB_DEADLINE_EXCEEDED');
  assert.equal(f.records.some(record => record.error === later), true);
});

test('the parent Job adapter refuses a changed root before it can create request or startup bytes', { timeout: 60_000 }, async t => {
  let f;
  const displaced = () => `${f.root}.parent-displaced`;
  f = await smokeJobParent(t, { async inventory() {
    await preparationFiles.rename(f.root, displaced());
    await mkdir(join(f.root, 'result'), { recursive: true });
  } });
  try {
    await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
    await assert.rejects(readFile(join(f.root, 'result', 'desktop-smoke-result.json')), { code: 'ENOENT' });
  } finally { await rm(f.root, { recursive: true }); await preparationFiles.rename(displaced(), f.root); }
});

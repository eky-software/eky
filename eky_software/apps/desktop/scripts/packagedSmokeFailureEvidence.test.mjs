import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { observeSmokeOutput } from './packagedSmokeFailureEvidence.mjs';

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
  assert.match(source, /throw error;\s*\} finally \{\s*if \(smokeSucceeded\) await rm/u);
  assert.match(source, /const smokeTimeoutMilliseconds = 120_000;/u);
});

let fixtureId = 0;

// Execute the actual driver with synthetic children, in-memory files and its
// unchanged deadline on Node's test clock. No Electron, MSI or profile is opened.
function startSmokeDriver(t, readResult = async () => ({ stage: 'startup', status: 'started' })) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new URL('./run-packaged-smoke.mjs', import.meta.url);
  const key = `__ekySmokeEvidenceFixture${++fixtureId}`;
  target.searchParams.set('fixture', key);
  const children = [];
  const waiting = [];
  const writes = [];
  const removed = [];
  const mocks = {
    'node:child_process': {
      spawn: () => {
        const child = new EventEmitter();
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
      writePackagedSmokeResult: async () => {},
    },
    './read-desktop-electron-version.mjs': { readDesktopElectronVersion: async () => 'synthetic-version' },
    './packaged-release-candidate.mjs': { preparePackagedReleaseCandidateSmoke: async () => {} },
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
  const outcome = import(target.href).then(() => ({ status: 'passed' }), error => ({ status: 'failed', error }));
  return { outcome, writes, removed,
    nextChild: () => children.length ? Promise.resolve(children.shift()) : new Promise(accept => waiting.push(accept)) };
}

function closeChild(child, code) {
  child.stdout?.emit('end');
  child.stderr?.emit('end');
  child.emit('close', code);
}

test('driver snapshots exit -> last stderr -> close and retains the failed root', async t => {
  const fixture = startSmokeDriver(t, async () => ({ stage: 'startup', status: 'failed', code: 'FIRST_ERROR' }));
  const child = await fixture.nextChild();
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

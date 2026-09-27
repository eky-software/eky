import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { bundleRequire, createElectronHarness, deferred, readVerifiedBundle, turn }
  from './playwrightElectronBundleHarness.mjs';
import { CLEANUP_UNVERIFIED_MARKER as marker, isExpectedElectronLaunchFailure }
  from './fixtures/electronLaunchFailure.cjs';

const settings = { concurrency: false, timeout: 5000 };
const syntheticPid = 424242;
const executable = 'C:\\eky-synthetic\\Bridge Folder\\bridge.exe';
const flags = ['--inspect=0', '--remote-debugging-port=0'];
const cleanupDirectory = 'C:\\eky-synthetic-never-created';
const markerCount = (metadata) => metadata.log.filter((line) => line === marker).length;

function observe(promise) {
  const observation = { state: 'pending' };
  observation.done = promise.then(
    (value) => { observation.state = 'fulfilled'; return { value }; },
    (error) => { observation.state = 'rejected'; return { error }; },
  );
  return observation;
}

async function assertPending(...observations) {
  await turn();
  for (const observation of observations) assert.equal(observation.state, 'pending');
}

async function captureLaunch(t, { platform = 'win32', client = true, effects = {}, options = {} } = {}) {
  const boundary = new Error('synthetic launch boundary');
  const h = createElectronHarness(t, { launch: () => Promise.reject(boundary) }, { platform, client, effects });
  if (client) h.api.installTransports();
  Object.assign(h.options, options);
  const before = structuredClone(h.options);
  const { error } = await h.run();
  if (client) assert.match(error.message, /synthetic launch boundary/);
  else assert.equal(error, boundary);
  assert.deepEqual(h.options, before);
  assert.deepEqual(h.calls, ['launch']);
  assert.equal(h.launches.length, 1);
  return { h, launch: h.launches[0] };
}

test('public Electron.launch declares an optional boolean, not an untyped or literal-only opt-in', settings, () => {
  readVerifiedBundle();
  const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
  const ts = rootRequire('typescript');
  const file = bundleRequire.resolve('../types/types.d.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  const electron = source.statements.find((node) => ts.isInterfaceDeclaration(node) && node.name.text === 'Electron');
  assert.ok(electron);
  const launch = electron.members.find((node) => ts.isMethodSignature(node) && node.name.getText(source) === 'launch');
  assert.ok(launch);
  const options = launch.parameters[0].type;
  assert.ok(ts.isTypeLiteralNode(options));
  const option = options.members.find((node) => node.name?.getText(source) === 'windowsProcessOnly');
  assert.ok(option, 'public type must expose the option');
  assert.ok(option.questionToken);
  assert.equal(option.type.kind, ts.SyntaxKind.BooleanKeyword);
});

test('public client and real protocol deliver opt-in to direct Windows launch without changing argv', settings, async (t) => {
  const args = ['', 'two words', 'a"b', 'a&b|c', '%PATH%', 'C:\\trailing\\'];
  const { launch } = await captureLaunch(t, { options: {
    windowsProcessOnly: true, executablePath: executable, args, cwd: 'C:\\eky-synthetic',
  } });
  assert.equal(launch.windowsProcessOnly, true);
  assert.equal(launch.command, executable);
  assert.equal(launch.shell, false);
  assert.deepEqual(launch.args, [...flags, ...args]);
  assert.equal(launch.cwd, 'C:\\eky-synthetic');
  assert.equal(launch.stdio, 'pipe');
});

for (const value of ['true', 1, null]) {
  test(`public protocol rejects nonboolean ${JSON.stringify(value)} before temp or launch`, settings, async (t) => {
    const h = createElectronHarness(t, {}, { client: true });
    h.api.installTransports();
    h.options.windowsProcessOnly = value;
    delete h.options.artifactsDir;
    const { error } = await h.run();
    assert.match(error.message, /windowsProcessOnly/);
    assert.match(error.message, /boolean/i);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.launches, []);
    assert.equal(h.interfaces.length, 0);
    // The existing fail-closed filesystem boundary also rejects any attempted mkdtemp.
  });
}

for (const scenario of [
  { name: 'omitted executable', executablePath: undefined },
  { name: 'empty executable', executablePath: '' },
  { name: 'relative executable', executablePath: 'bridge.exe' },
  { name: 'drive-relative executable', executablePath: 'C:bridge.exe' },
  { name: 'shell script', executablePath: 'C:\\eky-synthetic\\bridge.cmd' },
  { name: 'quoted executable', executablePath: '"C:\\eky-synthetic\\bridge.exe"' },
  { name: 'Linux', platform: 'linux', executablePath: '/tmp/eky-synthetic/bridge.exe' },
  { name: 'macOS', platform: 'darwin', executablePath: '/tmp/eky-synthetic/bridge.exe' },
]) {
  test(`server rejects opt-in ${scenario.name} before temp or launch`, settings, async (t) => {
    const h = createElectronHarness(t, {}, { client: true, platform: scenario.platform ?? 'win32' });
    h.api.installTransports();
    Object.assign(h.options, { windowsProcessOnly: true, executablePath: scenario.executablePath });
    delete h.options.artifactsDir;
    const { error } = await h.run();
    assert.match(error.message, /windowsProcessOnly.*explicit absolute Windows EXE/);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.launches, []);
    assert.equal(h.interfaces.length, 0);
  });
}

test('server also rejects a nonboolean when called without the client protocol', settings, async (t) => {
  const h = createElectronHarness(t);
  h.options.windowsProcessOnly = 'true';
  delete h.options.artifactsDir;
  assert.match((await h.run()).error.message, /windowsProcessOnly.*boolean/);
  assert.deepEqual(h.calls, []);
});

for (const scenario of [
  { name: 'non-Windows', platform: 'linux', shell: false },
  { name: 'Windows shell', platform: 'win32', shell: true },
]) {
  test(`internal launchProcess rejects opt-in ${scenario.name} before spawn`, settings, async (t) => {
    const { h, launch } = await captureLaunch(t, { platform: scenario.platform });
    await assert.rejects(h.api.originalLaunchProcess({ ...launch, windowsProcessOnly: true, shell: scenario.shell }),
      /windowsProcessOnly.*direct Windows process/);
    assert.deepEqual(h.api.localProcess.eventNames(), []);
  });
}

// Exercise the verified implementation, replacing only process and filesystem boundaries.
async function createProcessFixture(t, {
  platform = 'win32', options = { windowsProcessOnly: true, executablePath: executable },
  delivery = 'true', gracefulError, tempDirectories = [cleanupDirectory],
} = {}) {
  const child = new EventEmitter();
  Object.assign(child, { pid: syntheticPid, killed: false, exitCode: null, signalCode: null });
  child.stdio = [null, ...Array.from({ length: 4 }, () => new PassThrough())];
  [child.stdout, child.stderr] = child.stdio.slice(1, 3);
  t.after(() => { for (const stream of child.stdio.slice(1)) stream.destroy(); });
  const calls = { spawn: [], taskkill: [], pidKill: [], childKill: [], removals: [], exits: [], processExit: [], graceful: 0 };
  const cleanup = deferred();
  const graceful = deferred();
  const gracefulStarted = deferred();
  const killRequested = deferred();
  const failure = new Error('synthetic kill failure');
  const logs = [];
  const observations = [];
  let closed = false;
  child.kill = function (signal) {
    assert.equal(this, child, 'kill must use the original spawned object');
    calls.childKill.push(signal);
    killRequested.resolve();
    if (delivery === 'throw') throw failure;
    if (delivery === 'error') child.emit('error', failure);
    if (delivery !== 'true') return false;
    child.killed = true;
    return true;
  };
  const { h, launch } = await captureLaunch(t, { platform, options, effects: {
    spawn: (...args) => { calls.spawn.push(args); return child; },
    spawnSync: (...args) => {
      calls.taskkill.push(args);
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    },
    rm: (...args) => { calls.removals.push(args); return cleanup.promise; },
  } });
  t.mock.method(h.api.localProcess, 'kill', (...args) => { calls.pidKill.push(args); return true; });
  t.mock.method(h.api.localProcess, 'exit', (code) => { calls.processExit.push(code); });
  function close(code = 0, signal = null) {
    if (closed) return;
    closed = true;
    child.exitCode = code;
    child.signalCode = signal;
    for (const stream of child.stdio.slice(1)) stream.end();
    child.emit('close', code, signal);
  }
  t.after(async () => {
    graceful.resolve();
    close();
    cleanup.resolve();
    await turn();
    for (const observation of observations)
      assert.notEqual(observation.state, 'pending', 'cleanup must not leave a pending close waiter');
    if (launch.windowsProcessOnly) {
      assert.deepEqual(calls.taskkill, [], 'no late taskkill fallback');
      assert.deepEqual(calls.pidKill, [], 'no late PID fallback');
      assert.equal(calls.spawn.length, 1);
    }
    assert.deepEqual(h.api.localProcess.eventNames(), [], 'no retained process handlers');
  });
  const launched = await h.api.originalLaunchProcess({ ...launch, tempDirectories,
    log: (line) => logs.push(line),
    onExit: (...args) => calls.exits.push(args),
    attemptToGracefullyClose: () => {
      calls.graceful++;
      gracefulStarted.resolve();
      return gracefulError ? Promise.reject(gracefulError) : graceful.promise;
    },
  });
  assert.equal(launched.launchedProcess, child);
  assert.equal(calls.spawn.length, 1);
  assert.equal(calls.spawn[0][2].detached, platform !== 'win32');
  assert.equal(calls.spawn[0][2].shell, launch.shell);
  assert.deepEqual(calls.spawn[0][1], launch.args);
  assert.deepEqual(calls.spawn[0][2].stdio, ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']);
  return {
    h, child, calls, cleanup, graceful, logs, launch, launched, close,
    gracefulStarted: gracefulStarted.promise, killRequested: killRequested.promise,
    watch(promise) { const result = observe(promise); observations.push(result); return result; },
    exit(code, signal) { child.exitCode = code; child.signalCode = signal; child.emit('exit', code, signal); },
    assertNoFallback() {
      assert.deepEqual(calls.taskkill, []);
      assert.deepEqual(calls.pidKill, []);
      assert.equal(calls.spawn.length, 1, 'no replacement process');
    },
    assertNoClose() {
      assert.equal(closed, false);
      assert.deepEqual(calls.exits, []);
      assert.deepEqual(calls.removals, []);
      assert.equal(logs.some((line) => line.includes('<process did exit:')), false);
    },
  };
}

async function closeAndClean(f, observations, code = 0, signal = null) {
  f.close(code, signal);
  await assertPending(...observations);
  assert.deepEqual(f.calls.exits, [[code, signal]]);
  assert.deepEqual(f.calls.removals, [[cleanupDirectory, { recursive: true, force: true, maxRetries: 10 }]]);
  f.cleanup.resolve();
  for (const observation of observations) assert.equal((await observation.done).error, undefined);
  assert.deepEqual(f.h.api.localProcess.eventNames(), []);
}

for (const state of ['live', 'exitCode', 'signalCode', 'closed']) {
  test(`process-only kill with ${state} child never uses PID and awaits close plus cleanup`, settings, async (t) => {
    const f = await createProcessFixture(t, { delivery: state === 'live' ? 'true' : 'false' });
    const code = state === 'signalCode' ? null : 29;
    const signal = state === 'signalCode' ? 'SIGTERM' : null;
    if (state === 'exitCode' || state === 'signalCode') f.exit(code, signal);
    if (state === 'closed') f.close(code, signal);
    const stopped = f.watch(f.launched.kill());
    await assertPending(stopped);
    f.assertNoFallback();
    assert.deepEqual(f.calls.childKill, state === 'closed' ? [] : ['SIGKILL']);
    if (state !== 'closed') f.assertNoClose();
    if (state === 'live') {
      assert.equal(f.child.killed, true, 'delivery is not a close receipt');
      f.exit(code, signal);
      await assertPending(stopped);
      f.assertNoClose();
    }
    await closeAndClean(f, [stopped], code, signal);
    const again = f.watch(f.launched.kill());
    assert.equal((await again.done).error, undefined);
    assert.deepEqual(f.calls.childKill, state === 'closed' ? [] : ['SIGKILL']);
    assert.equal(f.calls.exits.length, 1);
    assert.equal(f.calls.removals.length, 1);
    f.assertNoFallback();
  });
}

for (const delivery of ['false', 'throw', 'error']) {
  test(`failed handle kill (${delivery}) cannot fall back or manufacture completion`, settings, async (t) => {
    const f = await createProcessFixture(t, { delivery });
    const stopped = f.watch(f.launched.kill());
    await assertPending(stopped);
    assert.deepEqual(f.calls.childKill, ['SIGKILL']);
    assert.equal(f.child.killed, false);
    if (delivery === 'throw') assert.ok(f.logs.some((line) => line.includes('synthetic kill failure')));
    else assert.ok(f.logs.includes('windowsProcessOnlyKillNotDelivered'));
    f.assertNoFallback();
    f.assertNoClose();
    f.exit(29, null);
    await assertPending(stopped);
    f.assertNoClose();
    await closeAndClean(f, [stopped], 29);
    f.assertNoFallback();
  });
}

test('successful graceful request does not force kill or replace close and cleanup', settings, async (t) => {
  const f = await createProcessFixture(t);
  const stopped = f.watch(f.launched.gracefullyClose());
  await f.gracefulStarted;
  f.graceful.resolve();
  await assertPending(stopped);
  assert.equal(f.calls.graceful, 1);
  assert.deepEqual(f.calls.childKill, []);
  f.assertNoClose();
  f.assertNoFallback();
  await closeAndClean(f, [stopped]);
  assert.deepEqual(f.calls.childKill, []);
});

test('graceful rejection requests handle kill and still waits for actual close and cleanup', settings, async (t) => {
  const f = await createProcessFixture(t, { gracefulError: new Error('synthetic graceful rejection') });
  const stopped = f.watch(f.launched.gracefullyClose());
  await f.killRequested;
  assert.equal(f.calls.graceful, 1);
  assert.deepEqual(f.calls.childKill, ['SIGKILL']);
  await assertPending(stopped);
  f.assertNoClose();
  f.assertNoFallback();
  await closeAndClean(f, [stopped]);
});

test('repeated graceful close escalates only the same child and both callers await cleanup', settings, async (t) => {
  const f = await createProcessFixture(t);
  const first = f.watch(f.launched.gracefullyClose());
  await f.gracefulStarted;
  const second = f.watch(f.launched.gracefullyClose());
  await f.killRequested;
  f.graceful.resolve();
  await assertPending(first, second);
  assert.equal(f.calls.graceful, 1);
  assert.deepEqual(f.calls.childKill, ['SIGKILL']);
  f.assertNoFallback();
  f.assertNoClose();
  await closeAndClean(f, [first, second]);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`caller ${signal} uses graceful failure then handle kill without early completion`, settings, async (t) => {
    const f = await createProcessFixture(t, { gracefulError: new Error('synthetic graceful rejection') });
    assert.equal(f.h.api.localProcess.emit(signal), true);
    await f.killRequested;
    const waiting = f.watch(f.launched.gracefullyClose());
    await assertPending(waiting);
    assert.equal(f.calls.graceful, 1);
    assert.deepEqual(f.calls.childKill, ['SIGKILL']);
    assert.deepEqual(f.calls.processExit, []);
    f.assertNoFallback();
    f.assertNoClose();
    await closeAndClean(f, [waiting]);
    await turn();
    assert.deepEqual(f.calls.processExit, signal === 'SIGINT' ? [130] : []);
  });
}

test('second SIGINT force branch does not turn process exit into a child-close receipt', settings, async (t) => {
  // Upstream synchronous exit cleanup has no directories in this inert branch test.
  const f = await createProcessFixture(t, { tempDirectories: [] });
  f.h.api.localProcess.emit('SIGINT');
  await f.gracefulStarted;
  f.h.api.localProcess.emit('SIGINT');
  assert.deepEqual(f.calls.childKill, ['SIGKILL']);
  assert.deepEqual(f.calls.processExit, [130], 'preserve upstream second-interrupt exit behavior');
  const stopped = f.watch(f.launched.kill());
  f.graceful.resolve();
  await assertPending(stopped);
  f.assertNoFallback();
  f.assertNoClose();
  f.close();
  assert.equal((await stopped.done).error, undefined);
  await turn();
  assert.deepEqual(f.calls.exits, [[0, null]]);
  assert.deepEqual(f.calls.processExit, [130, 130]);
});

test('caller exit force branch uses the handle even after child exit, with no PID fallback', settings, async (t) => {
  const f = await createProcessFixture(t, { tempDirectories: [], delivery: 'false' });
  f.exit(29, null);
  assert.equal(f.h.api.localProcess.emit('exit', 0), true);
  assert.deepEqual(f.calls.childKill, ['SIGKILL']);
  f.assertNoFallback();
  f.assertNoClose();
  const stopped = f.watch(f.launched.kill());
  await assertPending(stopped);
  assert.deepEqual(f.calls.childKill, ['SIGKILL', 'SIGKILL']);
  f.assertNoFallback();
  f.close(29);
  assert.equal((await stopped.done).error, undefined);
  assert.deepEqual(f.calls.exits, [[29, null]]);
  assert.deepEqual(f.calls.processExit, []);
});

for (const scenario of [
  { name: 'default Windows direct EXE', platform: 'win32', options: { executablePath: executable }, shell: false },
  { name: 'Windows shell with false', platform: 'win32', options: { windowsProcessOnly: false, executablePath: 'bridge.exe' }, shell: true },
  { name: 'default Linux', platform: 'linux', options: {}, shell: false },
  { name: 'macOS with false', platform: 'darwin', options: { windowsProcessOnly: false }, shell: false },
]) {
  test(`${scenario.name} retains existing process-tree kill behavior`, settings, async (t) => {
    const f = await createProcessFixture(t, scenario);
    assert.notEqual(f.launch.windowsProcessOnly, true);
    assert.equal(f.launch.shell, scenario.shell);
    const stopped = f.watch(f.launched.kill());
    await assertPending(stopped);
    assert.deepEqual(f.calls.childKill, []);
    if (scenario.platform === 'win32') {
      assert.deepEqual(f.calls.taskkill, [[`taskkill /pid ${syntheticPid} /T /F`, { shell: true }]]);
      assert.deepEqual(f.calls.pidKill, []);
    } else {
      assert.deepEqual(f.calls.taskkill, []);
      assert.deepEqual(f.calls.pidKill, [[-syntheticPid, 'SIGKILL']]);
    }
    f.exit(0, null);
    await assertPending(stopped);
    f.assertNoClose();
    await closeAndClean(f, [stopped]);
  });
}

for (const cleanupMode of ['reject', 'abort']) {
  test(`opt-in retains original launch error and cleanup uncertainty (${cleanupMode})`, settings, async (t) => {
    const primary = new Error('original node connection failure');
    const cleanup = deferred();
    const h = createElectronHarness(t, {
      nodeConnect: () => Promise.reject(primary),
      kill: () => cleanup.promise,
    });
    h.options.windowsProcessOnly = true;
    const result = observe(h.run());
    await h.ready;
    h.endpoints();
    await h.reached('kill');
    await assertPending(result);
    if (cleanupMode === 'reject') cleanup.reject(new Error('secondary cleanup failure'));
    else await h.abort(new Error('later cleanup abort'));
    assert.equal((await result.done).value.error, primary);
    assert.equal(h.launches[0].windowsProcessOnly, true);
    assert.equal(markerCount(h.controller.metadata), 1);
    cleanup.resolve();
    h.event('exit');
    await turn();
    assert.equal(markerCount(h.controller.metadata), 1, 'late cleanup cannot erase uncertainty');
    assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
    h.assertReleased();
  });
}

test('opt-in public error chain owns early sibling rejections and rejects uncertain cleanup', settings, async (t) => {
  const cleanup = deferred();
  const h = createElectronHarness(t, { kill: () => cleanup.promise }, { client: true });
  h.api.installTransports();
  h.options.windowsProcessOnly = true;
  const result = observe(h.run());
  await h.ready;
  h.event('exit');
  await h.reached('kill');
  const metadata = h.metadata();
  await assertPending(result);
  cleanup.reject(new Error('secondary cleanup failure'));
  const { error } = (await result.done).value;
  assert.match(error.message, /Process failed to launch!/);
  assert.ok(error.message.includes(marker));
  assert.equal(markerCount(metadata), 1);
  assert.equal(h.launches[0].windowsProcessOnly, true);
  assert.equal(isExpectedElectronLaunchFailure(error, h.clientAPI.errors.TimeoutError), false);
  await turn();
  h.assertReleased();
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  deadlineMilliseconds, maximumReadBytes, maximumResultBytes,
  parseProbeContext, validatePrerequisiteResult,
} from './linuxPrerequisiteContract.mjs';
import { runLinuxPrerequisiteCli } from './probeLinuxPrerequisites.mjs';

const argv = ['--consumer=system-api', `--checkout-sha=${'a'.repeat(40)}`];
const environment = { EKY_E2E: '1', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const binding = parseProbeContext(argv, environment);
const ownFile = '/proc/self/cgroup';
const mountsFile = '/proc/self/mountinfo';
const target = '/synthetic/cgroup/job';
const mount = '10 1 0:20 / /synthetic/cgroup rw - cgroup2 cgroup rw\n';
const privateMarker = 'synthetic-private-path-pid-uid-version-env-error';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClock() {
  let elapsed = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => elapsed,
    setTimeout(callback, delay) {
      assert.equal(delay, deadlineMilliseconds);
      timers.set(++sequence, { callback, at: elapsed + delay });
      return sequence;
    },
    clearTimeout: id => timers.delete(id),
    elapse: delta => { elapsed += delta; },
    advance(delta) {
      elapsed += delta;
      for (const [id, timer] of timers) {
        if (timer.at <= elapsed) { timers.delete(id); timer.callback(); }
      }
    },
    pending: () => timers.size,
  };
}

function syntheticFilesystem({ step = async () => {}, chunkSize = maximumReadBytes } = {}) {
  const files = new Map([
    [ownFile, '0::/job\n'], [mountsFile, mount],
    [`${target}/cgroup.type`, 'domain\n'], [`${target}/cgroup.events`, 'populated 1\nfrozen 0\n'],
  ]);
  const present = new Set([target, `${target}/cgroup.procs`, `${target}/cgroup.kill`]);
  const calls = [];
  const readPaths = [...files.keys()];
  const visit = async (operation, path, detail) => {
    calls.push({ operation, path, detail });
    await step(operation, path, detail);
  };
  const fs = {
    async open(path, flags) {
      assert.ok(readPaths.includes(path), 'Only four allowlisted content sources may be opened');
      assert.equal(flags, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      assert.equal(flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND), 0);
      await visit('open', path);
      if (!files.has(path)) throw Object.assign(new Error(privateMarker), { code: 'ENOENT' });
      const content = Buffer.isBuffer(files.get(path)) ? files.get(path) : Buffer.from(files.get(path));
      let offset = 0;
      return {
        async stat() { await visit('stat', path); return { isFile: () => true }; },
        async read(buffer, start, length, position) {
          assert.equal(position, null);
          assert.ok(length <= maximumReadBytes);
          await visit('read', path, length);
          const size = Math.min(content.length - offset, length, chunkSize);
          content.copy(buffer, start, offset, offset + size);
          offset += size;
          assert.ok(offset <= maximumReadBytes);
          return { bytesRead: size };
        },
        async close() { await visit('close', path); },
      };
    },
    async lstat(path) {
      assert.ok([target, `${target}/cgroup.procs`, `${target}/cgroup.kill`].includes(path));
      await visit('lstat', path);
      if (!present.has(path)) throw Object.assign(new Error(privateMarker), { code: 'ENOENT' });
      return { isDirectory: () => path === target, isFile: () => path !== target, isSymbolicLink: () => false };
    },
    async access(path, flags) {
      assert.ok(present.has(path));
      assert.equal(flags, constants.W_OK | (path === target ? constants.X_OK : 0));
      await visit('access', path, flags);
    },
  };
  return { fs, files, present, calls };
}

function start(fixture, overrides = {}) {
  const lines = [];
  const exits = [];
  const time = fakeClock();
  const finished = runLinuxPrerequisiteCli({
    argv, environment, platform: 'linux', fs: fixture.fs, time,
    writeLine(line, done) { lines.push(line); done(); },
    exit: code => exits.push(code), ...overrides,
  });
  return { lines, exits, time, finished };
}

function result(run, expectedBinding = binding) {
  assert.equal(run.lines.length, 1);
  const line = run.lines[0];
  assert.equal(line.split('\n').length, 2);
  assert.ok(Buffer.byteLength(line) <= maximumResultBytes);
  assert.equal(line.includes(privateMarker), false);
  assert.equal(line.includes('/synthetic'), false);
  const value = JSON.parse(line);
  validatePrerequisiteResult(value, expectedBinding);
  assert.equal(value.ownershipProof, 'notAttempted');
  assert.equal(value.systemd, 'notAttempted');
  return value;
}

test('CLI projects metadata only and closes every read without opening procs or kill', async () => {
  const fixture = syntheticFilesystem({ chunkSize: 7 });
  const run = start(fixture);
  assert.equal(await run.finished, 0);
  const value = result(run);
  assert.equal(value.observation, 'complete');
  assert.equal(value.cgroupV2, 'mapped');
  assert.deepEqual(value.accessHints, { createChild: 'allowed', writeProcs: 'allowed', writeKill: 'allowed' });
  assert.deepEqual(fixture.calls.filter(call => call.operation === 'open').map(call => call.path), [...fixture.files.keys()]);
  assert.equal(fixture.calls.filter(call => call.operation === 'close').length, 4);
  assert.deepEqual(run.exits, [0]);
  assert.equal(run.time.pending(), 0);
});

test('invalid context, absent opt-in and non-Linux platform never touch the filesystem', async () => {
  let hostOperations = 0;
  const fs = new Proxy({}, { get() { hostOperations += 1; assert.fail('No host operation is allowed'); } });
  for (const overrides of [
    { argv: [] }, { argv: [argv[0], '--checkout-sha='] },
    { environment: {} }, { environment: { ...environment, EKY_E2E: undefined } },
    { environment: { ...environment, EKY_E2E: '0' } },
    { environment: { ...environment, GITHUB_ACTIONS: 'false' } },
    { environment: { ...environment, GITHUB_RUN_ATTEMPT: '0' } },
    { platform: 'win32' },
  ]) {
    const run = start({ fs }, overrides);
    assert.equal(await run.finished, 1);
    const context = overrides.platform ? binding : null;
    assert.equal(result(run, context).reason, overrides.platform ? 'notLinux' : 'invalidContext');
    assert.deepEqual(run.exits, [1]);
    assert.equal(hostOperations, 0);
  }
});

test('both CI consumers retain exact supplied checkout and attempt, not inherited head SHA', async () => {
  const args = ['--consumer=web-chromium', argv[1]];
  const env = { ...environment, GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'b'.repeat(40), SECRET: privateMarker };
  const run = start(syntheticFilesystem(), { argv: args, environment: env });
  assert.equal(await run.finished, 0);
  const value = result(run, parseProbeContext(args, env));
  assert.equal(value.checkoutSha, 'a'.repeat(40));
  assert.equal(value.runAttempt, '2');
});

test('valid absent v2 is complete negative evidence and performs no cgroup target operations', async () => {
  const fixture = syntheticFilesystem();
  fixture.files.set(ownFile, '1:cpu:/job\n');
  fixture.files.set(mountsFile, mount.replace('cgroup2', 'cgroup'));
  const run = start(fixture);
  assert.equal(await run.finished, 0);
  assert.equal(result(run).reason, 'v2Absent');
  assert.equal(fixture.calls.some(call => ['lstat', 'access'].includes(call.operation)), false);
});

test('ambiguous namespace mapping stops before any target metadata or access', async () => {
  const fixture = syntheticFilesystem();
  fixture.files.set(mountsFile, mount.replace(' / /', ' /host-root /'));
  const run = start(fixture);
  assert.equal(await run.finished, 1);
  assert.equal(result(run).reason, 'ambiguousMapping');
  assert.equal(fixture.calls.some(call => ['lstat', 'access'].includes(call.operation)), false);
});

test('threaded and read-only metadata never claims kill support or ownership', async () => {
  const fixture = syntheticFilesystem();
  fixture.files.set(mountsFile, mount.replace(' rw ', ' ro '));
  fixture.files.set(`${target}/cgroup.type`, 'threaded\n');
  const run = start(fixture);
  assert.equal(await run.finished, 0);
  const value = result(run);
  assert.equal(value.cgroupType, 'threaded');
  assert.equal(value.mountMode, 'ro');
  assert.deepEqual(value.accessHints, { createChild: 'denied', writeProcs: 'denied', writeKill: 'denied' });
});

test('absent optional capability metadata is a complete negative observation', async () => {
  const fixture = syntheticFilesystem();
  fixture.files.delete(`${target}/cgroup.type`);
  fixture.files.delete(`${target}/cgroup.events`);
  fixture.present.delete(`${target}/cgroup.kill`);
  fixture.present.delete(`${target}/cgroup.procs`);
  const run = start(fixture);
  assert.equal(await run.finished, 0);
  const value = result(run);
  for (const key of ['cgroupType', 'events', 'killAvailability']) assert.equal(value[key], 'absent');
  assert.equal(value.accessHints.writeKill, 'unknown');
  assert.equal(value.accessHints.writeProcs, 'unknown');
  assert.deepEqual(fixture.calls.filter(call => call.operation === 'access').map(call => call.path), [target]);
});

test('missing own proc views or the resolved target is incomplete, not capability absence', async () => {
  for (const missing of [ownFile, mountsFile, target]) {
    const fixture = syntheticFilesystem();
    fixture.files.delete(missing);
    fixture.present.delete(missing);
    const run = start(fixture);
    assert.equal(await run.finished, 1);
    assert.equal(result(run).reason, 'readFailed');
    assert.equal(fixture.calls.filter(call => call.operation === 'open' && call.path === missing).length <= 1, true);
  }
});

test('access denial is a hint while unclassified IO failures remain incomplete and redacted', async () => {
  for (const code of ['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOENT']) {
    const fixture = syntheticFilesystem({ step(operation) {
      if (operation === 'access') throw Object.assign(new Error(privateMarker), { code });
    } });
    const run = start(fixture);
    const denied = ['EACCES', 'EPERM', 'EROFS'].includes(code);
    assert.equal(await run.finished, denied ? 0 : 1);
    assert.equal(result(run).observation, denied ? 'complete' : 'incomplete');
    if (denied) assert.equal(result(run).accessHints.writeKill, 'denied');
  }
});

test('all read and metadata failure phases emit one closed line without retries or error contents', async () => {
  for (const phase of ['open', 'stat', 'read', 'close', 'lstat']) {
    let failures = 0;
    const fixture = syntheticFilesystem({ step(operation) {
      if (operation === phase) { failures += 1; throw new Error(privateMarker); }
    } });
    const run = start(fixture);
    assert.equal(await run.finished, 1);
    assert.equal(result(run).reason, 'readFailed');
    assert.equal(failures, 1);
    assert.deepEqual(run.exits, [1]);
  }
});

test('symlink, special file, malformed metadata and invalid UTF-8 are never complete', async () => {
  for (const configure of [
    fixture => { fixture.fs.lstat = async () => ({ isDirectory: () => true, isSymbolicLink: () => true }); },
    fixture => { fixture.files.set(`${target}/cgroup.type`, `${privateMarker}\n`); },
    fixture => { fixture.files.set(`${target}/cgroup.events`, 'populated 2\n'); },
    fixture => { fixture.files.set(ownFile, Buffer.from([0xff, 0xfe])); },
    fixture => {
      const original = fixture.fs.open;
      fixture.fs.open = async (...args) => ({ ...await original(...args), stat: async () => ({ isFile: () => false }) });
    },
  ]) {
    const fixture = syntheticFilesystem();
    configure(fixture);
    const run = start(fixture);
    assert.equal(await run.finished, 1);
    assert.equal(result(run).observation, 'incomplete');
  }
});

test('per-source byte budget is enforced on short reads and at saturation without an extra byte', async () => {
  for (const path of [ownFile, mountsFile, `${target}/cgroup.type`, `${target}/cgroup.events`]) {
    for (const size of [maximumReadBytes, maximumReadBytes + 1, maximumReadBytes * 2]) {
      const fixture = syntheticFilesystem({ chunkSize: 4096 });
      fixture.files.set(path, 'x'.repeat(size));
      const run = start(fixture);
      assert.equal(await run.finished, 1);
      assert.equal(result(run).reason, 'readLimitExceeded');
      assert.equal(fixture.calls.filter(call => call.operation === 'read' && call.path === path).length, maximumReadBytes / 4096);
      assert.equal(fixture.calls.filter(call => call.operation === 'close' && call.path === path).length, 1);
    }
  }
  const fixture = syntheticFilesystem();
  fixture.files.set(ownFile, `1:cpu:/${'a'.repeat(maximumReadBytes - 9)}\n`);
  fixture.files.set(mountsFile, mount.replace('cgroup2', 'cgroup'));
  const run = start(fixture);
  assert.equal(await run.finished, 0);
  assert.equal(result(run).reason, 'v2Absent');
});

test('first read failure survives a later close failure', async () => {
  const fixture = syntheticFilesystem({ step(operation) {
    if (operation === 'close') throw new Error(privateMarker);
  } });
  fixture.files.set(ownFile, 'x'.repeat(maximumReadBytes));
  const run = start(fixture);
  assert.equal(await run.finished, 1);
  assert.equal(result(run).reason, 'readLimitExceeded');
});

test('hard entrypoint deadline exits even with a pending FS operation at every phase', async () => {
  for (const phase of ['open', 'stat', 'read', 'close', 'lstat', 'access']) {
    const entered = deferred();
    const pending = deferred();
    let held = false;
    const fixture = syntheticFilesystem({ step(operation) {
      if (operation === phase && !held) {
        held = true;
        entered.resolve();
        return pending.promise;
      }
    } });
    const run = start(fixture);
    await entered.promise;
    run.time.advance(deadlineMilliseconds - 1);
    assert.equal(run.lines.length, 0);
    run.time.advance(1);
    assert.equal(await run.finished, 1);
    assert.equal(result(run).reason, 'deadlineExceeded');
    assert.deepEqual(run.exits, [1]);
    const opens = fixture.calls.filter(call => call.operation === 'open').length;
    pending.resolve();
    // The event-loop boundary drains the late promise/finally chain, not a timed sleep.
    await pending.promise;
    await nextTurn();
    assert.equal(fixture.calls.filter(call => call.operation === 'open').length, opens);
    assert.equal(run.lines.length, 1);
    assert.deepEqual(run.exits, [1]);
    if (phase === 'open') assert.equal(fixture.calls.filter(call => call.operation === 'close').length, 1);
    assert.equal(run.time.pending(), 0);
  }
});

test('late rejected FS work after deadline is handled without new output or a second exit', async () => {
  const entered = deferred();
  const pending = deferred();
  const fixture = syntheticFilesystem({ step(operation) {
    if (operation === 'open') { entered.resolve(); return pending.promise; }
  } });
  const run = start(fixture);
  await entered.promise;
  run.time.advance(deadlineMilliseconds);
  assert.equal(await run.finished, 1);
  pending.reject(new Error(privateMarker));
  await nextTurn();
  assert.equal(result(run).reason, 'deadlineExceeded');
  assert.deepEqual(run.exits, [1]);
  assert.equal(fixture.calls.length, 1);
});

test('deadline checks stop IO even before a delayed timer callback is dispatched', async () => {
  let time;
  const fixture = syntheticFilesystem({ step(operation) {
    if (operation === 'stat') time.elapse(deadlineMilliseconds);
  } });
  const run = start(fixture);
  time = run.time;
  assert.equal(await run.finished, 1);
  assert.equal(result(run).reason, 'deadlineExceeded');
  assert.equal(fixture.calls.some(call => call.operation === 'read'), false);
});

test('pending stdout cannot extend deadline or produce a duplicate fallback line', async () => {
  const emitted = deferred();
  const lines = [];
  let callback;
  const run = start(syntheticFilesystem(), { writeLine(line, done) {
    lines.push(line); callback = done; emitted.resolve();
  } });
  await emitted.promise;
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).observation, 'complete');
  validatePrerequisiteResult(JSON.parse(lines[0]), binding);
  assert.equal(run.exits.length, 0);
  run.time.advance(deadlineMilliseconds);
  assert.equal(await run.finished, 1);
  callback();
  await nextTurn();
  assert.equal(lines.length, 1);
  assert.deepEqual(run.exits, [1]);
});

test('late stdout acknowledgement cannot beat a delayed deadline callback to a successful exit', async () => {
  const emitted = deferred();
  const lines = [];
  let callback;
  const run = start(syntheticFilesystem(), { writeLine(line, done) {
    lines.push(line); callback = done; emitted.resolve();
  } });
  await emitted.promise;
  run.time.elapse(deadlineMilliseconds);
  callback();
  assert.equal(await run.finished, 1);
  run.time.advance(1);
  await nextTurn();
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).observation, 'complete');
  assert.deepEqual(run.exits, [1]);
});

test('throwing or failing output sinks exit once, without raw stderr or a second output', async () => {
  for (const fail of [done => done(new Error(privateMarker)), () => { throw new Error(privateMarker); }]) {
    let writes = 0;
    const run = start(syntheticFilesystem(), { writeLine(_line, done) { writes += 1; fail(done); } });
    assert.equal(await run.finished, 1);
    assert.equal(writes, 1);
    assert.deepEqual(run.exits, [1]);
  }
});

test('actual CLI guard smoke emits exactly one closed line and exit 1 without E2E approval', () => {
  const unapprovedEnvironment = { ...environment };
  delete unapprovedEnvironment.EKY_E2E;
  let outcome;
  try {
    execFileSync(process.execPath, [
      fileURLToPath(new URL('./probeLinuxPrerequisites.mjs', import.meta.url)), ...argv,
    ], {
      env: unapprovedEnvironment, encoding: 'utf8', timeout: deadlineMilliseconds,
      maxBuffer: maximumResultBytes, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    outcome = { status: error.status, signal: error.signal, stdout: error.stdout, stderr: error.stderr };
  }
  assert.ok(outcome, 'The real entrypoint must reject a missing E2E approval');
  assert.equal(outcome.status, 1);
  assert.equal(outcome.signal, null);
  assert.equal(outcome.stderr, '');
  const value = result({ lines: [outcome.stdout] }, null);
  assert.equal(value.reason, 'invalidContext');
  assert.equal(value.observation, 'incomplete');
});

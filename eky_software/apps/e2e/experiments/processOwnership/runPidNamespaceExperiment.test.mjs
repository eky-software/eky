import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { actorGuard, runActor } from './pidNamespaceActor.mjs';
import { runNamespaceInit } from './pidNamespaceInit.mjs';
import {
  actorArguments, budgets, childEnvironment, descriptors, encodeMessage,
  expectedEofExit, failureExit, message, serializeResult,
} from './pidNamespaceContract.mjs';
import { emergencyStop, runNamespaceExperiment, runPidNamespaceCli, watchChild } from './runPidNamespaceExperiment.mjs';

const binding = { consumer: 'system-api', checkoutSha: 'c'.repeat(40), runId: '123', runAttempt: '1' };
const environment = { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const generation = 'a'.repeat(32);
const config = { generation, started: '1000000', uid: 1001, gid: 1002 };
const identity = { uid: 1001, euid: 1001, gid: 1002, egid: 1002 };
const status = 'Pid:\t1\nUid:\t1001\t1001\t1001\t1001\nGid:\t1002\t1002\t1002\t1002\n' +
  ['CapEff', 'CapPrm', 'CapInh', 'CapAmb'].map(name => `${name}:\t0000000000000000\n`).join('');

function clock() {
  let elapsed = 0;
  let id = 0;
  const timers = new Map();
  const time = {
    setTimeout(fn, delay) { timers.set(++id, { fn, at: elapsed + delay }); return id; },
    clearTimeout(key) { timers.delete(key); },
  };
  return { time, timers, now: () => 1000000n + BigInt(elapsed) * 1000000n,
    set(ms) { elapsed = ms; },
    advance(ms) {
      elapsed = ms;
      for (const [key, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed && timers.delete(key)) timer.fn();
      }
    },
  };
}

function stream(write = (_bytes, done) => done?.()) {
  const value = new EventEmitter();
  value.write = write;
  value.end = () => {};
  return value;
}

function child() {
  const value = new EventEmitter();
  value.stdin = stream(); value.stderr = stream();
  value.stdio = [value.stdin, null, value.stderr, stream(), stream()];
  value.kills = [];
  value.kill = signal => { value.kills.push(signal); value.finish(null, signal); return true; };
  value.finish = (code, signal = null) => {
    value.emit('exit', code, signal);
    for (const pipe of [value.stderr, value.stdio[3], value.stdio[4]]) {
      pipe.emit('end'); pipe.emit('close');
    }
    value.emit('close', code, signal);
  };
  return value;
}

function fixture(options = {}) {
  const c = clock();
  const calls = [];
  const removed = [];
  const actors = [];
  const controls = [];
  const root = '/synthetic-temp/eky-pid-namespace-ABC123';
  let nonce = 0;
  const fs = {
    access: async () => {
      if (options.toolPresent) return;
      throw Object.assign(Error('MISSING_SYNTHETIC_TOOL'), { code: options.toolReadError ?? 'ENOENT' });
    },
    realpath: async path => path,
    mkdtemp: async () => root,
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => Boolean(options.symlink) }),
    rmdir: async path => { removed.push(path); },
  };
  const spawnChild = (executable, args, spawnOptions) => {
    calls.push({ executable, args, options: spawnOptions });
    const owned = child();
    actors.push(owned);
    const token = args.find(arg => arg.startsWith('--generation=')).split('=')[1];
    if (executable !== 'unshare') {
      let challenges = 0;
      owned.stdin.write = (bytes, done) => {
        const value = JSON.parse(bytes);
        done?.();
        queueMicrotask(() => {
          if (value.type === 'STOP') return owned.finish(0);
          challenges++;
          if (options.sentinelAfterFailure && challenges === 2) return owned.finish(2);
          owned.stdio[3].emit('data', encodeMessage(message('ALIVE', token, value.challenge)));
        });
        return true;
      };
    } else {
      owned.stdin.write = (bytes, done) => {
        const value = JSON.parse(bytes);
        assert.equal(value.type, 'GO');
        controls.push(value.type);
        if (options.lateGoCallback) c.set(budgets.ready);
        done?.();
        queueMicrotask(() => {
          if (options.afterGoFailure) return owned.finish(1);
          if (options.missingWorkload) return;
          owned.stdio[3].emit('data', encodeMessage(message('WORKLOAD', token)));
        });
      };
      owned.stdin.end = () => {
        if (options.endThrows) throw Error('PRIVATE_END_FAILURE');
        if (options.stuckWrapper) return;
        queueMicrotask(() => owned.finish(options.wrapperExit ?? expectedEofExit));
      };
      queueMicrotask(() => {
        if (options.bootstrap) {
          if (options.bootstrapReply) owned.stdio[3].emit('data', Buffer.from('{'));
          if (options.bootstrap === 'missing') {
            owned.emit('error', { code: 'ENOENT' });
            return owned.finish(-2);
          }
          const raw = options.bootstrap === 'denied' ? 'unshare: unshare failed: Operation not permitted\n' : 'PRIVATE raw failure';
          owned.stderr.emit('data', Buffer.from(raw));
          return owned.finish(1);
        }
        if (!options.missingReady) owned.stdio[3].emit('data', Buffer.concat([
          encodeMessage(message('READY', token)), options.readyTail ? Buffer.from('{') : Buffer.alloc(0),
        ]));
      });
    }
    return owned;
  };
  return { ...c, calls, removed, actors, controls, root,
    operations: { fs, tempDirectory: () => '/synthetic-temp', spawnChild,
      identity: () => identity, execPath: '/synthetic-node', nonce: () => (++nonce).toString(16).padStart(32, '0'),
      now: c.now, time: c.time },
  };
}

async function experiment(f) {
  return runNamespaceExperiment({ ...f.operations, binding, platform: 'linux', started: config.started, facts: {} });
}

test('READY with a partial trailing frame rejects before any GO side effect', async () => {
  const f = fixture({ readyTail: true });
  const result = await experiment(f);
  assert.deepEqual(f.controls, []);
  assert.equal(result.observation, 'failed');
  assert.equal(result.workloadOutcome, 'notStarted');
  assert.equal(result.testRoot, 'retained');
  assert.deepEqual(f.removed, []);
});

test('pure injected experiment validates full ordering, isolated sentinel and exact arguments/fds', async () => {
  const f = fixture();
  const result = await experiment(f);
  assert.equal(result.observation, 'observed');
  assert.equal(result.cleanupOutcome, 'namespaceDestroyed');
  assert.equal(result.sentinelOutcome, 'preserved');
  assert.deepEqual(f.removed, [f.root]);
  assert.equal(f.calls.length, 2);
  const [sentinel, wrapper] = f.calls;
  assert.equal(wrapper.executable, 'unshare');
  assert.deepEqual(sentinel.options.stdio, descriptors.sentinel);
  assert.deepEqual(wrapper.options.stdio, descriptors.wrapper);
  for (const call of f.calls) {
    assert.equal(call.options.cwd, f.root);
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.options.env, childEnvironment());
  }
  assert.notEqual(sentinel.args.find(a => a.startsWith('--generation=')), wrapper.args.find(a => a.startsWith('--generation=')));
  assert.equal(f.timers.size, 0);
  assert.ok(f.actors.every(actor => actor.kills.length === 0));
  serializeResult(result, binding);
});

for (const [options, expected] of [
  [{ bootstrap: 'missing' }, 'prerequisiteUnavailable'],
  [{ bootstrap: 'denied' }, 'prerequisiteUnavailable'],
  [{ bootstrap: 'missing', toolPresent: true }, 'failed'],
  [{ bootstrap: 'missing', toolReadError: 'EACCES' }, 'failed'],
  [{ bootstrap: 'denied', bootstrapReply: true }, 'failed'],
  [{ bootstrap: 'unknown' }, 'failed'],
  [{ afterGoFailure: true }, 'failed'],
  [{ wrapperExit: 0 }, 'failed'],
  [{ sentinelAfterFailure: true }, 'failed'],
  [{ lateGoCallback: true }, 'failed'],
  [{ symlink: true }, 'failed'],
]) {
  test(`injected experiment fails closed and retains root: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    const result = await experiment(f);
    assert.equal(result.observation, expected);
    assert.equal(result.testRoot, 'retained');
    assert.deepEqual(f.removed, []);
    assert.equal(f.timers.size, 0);
    assert.doesNotMatch(serializeResult(result, binding), /PRIVATE|synthetic-temp|synthetic-node/u);
    if (options.afterGoFailure) assert.equal(result.workloadOutcome, 'failed');
  });
}

test('missing READY expires at five seconds without GO or resetting the shared start', async () => {
  const f = fixture({ missingReady: true });
  const running = experiment(f);
  await setImmediate();
  assert.equal(f.calls.length, 2);
  f.advance(budgets.ready);
  const result = await running;
  assert.equal(result.workloadOutcome, 'notStarted');
  assert.equal(result.reason, 'deadlineExceeded');
  assert.equal(result.testRoot, 'retained');
  assert.equal(f.timers.size, 0);
});

test('missing workload receipt expires at eight seconds, never becomes a missing prerequisite', async () => {
  const f = fixture({ missingWorkload: true });
  const running = experiment(f);
  await setImmediate();
  f.advance(budgets.workload);
  const result = await running;
  assert.equal(result.observation, 'failed');
  assert.equal(result.workloadOutcome, 'failed');
  assert.equal(result.testRoot, 'retained');
});

test('a late recognizable denial cannot erase an already expired readiness budget', async () => {
  const f = fixture({ missingReady: true });
  const running = experiment(f);
  await setImmediate();
  f.advance(budgets.ready);
  f.actors[1].stderr.emit('data', Buffer.from('unshare: unshare failed: Operation not permitted\n'));
  f.actors[1].finish(1);
  const result = await running;
  assert.equal(result.observation, 'failed');
  assert.equal(result.reason, 'deadlineExceeded');
});

test('wrapper emergency at fourteen seconds is never namespace destruction or restart permission', async () => {
  const f = fixture({ stuckWrapper: true });
  const running = experiment(f);
  await setImmediate();
  f.advance(budgets.wrapper);
  const result = await running;
  assert.deepEqual(f.actors[1].kills, ['SIGKILL']);
  assert.deepEqual(f.actors[0].kills, []);
  assert.equal(result.cleanupOutcome, 'unverified');
  assert.equal(result.observation, 'failed');
  assert.equal(result.testRoot, 'retained');
  assert.equal(f.calls.length, 2);
});

test('a synchronous control-close failure still waits for owned cleanup and separately stops the sentinel', async () => {
  const f = fixture({ endThrows: true });
  const running = experiment(f);
  await setImmediate();
  f.advance(budgets.wrapper);
  const result = await running;
  assert.deepEqual(f.actors[1].kills, ['SIGKILL']);
  assert.deepEqual(f.actors[0].kills, []);
  assert.equal(result.observation, 'failed');
  assert.equal(result.cleanupOutcome, 'unverified');
  assert.equal(result.sentinelOutcome, 'preserved');
  assert.equal(result.testRoot, 'retained');
});

test('emergency cleanup refuses exited/closed/spawn-failed handles and never uses PID lookup', () => {
  for (const changed of [{ exited: true }, { closed: true }, { spawnCode: 'ENOENT' }]) {
    const owned = { child: { kill() { assert.fail('NOT_OWNED_OPEN'); } }, ...changed };
    assert.equal(emergencyStop(owned), false);
  }
  const direct = child();
  const watch = watchChild(direct);
  assert.equal(emergencyStop(watch), true);
  assert.deepEqual(direct.kills, ['SIGKILL']);
});

test('CLI invalid context and non-Linux guards never touch filesystem or spawn', async () => {
  for (const supplied of [{ environment: {} }, { platform: 'win32' }]) {
    const output = [];
    let exit;
    const code = await runPidNamespaceCli({
      argv: ['--consumer=system-api', `--checkout-sha=${binding.checkoutSha}`],
      environment, platform: 'linux', ...supplied,
      fs: new Proxy({}, { get() { assert.fail('HOST_ACCESS'); } }),
      identity() { assert.fail('IDENTITY_ACCESS'); }, spawnChild() { assert.fail('SPAWN'); },
      writeLine(line, done) { output.push(JSON.parse(line)); done(); }, exit(value) { exit = value; },
    });
    assert.equal(code, 1); assert.equal(exit, 1);
    assert.equal(output.length, 1);
    assert.equal(output[0].observation, 'failed');
  }
});

test('CLI output failure or late callback preserves nonzero exit even after a complete JSON was queued', async () => {
  for (const mode of ['writeError', 'lateCallback', 'missingCallback']) {
    const f = fixture();
    const lines = [];
    let finishWrite;
    const running = runPidNamespaceCli({ ...f.operations,
      argv: ['--consumer=system-api', `--checkout-sha=${binding.checkoutSha}`], environment, platform: 'linux',
      writeLine(line, done) { lines.push(line); finishWrite = done; }, exit() {},
    });
    await setImmediate();
    assert.equal(lines.length, 1);
    if (mode === 'writeError') finishWrite(Error('PRIVATE'));
    if (mode === 'lateCallback') { f.set(budgets.report); finishWrite(); }
    if (mode === 'missingCallback') f.advance(budgets.report);
    assert.equal(await running, 1);
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0], /PRIVATE/u);
  }
});

test('report timeout during root removal never misreports retention or grants complete evidence', async () => {
  const f = fixture();
  let finishRemoval;
  f.operations.fs.rmdir = () => new Promise(resolve => { finishRemoval = resolve; });
  const results = [];
  const running = runPidNamespaceCli({ ...f.operations,
    argv: ['--consumer=system-api', `--checkout-sha=${binding.checkoutSha}`], environment, platform: 'linux',
    writeLine(line, done) { results.push(JSON.parse(line)); done(); }, exit() {},
  });
  await setImmediate();
  assert.equal(typeof finishRemoval, 'function');
  f.advance(budgets.report);
  assert.equal(await running, 1);
  assert.equal(results[0].testRoot, 'removalUnverified');
  assert.equal(results[0].evidenceOutcome, 'incomplete');
  assert.equal(results[0].cleanupOutcome, 'namespaceDestroyed');
  finishRemoval();
  await setImmediate();
  assert.equal(results.length, 1);
});

function initFixture(options = {}) {
  const c = clock();
  const exits = [];
  const writes = [];
  const launches = [];
  const output = stream((bytes, done) => { writes.push(JSON.parse(bytes)); done?.(); });
  const root = child();
  const runtime = Object.assign(new EventEmitter(), {
    platform: 'linux', env: environment, argv: ['node', 'init', ...actorArguments(config)], pid: 1,
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002,
    stdin: stream(), cwd: () => '/synthetic-temp', execPath: '/synthetic-node',
    exit: code => exits.push(code),
  }, options.runtime);
  const run = () => runNamespaceInit({ runtime, now: c.now, time: c.time,
    readStatus: () => options.status ?? status,
    socket: options => { assert.deepEqual(options, { fd: 3, readable: false, writable: true }); return output; },
    spawnChild: (...args) => { launches.push(args); return root; }, nonce: () => 'b'.repeat(32),
  });
  return { ...c, exits, writes, launches, output, root, runtime, run };
}

test('real init wiring challenges on exit without waiting for close, then accepts only expected EOF', () => {
  const f = initFixture();
  f.run();
  assert.equal(f.launches.length, 0);
  assert.equal(f.writes[0].type, 'READY');
  f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
  assert.deepEqual(f.launches[0][2].stdio, descriptors.root);
  assert.deepEqual(f.launches[0][2].env, childEnvironment());
  let challenge;
  f.root.stdio[4].write = bytes => { challenge = JSON.parse(bytes); };
  f.root.emit('message', message('HANDOFF', generation));
  assert.equal(challenge, undefined);
  f.root.emit('exit', 0, null);
  assert.equal(challenge.type, 'CHALLENGE');
  f.root.stdio[4].emit('data', encodeMessage(message('ALIVE', generation, challenge.challenge)));
  assert.equal(f.writes[1].type, 'WORKLOAD');
  f.runtime.stdin.emit('end');
  assert.deepEqual(f.exits, [expectedEofExit]);
  assert.equal(f.timers.size, 0);
});

test('init accepts exit before HANDOFF without waiting for close or challenging twice', () => {
  const f = initFixture(); f.run();
  f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
  const challenges = [];
  f.root.stdio[4].write = (bytes, done) => { challenges.push(JSON.parse(bytes)); done?.(); };
  f.root.emit('exit', 0, null);
  assert.deepEqual(f.exits, []);
  assert.deepEqual(challenges, []);
  f.set(budgets.workload - 1);
  f.root.emit('message', message('HANDOFF', generation));
  assert.equal(challenges.length, 1);
  assert.equal(challenges[0].type, 'CHALLENGE');
  assert.equal(f.root.listenerCount('close'), 0);
  const alive = encodeMessage(message('ALIVE', generation, challenges[0].challenge));
  f.root.stdio[4].emit('data', alive.subarray(0, 3));
  assert.deepEqual(f.writes.map(value => value.type), ['READY']);
  f.root.stdio[4].emit('data', alive.subarray(3));
  assert.deepEqual(f.writes.map(value => value.type), ['READY', 'WORKLOAD']);
  f.runtime.stdin.emit('end');
  assert.deepEqual(f.exits, [expectedEofExit]);
  assert.equal(challenges.length, 1);
  assert.equal(f.timers.size, 0);
});

test('init rejects same-chunk partial leaf tails before WORKLOAD and never accepts EOF afterward', () => {
  for (const extra of ['{', ' ', '\n', '\0', 'replay']) {
    const f = initFixture(); f.run();
    f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
    let challenge;
    f.root.stdio[4].write = bytes => { challenge = JSON.parse(bytes); };
    f.root.emit('message', message('HANDOFF', generation));
    f.root.emit('exit', 0, null);
    const alive = encodeMessage(message('ALIVE', generation, challenge.challenge));
    f.root.stdio[4].emit('data', Buffer.concat([alive, extra === 'replay' ? alive : Buffer.from(extra)]));
    f.runtime.stdin.emit('end');
    assert.deepEqual(f.exits, [failureExit]);
    assert.deepEqual(f.writes.map(value => value.type), ['READY']);
    assert.equal(f.timers.size, 0);
  }
});

test('init never challenges for missing, invalid, duplicate or late HANDOFF after root exit', () => {
  for (const mode of ['missing', 'invalid', 'duplicate', 'late', 'preChallengeBytes']) {
    const f = initFixture(); f.run();
    f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
    const challenges = [];
    f.root.stdio[4].write = bytes => { challenges.push(JSON.parse(bytes)); };
    f.root.emit('exit', 0, null);
    if (mode === 'preChallengeBytes') f.root.stdio[4].emit('data', Buffer.from('{'));
    if (mode === 'late') f.set(budgets.workload);
    if (mode !== 'missing') {
      f.root.emit('message', message('HANDOFF', mode === 'invalid' ? 'c'.repeat(32) : generation));
    }
    if (mode === 'duplicate') f.root.emit('message', message('HANDOFF', generation));
    f.runtime.stdin.emit('end');
    assert.deepEqual(f.exits, [failureExit]);
    assert.equal(challenges.length, mode === 'duplicate' ? 1 : 0);
    assert.deepEqual(f.writes.map(value => value.type), ['READY']);
  }
});

test('init rejects late leaf proof and post-proof bytes or channel failure even after reordered HANDOFF', () => {
  for (const mode of ['lateLeaf', 'partial', 'replay', 'error', 'eof', 'lateEof']) {
    const f = initFixture(); f.run();
    f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
    let challenge;
    f.root.stdio[4].write = bytes => { challenge = JSON.parse(bytes); };
    f.root.emit('exit', 0, null);
    f.set(budgets.workload - 1);
    f.root.emit('message', message('HANDOFF', generation));
    if (mode === 'lateLeaf') f.set(budgets.workload);
    const alive = encodeMessage(message('ALIVE', generation, challenge.challenge));
    f.root.stdio[4].emit('data', alive);
    if (mode === 'partial') f.root.stdio[4].emit('data', Buffer.from('{'));
    if (mode === 'replay') f.root.stdio[4].emit('data', alive);
    if (mode === 'error') f.root.stdio[4].emit('error', Error('SYNTHETIC_CHANNEL_FAILURE'));
    if (mode === 'eof') f.root.stdio[4].emit('end');
    if (mode === 'lateEof') f.set(budgets.init);
    f.runtime.stdin.emit('end');
    assert.deepEqual(f.exits, [failureExit]);
    assert.equal(f.timers.size, 0);
  }
});

test('real init wiring rejects any pre-exit leaf bytes and early EOF, replay and late control', () => {
  for (const attack of ['partialLeaf', 'leafEof', 'controlEof', 'replayGo', 'lateGo', 'expiry']) {
    const f = initFixture(); f.run();
    if (attack === 'lateGo') f.set(budgets.ready);
    f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
    if (attack === 'partialLeaf') f.root.stdio[4].emit('data', Buffer.from('{'));
    if (attack === 'leafEof') f.root.stdio[4].emit('end');
    if (attack === 'controlEof') f.runtime.stdin.emit('end');
    if (attack === 'replayGo') f.runtime.stdin.emit('data', encodeMessage(message('GO', generation)));
    if (attack === 'expiry') f.advance(budgets.init);
    assert.deepEqual(f.exits, [failureExit]);
    assert.ok(f.launches.length <= 1);
  }
});

test('init does not expose READY or launch for invalid PID, capabilities or environment', () => {
  for (const options of [{ runtime: { pid: 2 } }, { runtime: { env: {} } },
    { status: status.replace('CapEff:\t0000000000000000', 'CapEff:\t0000000000000001') }]) {
    const f = initFixture(options); f.run();
    assert.deepEqual(f.exits, [failureExit]);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.launches, []);
  }
});

test('actor entry guard rejects wrong platform/context/role and changed identities', () => {
  assert.deepEqual(actorGuard(actorArguments(config, 'leaf'), environment, 'linux', identity), { ...config, role: 'leaf' });
  for (const [env, platform, ids] of [[{}, 'linux', identity], [environment, 'win32', identity],
    [environment, 'linux', { ...identity, euid: 0 }]]) {
    assert.throws(() => actorGuard(actorArguments(config, 'leaf'), env, platform, ids));
  }
});

test('root hands only fd4 to detached leaf, closes its copy before HANDOFF and exits', () => {
  const c = clock(); const actions = []; const leaf = child();
  runActor({ ...config, role: 'root' }, {
    now: c.now, time: c.time,
    runtime: { execPath: '/synthetic-node', cwd: () => '/synthetic-temp',
      send(value, done) { actions.push(value.type); done(); },
      disconnect() { actions.push('disconnect'); }, exit(code) { actions.push(code); } },
    closeFd(fd) { actions.push(`close:${fd}`); },
    spawnChild(_program, args, options) {
      assert.deepEqual(options.stdio, descriptors.leaf);
      assert.equal(options.detached, true);
      assert.deepEqual(options.env, childEnvironment());
      assert.ok(args.includes('--role=leaf'));
      return leaf;
    },
  });
  leaf.emit('spawn');
  assert.deepEqual(actions, ['close:4', 'HANDOFF', 'disconnect', 0]);
  assert.equal(c.timers.size, 0);
});

test('leaf installs TERM resistance before fd4 reply; replay and expiry use failure exit', () => {
  for (const mode of ['replay', 'expiry']) {
    const c = clock(); const sent = []; const exits = [];
    const runtime = new EventEmitter(); runtime.exit = code => exits.push(code);
    const wire = stream((bytes, done) => {
      assert.equal(runtime.listenerCount('SIGTERM'), 1);
      sent.push(JSON.parse(bytes)); done?.();
    });
    runActor({ ...config, role: 'leaf' }, { runtime, now: c.now, time: c.time,
      socket: options => { assert.equal(options.fd, 4); return wire; } });
    const request = encodeMessage(message('CHALLENGE', generation, 'b'.repeat(32)));
    wire.emit('data', request);
    assert.equal(sent[0].type, 'ALIVE');
    if (mode === 'replay') wire.emit('data', request);
    else c.advance(budgets.leaf);
    assert.deepEqual(exits, [failureExit]);
  }
});

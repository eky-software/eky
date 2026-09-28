import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startLinuxConsumerSentinel } from './linuxConsumerSentinel.mjs';
import {
  actorArguments, budgets, childEnvironment, descriptors, encodeMessage, message, NamespaceFailure,
} from './pidNamespaceContract.mjs';

const identity = Object.freeze({ uid: 1001, gid: 1002 });
const root = '/synthetic-temp/eky-managed-ns-SENTINEL';
const generation = 'a'.repeat(32);
const unverified = { message: 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED' };

function fixture({ badFd = false, repeatNonce = false, outerMilliseconds } = {}) {
  let elapsed = 0;
  let timerId = 0;
  let token = 0;
  const timers = new Map();
  const scheduled = [];
  const time = {
    setTimeout(fn, delay) {
      const at = elapsed + delay;
      scheduled.push(at);
      timers.set(++timerId, { fn, at });
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  const replies = new EventEmitter();
  child.stdio = [child.stdin, null, null, badFd ? null : replies];
  Object.defineProperty(child, 'pid', { get() { assert.fail('No PID lookup is permitted'); } });
  const f = {
    child, replies, timers, scheduled, calls: [], writes: [], kills: [],
    set(ms) {
      assert.ok(ms >= elapsed);
      elapsed = ms;
    },
    advance(ms) {
      f.set(ms);
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed && timers.delete(id)) timer.fn();
      }
    },
    alive(value) { replies.emit('data', encodeMessage(message('ALIVE', generation, value.challenge))); },
    eof() { replies.emit('end'); replies.emit('close'); },
    exit(code = 0, signal = null) { child.emit('exit', code, signal); },
    close(code = 0, signal = null) { child.emit('close', code, signal); },
    finish(code = 0, signal = null) { f.exit(code, signal); f.eof(); f.close(code, signal); },
  };
  child.kill = signal => {
    f.kills.push(signal);
    if (f.onKill) return f.onKill(signal);
    f.finish(null, signal);
    return true;
  };
  child.stdin.write = (bytes, done) => {
    const value = JSON.parse(bytes);
    f.writes.push(value);
    if (f.onWrite) return f.onWrite(value, done);
    done();
    queueMicrotask(() => value.type === 'STOP' ? f.finish() : f.alive(value));
    return true;
  };
  const outerFailure = new NamespaceFailure('workloadFailed');
  const outerDeadline = outerMilliseconds === undefined ? undefined : {
    remaining(phase) { assert.equal(phase, 'wrapper'); return Math.max(0, outerMilliseconds - elapsed); },
    check(phase) {
      assert.equal(phase, 'wrapper');
      if (f.rejectOuter || elapsed >= outerMilliseconds) throw outerFailure;
    },
  };
  f.outerFailure = outerFailure;
  f.sentinel = startLinuxConsumerSentinel({ root, identity, outerDeadline }, {
    runtime: { execPath: '/synthetic-node' }, time,
    now: () => 1000000n + BigInt(elapsed) * 1000000n,
    nonce: () => token++ === 0 ? generation : (repeatNonce ? 1 : token).toString(16).padStart(32, '0'),
    spawnChild(executable, args, options) { f.calls.push({ executable, args, options }); return child; },
  });
  return f;
}

function observe(promise) {
  const result = { settled: false };
  result.done = promise.then(
    value => { result.settled = true; result.value = value; },
    error => { result.settled = true; result.error = error; },
  );
  return result;
}

test('launches only the retained sentinel and uses unique before/after challenges', async () => {
  const f = fixture();
  assert.ok(Object.isFrozen(f.sentinel));
  assert.deepEqual(Object.keys(f.sentinel), ['before', 'finish']);
  assert.deepEqual(f.calls, [{
    executable: '/synthetic-node',
    args: [fileURLToPath(new URL('./pidNamespaceActor.mjs', import.meta.url)),
      ...actorArguments({ ...identity, generation, started: '1000000' }, 'sentinel')],
    options: { cwd: root, env: childEnvironment(), shell: false, detached: false, stdio: [...descriptors.sentinel] },
  }]);
  assert.deepEqual(f.scheduled, [budgets.sentinel]);
  f.advance(5000);
  await f.sentinel.before();
  await assert.rejects(f.sentinel.before(), unverified);
  f.advance(budgets.sentinel - 1);
  const completion = f.sentinel.finish();
  assert.equal(f.sentinel.finish(), completion);
  await completion;
  assert.equal(f.sentinel.finish(), completion);
  await assert.rejects(f.sentinel.before(), unverified);
  assert.deepEqual(f.writes.map(value => value.type), ['CHALLENGE', 'CHALLENGE', 'STOP']);
  assert.ok(f.writes.every(value => value.generation === generation));
  assert.notEqual(f.writes[0].challenge, f.writes[1].challenge);
  assert.ok(f.scheduled.every(at => at === budgets.sentinel));
  assert.deepEqual(f.kills, []);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('exit zero and fd3 EOF remain pending until actual child close', async () => {
  const f = fixture();
  await f.sentinel.before();
  f.onWrite = (value, done) => { done(); if (value.type === 'CHALLENGE') f.alive(value); };
  const result = observe(f.sentinel.finish());
  await setImmediate();
  assert.equal(f.writes.at(-1).type, 'STOP');
  f.exit();
  f.eof();
  await setImmediate();
  assert.equal(result.settled, false);
  assert.ok([...f.timers.values()].some(timer => timer.at === budgets.sentinel));
  f.close();
  await result.done;
  assert.equal(result.error, undefined);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.kills, []);
});

for (const [name, complete] of [
  ['missing fd3 EOF', f => { f.exit(); f.close(); }],
  ['fd3 close without EOF', f => { f.exit(); f.replies.emit('close'); f.close(); }],
  ['missing exit event', f => { f.eof(); f.close(); }],
  ['nonzero exit', f => f.finish(42)],
  ['signal exit', f => f.finish(null, 'SIGTERM')],
  ['spawn error', f => { f.child.emit('error', { code: 'EIO' }); f.finish(); }],
  ['stdin error', f => { f.child.stdin.emit('error', Error('SYNTHETIC_INPUT_ERROR')); f.finish(); }],
]) {
  test(`normal completion refuses ${name}`, async () => {
    const f = fixture();
    await f.sentinel.before();
    f.onWrite = (value, done) => { done(); value.type === 'STOP' ? complete(f) : f.alive(value); };
    await assert.rejects(f.sentinel.finish());
    assert.deepEqual(f.kills, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

for (const [name, respond] of [
  ['wrong generation', (f, value) => f.replies.emit('data', encodeMessage(message('ALIVE', 'b'.repeat(32), value.challenge)))],
  ['replayed challenge', f => f.alive(f.writes[0])],
  ['duplicate reply', (f, value) => { f.alive(value); f.alive(value); }],
  ['partial trailing bytes', (f, value) => { f.alive(value); f.replies.emit('data', Buffer.from('{')); }],
  ['early EOF', (f, value) => { f.alive(value); f.eof(); }],
  ['premature exit', (f, value) => { f.alive(value); f.finish(); }],
]) {
  test(`after challenge rejects ${name}`, async () => {
    const f = fixture();
    await f.sentinel.before();
    f.onWrite = (value, done) => { done(); respond(f, value); };
    await assert.rejects(f.sentinel.finish());
    assert.deepEqual(f.writes.map(value => value.type), ['CHALLENGE', 'CHALLENGE']);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

test('a repeated generated token fails before sending another challenge', async () => {
  const f = fixture({ repeatNonce: true });
  await f.sentinel.before();
  await assert.rejects(f.sentinel.finish(), unverified);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.kills, ['SIGKILL']);
  assert.equal(f.timers.size, 0);
});

for (const phase of ['before', 'after', 'stop']) {
  test(`${phase} write callback cannot outlive the original sentinel deadline`, async () => {
    const f = fixture();
    if (phase !== 'before') await f.sentinel.before();
    f.advance(budgets.sentinel - 1000);
    let callback;
    f.onWrite = (value, done) => {
      if (phase === 'stop' && value.type !== 'STOP') { done(); f.alive(value); return true; }
      callback = done;
      if (value.type === 'CHALLENGE') f.alive(value);
      return false;
    };
    const result = observe(phase === 'before' ? f.sentinel.before() : f.sentinel.finish());
    await setImmediate();
    assert.equal(typeof callback, 'function');
    assert.equal(result.settled, false);
    f.advance(budgets.sentinel - 1);
    await setImmediate();
    assert.equal(result.settled, false);
    f.advance(budgets.sentinel);
    await result.done;
    assert.equal(result.error?.reason, 'deadlineExceeded');
    const firstError = result.error;
    callback();
    await setImmediate();
    assert.equal(result.error, firstError);
    await assert.rejects(f.sentinel.finish());
    assert.deepEqual(f.kills, ['SIGKILL']);
    assert.equal(f.calls.length, 1);
    assert.ok(f.scheduled.every(at => at === budgets.sentinel || at === budgets.report));
    assert.equal(f.timers.size, 0);
  });
}

for (const phase of ['before', 'after']) {
  test(`${phase} response cannot outlive the original sentinel deadline`, async () => {
    const f = fixture();
    if (phase === 'after') await f.sentinel.before();
    f.advance(budgets.sentinel - 1000);
    f.onWrite = (_value, done) => { done(); return true; };
    const result = observe(phase === 'before' ? f.sentinel.before() : f.sentinel.finish());
    await setImmediate();
    f.advance(budgets.sentinel - 1);
    await setImmediate();
    assert.equal(result.settled, false);
    f.advance(budgets.sentinel);
    await result.done;
    assert.ok(result.error instanceof NamespaceFailure);
    await assert.rejects(f.sentinel.finish());
    assert.ok(f.writes.every(value => value.type === 'CHALLENGE'));
    assert.deepEqual(f.kills, ['SIGKILL']);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

test('normal child close cannot hide a missing STOP write callback', async () => {
  const f = fixture();
  await f.sentinel.before();
  f.advance(budgets.sentinel - 1000);
  f.onWrite = (value, done) => {
    if (value.type === 'STOP') f.finish();
    else { done(); f.alive(value); }
    return true;
  };
  const result = observe(f.sentinel.finish());
  await setImmediate();
  assert.equal(result.settled, false);
  f.advance(budgets.sentinel);
  await result.done;
  assert.equal(result.error?.reason, 'deadlineExceeded');
  assert.deepEqual(f.kills, []);
  assert.equal(f.timers.size, 0);
});

test('exit without close times out and does not grant a fresh cleanup budget', async () => {
  const f = fixture();
  await f.sentinel.before();
  f.advance(10000);
  f.onWrite = (value, done) => { done(); value.type === 'STOP' ? f.exit() : f.alive(value); };
  const result = observe(f.sentinel.finish());
  await setImmediate();
  f.advance(budgets.sentinel);
  await setImmediate();
  assert.equal(result.settled, false);
  assert.deepEqual(f.kills, []);
  assert.deepEqual([...f.timers.values()].map(timer => timer.at), [budgets.report]);
  f.advance(budgets.report - 1);
  await setImmediate();
  assert.equal(result.settled, false);
  f.advance(budgets.report);
  await result.done;
  assert.equal(result.error?.reason, 'deadlineExceeded');
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('an unused sentinel still expires at its original lifetime without a restart', async () => {
  const f = fixture();
  f.advance(budgets.sentinel);
  assert.deepEqual(f.kills, ['SIGKILL']);
  await assert.rejects(f.sentinel.before(), { reason: 'deadlineExceeded' });
  await assert.rejects(f.sentinel.finish());
  assert.deepEqual(f.writes, []);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('finish without before fails but retains child cleanup ownership', async () => {
  const f = fixture();
  await assert.rejects(f.sentinel.finish(), unverified);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.kills, ['SIGKILL']);
  assert.equal(f.timers.size, 0);
});

for (const closes of [true, false]) {
  test(`bad startup fd retains cleanup until ${closes ? 'actual close' : 'the original report deadline'}`, async () => {
    const f = fixture({ badFd: true });
    f.onKill = () => true;
    await assert.rejects(f.sentinel.before(), unverified);
    f.advance(12000);
    const result = observe(f.sentinel.finish());
    await setImmediate();
    assert.equal(result.settled, false);
    assert.deepEqual(f.kills, ['SIGKILL']);
    f.exit(null, 'SIGKILL');
    if (closes) f.close(null, 'SIGKILL');
    else {
      f.advance(budgets.sentinel);
      await setImmediate();
      assert.deepEqual([...f.timers.values()].map(timer => timer.at), [budgets.report]);
      f.advance(budgets.report - 1);
      await setImmediate();
      assert.equal(result.settled, false);
      f.advance(budgets.report);
    }
    await result.done;
    assert.equal(result.error?.message, unverified.message);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

for (const cleanup of ['close', 'stuck', 'throws']) {
  test(`the first finish failure survives ${cleanup} cleanup and repeated finish`, async () => {
    const f = fixture();
    await f.sentinel.before();
    f.advance(9000);
    const firstError = new NamespaceFailure('channelFailed');
    f.onWrite = () => { throw firstError; };
    if (cleanup !== 'close') f.onKill = () => {
      if (cleanup === 'throws') throw Error('SYNTHETIC_KILL_ERROR');
      return false;
    };
    const completion = f.sentinel.finish();
    const result = observe(completion);
    await setImmediate();
    if (cleanup !== 'close') {
      assert.equal(result.settled, false);
      f.advance(budgets.sentinel);
      await setImmediate();
      f.advance(budgets.report);
    }
    await result.done;
    assert.equal(result.error, firstError);
    assert.equal(f.sentinel.finish(), completion);
    assert.ok(f.kills.every(signal => signal === 'SIGKILL'));
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

test('a before failure remains the first failure through finish cleanup', async () => {
  const f = fixture();
  const firstError = new NamespaceFailure('channelFailed');
  f.onWrite = () => { throw firstError; };
  await assert.rejects(f.sentinel.before(), error => error === firstError);
  await assert.rejects(f.sentinel.finish(), error => error === firstError);
  assert.deepEqual(f.kills, ['SIGKILL']);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('normal sentinel completion fits inside the existing outer wrapper deadline', async () => {
  const f = fixture({ outerMilliseconds: 5000 });
  assert.deepEqual(f.scheduled, [5000]);
  f.advance(3000);
  await f.sentinel.before();
  f.advance(4999);
  await f.sentinel.finish();
  assert.ok(f.scheduled.every(at => at === 5000));
  assert.deepEqual(f.kills, []);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

for (const phase of ['before', 'after', 'stop']) {
  test(`${phase} stuck write is clipped to the shorter case wrapper deadline`, async () => {
    const f = fixture({ outerMilliseconds: 5000 });
    if (phase !== 'before') await f.sentinel.before();
    f.advance(3000);
    f.onWrite = (value, done) => {
      if (phase === 'stop' && value.type !== 'STOP') done();
      if (value.type === 'CHALLENGE') f.alive(value);
      return false;
    };
    const result = observe(phase === 'before' ? f.sentinel.before() : f.sentinel.finish());
    await setImmediate();
    f.advance(4999);
    await setImmediate();
    assert.equal(result.settled, false);
    f.advance(5000);
    await result.done;
    assert.ok(result.error instanceof NamespaceFailure);
    await assert.rejects(f.sentinel.finish());
    assert.ok(f.scheduled.every(at => at === 5000));
    assert.deepEqual(f.kills, ['SIGKILL']);
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

for (const outerMilliseconds of [5000, 18000, 25000]) {
  test(`outer ${outerMilliseconds}ms deadline neither renews the sentinel nor extends cleanup`, async () => {
    const f = fixture({ outerMilliseconds });
    const lifeEnds = Math.min(budgets.sentinel, outerMilliseconds);
    const reportEnds = Math.min(budgets.report, outerMilliseconds);
    assert.deepEqual(f.scheduled, [lifeEnds]);
    await f.sentinel.before();
    f.advance(1000);
    const firstError = new NamespaceFailure('channelFailed');
    f.onWrite = () => { throw firstError; };
    f.onKill = () => false;
    const result = observe(f.sentinel.finish());
    await setImmediate();
    assert.ok([...f.timers.values()].some(timer => timer.at === reportEnds));
    f.advance(reportEnds - 1);
    await setImmediate();
    assert.equal(result.settled, false);
    f.advance(reportEnds);
    await result.done;
    assert.equal(result.error, firstError);
    assert.ok(f.scheduled.every(at => at === lifeEnds || at === reportEnds));
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

test('outer check failure is enforced even when its remaining time is positive', async () => {
  const f = fixture({ outerMilliseconds: 25000 });
  f.rejectOuter = true;
  await assert.rejects(f.sentinel.before(), error => error === f.outerFailure);
  await assert.rejects(f.sentinel.finish(), error => error === f.outerFailure);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.kills, ['SIGKILL']);
  assert.equal(f.timers.size, 0);
});

test('own deadline check still rejects before timers fire with a later outer deadline', async () => {
  const f = fixture({ outerMilliseconds: 25000 });
  await f.sentinel.before();
  f.set(budgets.sentinel);
  await assert.rejects(f.sentinel.finish(), { reason: 'deadlineExceeded' });
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.kills, ['SIGKILL']);
  assert.equal(f.timers.size, 0);
});

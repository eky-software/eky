import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createLinuxConsumerCommandGate } from './linuxConsumerCommandGate.mjs';

const unverified = { message: 'E2E_LINUX_CONSUMER_COMMAND_GATE_UNVERIFIED' };
const turn = () => new Promise(resolve => setImmediate(resolve));

function childHandle() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => assert.fail('The command gate must not kill a child');
  return child;
}

function finishStreams(child) {
  for (const stream of [child.stdout, child.stderr]) {
    stream.emit('end');
    stream.emit('close');
  }
}

function finish(child, code = 0, signal = null) {
  child.emit('spawn');
  child.emit('exit', code, signal);
  finishStreams(child);
  child.emit('close', code, signal);
}

function fixture(t) {
  let now = 0;
  let serial = 0;
  const timers = new Map();
  const waits = [];
  const phases = [];
  const deadline = {
    check(phase) {
      phases.push(phase);
      assert.ok(['ready', 'wrapper'].includes(phase));
      if (now >= 100) throw new Error('Original deadline expired');
    },
    remaining(phase) { this.check(phase); return 100 - now; },
  };
  t.mock.method(globalThis, 'setTimeout', (run, milliseconds) => {
    waits.push(milliseconds);
    timers.set(++serial, { run, until: now + milliseconds });
    return serial;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); });
  t.after(() => assert.equal(timers.size, 0));
  const children = [];
  const calls = [];
  const gate = createLinuxConsumerCommandGate({ spawnChild(...args) {
    calls.push(args);
    const child = childHandle();
    children.push(child);
    return child;
  } });
  return { gate, children, calls, deadline, timers, waits, phases,
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.until <= now && timers.delete(id)) timer.run();
      }
    },
  };
}

test('returns the actual child and registers every direct spawn synchronously', async t => {
  const f = fixture(t);
  const args = ['command', ['argument'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }];
  const spawnChild = f.gate.spawnChild;
  const first = spawnChild(...args);
  const second = spawnChild('other-command');
  assert.equal(first, f.children[0]);
  assert.equal(second, f.children[1]);
  assert.deepEqual(f.calls, [args, ['other-command']]);
  assert.equal(f.calls[0][1], args[1]);
  assert.equal(f.calls[0][2], args[2]);
  assert.equal(f.gate.pendingCount, 2);
  assert.ok(Object.isFrozen(f.gate));
  assert.throws(() => { f.gate.pendingCount = 0; }, TypeError);
  for (const child of f.children) {
    for (const name of ['spawn', 'exit', 'close', 'error']) assert.equal(child.listenerCount(name), 1);
    for (const stream of [child.stdout, child.stderr]) {
      for (const name of ['end', 'close', 'error']) assert.equal(stream.listenerCount(name), 1);
      assert.equal(stream.listenerCount('data'), 0);
    }
    finish(child);
  }
  assert.equal(f.gate.pendingCount, 0);
  await f.gate.drain(f.deadline);
  assert.equal(f.gate.seal(), undefined);
  assert.equal(f.gate.verifySealed(), undefined);
});

for (const [code, signal] of [[0, null], [42, null], [null, 'SIGTERM']]) {
  test(`matching exit/close ${code}/${signal} proves command absence, not success`, async t => {
    const f = fixture(t);
    finish(f.gate.spawnChild(), code, signal);
    await f.gate.drain(f.deadline);
    f.gate.seal();
    f.gate.verifySealed();
  });
}

test('exit and result rejection alone do not settle a command or its streams', async t => {
  const f = fixture(t);
  const child = f.gate.spawnChild();
  child.emit('spawn');
  child.emit('exit', 42, null);
  await assert.rejects(Promise.reject(new Error('Command result rejected')));
  let drained = false;
  const waiting = f.gate.drain(f.deadline).then(() => { drained = true; });
  await turn();
  assert.equal(drained, false);
  child.emit('close', 42, null);
  await turn();
  assert.equal(drained, false);
  child.stdout.emit('end');
  child.stderr.emit('end');
  child.stdout.emit('close');
  await turn();
  assert.equal(drained, false);
  assert.equal(f.gate.pendingCount, 1);
  child.stderr.emit('close');
  await waiting;
  f.gate.seal();
  f.gate.verifySealed();
});

test('drain includes commands started while waiting without renewing the deadline', async t => {
  const f = fixture(t);
  const first = f.gate.spawnChild();
  let drained = false;
  const waiting = f.gate.drain(f.deadline, 'ready').then(() => { drained = true; });
  f.advance(40);
  const second = f.gate.spawnChild();
  finish(first);
  await turn();
  assert.equal(drained, false);
  assert.deepEqual(f.waits, [100, 60]);
  f.advance(35);
  const third = f.gate.spawnChild();
  finish(second);
  await turn();
  assert.equal(drained, false);
  assert.deepEqual(f.waits, [100, 60, 25]);
  finish(third);
  await waiting;
  assert.ok(f.phases.every(phase => phase === 'ready'));
  // Draining observes current work; it does not close future admission.
  const fourth = f.gate.spawnChild();
  finish(fourth);
  await f.gate.drain(f.deadline);
  assert.equal(f.phases.at(-1), 'wrapper');
  f.gate.seal();
  f.gate.verifySealed();
});

for (const missing of ['childClose', 'stdoutEnd', 'stdoutClose', 'stderrEnd', 'stderrClose']) {
  test(`missing ${missing} expires at the original deadline and poisons later proof`, async t => {
    const f = fixture(t);
    const child = f.gate.spawnChild();
    child.emit('spawn');
    child.emit('exit', 0, null);
    for (const name of ['stdout', 'stderr']) {
      if (missing !== name + 'End') child[name].emit('end');
      if (missing !== name + 'Close') child[name].emit('close');
    }
    if (missing !== 'childClose') child.emit('close', 0, null);
    assert.equal(f.gate.pendingCount, 1);
    const rejected = assert.rejects(f.gate.drain(f.deadline), { reason: 'deadlineExceeded' });
    f.advance(100);
    await rejected;
    if (missing === 'childClose') child.emit('close', 0, null);
    else child[missing.startsWith('stdout') ? 'stdout' : 'stderr'].emit(missing.endsWith('End') ? 'end' : 'close');
    assert.equal(f.gate.pendingCount, 0);
    assert.throws(() => f.gate.seal(), unverified);
    assert.throws(() => f.gate.verifySealed(), unverified);
  });
}

for (const source of ['child', 'stdout', 'stderr']) {
  test(`${source} error remains poisoned after all actual handles close`, async t => {
    const f = fixture(t);
    const child = f.gate.spawnChild();
    (source === 'child' ? child : child[source]).emit('error', new Error('PRIVATE helper detail'));
    finish(child);
    assert.equal(f.gate.pendingCount, 0);
    await assert.rejects(f.gate.drain(f.deadline), error => {
      assert.equal(error.message, unverified.message);
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify(error).includes('PRIVATE'));
      return true;
    });
    assert.throws(() => f.gate.seal(), unverified);
  });
}

const invalidLifecycles = {
  missingSpawn: child => { child.emit('exit', 0, null); },
  missingExit: child => { child.emit('spawn'); },
  duplicateSpawn: child => { child.emit('spawn'); child.emit('spawn'); child.emit('exit', 0, null); },
  duplicateExit: child => { child.emit('spawn'); child.emit('exit', 0, null); child.emit('exit', 0, null); },
  exitBeforeSpawn: child => { child.emit('exit', 0, null); child.emit('spawn'); },
  mismatchedCode: child => { child.emit('spawn'); child.emit('exit', 42, null); },
  mismatchedSignal: child => { child.emit('spawn'); child.emit('exit', null, 'SIGTERM'); },
  invalidExit: child => { child.emit('spawn'); child.emit('exit', null, null); },
  prematureStreamClose: child => {
    child.emit('spawn'); child.emit('exit', 0, null); child.stdout.emit('close');
  },
};
for (const [name, emit] of Object.entries(invalidLifecycles)) {
  test(`${name} cannot become valid absence through later close events`, async t => {
    const f = fixture(t);
    const child = f.gate.spawnChild();
    emit(child);
    finishStreams(child);
    child.emit('close', 0, null);
    assert.equal(f.gate.pendingCount, 0);
    await assert.rejects(f.gate.drain(f.deadline), unverified);
    assert.throws(() => f.gate.seal(), unverified);
  });
}

test('sync spawn throw poisons proof without creating a phantom pending handle', async t => {
  const f = fixture(t);
  const gate = createLinuxConsumerCommandGate({ spawnChild() { throw new Error('PRIVATE spawn detail'); } });
  assert.throws(() => gate.spawnChild(), unverified);
  assert.equal(gate.pendingCount, 0);
  await assert.rejects(gate.drain(f.deadline), unverified);
  assert.throws(() => gate.seal(), unverified);
  assert.throws(() => gate.verifySealed(), unverified);
});

test('failed seal is sticky and closes admission before the existing child finishes', async t => {
  const f = fixture(t);
  const child = f.gate.spawnChild();
  assert.throws(() => f.gate.seal(), unverified);
  assert.throws(() => f.gate.spawnChild(), unverified);
  assert.equal(f.calls.length, 1);
  finish(child);
  await assert.rejects(f.gate.drain(f.deadline), unverified);
  assert.throws(() => f.gate.seal(), unverified);
  assert.throws(() => f.gate.verifySealed(), unverified);
});

test('sealed gate refuses later spawn before creating a child and poisons verification', async t => {
  const f = fixture(t);
  assert.throws(() => f.gate.verifySealed(), unverified);
  await f.gate.drain(f.deadline);
  f.gate.seal();
  f.gate.seal();
  f.gate.verifySealed();
  assert.throws(() => f.gate.spawnChild('must-not-launch'), unverified);
  assert.equal(f.calls.length, 0);
  assert.equal(f.gate.pendingCount, 0);
  assert.throws(() => f.gate.verifySealed(), unverified);
  await assert.rejects(f.gate.drain(f.deadline), unverified);
});

test('reentrant seal cannot certify a spawn still returning its actual handle', () => {
  const child = childHandle();
  const gate = createLinuxConsumerCommandGate({ spawnChild() {
    assert.throws(() => gate.seal(), unverified);
    return child;
  } });
  assert.equal(gate.spawnChild(), child);
  assert.equal(gate.pendingCount, 1);
  finish(child);
  assert.throws(() => gate.seal(), unverified);
  assert.throws(() => gate.verifySealed(), unverified);
});

for (const late of ['error', 'exit', 'close', 'spawn', 'stdoutEnd', 'stderrClose', 'stdoutError']) {
  test(`late ${late} still poisons a sealed gate`, async t => {
    const f = fixture(t);
    const child = f.gate.spawnChild();
    finish(child);
    await f.gate.drain(f.deadline);
    f.gate.seal();
    f.gate.verifySealed();
    if (late === 'stdoutEnd') child.stdout.emit('end');
    else if (late === 'stderrClose') child.stderr.emit('close');
    else if (late === 'stdoutError') child.stdout.emit('error', new Error('PRIVATE'));
    else if (late === 'error') child.emit(late, new Error('PRIVATE'));
    else child.emit(late, 0, null);
    assert.throws(() => f.gate.verifySealed(), unverified);
  });
}

test('already expired deadline cannot certify an empty gate', async t => {
  const f = fixture(t);
  f.advance(100);
  await assert.rejects(f.gate.drain(f.deadline), { message: 'Original deadline expired' });
  assert.deepEqual(f.waits, []);
  assert.throws(() => f.gate.seal(), unverified);
});

test('closure at expiry does not turn a late wait into successful proof', async t => {
  const f = fixture(t);
  const child = f.gate.spawnChild();
  const rejected = assert.rejects(f.gate.drain(f.deadline), { reason: 'deadlineExceeded' });
  finish(child);
  f.advance(100);
  await rejected;
  assert.throws(() => f.gate.seal(), unverified);
});

test('helper error does not release an unclosed handle or stop cleanup admission', async t => {
  const f = fixture(t);
  const child = f.gate.spawnChild();
  child.emit('error', new Error('PRIVATE helper detail'));
  let settled = false;
  const rejected = assert.rejects(f.gate.drain(f.deadline), unverified).then(() => { settled = true; });
  await turn();
  assert.equal(settled, false);
  assert.equal(f.gate.pendingCount, 1);
  const cleanupCommand = f.gate.spawnChild();
  finish(child);
  await turn();
  assert.equal(settled, false);
  finish(cleanupCommand);
  await rejected;
  assert.equal(f.gate.pendingCount, 0);
  assert.throws(() => f.gate.seal(), unverified);
});

for (const name of ['stdout', 'stderr']) {
  test(`missing ${name} never supplies implicit EOF or closure`, async t => {
    const f = fixture(t);
    const child = childHandle();
    child[name] = null;
    const gate = createLinuxConsumerCommandGate({ spawnChild: () => child });
    assert.equal(gate.spawnChild(), child);
    child.emit('spawn');
    child.emit('exit', 0, null);
    const other = child[name === 'stdout' ? 'stderr' : 'stdout'];
    other.emit('end');
    other.emit('close');
    child.emit('close', 0, null);
    const rejected = assert.rejects(gate.drain(f.deadline), { reason: 'deadlineExceeded' });
    f.advance(100);
    await rejected;
    assert.equal(gate.pendingCount, 1);
    assert.throws(() => gate.seal(), unverified);
  });
}

test('async spawn failure remains uncertainty even when close and both streams settle', async t => {
  const f = fixture(t);
  const child = f.gate.spawnChild();
  child.emit('error', new Error('PRIVATE spawn detail'));
  finishStreams(child);
  child.emit('close', -2, null);
  assert.equal(f.gate.pendingCount, 0);
  await assert.rejects(f.gate.drain(f.deadline), unverified);
  assert.throws(() => f.gate.seal(), unverified);
});

test('observer installation failure still returns the actual handle to its cleanup owner', async t => {
  const f = fixture(t);
  const child = childHandle();
  t.mock.method(child.stdout, 'on', () => { throw new Error('PRIVATE observer detail'); });
  const gate = createLinuxConsumerCommandGate({ spawnChild: () => child });
  assert.equal(gate.spawnChild(), child);
  assert.equal(gate.pendingCount, 1);
  finish(child);
  const rejected = assert.rejects(gate.drain(f.deadline), { reason: 'deadlineExceeded' });
  f.advance(100);
  await rejected;
  assert.throws(() => gate.seal(), unverified);
});

test('same retained child cannot be registered again after its completed receipt', async t => {
  const f = fixture(t);
  const child = childHandle();
  const gate = createLinuxConsumerCommandGate({ spawnChild: () => child });
  gate.spawnChild();
  finish(child);
  assert.equal(gate.pendingCount, 0);
  assert.throws(() => gate.spawnChild(), unverified);
  assert.equal(gate.pendingCount, 0);
  await assert.rejects(gate.drain(f.deadline), unverified);
  assert.throws(() => gate.seal(), unverified);
});

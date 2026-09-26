import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { startManagedObservation } from './managedNamespaceObservation.mjs';
import { managedObservationCommand } from './managedNamespaceLaunchContract.mjs';
import { managedUnitName, managedUnitProperties, unitObservationLimit } from './managedNamespaceUnitContract.mjs';
import { budgets, createDeadline } from './pidNamespaceContract.mjs';

const generation = 'a'.repeat(32);
const running = {
  Id: managedUnitName(generation), InvocationID: 'b'.repeat(32), LoadState: 'loaded', Transient: 'yes',
  ActiveState: 'active', SubState: 'running', Result: 'success', MainPID: '123', ControlPID: '0',
  ControlGroup: `/system.slice/${managedUnitName(generation)}`, ExecMainCode: '0', ExecMainStatus: '0',
  ExecMainStartTimestampMonotonic: '1000000', ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties,
};
const wire = (record = running) => Buffer.from(Object.entries(record).map(([key, value]) => `${key}=${value}\n`).join(''));

function fixture(options = {}) {
  let elapsed = options.elapsed ?? 0;
  let serial = 0;
  const timers = new Map();
  const time = { setTimeout(fn, delay) { timers.set(++serial, { fn, at: elapsed + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); } };
  const deadline = createDeadline('1000000', () => 1000000n + BigInt(elapsed) * 1000000n);
  const runtime = { platform: 'linux', env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true', NODE_OPTIONS: 'PRIVATE' },
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 };
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const kills = [];
  child.kill = signal => { kills.push(signal); return options.kill?.(child) ?? true; };
  const calls = [];
  const input = { generation, deadline, phase: 'ready', runtime, time,
    spawnChild(...args) {
      calls.push(args);
      options.onSpawn?.();
      if (options.throwSpawn) throw new Error('PRIVATE executable or environment');
      return child;
    } };
  function finish(bytes = wire(), order = ['stdout', 'stderr', 'exit'], code = 0, signal = null) {
    if (bytes) child.stdout.emit('data', bytes);
    for (const step of order) {
      if (step === 'exit') child.emit('exit', code, signal);
      else child[step].emit('end');
    }
    child.emit('close', code, signal);
  }
  return { input, child, timers, kills, calls, finish,
    start() { const query = startManagedObservation(input); child.emit('spawn'); return query; },
    set(ms) { elapsed = ms; },
    advance(ms) {
      elapsed = ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= ms && timers.delete(id)) timer.fn();
      }
    } };
}

async function rejected(query, reason) {
  await assert.rejects(query.result, error => {
    assert.equal(error.message, 'Managed namespace query unverified');
    assert.equal(error.reason, reason);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes('PRIVATE'));
    return true;
  });
  assert.equal(query.snapshot().accepted, false);
}

test('show-only query uses fixed arguments and environment, with no caller shell or inherited hooks', async () => {
  const f = fixture(); const query = f.start();
  const command = managedObservationCommand(generation);
  assert.deepEqual(f.calls, [[command.file, command.args, {
    env: command.env, cwd: '/', shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
  }]]);
  assert.ok(Object.isFrozen(query));
  assert.deepEqual(Object.keys(query), ['result', 'closed', 'snapshot']);
  f.finish();
  assert.deepEqual({ ...await query.result }, running);
  assert.ok(Object.isFrozen(await query.result));
  assert.deepEqual(await query.closed, {
    reason: null, accepted: true, spawned: true, exited: true, queryCleanup: 'closed', terminationAttempted: false,
  });
  assert.equal(f.timers.size, 0);
});

test('all valid process-exit and stream-EOF orderings still require child close', async () => {
  for (const order of [['stdout', 'stderr', 'exit'], ['stdout', 'exit', 'stderr'], ['stderr', 'stdout', 'exit'],
    ['stderr', 'exit', 'stdout'], ['exit', 'stdout', 'stderr'], ['exit', 'stderr', 'stdout']]) {
    const f = fixture(); const query = f.start();
    let settled = false;
    query.result.finally(() => { settled = true; });
    f.child.stdout.emit('data', wire());
    for (const step of order) {
      if (step === 'exit') f.child.emit('exit', 0, null); else f.child[step].emit('end');
      await Promise.resolve(); assert.equal(settled, false);
    }
    f.child.emit('close', 0, null);
    await query.result;
    assert.equal((await query.closed).queryCleanup, 'closed');
  }
});

test('invalid context, root identity, generation, phase or expired deadline never spawns', () => {
  for (const mutate of [f => { f.input.runtime.platform = 'win32'; },
    ...['CI', 'GITHUB_ACTIONS', 'EKY_E2E'].map(key => f => { delete f.input.runtime.env[key]; }),
    f => { f.input.runtime.getuid = () => 0; }, f => { f.input.runtime.geteuid = () => 0; },
    f => { f.input.runtime.getgid = () => 0; }, f => { f.input.runtime.getegid = () => 0; },
    f => { f.input.generation = '*'; }, f => { f.input.phase = 'report'; },
    f => f.set(budgets.ready)]) {
    const f = fixture(); mutate(f);
    assert.throws(() => startManagedObservation(f.input));
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  }
});

test('spawn throw and process error are sanitized, never inferred as an absent unit', async () => {
  const thrown = fixture({ throwSpawn: true });
  const absent = startManagedObservation(thrown.input);
  await rejected(absent, 'spawnFailed');
  assert.equal((await absent.closed).queryCleanup, 'notStarted');
  const f = fixture(); const query = startManagedObservation(f.input);
  f.child.emit('error', Object.assign(Error('PRIVATE'), { code: 'ENOENT' }));
  await rejected(query, 'processError');
  assert.equal(query.snapshot().queryCleanup, 'unverified');
  f.child.emit('close', -2, null);
  assert.equal((await query.closed).queryCleanup, 'closed');
  assert.deepEqual(f.kills, []);
});

test('nonzero or signalled exit never becomes a successful observation', async () => {
  for (const [code, signal] of [[1, null], [41, null], [null, 'SIGKILL']]) {
    const f = fixture(); const query = f.start(); f.finish(wire(), undefined, code, signal);
    await rejected(query, 'exitFailed');
    assert.equal((await query.closed).queryCleanup, 'closed');
    assert.deepEqual(f.kills, []);
  }
});

test('missing EOF, missing exit, mismatched close or missing spawn cannot grant a receipt', async () => {
  for (const omitted of ['stdout', 'stderr', 'exit', 'spawn', 'consistentExit']) {
    const f = fixture(); const query = startManagedObservation(f.input);
    if (omitted !== 'spawn') f.child.emit('spawn');
    f.child.stdout.emit('data', wire());
    for (const name of ['stdout', 'stderr']) if (omitted !== name) f.child[name].emit('end');
    if (omitted !== 'exit') f.child.emit('exit', 0, null);
    f.child.emit('close', omitted === 'consistentExit' ? 1 : 0, null);
    await rejected(query, 'terminalIncomplete');
    assert.equal((await query.closed).queryCleanup, 'closed');
  }
});

test('stream errors, missing streams and premature stream close poison success', async () => {
  for (const name of ['stdout', 'stderr']) {
    for (const event of ['error', 'close']) {
      const f = fixture(); const query = f.start();
      f.child[name].emit(event, new Error('PRIVATE'));
      f.finish();
      await rejected(query, event === 'error' ? 'streamError' : 'streamIncomplete');
      assert.deepEqual(f.kills, ['SIGKILL']);
    }
    const f = fixture(); f.child[name] = null;
    const query = f.start();
    await rejected(query, 'streamMissing');
    f.child.emit('close', null, 'SIGKILL');
    await query.closed;
  }
});

test('stdout byte bound is strict and cumulative, stderr is never merged into evidence', async () => {
  const original = wire();
  const accepted = wire({ ...running, ActiveState: 'x'.repeat(unitObservationLimit - 1 - original.length + 'active'.length) });
  assert.equal(accepted.length, unitObservationLimit - 1);
  const f = fixture(); const query = f.start(); f.finish(accepted); await query.result;
  for (const name of ['stdout', 'stderr']) {
    const over = fixture(); const rejectedQuery = over.start();
    over.child[name].emit('data', Buffer.alloc(unitObservationLimit));
    await rejected(rejectedQuery, 'outputLimit'); over.finish();
  }
  const cumulative = fixture(); const capped = cumulative.start();
  cumulative.child.stdout.emit('data', accepted);
  cumulative.child.stdout.emit('data', Buffer.from('x'));
  await rejected(capped, 'outputLimit'); cumulative.finish();
  const warning = fixture(); const warned = warning.start();
  warning.child.stderr.emit('data', Buffer.from('PRIVATE'));
  warning.finish(); await rejected(warned, 'stderrNotEmpty');
});

test('byte decoding preserves split UTF-8 and rejects malformed or partial text', async () => {
  const value = { ...running, ActiveState: 'caf\u00e9' };
  const bytes = wire(value); const split = bytes.indexOf(Buffer.from('\u00e9')) + 1;
  const f = fixture(); const query = f.start();
  f.child.stdout.emit('data', bytes.subarray(0, split)); f.finish(bytes.subarray(split));
  assert.equal((await query.result).ActiveState, value.ActiveState);
  for (const invalid of [Buffer.concat([wire(), Buffer.from([0xc3])]), Buffer.concat([wire(), Buffer.from([0xff])]),
    wire().subarray(0, -1), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), wire()]),
    wire({ ...running, InvocationID: '' }), wire({ ...running, LoadState: 'not-found' })]) {
    const g = fixture(); const rejectedQuery = g.start(); g.finish(invalid);
    await rejected(rejectedQuery, 'observationInvalid');
  }
});

test('unexpected data type or data after EOF is rejected without raw output', async () => {
  for (const invalid of ['PRIVATE', null]) {
    const f = fixture(); const query = f.start(); f.child.stdout.emit('data', invalid);
    f.finish(); await rejected(query, 'streamInvalid');
  }
  const f = fixture(); const query = f.start();
  f.child.stdout.emit('end'); f.child.stdout.emit('data', wire());
  f.finish(); await rejected(query, 'streamInvalid');
});

test('original deadline expires without close and a late success cannot erase the failure', async () => {
  for (const phase of ['ready', 'wrapper']) {
    const f = fixture({ elapsed: budgets[phase] - 7 }); f.input.phase = phase;
    const query = f.start();
    assert.equal([...f.timers.values()][0].at, budgets[phase]);
    f.advance(budgets[phase]);
    await rejected(query, 'deadlineExceeded');
    assert.equal(query.snapshot().queryCleanup, 'unverified');
    assert.deepEqual(f.kills, ['SIGKILL']);
    f.finish();
    assert.equal((await query.closed).accepted, false);
    await rejected(query, 'deadlineExceeded');
    assert.equal(f.calls.length, 1);
  }
});

test('delayed spawn and synchronous spawn work cannot extend the original deadline', async () => {
  const f = fixture(); const query = startManagedObservation(f.input);
  f.advance(budgets.ready); assert.deepEqual(f.kills, []);
  f.child.emit('spawn'); assert.deepEqual(f.kills, ['SIGKILL']);
  f.finish(); await rejected(query, 'deadlineExceeded');
  const g = fixture({ onSpawn: () => g.set(budgets.ready) });
  const late = startManagedObservation(g.input); g.child.emit('spawn');
  g.finish(); await rejected(late, 'deadlineExceeded');
});

test('exit without stream closure times out without signalling a reused process identifier', async () => {
  const f = fixture(); const query = f.start(); f.child.emit('exit', 0, null);
  f.advance(budgets.ready); await rejected(query, 'deadlineExceeded');
  assert.deepEqual(f.kills, []); assert.equal(query.snapshot().queryCleanup, 'unverified');
  f.finish(); await query.closed;
});

test('late close is rejected even when the event-loop timer callback has not run', async () => {
  const f = fixture(); const query = f.start(); f.set(budgets.ready); f.finish();
  await rejected(query, 'deadlineExceeded'); assert.equal(f.timers.size, 0);
});

test('the final acceptance check cannot return an observation after its original deadline', async () => {
  const f = fixture(); const deadline = f.input.deadline;
  let closing = false; let checks = 0;
  f.input.deadline = { ...deadline, check(phase) {
    if (closing && ++checks === 2) f.set(budgets.ready);
    deadline.check(phase);
  } };
  const query = f.start(); closing = true; f.finish();
  await rejected(query, 'deadlineExceeded');
  assert.equal(checks, 2); assert.equal((await query.closed).queryCleanup, 'closed');
});

test('an unkillable query stays explicitly unverified without another launch or synthetic close', async () => {
  for (const kill of [() => false, () => { throw Error('PRIVATE'); }]) {
    const f = fixture({ kill }); const query = f.start();
    let closed = false; query.closed.then(() => { closed = true; });
    f.advance(budgets.ready); await rejected(query, 'deadlineExceeded');
    assert.equal(closed, false); assert.equal(query.snapshot().queryCleanup, 'unverified');
    assert.equal(f.calls.length, 1); assert.deepEqual(f.kills, ['SIGKILL']);
    f.finish(); await query.closed;
  }
});

test('kill false, throw and reentrant errors or success retain the first failure', async () => {
  for (const kill of [() => false, () => { throw Error('PRIVATE'); },
    child => { child.emit('error', Error('PRIVATE')); return false; },
    child => { child.stdout.emit('end'); child.stderr.emit('end'); child.emit('exit', 0, null); child.emit('close', 0, null); return true; }]) {
    const f = fixture({ kill }); const query = f.start();
    f.child.stdout.emit('data', wire()); f.advance(budgets.ready);
    await rejected(query, 'deadlineExceeded');
    assert.deepEqual(f.kills, ['SIGKILL']);
    assert.equal(f.timers.size, 0);
    f.finish();
    assert.equal((await query.closed).accepted, false);
  }
});

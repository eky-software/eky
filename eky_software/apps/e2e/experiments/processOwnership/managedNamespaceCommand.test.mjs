import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { prepareManagedLaunch, startManagedCommand } from './managedNamespaceCommand.mjs';
import { startManagedObservation } from './managedNamespaceObservation.mjs';
import { managedLaunchCommand, managedObservationCommand, managedStopCommand,
  managedSystemTools } from './managedNamespaceLaunchContract.mjs';
import { unitObservationLimit } from './managedNamespaceUnitContract.mjs';
import { budgets, createDeadline } from './pidNamespaceContract.mjs';

const generation = 'a'.repeat(32);
const configuration = () => ({ generation, started: '1000000', uid: 1001, gid: 1002,
  root: '/tmp/eky-managed-ns-example', node: '/opt/node/bin/node', init: '/repo/managedNamespaceInit.mjs' });

function fixture() {
  let elapsed = 0;
  let serial = 0;
  const timers = new Map();
  const time = { setTimeout(fn, delay) { timers.set(++serial, { fn, at: elapsed + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); } };
  const runtime = { platform: 'linux', env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true', NODE_OPTIONS: 'PRIVATE' },
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 };
  const calls = [];
  const children = [];
  const input = { runtime, time, generation,
    deadline: createDeadline('1000000', () => 1000000n + BigInt(elapsed) * 1000000n),
    spawnChild(...args) {
      calls.push(args);
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kills = [];
      child.kill = signal => { child.kills.push(signal); return false; };
      children.push(child);
      return child;
    } };
  const finish = (text = '', code = 0, signal = null) => {
    const child = children.at(-1);
    child.emit('spawn'); child.stdout.emit('data', Buffer.isBuffer(text) ? text : Buffer.from(text));
    child.stdout.emit('end'); child.stderr.emit('end'); child.emit('exit', code, signal); child.emit('close', code, signal);
  };
  return { input, calls, children, timers, finish,
    advance(ms) { elapsed = ms;
      for (const [id, timer] of [...timers]) if (timer.at <= ms && timers.delete(id)) timer.fn();
    },
    start(operation) { return startManagedCommand({ ...input, operation }); },
    prepare(config = configuration()) { return prepareManagedLaunch({ ...input, config }); },
  };
}

async function rejected(query, reason) {
  await assert.rejects(query.result, error => {
    assert.equal(error.message, 'Managed namespace command unverified');
    assert.equal(error.reason, reason);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes('PRIVATE'));
    return true;
  });
  assert.equal(query.snapshot().accepted, false);
}

test('manager probe queries only Version without a unit, shell, sudo or inherited environment', async () => {
  const f = fixture(); const query = f.start('managerProbe');
  assert.deepEqual(f.calls, [[managedSystemTools.control,
    ['--system', '--no-ask-password', 'show', '--no-pager', '--property=Version', '--value'],
    { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, cwd: '/', shell: false,
      detached: false, stdio: ['ignore', 'pipe', 'pipe'] }]]);
  f.finish('255 (synthetic build)\n');
  assert.deepEqual(await query.result, { kind: 'managerReachable' });
  assert.ok(Object.isFrozen(await query.result));
  assert.equal((await query.closed).commandCleanup, 'closed');
  assert.equal(f.timers.size, 0);
});

test('manager probe rejects missing, multiline, blank, nonprintable, non-ASCII or malformed UTF-8 output', async () => {
  for (const text of ['', '\n', ' \n', '255', '255\n\n', '255\nextra\n', '255\r\n', '255\0\n',
    '255\t\n', '\uFEFF255\n', 'version-\u00e9\n', Buffer.from([0xff, 0x0a])]) {
    const f = fixture(); const query = f.start('managerProbe'); f.finish(text);
    await rejected(query, 'outputInvalid');
  }
});

test('authorization lists the exact fixed command only, discarding raw policy output', async () => {
  for (const [operation, build] of [['authorizeObservation', managedObservationCommand], ['authorizeStop', managedStopCommand]]) {
    const f = fixture(); const query = f.start(operation); const command = build(generation);
    assert.equal(f.calls[0][0], managedSystemTools.sudo);
    assert.deepEqual(f.calls[0][1], ['-n', '-l', ...command.args.slice(1)]);
    f.finish('PRIVATE policy detail\n');
    assert.deepEqual(await query.result, { kind: 'policyListed' });
    assert.ok(Object.isFrozen(await query.result));
    assert.ok(!JSON.stringify(await query.closed).includes('PRIVATE'));
  }
});

test('authorization and launch use one frozen command despite caller configuration changes', async () => {
  const f = fixture(); const config = configuration(); const command = managedLaunchCommand(config);
  const prepared = f.prepare(config);
  config.uid = 1009; config.gid = 1009; config.root = '/tmp/eky-managed-ns-other'; config.node = '/different/node';
  const policy = prepared.authorize();
  assert.deepEqual(f.calls[0][1], ['-n', '-l', ...command.args.slice(1)]);
  assert.throws(() => prepared.launch(), { reason: 'invalidArguments' });
  f.finish('PRIVATE\n'); await policy.result;
  const launch = prepared.launch();
  assert.deepEqual(f.calls[1], [command.file, command.args, {
    env: command.env, cwd: '/', shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
  }]);
  assert.ok(Object.isFrozen(f.calls[1][1])); assert.ok(Object.isFrozen(f.calls[1][2].env));
  f.finish();
  assert.deepEqual(await launch.result, { kind: 'launchCommandAccepted' });
  assert.deepEqual(Object.keys(await launch.result), ['kind']);
  assert.throws(() => prepared.launch(), { reason: 'invalidArguments' });
  assert.throws(() => prepared.authorize(), { reason: 'invalidArguments' });
  assert.equal(f.calls.length, 2);
});

test('configured IDs must match all four caller IDs before either authorization or launch', async () => {
  for (const name of ['uid', 'gid']) {
    const f = fixture(); const config = configuration(); config[name] += 1;
    assert.throws(() => f.prepare(config)); assert.equal(f.calls.length, 0);
  }
  for (const name of ['getuid', 'geteuid', 'getgid', 'getegid']) {
    const f = fixture(); const prepared = f.prepare(); const original = f.input.runtime[name];
    f.input.runtime[name] = () => 999;
    assert.throws(() => prepared.authorize()); assert.equal(f.calls.length, 0);
    f.input.runtime[name] = original;
    const policy = prepared.authorize(); f.finish(); await policy.result;
    f.input.runtime[name] = () => 999;
    assert.throws(() => prepared.launch()); assert.equal(f.calls.length, 1);
  }
});

test('closed operations and Linux nonroot CI guards reject before any process is created', () => {
  for (const operation of ['stop', 'launch', 'authorizeLaunch', 'showAll', 'toString', undefined]) {
    const f = fixture(); assert.throws(() => f.start(operation)); assert.equal(f.calls.length, 0);
  }
  for (const mutate of [f => { f.input.runtime.platform = 'win32'; },
    ...['CI', 'GITHUB_ACTIONS', 'EKY_E2E'].map(key => f => { delete f.input.runtime.env[key]; }),
    ...['getuid', 'geteuid', 'getgid', 'getegid'].map(key => f => { f.input.runtime[key] = () => 0; }),
    f => { f.input.phase = 'wrapper'; }, f => f.advance(budgets.ready)]) {
    const f = fixture(); mutate(f);
    assert.throws(() => f.start('managerProbe')); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.input.generation = '*';
  assert.throws(() => f.start('authorizeStop')); assert.equal(f.calls.length, 0);
});

test('the existing observation API still requires an explicit valid phase', () => {
  for (const phase of [{}, { phase: undefined }, { phase: null }]) {
    const f = fixture();
    assert.throws(() => startManagedObservation({ ...f.input, ...phase }));
    assert.throws(() => startManagedCommand({ ...f.input, ...phase, operation: 'observation' }));
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  }
});

test('a denied policy cannot launch or be retried, even after late successful close', async () => {
  const f = fixture(); const prepared = f.prepare(); const policy = prepared.authorize();
  const child = f.children[0]; child.emit('spawn'); child.emit('exit', 1, null);
  await rejected(policy, 'exitFailed');
  f.finish('PRIVATE\n');
  assert.throws(() => prepared.launch()); assert.throws(() => prepared.authorize());
  assert.equal((await policy.closed).accepted, false); assert.equal(f.calls.length, 1);
});

test('policy success does not guarantee launch success and never enables an automatic retry', async () => {
  for (const [code, signal] of [[1, null], [null, 'SIGKILL']]) {
    const f = fixture(); const prepared = f.prepare();
    const policy = prepared.authorize(); f.finish(); await policy.result;
    const launch = prepared.launch(); f.finish('', code, signal);
    await rejected(launch, 'exitFailed'); assert.equal((await launch.closed).commandCleanup, 'closed');
    assert.throws(() => prepared.launch()); assert.equal(f.calls.length, 2);
  }
});

test('launch requires quiet output and actual exit, both EOFs and close before acceptance', async () => {
  for (const omit of ['exit', 'stdout', 'stderr', 'quiet']) {
    const f = fixture(); const prepared = f.prepare(); const policy = prepared.authorize();
    f.finish(); await policy.result;
    const launch = prepared.launch(); const child = f.children[1]; child.emit('spawn');
    if (omit === 'quiet') child.stdout.emit('data', Buffer.from('PRIVATE'));
    for (const name of ['stdout', 'stderr']) if (omit !== name) child[name].emit('end');
    if (omit !== 'exit') child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await rejected(launch, omit === 'quiet' ? 'outputInvalid' : 'terminalIncomplete');
  }
});

test('every new command keeps bounded output, strict decoding and stderr separation', async () => {
  for (const operation of ['managerProbe', 'authorizeObservation', 'authorizeStop']) {
    for (const [stream, bytes, reason] of [['stdout', Buffer.alloc(unitObservationLimit), 'outputLimit'],
      ['stderr', Buffer.from('PRIVATE'), 'stderrNotEmpty'], ['stdout', Buffer.from([0xff]), 'outputInvalid']]) {
      const f = fixture(); const query = f.start(operation); const child = f.children[0]; child.emit('spawn');
      child[stream].emit('data', bytes); f.finish();
      await rejected(query, reason);
    }
  }
});

test('the original ready deadline also binds policy and launch without resetting', async () => {
  const f = fixture(); const prepared = f.prepare();
  f.advance(budgets.ready - 2);
  const policy = prepared.authorize(); f.finish(); await policy.result;
  const launch = prepared.launch(); f.children[1].emit('spawn');
  assert.equal([...f.timers.values()][0].at, budgets.ready);
  f.advance(budgets.ready); await rejected(launch, 'deadlineExceeded');
  assert.equal(launch.snapshot().commandCleanup, 'unverified');
  assert.deepEqual(f.children[1].kills, ['SIGKILL']);
  f.finish(); await rejected(launch, 'deadlineExceeded');
  assert.equal((await launch.closed).commandCleanup, 'closed'); assert.equal(f.calls.length, 2);
});

test('command spawn failure is sanitized and closure says nothing about any unit', async () => {
  const f = fixture(); f.input.spawnChild = () => { throw new Error('PRIVATE'); };
  const query = f.start('managerProbe'); await rejected(query, 'spawnFailed');
  assert.equal((await query.closed).commandCleanup, 'notStarted');
  assert.ok(!Object.hasOwn(query.snapshot(), 'unitAbsent'));
});

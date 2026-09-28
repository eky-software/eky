import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createLinuxConsumerObserver } from './linuxConsumerObserver.mjs';
import { createLinuxConsumerCommandGate } from './linuxConsumerCommandGate.mjs';
import { consumerLossCase, ownerLossExit } from './linuxConsumerLossContract.mjs';
import { consumerLossRecords } from './linuxConsumerLossRecords.mjs';
import { serviceDeadlines } from './linuxServiceContract.mjs';
import { managedStopCommand } from './managedNamespaceLaunchContract.mjs';
import { captureRunningUnit, managedUnitName, managedUnitProperties } from './managedNamespaceUnitContract.mjs';
import { waitWithin } from './pidNamespaceContract.mjs';

const unverified = /E2E_LINUX_CONSUMER_LOSS_UNVERIFIED/u;
const turn = () => new Promise(resolve => setImmediate(resolve));
const pending = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};
const units = Object.fromEntries(['chromium', 'backend', 'vite'].map((profile, index) => {
  const generation = String(index + 1).repeat(32);
  const running = Object.freeze({
    Id: managedUnitName(generation), InvocationID: String(index + 4).repeat(32),
    LoadState: 'loaded', Transient: 'yes', ActiveState: 'active', SubState: 'running', Result: 'success',
    MainPID: '123', ControlPID: '0', ControlGroup: `/system.slice/${managedUnitName(generation)}`,
    ExecMainCode: '0', ExecMainStatus: '0', ExecMainStartTimestampMonotonic: '1000000',
    ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties,
  });
  return [profile, { generation, running, receipt: captureRunningUnit(running, generation),
    terminal: Object.freeze({ ...running, ActiveState: 'failed', SubState: 'failed', Result: 'exit-code',
      MainPID: '0', ExecMainCode: '1', ExecMainStatus: '42', ExecMainExitTimestampMonotonic: '2000000' }) }];
}));

function controlledChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const kills = [];
  child.kill = signal => { kills.push(signal); return true; };
  Object.defineProperty(child, 'pid', { get() { assert.fail('No PID lookup authority'); } });
  let spawned = false; let exited = false; let closed = false;
  const ended = new Set(); const streamClosed = new Set();
  const handle = {
    child, kills,
    exit(code = 0, signal = null) {
      if (!spawned) { spawned = true; child.emit('spawn'); }
      if (!exited) { exited = true; child.emit('exit', code, signal); }
    },
    close(code = 0, signal = null) {
      if (!closed) { closed = true; child.emit('close', code, signal); }
    },
    endStream(name) {
      if (!ended.has(name)) { ended.add(name); child[name].emit('end'); }
    },
    closeStream(name) {
      if (!streamClosed.has(name)) { streamClosed.add(name); child[name].emit('close'); }
    },
    finish(code = 0, signal = null) {
      handle.exit(code, signal);
      for (const name of ['stdout', 'stderr']) { handle.endStream(name); handle.closeStream(name); }
      handle.close(code, signal);
    },
  };
  return handle;
}

function fixture(t, caseId = 'backend-control') {
  const selected = consumerLossCase(caseId);
  let clock = 1_000_000n; let serial = 0; let callerIsClosed = false;
  const timers = new Map(); const records = new Map(); const plans = []; const stopActions = [];
  const events = []; const queries = []; const children = []; const stops = []; const publications = [];
  const definitions = consumerLossRecords(caseId);
  const deadline = serviceDeadlines({ startUntil: '45001000000', workUntil: '90001000000' }, () => clock);
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    timers.set(++serial, { callback, at: clock + BigInt(Math.ceil(milliseconds * 1e6)) }); return serial;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); });
  t.mock.method(process, 'kill', () => assert.fail('No process or group signal authority'));
  const gate = createLinuxConsumerCommandGate({ spawnChild(file, args, options) {
    const handle = controlledChild(); children.push(handle);
    if (file !== 'synthetic-observation' && file !== 'synthetic-helper') {
      assert.equal(callerIsClosed, true);
      events.push('stop'); stops.push({ file, args, options, handle });
      const action = stopActions.shift() ?? (value => value.finish());
      queueMicrotask(() => action(handle));
    }
    return handle.child;
  } });
  const commands = { spawnChild: gate.spawnChild, async drain(actualDeadline, phase) {
    assert.equal(actualDeadline, deadline); assert.equal(phase, 'wrapper');
    events.push('drain'); await gate.drain(actualDeadline, phase); events.push('drained');
  } };
  const exchange = { publish(name, value) {
    const definition = definitions.find(record => record.name === name);
    assert.equal(definition?.writer, 'observer'); definition.validate(value);
    assert.ok(!publications.some(([previous]) => previous === name));
    events.push(name); publications.push([name, value]);
  } };
  const record = name => {
    if (!records.has(name)) records.set(name, pending());
    return records.get(name);
  };
  const observer = createLinuxConsumerObserver({ caseId, exchange, deadline, commands,
    callerClosed: () => callerIsClosed }, {
    time: globalThis,
    startObservation(options) {
      assert.equal(options.deadline, deadline); assert.equal(options.phase, 'wrapper');
      assert.equal(options.spawnChild, gate.spawnChild); assert.equal(options.time, globalThis);
      const plan = plans.shift(); assert.ok(plan, 'Every independent observation must be planned');
      assert.equal(options.generation, plan.generation);
      events.push('query'); queries.push(options);
      options.spawnChild('synthetic-observation', [options.generation]);
      plan.handle = children.at(-1);
      if (plan.automatic) queueMicrotask(() => plan.complete());
      return { result: plan.result.promise, closed: plan.closed.promise };
    },
    waitRecord(actualExchange, name, actualDeadline, phase) {
      assert.equal(actualExchange, exchange); assert.equal(actualDeadline, deadline); assert.equal(phase, 'work');
      events.push(`wait:${name}`);
      // Intentionally inject raw records: observer binding must not rely on a
      // separately configured exchange having selected the same case/profile.
      return waitWithin(record(name).promise, deadline, phase);
    },
  });
  const queue = (profile, value = units[profile].running, automatic = true) => {
    const plan = { generation: units[profile].generation, value, automatic, result: pending(), closed: pending(),
      complete() { plan.handle.finish(); plan.result.resolve(plan.value); plan.closed.resolve(); } };
    plans.push(plan); return plan;
  };
  const announce = (profile, receipt = units[profile].receipt) => {
    record(`${profile}-intent.json`).resolve({ generation: units[profile].generation,
      startUntil: '45001000000', workUntil: '90001000000' });
    record(`${profile}-owned.json`).resolve(receipt);
  };
  const register = async (profile, receipt = units[profile].receipt, observation = units[profile].running) => {
    announce(profile, receipt); queue(profile, observation); await observer.register(profile);
  };
  t.after(() => { assert.equal(gate.pendingCount, 0); assert.equal(timers.size, 0); });
  return { observer, deadline, gate, commands, events, queries, children, stops, publications, stopActions,
    record, queue, announce, register, selected,
    async registerAll() { for (const profile of selected.profiles) await register(profile); },
    arm(profile, overrides = {}) {
      record(`${profile}-armed.json`).resolve({ caseId, profile, generation: units[profile].generation,
        cause: selected.cause, ...overrides });
    },
    setCallerClosed(value) { callerIsClosed = value; },
    advance(milliseconds) {
      clock += BigInt(milliseconds) * 1_000_000n;
      for (const [id, timer] of [...timers]) if (timer.at <= clock && timers.delete(id)) timer.callback();
    },
    published: name => publications.some(([actual]) => actual === name),
  };
}

test('registration independently binds ownership and every command/stream closure before GO', async t => {
  const f = fixture(t);
  assert.deepEqual(f.observer.readState(), { registered: 0, passive: 0, complete: false });
  assert.equal(f.children.length, 0);
  const plan = f.queue('backend', units.backend.running, false);
  const registration = f.observer.register('backend');
  await turn();
  assert.deepEqual(f.events, ['wait:backend-intent.json']);
  f.record('backend-intent.json').resolve({ generation: units.backend.generation });
  await turn();
  assert.deepEqual(f.publications, [['backend-ack.json', { generation: units.backend.generation }]]);
  assert.equal(f.queries.length, 0);
  f.record('backend-owned.json').resolve(units.backend.receipt);
  await turn();
  plan.result.resolve(units.backend.running);
  await turn();
  assert.ok(!f.events.includes('drain'));
  plan.closed.resolve();
  await turn();
  assert.ok(f.events.includes('drain'));
  plan.handle.exit(); await turn();
  assert.equal(f.published('backend-go.json'), false);
  plan.handle.close();
  for (const [method, name] of [['endStream', 'stdout'], ['closeStream', 'stdout'], ['endStream', 'stderr']]) {
    plan.handle[method](name); await turn();
    assert.equal(f.published('backend-go.json'), false);
  }
  f.commands.spawnChild('synthetic-helper');
  const lateHelper = f.children.at(-1);
  plan.handle.closeStream('stderr'); await turn();
  assert.equal(f.published('backend-go.json'), false);
  lateHelper.finish(7);
  await registration;
  assert.deepEqual(f.publications.at(-1), ['backend-go.json', units.backend.receipt]);
  assert.ok(f.events.indexOf('drained') < f.events.indexOf('backend-go.json'));
  assert.deepEqual(f.observer.readState(), { registered: 1, passive: 0, complete: true });
  assert.ok(Object.isFrozen(f.observer.readState()));
  assert.equal(f.stops.length, 0);
});

test('web registration is sequential per service, rejects duplicates and never needs an all-services GO barrier', async t => {
  const f = fixture(t, 'vite-owner');
  await assert.rejects(f.observer.register('backend'), unverified);
  assert.equal(f.events.length, 0);
  for (const [index, profile] of f.selected.profiles.entries()) {
    await f.register(profile);
    assert.ok(f.published(`${profile}-go.json`));
    assert.deepEqual(f.observer.readState(), { registered: index + 1, passive: 0, complete: index === 2 });
    await assert.rejects(f.observer.register(profile), unverified);
  }
  assert.equal(f.queries.length, 3);
});

for (const [field, value] of [
  ['generation', 'a'.repeat(32)], ['unit', managedUnitName('a'.repeat(32))],
  ['invocation', 'a'.repeat(32)], ['started', '1000001'],
]) test(`registration rejects announced ${field} mismatch without GO`, async t => {
  const f = fixture(t);
  await assert.rejects(f.register('backend', { ...units.backend.receipt, [field]: value }), unverified);
  assert.equal(f.published('backend-go.json'), false);
  assert.equal(f.observer.readState().registered, 0);
  assert.equal(f.stops.length, 0);
});

for (const [stage, error] of [['result', new Error('observation failed')], ['closed', new Error('close failed')]]) {
  test(`a rejected observation ${stage} cannot grant GO or erase its actual open handle`, async t => {
    const f = fixture(t); f.announce('backend');
    const plan = f.queue('backend', units.backend.running, false);
    const rejected = assert.rejects(f.observer.register('backend'), value => value === error);
    await turn();
    if (stage === 'closed') plan.result.resolve(units.backend.running);
    plan[stage].reject(error);
    await rejected;
    assert.equal(f.gate.pendingCount, 1);
    assert.equal(f.published('backend-go.json'), false);
    assert.equal(f.stops.length, 0);
    plan.complete();
  });
}

test('registration rejects a command error even after matching result, close and stream completion', async t => {
  const f = fixture(t); f.announce('backend');
  const plan = f.queue('backend', units.backend.running, false);
  const rejected = assert.rejects(f.observer.register('backend'), /COMMAND_GATE_UNVERIFIED/u);
  await turn();
  plan.handle.child.emit('error', new Error('helper failed')); plan.complete();
  await rejected;
  assert.equal(f.published('backend-go.json'), false);
});

test('a closed observation after work expiry cannot publish a late GO using wrapper time', async t => {
  const f = fixture(t); f.announce('backend');
  const plan = f.queue('backend', units.backend.running, false);
  const rejected = assert.rejects(f.observer.register('backend'), error => error.reason === 'startupDeadlineExceeded');
  await turn();
  f.advance(90_000); plan.complete();
  await rejected;
  assert.equal(f.published('backend-go.json'), false);
});

for (const profile of ['backend', 'vite', 'chromium']) for (const cause of ['owner', 'control']) {
  test(`${profile}-${cause} publishes only its passive receipt before caller finalization`, async t => {
    const f = fixture(t, `${profile}-${cause}`); await f.registerAll();
    f.arm(profile); f.queue(profile, { ...units[profile].terminal,
      ExecMainStatus: cause === 'owner' ? String(ownerLossExit) : '42' });
    const before = f.queries.length;
    assert.deepEqual(await f.observer.observePassive(profile), units[profile].receipt);
    assert.equal(f.queries.length, before + 1);
    assert.deepEqual(f.publications.filter(([name]) => name.endsWith('-passive.json')),
      [[`${profile}-passive.json`, units[profile].receipt]]);
    assert.equal(f.events.some(value => /result|ready|grant/u.test(value)), false);
    assert.equal(f.stops.length, 0);
    await assert.rejects(f.observer.observePassive(profile), unverified);
    await assert.rejects(f.observer.containAfterCallerClosed(), unverified);
  });
}

test('unregistered and healthy profiles cannot supply passive proof', async t => {
  const f = fixture(t, 'vite-control');
  await assert.rejects(f.observer.observePassive('vite'), unverified);
  await f.registerAll();
  const before = f.queries.length;
  for (const profile of ['backend', 'chromium']) await assert.rejects(f.observer.observePassive(profile), unverified);
  assert.equal(f.queries.length, before);
  assert.equal(f.observer.readState().passive, 0);
});

test('an unarmed terminal cannot produce proof and missing arm expires within the existing deadline', async t => {
  const f = fixture(t); await f.registerAll();
  const rejected = assert.rejects(f.observer.observePassive('backend'), error => error.reason === 'deadlineExceeded');
  await turn();
  assert.equal(f.queries.length, 1);
  assert.equal(f.published('backend-passive.json'), false);
  f.advance(90_000); await rejected;
  assert.equal(f.observer.readState().passive, 0);
});

for (const [label, arm] of [
  ['missing record contents', null],
  ['wrong generation', { generation: 'a'.repeat(32) }],
  ['cause inconsistent with case', { cause: 'owner' }],
  ['different valid case', { caseId: 'backend-owner', cause: 'owner' }],
  ['different valid case and profile', { caseId: 'vite-control', profile: 'vite' }],
  ['caller fault instead of control', { caseId: 'caller', cause: 'caller' }],
]) test(`passive proof rejects ${label} even with an injected record reader`, async t => {
  const f = fixture(t); await f.registerAll();
  if (arm === null) f.record('backend-armed.json').resolve(null); else f.arm('backend', arm);
  f.queue('backend', { ...units.backend.terminal,
    ExecMainStatus: arm?.cause === 'owner' ? String(ownerLossExit) : '42' });
  await assert.rejects(f.observer.observePassive('backend'), unverified);
  assert.equal(f.published('backend-passive.json'), false);
  assert.equal(f.observer.readState().passive, 0);
  assert.equal(f.stops.length, 0);
});

test('caller passive proof rejects an arm for another profile in the same case', async t => {
  const f = fixture(t, 'caller'); await f.registerAll();
  f.arm('backend', { profile: 'vite' }); f.queue('backend', units.backend.terminal);
  await assert.rejects(f.observer.observePassive('backend'), unverified);
  assert.equal(f.observer.readState().passive, 0);
});

for (const [caseId, code] of [['backend-owner', 42], ['backend-control', ownerLossExit], ['caller', ownerLossExit]]) {
  test(`${caseId} refuses exit ${code} from a different failure cause`, async t => {
    const f = fixture(t, caseId); await f.registerAll(); f.arm('backend');
    f.queue('backend', { ...units.backend.terminal, ExecMainStatus: String(code) });
    await assert.rejects(f.observer.observePassive('backend'), unverified);
    assert.equal(f.published('backend-passive.json'), false);
    assert.equal(f.observer.readState().passive, 0);
  });
}

for (const [field, value] of [
  ['Id', managedUnitName('a'.repeat(32))], ['InvocationID', 'a'.repeat(32)],
  ['ExecMainStartTimestampMonotonic', '1000001'], ['ActiveState', 'inactive'], ['SubState', 'dead'],
  ['Result', 'signal'], ['MainPID', '123'], ['ControlPID', '456'], ['ExecMainCode', '2'],
  ['ExecMainStatus', '41'], ['ExecMainStatus', '0'], ['ExecMainExitTimestampMonotonic', '0'],
  ['ExecMainExitTimestampMonotonic', '999999'], ['KillMode', 'process'],
]) test(`passive proof rejects terminal ${field}=${value}`, async t => {
  const f = fixture(t); await f.registerAll(); f.arm('backend');
  f.queue('backend', { ...units.backend.terminal, [field]: value });
  await assert.rejects(f.observer.observePassive('backend'));
  assert.equal(f.published('backend-passive.json'), false);
  assert.equal(f.observer.readState().passive, 0);
  assert.equal(f.stops.length, 0);
});

test('active and deactivating observations only poll within the same latched cleanup budget', async t => {
  const f = fixture(t); await f.registerAll(); f.arm('backend'); f.deadline.beginCleanup();
  f.queue('backend'); f.queue('backend', { ...units.backend.running, ActiveState: 'deactivating' });
  f.queue('backend', units.backend.terminal);
  const passive = f.observer.observePassive('backend');
  await turn(); assert.equal(f.published('backend-passive.json'), false);
  f.advance(25); await turn(); assert.equal(f.published('backend-passive.json'), false);
  f.advance(25); await passive;
  assert.equal(f.queries.length, 4);
  assert.equal(f.deadline.remaining('wrapper'), 2950);
  assert.equal(f.stops.length, 0);
});

test('exit-42 result and command close without stream closure expire instead of releasing passive proof', async t => {
  const f = fixture(t); await f.registerAll(); f.arm('backend'); f.deadline.beginCleanup();
  const plan = f.queue('backend', units.backend.terminal, false);
  const rejected = assert.rejects(f.observer.observePassive('backend'), error => error.reason === 'deadlineExceeded');
  await turn();
  plan.result.resolve(plan.value); plan.closed.resolve(); plan.handle.exit(); plan.handle.close();
  await turn();
  f.advance(2999); await turn(); assert.equal(f.published('backend-passive.json'), false);
  f.advance(1); await rejected;
  assert.equal(f.deadline.remaining('wrapper'), 0);
  assert.equal(f.observer.readState().passive, 0);
  assert.equal(f.stops.length, 0);
  plan.handle.finish(); await turn();
});

for (const closed of [false, undefined, 1, 'closed']) {
  test(`takeover refuses non-proven caller closure (${String(closed)}) without query or stop`, async t => {
    const f = fixture(t); await f.registerAll(); f.setCallerClosed(closed);
    await assert.rejects(f.observer.containAfterCallerClosed(), unverified);
    assert.equal(f.queries.length, 1); assert.equal(f.stops.length, 0);
  });
}

test('caller-closed takeover requires a fresh bound and fully closed query before fixed-unit stop', async t => {
  const f = fixture(t); await f.registerAll(); f.setCallerClosed(true);
  const plan = f.queue('backend', { ...units.backend.running, MainPID: '999' }, false);
  const completion = f.observer.containAfterCallerClosed();
  await turn();
  plan.result.resolve(plan.value); plan.closed.resolve(); plan.handle.exit(); plan.handle.close();
  await turn(); assert.equal(f.stops.length, 0);
  plan.handle.finish(); await completion;
  const command = managedStopCommand(units.backend.generation);
  assert.deepEqual(f.stops.map(({ file, args, options }) => ({ file, args, options })), [{
    file: command.file, args: command.args,
    options: { cwd: '/', env: command.env, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] },
  }]);
  assert.ok(f.children.every(handle => handle.kills.length === 0));
});

for (const [field, value] of [
  ['Id', managedUnitName('a'.repeat(32))], ['InvocationID', 'a'.repeat(32)],
  ['ExecMainStartTimestampMonotonic', '1000001'],
]) test(`takeover rejects fresh ${field} mismatch before any stop`, async t => {
  const f = fixture(t); await f.registerAll(); f.setCallerClosed(true);
  f.queue('backend', { ...units.backend.running, [field]: value });
  await assert.rejects(f.observer.containAfterCallerClosed());
  assert.equal(f.stops.length, 0);
});

for (const running of [true, false]) {
  test(`pre-GO caller loss ${running ? 'captures fresh running ownership' : 'rejects terminal-only guessed ownership'}`, async t => {
    const f = fixture(t);
    await assert.rejects(f.register('backend', { ...units.backend.receipt, invocation: 'a'.repeat(32) }), unverified);
    assert.equal(f.observer.readState().registered, 0); f.setCallerClosed(true);
    f.queue('backend', running ? units.backend.running : units.backend.terminal);
    if (running) {
      await f.observer.containAfterCallerClosed();
      assert.deepEqual(f.stops[0].args, managedStopCommand(units.backend.generation).args);
    } else {
      await assert.rejects(f.observer.containAfterCallerClosed()); assert.equal(f.stops.length, 0);
    }
    assert.equal(f.published('backend-go.json'), false);
    assert.equal(f.observer.readState().complete, false);
  });
}

test('caller loss records three passive proofs without live-session release and freshly binds each takeover', async t => {
  const f = fixture(t, 'caller'); await f.registerAll();
  for (const profile of f.selected.profiles) {
    f.arm(profile); f.queue(profile, units[profile].terminal);
    assert.deepEqual(await f.observer.observePassive(profile), units[profile].receipt);
  }
  assert.equal(f.publications.some(([name]) => name.endsWith('-passive.json')), false);
  assert.equal(f.observer.readState().passive, 3); assert.equal(f.stops.length, 0);
  f.setCallerClosed(true);
  for (const profile of f.selected.profiles) f.queue(profile, units[profile].terminal);
  await f.observer.containAfterCallerClosed();
  assert.equal(f.queries.length, 9);
  assert.deepEqual(f.stops.map(({ args }) => args), f.selected.profiles.map(profile =>
    managedStopCommand(units[profile].generation).args));
});

for (const [label, action] of [
  ['nonzero exit', handle => handle.finish(7)],
  ['signal exit', handle => handle.finish(null, 'SIGTERM')],
  ['unexpected stdout', handle => { handle.child.stdout.emit('data', Buffer.from('unexpected')); handle.finish(); }],
  ['unexpected stderr', handle => { handle.child.stderr.emit('data', Buffer.from('unexpected')); handle.finish(); }],
  ['child error', handle => { handle.child.emit('error', new Error('stop error')); handle.finish(); }],
  ['stream error', handle => { handle.child.stderr.emit('error', new Error('stream error')); handle.finish(); }],
]) test(`takeover never treats a fully closed stop with ${label} as success`, async t => {
  const f = fixture(t); await f.registerAll(); f.setCallerClosed(true); f.queue('backend');
  f.stopActions.push(action);
  await assert.rejects(f.observer.containAfterCallerClosed());
  assert.equal(f.stops.length, 1);
  assert.equal(f.published('backend-passive.json'), false);
});

test('fixed stop completion still waits for actual stdout and stderr end/close', async t => {
  const f = fixture(t); await f.registerAll(); f.setCallerClosed(true); f.queue('backend');
  f.stopActions.push(() => {});
  let finished = false;
  const completion = f.observer.containAfterCallerClosed().then(() => { finished = true; });
  await turn();
  const { handle } = f.stops[0];
  handle.exit(); await turn(); assert.equal(finished, false);
  handle.close(); await turn(); assert.equal(finished, false);
  for (const [method, name] of [['endStream', 'stdout'], ['closeStream', 'stdout'], ['endStream', 'stderr']]) {
    handle[method](name); await turn(); assert.equal(finished, false);
  }
  handle.closeStream('stderr'); await completion;
  assert.equal(finished, true);
});

test('an open stop expires on the same cleanup deadline and only its retained direct child is signalled', async t => {
  const f = fixture(t); await f.registerAll(); f.setCallerClosed(true); f.queue('backend');
  f.deadline.beginCleanup(); f.stopActions.push(() => {});
  const rejected = assert.rejects(f.observer.containAfterCallerClosed(), error => error.reason === 'deadlineExceeded');
  await turn(); f.advance(3000); await rejected;
  assert.equal(f.deadline.remaining('wrapper'), 0);
  assert.deepEqual(f.stops[0].handle.kills, ['SIGKILL']);
  assert.equal(f.children.slice(0, -1).some(handle => handle.kills.length > 0), false);
  f.stops[0].handle.finish(null, 'SIGKILL'); await turn();
});

test('stopping admission synchronously refuses new registration and passive queries', async t => {
  const f = fixture(t, 'vite-control'); await f.register('chromium');
  const before = f.events.length;
  f.observer.stopAdmission(); f.observer.stopAdmission();
  await assert.rejects(f.observer.register('backend'), unverified);
  await assert.rejects(f.observer.observePassive('vite'), unverified);
  assert.equal(f.events.length, before);
});

for (const held of ['intent', 'owned']) {
  test(`stopping admission while ${held} is pending refuses later acknowledgement/query/GO`, async t => {
    const f = fixture(t);
    if (held === 'owned') f.record('backend-intent.json').resolve({ generation: units.backend.generation });
    const rejected = assert.rejects(f.observer.register('backend'), unverified);
    await turn(); f.observer.stopAdmission(); f.announce('backend'); await rejected;
    assert.equal(f.queries.length, 0); assert.equal(f.published('backend-go.json'), false);
    assert.equal(f.published('backend-ack.json'), held === 'owned');
  });
}

test('an in-flight registration query must close but cannot grant GO after admission stops', async t => {
  const f = fixture(t); f.announce('backend');
  const plan = f.queue('backend', units.backend.running, false);
  const rejected = assert.rejects(f.observer.register('backend'), unverified);
  await turn(); f.observer.stopAdmission();
  assert.equal(f.gate.pendingCount, 1);
  plan.complete(); await rejected;
  assert.equal(f.gate.pendingCount, 0); assert.equal(f.published('backend-go.json'), false);
  assert.equal(f.observer.readState().complete, false);
});

test('stopping admission while an arm is pending refuses a later passive query', async t => {
  const f = fixture(t); await f.registerAll();
  const rejected = assert.rejects(f.observer.observePassive('backend'), unverified);
  await turn(); f.observer.stopAdmission(); f.arm('backend'); await rejected;
  assert.equal(f.queries.length, 1); assert.equal(f.published('backend-passive.json'), false);
});

test('an in-flight passive query cannot publish a receipt after admission stops', async t => {
  const f = fixture(t); await f.registerAll(); f.arm('backend');
  const plan = f.queue('backend', units.backend.terminal, false);
  const rejected = assert.rejects(f.observer.observePassive('backend'), unverified);
  await turn(); f.observer.stopAdmission(); plan.complete(); await rejected;
  assert.equal(f.observer.readState().passive, 0); assert.equal(f.published('backend-passive.json'), false);
});

test('stopping admission between passive polls prevents the next manager command', async t => {
  const f = fixture(t); await f.registerAll(); f.arm('backend'); f.queue('backend');
  const rejected = assert.rejects(f.observer.observePassive('backend'), unverified);
  await turn(); f.observer.stopAdmission(); f.advance(25); await rejected;
  assert.equal(f.queries.length, 2); assert.equal(f.published('backend-passive.json'), false);
});

test('stopped normal admission permits only caller-closed takeover through fresh internal queries', async t => {
  const f = fixture(t); await f.registerAll(); f.observer.stopAdmission();
  await assert.rejects(f.observer.containAfterCallerClosed(), unverified);
  assert.equal(f.queries.length, 1); assert.equal(f.stops.length, 0);
  f.setCallerClosed(true); f.queue('backend', units.backend.terminal);
  await f.observer.containAfterCallerClosed();
  assert.equal(f.queries.length, 2);
  assert.deepEqual(f.stops[0].args, managedStopCommand(units.backend.generation).args);
  await assert.rejects(f.observer.observePassive('backend'), unverified);
});

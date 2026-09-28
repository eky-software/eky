import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { posix } from 'node:path';
import test from 'node:test';
import { createLinuxConsumerSessionProbe } from './linuxConsumerSessionProbe.mjs';
import { createLinuxConsumerCommandGate } from './linuxConsumerCommandGate.mjs';
import { serviceDeadlines } from './linuxServiceContract.mjs';
import { startLinuxService } from './linuxServiceSession.mjs';
import { captureRunningUnit, managedUnitName, managedUnitProperties } from './managedNamespaceUnitContract.mjs';

const generation = 'a'.repeat(32);
const repositoryRoot = '/original-source/eky';
const unverified = /E2E_LINUX_CONSUMER_LOSS_UNVERIFIED/u;
const turn = () => new Promise(resolve => setImmediate(resolve));
const pending = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};
const running = Object.freeze({
  Id: managedUnitName(generation), InvocationID: 'b'.repeat(32), LoadState: 'loaded', Transient: 'yes',
  ActiveState: 'active', SubState: 'running', Result: 'success', MainPID: '123', ControlPID: '0',
  ControlGroup: `/system.slice/${managedUnitName(generation)}`, ExecMainCode: '0', ExecMainStatus: '0',
  ExecMainStartTimestampMonotonic: '1000000', ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties,
});
const receipt = captureRunningUnit(running, generation);

function fixture(t, { caseId = 'backend-control', profile = 'backend', containmentError,
  holdContainment = false, expireOnArmPublish = false } = {}) {
  let clock = 1_000_000n;
  let serial = 0;
  let managerOptions;
  let serviceDeadline;
  let manager;
  let reply;
  let notifyLost;
  let observationChild;
  const events = [];
  const replies = [];
  const waits = [];
  const timers = new Map();
  const ack = pending(); const observation = pending(); const grant = pending();
  const passive = pending(); const containment = pending(); const commandClosed = pending();
  if (!holdContainment) containment.resolve();
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    timers.set(++serial, { callback, at: clock + BigInt(Math.ceil(milliseconds * 1e6)) });
    return serial;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); });
  const socket = new Socket();
  const destroy = t.mock.method(socket, 'destroy');
  t.after(() => { socket.destroy(); assert.equal(timers.size, 0); });
  const server = new EventEmitter();
  const config = Object.freeze({ profile, generation, repositoryRoot, uid: 1001, gid: 1002,
    root: '/synthetic-temp/eky-managed-ns-ABC123', startUntil: '45001000000', workUntil: '90001000000' });
  const prepared = { config };
  const input = { repositoryRoot };
  const gate = createLinuxConsumerCommandGate({ spawnChild() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => assert.fail('Probe must not own command cleanup');
    observationChild = child;
    return child;
  } });
  const commands = { spawnChild: gate.spawnChild, async drain(deadline, phase) {
    events.push('drain');
    assert.equal(deadline, serviceDeadline); assert.equal(phase, 'ready');
    await gate.drain(deadline, phase); events.push('drained');
  } };
  const publications = [];
  const exchange = { publish(name, value) {
    events.push(name); publications.push([name, value]);
    if (expireOnArmPublish && name === `${profile}-armed.json`) clock += 90_000_000_000n;
  } };
  const ownerOpens = []; const ownerPublications = []; const prepareCalls = [];
  const probe = createLinuxConsumerSessionProbe({ caseId, profile, repositoryRoot, exchange, commands }, {
    prepare(actualProfile, actualInput, options) {
      prepareCalls.push([actualProfile, actualInput, options]); return prepared;
    },
    createManager(actualConfig, deadline, options) {
      assert.equal(actualConfig, config);
      serviceDeadline = deadline; managerOptions = options;
      return {
        async prepare() { events.push('managerPrepare'); },
        async launch() { events.push('managerLaunch'); },
        async own() {
          events.push('managerOwn');
          await options.startCommand({ operation: 'observation', generation, deadline, phase: 'ready',
            spawnChild: options.spawnChild }).result;
          events.push('managerOwned');
        },
        async emergencyStop() {
          events.push('managerEmergency');
          if (containmentError) throw containmentError;
          await containment.promise;
        },
        async observe() { return { waitingWrapper: 'normalExit' }; },
        async settle() { events.push('settle'); },
        mayHaveStarted: () => events.includes('managerLaunch'),
      };
    },
    startCommand(actual) {
      assert.equal(actual.spawnChild, gate.spawnChild);
      actual.spawnChild('synthetic-manager');
      return { result: observation.promise, closed: commandClosed.promise };
    },
    waitRecord(actualExchange, name, deadline, phase) {
      assert.equal(actualExchange, exchange); assert.equal(deadline, serviceDeadline);
      events.push(`wait:${name}`); waits.push({ name, deadline, phase });
      const record = name.endsWith('-ack.json') ? ack : name.endsWith('-go.json') ? grant : passive;
      return record.promise;
    },
    listen(actualPrepared, deadline, onReply, onLost, options) {
      assert.equal(actualPrepared, prepared); assert.equal(deadline, serviceDeadline);
      reply = onReply; notifyLost = onLost;
      const listener = options.createListener({ allowHalfOpen: true, pauseOnConnect: true });
      assert.equal(listener, server);
      server.on('connection', channel => channel.once('close', onLost));
      return control;
    },
    createListener(options) {
      assert.deepEqual(options, { allowHalfOpen: true, pauseOnConnect: true }); return server;
    },
    openExchange(options) {
      ownerOpens.push(options);
      return { publish(name, value) { options.records[0].validate(value); ownerPublications.push([name, value]); } };
    },
  });
  const control = {
    opened: Promise.resolve(), ready: Promise.resolve(), closed: Promise.resolve(),
    async request(type) {
      events.push(type);
      const value = { state: 'running', spawned: true, stdout: '', stderr: '', rssBytes: null };
      reply(value); return value;
    },
    verifyClosed() {},
    async dispose() { events.push('dispose'); },
  };
  const bind = () => {
    probe.dependencies.prepare(profile, input);
    manager = probe.dependencies.createManager(config, serviceDeadlines(config, () => clock));
    probe.dependencies.listen(prepared, serviceDeadline, value => replies.push(value), () => { events.push('lost'); });
    server.emit('connection', socket);
  };
  const closeCommand = () => {
    observationChild.emit('spawn'); observationChild.emit('exit', 0, null);
    for (const stream of [observationChild.stdout, observationChild.stderr]) {
      stream.emit('end'); stream.emit('close');
    }
    observationChild.emit('close', 0, null); commandClosed.resolve();
  };
  return { probe, events, replies, waits, publications, ownerOpens, ownerPublications, prepareCalls,
    prepared, input, config, commands, ack, observation, grant, passive, containment, socket, destroy, bind, closeCommand,
    get manager() { return manager; }, get managerOptions() { return managerOptions; },
    get deadline() { return serviceDeadline; },
    notifyLost: () => notifyLost(),
    notifyReply: value => reply(value),
    advance(milliseconds) {
      clock += BigInt(milliseconds) * 1_000_000n;
      for (const [id, timer] of [...timers]) if (timer.at <= clock && timers.delete(id)) timer.callback();
    },
    async ready(reportRunning = true) {
      bind(); ack.resolve({ generation }); await manager.prepare();
      const owning = manager.own(); observation.resolve(running); closeCommand();
      grant.resolve(receipt); await owning;
      if (reportRunning) {
        reply({ state: 'running', spawned: true, stdout: '', stderr: '', rssBytes: null });
        probe.requireHealthy();
      }
    },
    startSession() {
      return startLinuxService(profile, input, { ...probe.dependencies,
        preflight: async () => {}, now: () => clock, time: globalThis,
        listen(...args) {
          const result = probe.dependencies.listen(...args); server.emit('connection', socket); return result;
        },
        removeControl() { events.push('removeControl'); }, reportFailure() {},
      });
    },
  };
}

test('real session holds prepare for intent acknowledgement and GO for captured, closed commands and grant', async t => {
  const f = fixture(t);
  const started = f.startSession();
  await turn();
  assert.deepEqual(f.events, ['backend-intent.json', 'wait:backend-ack.json']);
  f.ack.resolve({ generation });
  await turn();
  assert.ok(f.events.includes('managerPrepare'));
  assert.ok(f.events.includes('managerOwn'));
  assert.ok(!f.events.includes('go'));
  f.observation.resolve(running);
  await turn();
  assert.deepEqual(f.probe.readState().receipt, receipt);
  assert.ok(f.events.includes('drain'));
  assert.ok(!f.events.includes('backend-owned.json'));
  f.closeCommand();
  await turn();
  assert.ok(f.events.includes('backend-owned.json'));
  assert.ok(!f.events.includes('go'));
  f.grant.resolve(receipt);
  const service = await started;
  assert.ok(f.events.indexOf('drained') < f.events.indexOf('backend-owned.json'));
  assert.ok(f.events.indexOf('wait:backend-go.json') < f.events.indexOf('go'));
  assert.ok(f.waits.every(call => call.deadline === f.deadline && call.phase === 'ready'));
  await service.stop();
});

for (const [caseId, profile, basename] of [
  ['backend-owner', 'backend', 'linuxConsumerLossInit.mjs'],
  ['vite-owner', 'vite', 'linuxConsumerLossInit.mjs'],
  ['chromium-owner', 'chromium', 'linuxConsumerLossInit.mjs'],
  ['backend-control', 'backend', 'linuxServiceInit.mjs'],
  ['vite-control', 'vite', 'linuxServiceInit.mjs'],
  ['chromium-control', 'chromium', 'linuxServiceInit.mjs'],
  ['vite-owner', 'backend', 'linuxServiceInit.mjs'],
  ['caller', 'backend', 'linuxServiceInit.mjs'],
]) {
  test(`${caseId}/${profile} forwards the same ORIGINAL source init path to prepare and manager`, t => {
    const f = fixture(t, { caseId, profile }); f.bind();
    const expected = posix.join(repositoryRoot, 'apps/e2e/experiments/processOwnership', basename);
    assert.equal(f.prepareCalls[0][1], f.input);
    assert.equal(f.prepareCalls[0][2].initPath, expected);
    assert.equal(f.managerOptions.initPath, expected);
    assert.equal(f.managerOptions.spawnChild, f.commands.spawnChild);
  });
}

test('wrong acknowledgement generation refuses manager preparation', async t => {
  const f = fixture(t); f.bind();
  const preparing = f.manager.prepare(); f.ack.resolve({ generation: 'c'.repeat(32) });
  await assert.rejects(preparing, unverified);
  assert.ok(!f.events.includes('managerPrepare'));
});

test('a foreign running observation cannot become an owned receipt', async t => {
  const f = fixture(t); f.bind();
  const owning = f.manager.own();
  f.observation.resolve({ ...running, Id: managedUnitName('c'.repeat(32)) }); f.closeCommand();
  await assert.rejects(owning);
  assert.equal(f.probe.readState().receipt, undefined);
  assert.ok(!f.events.includes('backend-owned.json'));
  assert.ok(!f.waits.some(call => call.name.endsWith('-go.json')));
});

for (const field of ['generation', 'unit', 'invocation', 'started']) {
  test(`mismatched GO ${field} refuses ownership completion`, async t => {
    const f = fixture(t); f.bind();
    const owning = f.manager.own(); f.observation.resolve(running); f.closeCommand();
    f.grant.resolve({ ...receipt, [field]: field === 'started' ? '2000000' : 'c'.repeat(32) });
    await assert.rejects(owning, unverified);
  });
}

test('only affected armed stop waits for its passive receipt before delegating containment', async t => {
  const f = fixture(t, { holdContainment: true }); await f.ready(); f.probe.arm();
  f.deadline.beginCleanup();
  const stopping = f.manager.emergencyStop();
  assert.equal(f.waits.at(-1).deadline, f.deadline);
  assert.equal(f.waits.at(-1).phase, 'wrapper');
  assert.ok(!f.events.includes('managerEmergency'));
  f.advance(1200); f.passive.resolve(receipt);
  await turn();
  assert.ok(f.events.includes('managerEmergency'));
  assert.equal(f.probe.readState().passive, true);
  assert.equal(f.deadline.remaining('wrapper'), 1800);
  assert.ok(!f.events.includes('settle'));
  f.containment.resolve(); await stopping;
});

for (const mode of ['wrongReceipt', 'rejectedReceipt', 'expiredReceipt']) {
  test(`${mode} stays failed while still delegating emergency containment`, async t => {
    const containmentError = new Error('synthetic containment failure');
    const f = fixture(t, { containmentError }); await f.ready(); f.probe.arm(); f.deadline.beginCleanup();
    const stopping = f.manager.emergencyStop();
    const first = new Error('synthetic missing passive proof');
    if (mode === 'wrongReceipt') f.passive.resolve({ ...receipt, generation: 'c'.repeat(32) });
    else if (mode === 'rejectedReceipt') f.passive.reject(first);
    else { f.advance(3000); f.passive.resolve(receipt); }
    await assert.rejects(stopping, error => {
      assert.notEqual(error, containmentError);
      if (mode === 'rejectedReceipt') assert.equal(error, first);
      return true;
    });
    assert.ok(f.events.includes('managerEmergency'));
    assert.equal(f.probe.readState().gateFailed, true);
    assert.equal(f.probe.readState().passive, false);
    if (mode === 'expiredReceipt') assert.equal(f.deadline.remaining('wrapper'), 0);
  });
}

for (const mode of ['healthy', 'prearm']) {
  test(`${mode} service delegates containment without passive gating`, async t => {
    const f = fixture(t, mode === 'healthy' ? { caseId: 'vite-control', profile: 'backend' } : {});
    await f.ready(); await f.manager.emergencyStop();
    assert.ok(f.events.includes('managerEmergency'));
    assert.ok(!f.waits.some(call => call.name.endsWith('-passive.json')));
    if (mode === 'healthy') assert.throws(() => f.probe.arm(), unverified);
  });
}

test('control arm destroys the captured socket; loss arrives from its close event, not a synthetic callback', async t => {
  const f = fixture(t); await f.ready();
  const arm = f.probe.arm();
  assert.equal(arm.cause, 'control'); assert.equal(f.destroy.mock.callCount(), 1);
  assert.equal(f.socket.destroyed, true);
  assert.equal(f.probe.readState().lost, false);
  assert.ok(!f.events.includes('lost'));
  await turn();
  assert.equal(f.probe.readState().lost, true);
  assert.deepEqual(f.ownerOpens, []);
  assert.throws(() => f.probe.arm(), unverified);
});

test('a live socket and owned unit do not imply the actual workload has started', async t => {
  const f = fixture(t); await f.ready(false);
  assert.equal(f.socket.destroyed, false);
  assert.throws(() => f.probe.requireHealthy(), unverified);
  for (const value of [{ state: 'pending', spawned: false }, { state: 'running', spawned: false }]) {
    f.notifyReply(value);
    assert.equal(f.replies.at(-1), value);
    assert.throws(() => f.probe.requireHealthy(), unverified);
  }
  f.notifyReply({ state: 'running', spawned: true });
  f.probe.requireHealthy();
  assert.equal(f.destroy.mock.callCount(), 0);
});

for (const [label, terminal] of [
  ['exited', { state: 'exited', spawned: true }],
  ['spawn failure', { state: 'unavailable', spawned: false }],
  ['unavailable after spawn', { state: 'unavailable', spawned: true }],
]) test(`${label} is sticky health failure even with a live socket and a later running reply`, async t => {
  const f = fixture(t); await f.ready();
  f.notifyReply(terminal);
  assert.equal(f.replies.at(-1), terminal);
  assert.throws(() => f.probe.requireHealthy(), unverified);
  f.notifyReply({ state: 'running', spawned: true });
  assert.equal(f.socket.destroyed, false);
  assert.equal(f.probe.readState().lost, false);
  assert.throws(() => f.probe.requireHealthy(), unverified);
  assert.throws(() => f.probe.arm(), unverified);
  assert.equal(f.destroy.mock.callCount(), 0);
  assert.ok(!f.publications.some(([name]) => name.endsWith('-armed.json')));
});

for (const cause of ['control', 'owner', 'caller']) {
  test(`${cause} arm rechecks the original deadline after publishing before fault delivery`, async t => {
    const f = fixture(t, { caseId: cause === 'caller' ? 'caller' : `backend-${cause}`,
      expireOnArmPublish: true });
    await f.ready();
    assert.throws(() => f.probe.arm(), error => error.reason === 'startupDeadlineExceeded');
    assert.ok(f.publications.some(([name]) => name === 'backend-armed.json'));
    assert.equal(f.deadline.remaining('work'), 0);
    assert.equal(f.destroy.mock.callCount(), 0);
    assert.equal(f.socket.destroyed, false);
    assert.deepEqual(f.ownerOpens, []);
  });
}

test('owner arm publishes the fixed, generation-bound record without destroying the socket', async t => {
  const f = fixture(t, { caseId: 'backend-owner' }); await f.ready();
  const arm = f.probe.arm();
  assert.ok(Object.isFrozen(arm));
  assert.equal(f.ownerOpens.length, 1);
  const options = f.ownerOpens[0];
  assert.equal(options.root, f.config.root);
  assert.deepEqual(options.identity, { uid: 1001, gid: 1002 });
  assert.equal(options.nonce, generation); assert.equal(options.role, 'caller');
  assert.equal(options.caseId, 'backend-owner');
  assert.equal(options.serviceRoot, true);
  assert.deepEqual(f.ownerPublications, [['armed.json', arm]]);
  assert.throws(() => options.records[0].validate({ ...arm, generation: 'c'.repeat(32) }), unverified);
  assert.equal(f.destroy.mock.callCount(), 0);
});

for (const profile of ['backend', 'vite', 'chromium']) {
  test(`caller arm for ${profile} leaves the control socket intact`, async t => {
    const f = fixture(t, { caseId: 'caller', profile }); await f.ready();
    assert.equal(f.probe.arm().cause, 'caller');
    assert.equal(f.destroy.mock.callCount(), 0);
    assert.equal(f.probe.readState().lost, false);
    assert.deepEqual(f.ownerOpens, []);
  });
}

test('foreign repository and prepared/deadline identities refuse before delegation', t => {
  const f = fixture(t);
  assert.throws(() => f.probe.dependencies.prepare('backend', { repositoryRoot: '/relocated/output' }), unverified);
  assert.deepEqual(f.prepareCalls, []);
  f.bind();
  assert.throws(() => f.probe.dependencies.createManager({ ...f.config }, f.deadline), unverified);
  assert.throws(() => f.probe.dependencies.listen({ ...f.prepared }, f.deadline, () => {}, () => {}), unverified);
});

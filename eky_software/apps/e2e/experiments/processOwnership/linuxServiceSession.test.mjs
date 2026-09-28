import assert from 'node:assert/strict';
import test from 'node:test';
import { startLinuxService, OwnedLinuxServiceStartupFailure } from './linuxServiceSession.mjs';
import { serviceFailure } from './linuxServiceContract.mjs';

const generation = 'a'.repeat(32);
const pending = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };
const snapshot = state => ({ state, spawned: state !== 'pending', stdout: 'synthetic output\n', stderr: '', rssBytes: null });

function fixture(options = {}) {
  let clock = 1_000_000n;
  let serial = 0;
  const timers = new Map();
  const time = { setTimeout(callback, milliseconds) { timers.set(++serial,
    { callback, at: clock + BigInt(Math.ceil(milliseconds * 1e6)) }); return serial; },
  clearTimeout(id) { timers.delete(id); } };
  const events = [];
  const diagnostics = [];
  const channelClose = pending();
  let reply;
  let lost;
  let attempted = false;
  let owned = false;
  const manager = {
    async prepare() { events.push('prepare'); if (options.policyFailure) throw serviceFailure('preparationFailed'); },
    async launch() { attempted = true; events.push('launch'); },
    async own() { events.push('own'); if (options.ownershipFailure) throw serviceFailure('observationLost'); owned = true; },
    async observe() { events.push('observe'); assert.equal(owned, true);
      if (options.wrapperFailure) throw serviceFailure('cleanupUnverified');
      return { waitingWrapper: 'normalExit' }; },
    async emergencyStop() { events.push('emergency'); },
    async settle() { events.push('commandsClosed'); },
    mayHaveStarted: () => attempted,
  };
  const control = {
    opened: Promise.resolve(), ready: Promise.resolve(), closed: channelClose.promise,
    async request(type) {
      events.push(type);
      if (type === 'go') {
        assert.equal(owned, true);
        const value = snapshot(options.earlyExit ? 'exited' : 'running'); reply(value); return value;
      }
      if (type === 'stop') {
        if (options.stopFailure) throw serviceFailure('cleanupUnverified');
        const value = snapshot(options.rootFirst || options.cleanupExit ? 'exited' : 'running'); reply(value);
        if (!options.holdClose) channelClose.resolve();
        return value;
      }
      if (options.readFailure) { lost(); throw serviceFailure('observationLost'); }
      const value = { ...snapshot(options.rootFirst ? 'exited' : 'running'), rssBytes: type === 'rss' ? 4096 : null };
      reply(value);
      if (options.exitAfterSnapshot) reply(snapshot('exited'));
      return value;
    },
    verifyClosed() { events.push('controlVerified'); if (options.controlFailure) throw serviceFailure('cleanupUnverified'); },
    dispose() { events.push('dispose'); channelClose.resolve(); return channelClose.promise; },
  };
  const input = { lifetime: { readRemainingWorkMilliseconds: () => 90_000 }, startupDeadline: 45_001 };
  const overrides = {
    prepare(profile, actual) {
      assert.equal(actual.lifetime, input.lifetime);
      events.push(profile);
      if (options.preparationCleanupFailure) throw Object.assign(serviceFailure('preparationFailed'),
        { preparationCleanupUnverified: true });
      return { config: { generation, startUntil: '45001000000', workUntil: '90001000000',
        ...(profile === 'chromium' ? { runRoot: '/tmp/eky-e2e/run-synthetic', browserGeneration: 'b'.repeat(64) } : {}) } };
    },
    preflight: async () => { events.push('preflight'); },
    createManager: () => manager,
    listen(prepared, deadline, onReply, onLost) { reply = onReply; lost = onLost; return control; },
    removeControl() { events.push('removeControl'); }, now: () => clock, time,
    reportFailure(value) { diagnostics.push(value); if (options.reportFailure) throw new Error('synthetic reporter failure'); },
  };
  return { events, diagnostics, input, overrides, channelClose, timers,
    start: () => startLinuxService(options.profile ?? 'backend', input, overrides),
    lost: () => lost(), reply: value => reply(value),
    advance(milliseconds) {
      clock += BigInt(milliseconds) * 1_000_000n;
      for (const [id, timer] of [...timers]) if (timer.at <= clock && timers.delete(id)) timer.callback();
    },
  };
}

test('live backend and Vite preserve workload API and require ownership before GO', async () => {
  for (const profile of ['backend', 'vite']) {
    const f = fixture({ profile }); const service = await f.start();
    assert.match(service.workload.instanceId, /^[a-f0-9-]{36}$/u);
    assert.notEqual(service.workload.instanceId, generation);
    const instanceId = service.workload.instanceId;
    assert.equal(await service.workload.readState(), 'running');
    assert.equal(await service.workload.readRssBytes(), 4096);
    assert.equal(service.workload.instanceId, instanceId);
    assert.equal(service.startup.readState().spawnObserved, true);
    assert.equal(service.startup.readState().terminal, undefined);
    assert.equal(service.readStdout(), 'synthetic output\n');
    assert.ok(f.events.indexOf('own') < f.events.indexOf('go'));
    assert.ok(!f.events.includes('removeControl'));
    await service.stop(); assert.equal(await service.workload.readState(), 'exited');
    assert.deepEqual(f.events.slice(-3), ['observe', 'commandsClosed', 'removeControl']);
    assert.equal(f.timers.size, 0);
  }
});

test('repeated stop shares one promise and waits actual control close before manager proof', async () => {
  const f = fixture({ holdClose: true }); const service = await f.start();
  const first = service.stop(); assert.equal(service.stop(), first);
  let finished = false; void first.then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false); assert.ok(!f.events.includes('observe'));
  f.channelClose.resolve(); await first;
  assert.equal(f.events.filter(value => value === 'stop').length, 1);
  assert.equal(service.stop(), first);
});

test('root-first is a workload exit, never sufficient cleanup evidence', async () => {
  const f = fixture({ rootFirst: true, wrapperFailure: true }); const service = await f.start();
  assert.equal(await service.workload.readState(), 'exited');
  assert.equal(service.startup.readState().terminal, 'exited');
  await assert.rejects(service.stop(), error => {
    assert.ok(error instanceof OwnedLinuxServiceStartupFailure);
    assert.equal(error.evidence.exitedBeforeCleanup, true);
    assert.equal(error.evidence.processTree, 'unverified'); return true;
  });
  assert.ok(f.events.includes('emergency')); assert.ok(!f.events.includes('removeControl'));
});

test('early workload exit keeps original failure after verified cleanup', async () => {
  const f = fixture({ earlyExit: true });
  await assert.rejects(f.start(), error => {
    assert.deepEqual(error.evidence, { spawnObserved: true, exitedBeforeCleanup: true,
      processTree: 'stopped', startupFailure: 'workloadExited' }); return true;
  });
  assert.ok(f.events.includes('removeControl'));
});

test('cleanup exit never overwrites the original pre-cleanup workload observation', async () => {
  const f = fixture({ cleanupExit: true }); const service = await f.start();
  const observed = []; service.startup.subscribe(value => observed.push(value));
  await service.stop();
  assert.equal(service.startup.readState().terminal, undefined);
  assert.equal(observed.some(value => value.terminal === 'exited'), false);
});

test('owner loss is sticky, starts bounded cleanup and cannot become a fresh successful stop', async () => {
  const f = fixture(); const service = await f.start();
  f.lost();
  assert.equal(service.startup.readState().terminal, 'observationLost');
  assert.equal(await service.workload.readState(), 'unavailable');
  const first = service.stop();
  await assert.rejects(first, error => error.evidence.processTree === 'unverified' &&
    error.evidence.startupFailure === 'observationLost');
  f.reply(snapshot('running'));
  assert.equal(service.stop(), first);
  assert.ok(!f.events.includes('removeControl'));
  assert.ok(!f.events.includes('stop'));
});

test('manager or control failures never authorize control-root deletion', async () => {
  for (const options of [{ wrapperFailure: true }, { controlFailure: true }, { stopFailure: true }]) {
    const f = fixture(options); const service = await f.start();
    await assert.rejects(service.stop(), error => error.evidence.processTree === 'unverified');
    assert.ok(!f.events.includes('removeControl'));
    assert.equal(f.timers.size, 0);
  }
});

test('missing ownership forbids GO and remains unverified despite emergency stop acceptance', async () => {
  const f = fixture({ ownershipFailure: true });
  await assert.rejects(f.start(), error => error.evidence.processTree === 'unverified');
  assert.ok(!f.events.includes('go')); assert.ok(!f.events.includes('removeControl'));
});

test('prelaunch policy failure distinguishes no workload from launched uncertainty', async () => {
  const f = fixture({ policyFailure: true });
  await assert.rejects(f.start(), error => error.evidence.processTree === 'stopped' &&
    error.evidence.spawnObserved === false && error.evidence.startupFailure === 'preparationFailed');
  assert.ok(!f.events.includes('launch')); assert.ok(f.events.includes('commandsClosed'));
  assert.deepEqual(f.diagnostics, [{ schemaVersion: 1, profile: 'backend', phase: 'managerPrepare',
    causeReason: 'preparationFailed', causeStage: 'unverified',
    startupFailure: 'preparationFailed', spawnObserved: false, processTree: 'stopped' }]);
});

test('safe startup diagnostics preserve the original failure when reporting fails', async () => {
  const f = fixture({ earlyExit: true, reportFailure: true });
  await assert.rejects(f.start(), error => error instanceof OwnedLinuxServiceStartupFailure &&
    error.evidence.startupFailure === 'workloadExited' && error.evidence.processTree === 'stopped');
  assert.deepEqual(f.diagnostics, [{ schemaVersion: 1, profile: 'backend', phase: 'workloadStart',
    causeReason: 'workloadExited', causeStage: 'unverified',
    startupFailure: 'workloadExited', spawnObserved: true, processTree: 'stopped' }]);
  assert.ok(f.events.includes('removeControl'));
});

test('original lifetime expiry triggers failure without renewing stop or fixture deadlines', async () => {
  const f = fixture({ holdClose: true }); const service = await f.start();
  f.advance(90_000);
  const first = service.stop();
  await new Promise(resolve => setImmediate(resolve));
  f.advance(3000);
  await assert.rejects(first, error => error.evidence.startupFailure === 'startupDeadlineExceeded' &&
    error.evidence.processTree === 'unverified');
  assert.equal(service.stop(), first); assert.ok(!f.events.includes('removeControl'));
});

test('startup observer does not substitute owner state and freezes its first terminal event', async () => {
  const f = fixture(); const service = await f.start();
  const seen = []; const unsubscribe = service.startup.subscribe(value => seen.push(value));
  f.reply(snapshot('exited')); f.lost(); unsubscribe();
  assert.equal(seen.length, 1); assert.equal(seen[0].terminal, 'exited');
  await assert.rejects(service.stop());
});

test('read failures expose unavailable rather than invented zero RSS or a healthy root', async () => {
  const f = fixture({ readFailure: true }); const service = await f.start();
  assert.equal(await service.workload.readState(), 'unavailable');
  await assert.rejects(service.workload.readRssBytes());
  await assert.rejects(service.stop());
});

test('an exit following a running snapshot wins over stale state and RSS delivery', async () => {
  const f = fixture({ exitAfterSnapshot: true }); const service = await f.start();
  assert.equal(await service.workload.readState(), 'exited');
  await assert.rejects(service.workload.readRssBytes());
  await service.stop();
});

test('backend and Vite RSS facade errors stay profile-specific after stop and observation loss', async () => {
  for (const profile of ['backend', 'vite']) for (const lost of [false, true]) {
    const f = fixture({ profile }); const service = await f.start();
    if (lost) { f.lost(); await assert.rejects(service.stop()); }
    else await service.stop();
    await assert.rejects(service.workload.readRssBytes(), {
      message: profile === 'backend' ? 'E2E_BACKEND_RSS_UNAVAILABLE' : 'E2E_VITE_RSS_UNAVAILABLE',
    });
  }
});

test('failed preparation rollback remains unverified without a manager or workload', async () => {
  const f = fixture({ preparationCleanupFailure: true });
  await assert.rejects(f.start(), error => error.evidence.processTree === 'unverified' &&
    error.evidence.startupFailure === 'preparationFailed' && !error.evidence.spawnObserved);
  assert.deepEqual(f.events, ['backend']);
});

test('Chromium connection owner uses the original ready/work/cleanup clock and separate browser nonce', async () => {
  const f = fixture({ profile: 'chromium', holdClose: true }); const service = await f.start();
  const owner = service.connectionOwner;
  assert.equal(owner.generation, 'b'.repeat(64)); assert.notEqual(owner.generation, generation);
  assert.equal(owner.readyPath, '/tmp/eky-e2e/run-synthetic/chromium-browser-' + 'b'.repeat(64) + '/chromium-ready.json');
  assert.equal(owner.readStartupRemainingMilliseconds(), 45000);
  f.advance(12000); assert.equal(owner.readStartupRemainingMilliseconds(), 33000);
  assert.equal(await owner.beforeStartupDeadline(Promise.resolve('ready')), 'ready');
  const stop = owner.stop(); assert.equal(service.stop(), stop);
  assert.equal(owner.readCleanupRemainingMilliseconds(), 3000);
  f.advance(500); assert.equal(owner.readCleanupRemainingMilliseconds(), 2500);
  assert.throws(owner.requireStartupOpen);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(owner.readCleanupEvidence(), { processTree: 'unverified', firstFailure: null });
  f.channelClose.resolve(); await stop;
  assert.deepEqual(owner.readCleanupEvidence(), { processTree: 'stopped', firstFailure: null });
  assert.equal(owner.stop(), stop);
  assert.equal(owner.readCleanupRemainingMilliseconds(), 2500);
});

test('Chromium ready deadline rejection does not renew cleanup and preserves the first failure', async () => {
  const f = fixture({ profile: 'chromium' }); const service = await f.start();
  const operation = pending(); const result = service.connectionOwner.beforeStartupDeadline(operation.promise);
  void result.catch(() => {});
  f.advance(45000);
  await assert.rejects(result);
  operation.resolve('too late');
  await assert.rejects(service.stop());
  assert.deepEqual(service.connectionOwner.readCleanupEvidence(), {
    processTree: 'stopped', firstFailure: 'startupDeadlineExceeded',
  });
  assert.equal(service.connectionOwner.readCleanupRemainingMilliseconds(), 3000);
});

test('Chromium pending connection rejects on real owner/workload loss and never invents stopped proof', async () => {
  for (const exited of [false, true]) {
    const f = fixture({ profile: 'chromium', wrapperFailure: true }); const service = await f.start();
    const pendingConnection = service.connectionOwner.beforeStartupDeadline(new Promise(() => {}));
    void pendingConnection.catch(() => {});
    if (exited) f.reply(snapshot('exited')); else f.lost();
    await assert.rejects(pendingConnection);
    await assert.rejects(service.stop());
    assert.deepEqual(service.connectionOwner.readCleanupEvidence(), { processTree: 'unverified',
      firstFailure: exited ? 'workloadExited' : 'observationLost' });
    assert.ok(!f.events.includes('removeControl'));
  }
});

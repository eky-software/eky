import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { readConsumerFailurePhase, runLinuxConsumerLossCase } from './runLinuxConsumerLossCase.mjs';
import { consumerLossCase, linuxConsumerLossCases } from './linuxConsumerLossContract.mjs';
import { waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';
import { childEnvironment, waitWithin } from './pidNamespaceContract.mjs';
import { streamLimit } from './adapterContract.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const pending = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};
const paths = Object.freeze({ root: '/synthetic-temp/eky-managed-ns-ABC123',
  auxiliary: '/synthetic-temp/eky-e2e/run-auxiliary', test: '/synthetic-temp/eky-e2e/run-test',
  worker: '/synthetic-temp/eky-e2e/run-worker',
  admission: '/synthetic-temp/eky-e2e/run-auxiliary/admission',
  marker: '/synthetic-temp/eky-e2e/run-auxiliary/admission/.eky-chromium-worker-pending.json' });
const identity = Object.freeze({ uid: 1001, gid: 1002 });
const directory = ino => ({ dev: 1, ino, ...identity, mode: 0o40700,
  isDirectory: () => true, isSymbolicLink: () => false });

function outcome(caseId, context) {
  const { profile, profiles } = consumerLossCase(caseId);
  const backend = profile === 'backend'; const vite = profile === 'vite';
  return { caseId, bodyPreserved: true, passive: true, commandsClosed: true,
    refusal: backend ? 'backendRestart' : vite ? 'cachedViteStop' : 'chromiumReplacement',
    launches: Object.fromEntries(profiles.map(value => [value, 1])),
    fixtureCleanup: { context: backend ? 'notStarted' : context, api: 'completed',
      web: backend ? 'notStarted' : vite ? 'failed' : 'completed', backend: backend ? 'failed' : 'completed',
      webPort: backend ? 'notStarted' : 'completed', backendPort: 'completed', artifacts: 'completed',
      priorCleanup: backend ? 'unverified' : 'verified',
      runRoot: backend || vite || context === 'failed' ? 'retained' : 'removed' },
    workerCleanup: backend ? null : { schemaVersion: 1, operation: 'chromiumWorker', phase: 'workerTeardown',
      ownerFailure: null, cleanup: vite ? 'verified' : 'unverified', workerRoot: vite ? 'removed' : 'retained' } };
}

function retainedChild(events, name) {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const kills = []; const ended = new Set(); const closedStreams = new Set();
  let exited = false; let closed = false;
  Object.defineProperty(child, 'pid', { get() { assert.fail('No PID authority'); } });
  const handle = { child, kills, closeOnKill: true,
    exit(code = 0, signal = null) {
      if (!exited) { exited = true; events.push(`${name}:exit`); child.emit('exit', code, signal); }
    },
    close(code = 0, signal = null) {
      if (!closed) { closed = true; events.push(`${name}:close`); child.emit('close', code, signal); }
    },
    streams() {
      for (const stream of ['stdout', 'stderr']) {
        if (!ended.has(stream)) { ended.add(stream); child[stream].emit('end'); }
        if (!closedStreams.has(stream)) { closedStreams.add(stream); child[stream].emit('close'); }
      }
    },
    finish(code = 0, signal = null) { handle.exit(code, signal); handle.streams(); handle.close(code, signal); },
  };
  child.kill = signal => {
    kills.push(signal); events.push(`${name}:kill`);
    if (handle.closeOnKill) queueMicrotask(() => handle.finish(null, signal));
    return true;
  };
  queueMicrotask(() => child.emit('spawn'));
  return handle;
}

function fixture(t, caseId = 'backend-control', context = 'completed') {
  const selected = consumerLossCase(caseId);
  const events = []; const hooks = {}; const spawns = []; const children = []; const timers = new Map();
  const files = new Map([[paths.test, directory(3)], [paths.worker, directory(4)], [paths.marker, {}]]);
  const registered = []; const passive = []; const passiveWaits = new Map();
  let clock = 1_000_000n; let serial = 0; let observerOptions; let exchangeOptions; let caller;
  let admissionClosed = false;
  const runtime = { execPath: '/synthetic/node' };
  const ready = { testRoot: paths.test, workerRoot: selected.profile === 'backend' ? null : paths.worker,
    admissionDirectory: selected.profile === 'backend' ? null : paths.admission };
  const result = selected.cause === 'caller' ? null : outcome(caseId, context);
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    timers.set(++serial, { callback, at: clock + BigInt(Math.ceil(milliseconds * 1e6)) }); return serial;
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); });
  t.mock.method(process, 'kill', () => assert.fail('No process/group signalling'));
  const fs = {
    realpathSync: path => path,
    lstatSync(path) {
      const value = files.get(path);
      if (value) return value;
      throw Object.assign(new Error('Synthetic absent path'), { code: 'ENOENT' });
    },
    existsSync: path => files.has(path),
    mkdtempSync(prefix) {
      assert.equal(prefix, '/synthetic-temp/eky-managed-ns-');
      events.push('root'); files.set(paths.root, directory(1)); return paths.root;
    },
    rmSync() { assert.fail('Outer driver must not delete fixture roots or evidence'); },
    unlinkSync() { assert.fail('Outer driver must not release worker admission'); },
  };
  const consumed = new Set();
  const exchange = {
    read(name) {
      assert.ok(['ready.json', 'result.json'].includes(name));
      return name === 'ready.json' ? ready : result;
    },
    consume(name) {
      assert.ok(!consumed.has(name)); consumed.add(name); events.push(name);
      const value = exchange.read(name);
      exchangeOptions.records.find(record => record.name === name).validate(value);
      return value;
    },
    publish(name, value) {
      assert.equal(name, 'grant.json'); assert.deepEqual(value, { caseId });
      assert.deepEqual(registered, selected.profiles);
      events.push('grant'); hooks.grant?.();
    },
  };
  const input = { caseId, repositoryRoot: '/original-source', actorEntry: '/emitted/linuxConsumerLossActor.mjs',
    config: { timeout: 1000, globalTimeout: 2000, workers: 1 },
    createRunRoot() { events.push('auxiliary'); files.set(paths.auxiliary, directory(2)); return paths.auxiliary; } };
  const deps = { runtime, fs, tempDirectory: () => '/synthetic-temp', now: () => clock, time: globalThis,
    nonce: () => 'a'.repeat(32),
    guard(actual) { assert.equal(actual, runtime); events.push('guard'); hooks.guard?.(); return identity; },
    spawnChild(file, args, options) {
      const name = file === runtime.execPath ? 'caller' : 'command';
      const handle = retainedChild(events, name); children.push(handle); spawns.push({ file, args, options });
      if (name === 'caller') { assert.equal(caller, undefined); caller = handle; }
      return handle.child;
    },
    openExchange(options) {
      exchangeOptions = options; assert.equal(options.root, paths.root); assert.equal(options.role, 'observer');
      assert.equal(options.caseId, caseId); assert.deepEqual(options.identity, identity);
      assert.equal(options.nonce, 'a'.repeat(32)); assert.notEqual(options.serviceRoot, true);
      return exchange;
    },
    waitRecord(actualExchange, name, deadline, phase, time) {
      assert.equal(actualExchange, exchange); assert.equal(deadline, observerOptions.deadline);
      assert.equal(time, globalThis); assert.equal(phase, name === 'ready.json' ? 'work' : 'wrapper');
      return waitConsumerLossRecord(exchange, name, deadline, phase, time);
    },
    createObserver(options) {
      observerOptions = options; assert.equal(options.caseId, caseId); assert.equal(options.exchange, exchange);
      return {
        stopAdmission() { admissionClosed = true; events.push('stopAdmission'); },
        async register(profile) {
          events.push(`register:${profile}`); await hooks.register?.(profile);
          events.push(`registeredTaskSettled:${profile}`);
          if (admissionClosed) throw new Error('Synthetic stopped registration');
          registered.push(profile);
        },
        async observePassive(profile) {
          events.push(`observe:${profile}`);
          const record = pending(); passiveWaits.set(profile, record);
          await waitWithin(record.promise, options.deadline, 'wrapper');
          events.push(`passiveTaskSettled:${profile}`);
          if (admissionClosed) throw new Error('Synthetic stopped passive observation');
          passive.push(profile); events.push(`passive:${profile}`);
        },
        async containAfterCallerClosed() {
          assert.equal(options.callerClosed(), true, 'No competing cleanup while caller is live');
          events.push('takeover'); options.deadline.check('wrapper'); await hooks.takeover?.();
        },
        readState: () => ({ registered: registered.length, passive: passive.length,
          complete: registered.length === selected.profiles.length }),
      };
    },
    startSentinel(options, dependencies) {
      assert.deepEqual(options, { root: paths.root, identity, outerDeadline: observerOptions.deadline });
      assert.equal(dependencies.spawnChild, deps.spawnChild); assert.equal(dependencies.runtime, runtime);
      assert.equal(dependencies.now, deps.now); assert.equal(dependencies.time, globalThis);
      return {
        async before() { events.push('sentinelBefore'); await hooks.before?.(); },
        async finish() { events.push('sentinelAfter'); await hooks.finish?.(); },
      };
    },
  };
  t.after(() => assert.equal(timers.size, 0));
  const applyRetention = () => {
    if (result?.fixtureCleanup.runRoot === 'removed') files.delete(paths.test);
    if (result?.workerCleanup?.workerRoot === 'removed') { files.delete(paths.worker); files.delete(paths.marker); }
  };
  return { input, deps, selected, events, hooks, spawns, children, files, ready, result, passiveWaits,
    applyRetention, get caller() { return caller; }, get observerOptions() { return observerOptions; },
    run: () => runLinuxConsumerLossCase(input, deps),
    async finishAfterFailure(run) { await turn(); caller?.finish(1); return run; },
    async releasePassive() { for (const value of passiveWaits.values()) value.resolve(); await turn(); },
    async succeed() {
      const run = runLinuxConsumerLossCase(input, deps); await turn(); assert.ok(events.includes('grant'));
      for (const value of passiveWaits.values()) value.resolve(); await turn();
      applyRetention(); caller.finish(selected.cause === 'caller' ? 42 : 0); return run;
    },
    advance(milliseconds) {
      clock += BigInt(milliseconds) * 1_000_000n;
      for (const [id, timer] of [...timers]) if (timer.at <= clock && timers.delete(id)) timer.callback();
    },
  };
}

for (const { id: caseId, profiles, cause, profile } of linuxConsumerLossCases) {
  test(`${caseId} routes the actual case ports in order and preserves its root-retention matrix`, async t => {
    const f = fixture(t, caseId); const value = await f.succeed();
    assert.deepEqual(value, { caseId, stage: 'complete', outcome: 'complete', registered: profiles.length,
      passive: cause === 'caller' ? 3 : 1, callerClosed: true, commandsClosed: true,
      sentinelPreserved: true, retentionVerified: true,
      takeover: cause === 'caller' ? 'completed' : 'notAttempted', forcedCaller: false, callerFailurePhase: null });
    assert.ok(Object.isFrozen(value));
    assert.deepEqual(f.events.filter(event => event.startsWith('register:')), profiles.map(name => `register:${name}`));
    const affected = cause === 'caller' ? profiles : [profile];
    for (const name of affected) {
      assert.ok(f.events.indexOf(`observe:${name}`) < f.events.indexOf('grant'));
      assert.ok(f.events.indexOf(`passive:${name}`) < f.events.indexOf('sentinelAfter'));
    }
    assert.equal(f.events.includes('result.json'), cause !== 'caller');
    assert.equal(f.events.includes('takeover'), cause === 'caller');
    assert.ok(f.events.indexOf('caller:close') < f.events.indexOf('sentinelAfter'));
    assert.deepEqual(f.caller.kills, []);
    assert.equal(f.files.has(paths.test), profile !== 'chromium');
    if (profile !== 'backend') {
      assert.equal(f.files.has(paths.worker), profile !== 'vite');
      assert.equal(f.files.has(paths.marker), profile !== 'vite');
    }
    assert.ok(f.files.has(paths.root)); assert.ok(f.files.has(paths.auxiliary));
    assert.deepEqual(f.spawns, [{ file: f.deps.runtime.execPath,
      args: [f.input.actorEntry, `--root=${paths.root}`, `--nonce=${'a'.repeat(32)}`, `--caseId=${caseId}`,
        '--repositoryRoot=/original-source', `--auxiliaryRoot=${paths.auxiliary}`, '--until=1001000000'],
      options: { cwd: '/original-source', env: childEnvironment(), shell: false, detached: false,
        stdio: ['ignore', 'pipe', 'pipe'] } }]);
  });
}

test('Chromium loss with failed context cleanup retains both test and worker roots', async t => {
  const f = fixture(t, 'chromium-owner', 'failed');
  assert.equal((await f.succeed()).outcome, 'complete');
  for (const path of [paths.test, paths.worker, paths.marker]) assert.ok(f.files.has(path));
});

for (const stage of ['guard', 'config']) {
  test(`${stage} failure refuses all roots and launches`, async t => {
    const f = fixture(t);
    if (stage === 'guard') f.hooks.guard = () => { throw new Error('synthetic guard failure'); };
    else f.input.config.workers = 2;
    const value = await f.run();
    assert.equal(value.outcome, 'incomplete'); assert.equal(value.stage, 'context');
    assert.equal(f.files.has(paths.root), false); assert.equal(f.spawns.length, 0);
  });
}

test('first registration failure closes admission and retains roots despite cooperative caller close and takeover', async t => {
  const f = fixture(t, 'vite-control');
  f.hooks.register = profile => { if (profile === 'backend') throw new Error('synthetic binding failure'); };
  const value = await f.finishAfterFailure(f.run());
  assert.equal(value.stage, 'registration'); assert.equal(value.outcome, 'incomplete');
  assert.equal(value.registered, 1); assert.equal(value.forcedCaller, false); assert.equal(value.takeover, 'completed');
  assert.equal(value.commandsClosed, false); assert.deepEqual(f.caller.kills, []);
  assert.ok(f.events.indexOf('stopAdmission') < f.events.indexOf('caller:close'));
  assert.ok(f.events.indexOf('caller:close') < f.events.indexOf('takeover'));
  assert.ok(!f.events.includes('register:vite')); assert.ok(!f.events.includes('grant'));
  for (const path of [paths.root, paths.auxiliary, paths.test, paths.worker, paths.marker]) assert.ok(f.files.has(path));
});

test('later containment and sentinel failures cannot erase the first failed stage', async t => {
  const f = fixture(t); f.hooks.before = () => { throw new Error('synthetic first failure'); };
  f.hooks.takeover = () => { throw new Error('synthetic takeover failure'); };
  f.hooks.finish = () => { throw new Error('synthetic sentinel failure'); };
  const value = await f.finishAfterFailure(f.run());
  assert.equal(value.stage, 'sentinelBefore'); assert.equal(value.outcome, 'incomplete');
  assert.equal(value.takeover, 'unverified'); assert.equal(value.sentinelPreserved, false);
  assert.ok(!f.events.includes('grant')); assert.ok(f.files.has(paths.test));
});

test('live caller cleanup is never competed with while its one passive proof or final close is pending', async t => {
  const f = fixture(t); const run = f.run(); await turn();
  assert.ok(f.events.includes('grant')); assert.equal(f.observerOptions.callerClosed(), false);
  assert.ok(!f.events.includes('takeover')); assert.ok(!f.events.includes('sentinelAfter'));
  await f.releasePassive();
  assert.ok(!f.events.includes('result.json')); assert.ok(!f.events.includes('takeover'));
  f.caller.finish();
  assert.equal((await run).outcome, 'complete');
});

test('caller loss waits for all independent passive proofs and actual child close before takeover', async t => {
  const f = fixture(t, 'caller'); const run = f.run(); await turn();
  f.caller.exit(42);
  for (const profile of f.selected.profiles) {
    f.passiveWaits.get(profile).resolve(); await turn(); assert.ok(!f.events.includes('takeover'));
  }
  f.caller.streams(); f.caller.close(42);
  assert.equal((await run).outcome, 'complete');
  assert.ok(f.events.indexOf('passive:vite') < f.events.indexOf('takeover'));
  assert.ok(f.events.indexOf('caller:close') < f.events.indexOf('takeover'));
});

test('failed passive observation closes admission and waits for actual remaining tasks before failure takeover', async t => {
  const f = fixture(t, 'caller'); const run = f.run(); await turn();
  f.passiveWaits.get('chromium').reject(new Error('synthetic unverified terminal')); await turn();
  assert.deepEqual(f.caller.kills, []); assert.ok(f.events.includes('stopAdmission'));
  f.caller.finish(1); await turn(); assert.ok(!f.events.includes('takeover'));
  f.passiveWaits.get('backend').resolve(); f.passiveWaits.get('vite').resolve();
  const value = await run;
  assert.equal(value.stage, 'passive'); assert.equal(value.outcome, 'incomplete');
  assert.equal(value.takeover, 'completed'); assert.equal(value.passive, 0);
  assert.ok(f.events.indexOf('passiveTaskSettled:vite') < f.events.indexOf('takeover'));
  assert.equal(value.commandsClosed, false);
});

for (const [caseId, code, signal] of [['backend-owner', 42, null], ['caller', 0, null],
  ['caller', 43, null], ['backend-control', null, 'SIGTERM']]) {
  test(`${caseId} refuses caller exit ${code}/${signal} despite complete passive proof`, async t => {
    const f = fixture(t, caseId); const run = f.run(); await turn(); await f.releasePassive();
    f.caller.finish(code, signal);
    const value = await run;
    assert.equal(value.outcome, 'incomplete'); assert.equal(value.stage, 'callerClose');
    assert.equal(value.retentionVerified, false); assert.equal(value.takeover, 'completed');
    assert.ok(!f.events.includes('result.json')); assert.ok(f.files.has(paths.test));
  });
}

for (const field of ['caseId', 'commandsClosed', 'passive']) {
  test(`a wrong result ${field} fails real record validation and retains evidence`, async t => {
    const f = fixture(t); f.result[field] = field === 'caseId' ? 'backend-owner' : false;
    const run = f.run(); await turn(); await f.releasePassive(); f.caller.finish();
    const value = await run;
    assert.equal(value.outcome, 'incomplete'); assert.equal(value.stage, 'result');
    assert.equal(value.retentionVerified, false); assert.ok(f.files.has(paths.test));
  });
}

for (const [caseId, path, change] of [
  ['backend-control', paths.test, 'missing'], ['vite-owner', paths.worker, 'unexpected'],
  ['vite-control', paths.marker, 'unexpected'], ['chromium-owner', paths.test, 'unexpected'],
  ['chromium-control', paths.worker, 'missing'], ['chromium-owner', paths.marker, 'missing'],
  ['caller', paths.test, 'missing'], ['caller', paths.worker, 'replaced'], ['caller', paths.marker, 'missing'],
]) test(`${caseId} rejects ${change} ${path.split('/').at(-1)} against its retention receipt`, async t => {
  const f = fixture(t, caseId); const run = f.run(); await turn(); await f.releasePassive();
  f.applyRetention();
  if (change === 'missing') f.files.delete(path); else f.files.set(path, directory(99));
  f.caller.finish(caseId === 'caller' ? 42 : 0);
  const value = await run;
  assert.equal(value.outcome, 'incomplete'); assert.equal(value.stage, 'retention');
  assert.equal(value.retentionVerified, false); assert.ok(f.files.has(paths.root));
});

test('readiness roots cannot alias the auxiliary root or use foreign directory ownership', async t => {
  for (const invalid of ['alias', 'owner']) {
    const f = fixture(t);
    if (invalid === 'alias') f.ready.testRoot = paths.auxiliary;
    else f.files.set(paths.test, { ...directory(3), uid: 9999 });
    const value = await f.finishAfterFailure(f.run());
    assert.equal(value.stage, 'readiness'); assert.equal(value.outcome, 'incomplete');
    assert.ok(!f.events.includes('grant')); assert.equal(value.forcedCaller, false);
  }
});

test('replacement of the evidence root cannot become complete after valid caller and fixture cleanup', async t => {
  const f = fixture(t); f.hooks.finish = () => f.files.set(paths.root, directory(99));
  const value = await f.succeed();
  assert.equal(value.stage, 'commandsClose'); assert.equal(value.outcome, 'incomplete');
  assert.ok(f.files.has(paths.root));
});

for (const mode of ['exitOnly', 'missingEof', 'childError', 'outputOverflow']) {
  test(`${mode} cannot substitute for the caller's closed healthy handle and both stream EOFs`, async t => {
    const f = fixture(t); const run = f.run(); await turn(); await f.releasePassive();
    if (mode === 'childError') { f.caller.child.emit('error', new Error('synthetic child failure')); f.caller.finish(); }
    else if (mode === 'outputOverflow') {
      f.caller.child.stdout.emit('data', Buffer.alloc(streamLimit + 1)); await turn(); f.caller.finish(1);
    }
    else {
      f.caller.exit(); if (mode === 'missingEof') f.caller.close();
      await turn(); assert.ok(!f.events.includes('result.json'));
      f.advance(4000);
    }
    const value = await run;
    assert.equal(value.outcome, 'incomplete'); assert.equal(value.commandsClosed, false);
    assert.ok(f.files.has(paths.test));
    if (mode === 'exitOnly') { assert.equal(value.callerClosed, false); assert.ok(!f.events.includes('takeover')); }
    f.caller.finish(); await turn();
  });
}

test('late observer command closure is required even after caller EOF and fixture retention proof', async t => {
  const f = fixture(t); const run = f.run(); await turn();
  f.observerOptions.commands.spawnChild('synthetic-manager'); const command = f.children.at(-1);
  await f.releasePassive(); f.caller.finish();
  let settled = false; const completion = run.then(value => { settled = true; return value; });
  await turn(); assert.equal(settled, false);
  command.exit(); command.close(); await turn(); assert.equal(settled, false);
  command.streams();
  assert.equal((await completion).outcome, 'complete');
});

test('an unclosed observer helper poisons the case at the original wrapper deadline without killing that helper', async t => {
  const f = fixture(t); const run = f.run(); await turn();
  f.observerOptions.commands.spawnChild('synthetic-manager'); const command = f.children.at(-1);
  await f.releasePassive(); f.caller.finish(); await turn(); f.advance(4000);
  const value = await run;
  assert.equal(value.outcome, 'incomplete'); assert.equal(value.commandsClosed, false);
  assert.deepEqual(command.kills, []); assert.ok(f.files.has(paths.test));
  const before = f.spawns.length;
  assert.throws(() => f.observerOptions.commands.spawnChild('synthetic-late'), /COMMAND_GATE_UNVERIFIED/u);
  assert.equal(f.spawns.length, before);
  command.finish(); await turn();
});

test('registration and fault time consume one original deadline; watchdog and cleanup cannot renew it', async t => {
  const f = fixture(t);
  f.hooks.register = () => f.advance(200); f.hooks.before = () => f.advance(100);
  const run = f.run(); await turn();
  const deadline = f.observerOptions.deadline;
  assert.equal(deadline.remaining('work'), 700); assert.equal(deadline.remaining('wrapper'), 3700);
  f.advance(700); await turn();
  assert.deepEqual(f.caller.kills, []);
  f.advance(2999); await turn(); assert.deepEqual(f.caller.kills, []);
  f.advance(1);
  const value = await run;
  assert.equal(value.outcome, 'incomplete'); assert.equal(value.forcedCaller, true);
  assert.deepEqual(f.caller.kills, ['SIGKILL']);
  assert.equal(value.commandsClosed, false); assert.equal(value.takeover, 'notAttempted');
  assert.equal(deadline.remaining('wrapper'), 0); assert.ok(f.files.has(paths.test));
});

test('grant publication reaching the work deadline cannot be reported as a completed fault case', async t => {
  const f = fixture(t); f.hooks.grant = () => f.advance(1000);
  const run = f.run(); await turn(); await f.releasePassive();
  f.caller.finish(1);
  const value = await run;
  assert.equal(value.stage, 'fault'); assert.equal(value.outcome, 'incomplete');
  assert.equal(value.forcedCaller, false); assert.ok(f.files.has(paths.test));
});

test('output failure cannot abandon in-flight registration or authorize takeover before it actually settles', async t => {
  const f = fixture(t); const registration = pending();
  f.hooks.register = () => registration.promise;
  const run = f.run(); await turn();
  f.caller.child.stderr.emit('error', new Error('synthetic output failure')); await turn();
  assert.ok(f.events.includes('stopAdmission')); assert.deepEqual(f.caller.kills, []);
  f.caller.finish(1); await turn(); assert.ok(!f.events.includes('takeover'));
  registration.resolve();
  const value = await run;
  assert.equal(value.outcome, 'incomplete'); assert.equal(value.stage, 'registration');
  assert.equal(value.commandsClosed, false); assert.equal(value.registered, 0);
  assert.ok(f.events.indexOf('registeredTaskSettled:backend') < f.events.indexOf('takeover'));
  assert.ok(!f.events.includes('grant'));
});

test('an unsettled registration at expiry cannot grant takeover or spawn another command after return', async t => {
  const f = fixture(t); const registration = pending();
  f.hooks.register = () => registration.promise;
  const run = f.run(); await turn();
  f.caller.child.stderr.emit('error', new Error('synthetic output failure')); await turn();
  f.caller.finish(1); await turn(); f.advance(4000);
  const value = await run;
  assert.equal(value.outcome, 'incomplete'); assert.equal(value.takeover, 'notAttempted');
  assert.equal(value.commandsClosed, false);
  const before = f.spawns.length;
  assert.throws(() => f.observerOptions.commands.spawnChild('synthetic-late'), /COMMAND_GATE_UNVERIFIED/u);
  assert.equal(f.spawns.length, before);
  registration.resolve(); await turn(); assert.ok(!f.events.includes('grant'));
});

test('failure allows cooperative caller cleanup through the original wrapper deadline, not just work expiry', async t => {
  const f = fixture(t); f.hooks.register = () => { throw new Error('synthetic failure'); };
  const run = f.run(); await turn(); f.advance(1000); await turn();
  assert.deepEqual(f.caller.kills, []);
  f.advance(2999); await turn(); assert.deepEqual(f.caller.kills, []);
  f.caller.finish(1);
  const value = await run;
  assert.equal(value.outcome, 'incomplete'); assert.equal(value.forcedCaller, false);
  assert.equal(value.commandsClosed, false); assert.equal(value.takeover, 'completed');
  assert.equal(f.observerOptions.deadline.remaining('wrapper'), 1);
});

const failureMarker = patch => 'EKY_LINUX_CONSUMER_FAILURE ' + JSON.stringify({ schemaVersion: 1,
  operation: 'consumerLoss', phase: 'backendStart', errorCode: 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED', ...patch });

test('failure phase extraction accepts one bounded exact marker and returns only its closed phase', () => {
  assert.equal(readConsumerFailurePhase(Buffer.from(failureMarker() + '\n')), 'backendStart');
  assert.equal(readConsumerFailurePhase(Buffer.from('synthetic private text\n' + failureMarker() + '\n')), 'backendStart');
  const line = failureMarker();
  assert.equal(readConsumerFailurePhase(Buffer.from(line + ' '.repeat(512 - line.length) + '\n')), 'backendStart');
  assert.equal(readConsumerFailurePhase(Buffer.from(line + ' '.repeat(513 - line.length) + '\n')), null);
});

test('an incomplete failure-marker tail cannot publish a phase without its terminating LF', () => {
  assert.equal(readConsumerFailurePhase(Buffer.from(failureMarker())), null);
  assert.equal(readConsumerFailurePhase(Buffer.from(failureMarker().slice(0, -1))), null);
});

for (const [label, text] of [
  ['raw text', 'synthetic private text'], ['malformed JSON', 'EKY_LINUX_CONSUMER_FAILURE {'],
  ['duplicate markers', failureMarker() + '\n' + failureMarker()],
  ['unknown phase', failureMarker({ phase: 'synthetic-private-value' })],
  ['extra metadata', failureMarker({ privatePath: '/synthetic-private' })],
  ['wrong schema', failureMarker({ schemaVersion: 2 })],
  ['wrong operation', failureMarker({ operation: 'other' })],
  ['wrong error code', failureMarker({ errorCode: 'other' })],
]) test(`failure phase extraction never publishes ${label}`, () => {
  assert.equal(readConsumerFailurePhase(Buffer.from(text + '\n')), null);
});

test('case state extracts only the safe phase from actual bounded child output and never republishes raw metadata', async t => {
  const f = fixture(t); const run = f.run(); await turn(); await f.releasePassive();
  f.caller.child.stderr.emit('data', Buffer.from('synthetic private text\n' + failureMarker() + '\n'));
  f.caller.finish(1);
  const value = await run;
  assert.equal(value.callerFailurePhase, 'backendStart'); assert.equal(value.outcome, 'incomplete');
  assert.ok(!JSON.stringify(value).includes('synthetic private'));
  assert.deepEqual(Object.keys(value).sort(), ['caseId', 'stage', 'outcome', 'registered', 'passive',
    'callerClosed', 'commandsClosed', 'sentinelPreserved', 'retentionVerified', 'takeover', 'forcedCaller',
    'callerFailurePhase'].sort());
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { prepareManagedLaunch } from './managedNamespaceCommand.mjs';
import { runManagedSession } from './managedNamespaceSession.mjs';
import { managedUnitName, managedUnitProperties } from './managedNamespaceUnitContract.mjs';
import { budgets, createDeadline, encodeMessage, message, NamespaceFailure } from './pidNamespaceContract.mjs';

const config = { generation: 'a'.repeat(32), started: '1000000', uid: 1001, gid: 1002,
  root: '/tmp/eky-managed-ns-ABC123', node: '/opt/node/bin/node', init: '/repo/managedNamespaceInit.mjs' };
const unit = managedUnitName(config.generation);
const running = { Id: unit, InvocationID: 'b'.repeat(32), LoadState: 'loaded', Transient: 'yes',
  ActiveState: 'active', SubState: 'running', Result: 'success', MainPID: '123', ControlPID: '0',
  ControlGroup: `/system.slice/${unit}`, ExecMainCode: '0', ExecMainStatus: '0',
  ExecMainStartTimestampMonotonic: '1000000', ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties };
const exited = { ...running, MainPID: '0', ActiveState: 'failed', SubState: 'failed', Result: 'exit-code',
  ExecMainCode: '1', ExecMainStatus: '41', ExecMainExitTimestampMonotonic: '2000000' };
const wire = value => Object.entries(value).map(([name, content]) => `${name}=${content}\n`).join('');

function fixture(options = {}) {
  let elapsed = 0;
  let serial = 0;
  let socketExists = false;
  let terminal = false;
  let observationCount = 0;
  const timers = new Map();
  const order = [];
  const calls = [];
  const channels = [];
  const children = [];
  const time = { setTimeout(fn, delay) { timers.set(++serial, { fn, at: elapsed + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); } };
  const now = () => 1000000n + BigInt(elapsed) * 1000000n;
  const runtime = { platform: 'linux', env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true' },
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 };
  const root = { uid: 1001, gid: 1002, mode: 0o40700, dev: 2, ino: 3,
    isDirectory: () => true, isSymbolicLink: () => false };
  const socketStat = { uid: 1001, gid: 1002, mode: 0o140600, dev: 2, ino: 4,
    isSocket: () => true, isSymbolicLink: () => false };
  const fs = {
    lstatSync(path) {
      order.push('privateMetadata');
      if (path === config.root) return root;
      assert.equal(path, `${config.root}/control.sock`);
      if (!socketExists) throw Object.assign(Error('PRIVATE'), { code: 'ENOENT' });
      return socketStat;
    },
    realpathSync: path => path,
    chmodSync(path, mode) { assert.equal(path, `${config.root}/control.sock`); assert.equal(mode, 0o600); },
  };
  const hostFs = {
    async lstat(path) {
      order.push('hostMetadata');
      if (options.metadata) return options.metadata(path);
      return { uid: 0, mode: path === '/usr/bin/sudo' ? 0o104755 : 0o100755, dev: 1, ino: 2,
        isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true, isSocket: () => true };
    },
    realpath: async path => path, statfs: async () => ({ type: 0x63677270 }),
  };
  const server = new EventEmitter();
  server.listen = value => {
    assert.deepEqual(value, { path: `${config.root}/control.sock` });
    socketExists = true;
    queueMicrotask(() => server.emit('listening'));
  };
  server.close = () => {
    if (channels.every(socket => socket.destroyed)) queueMicrotask(() => server.emit('close'));
  };
  const connect = () => {
    const socket = new EventEmitter();
    socket.destroyed = false; socket.writes = [];
    socket.resume = () => {};
    socket.destroy = () => {
      if (!socket.destroyed) { socket.destroyed = true; socket.emit('close'); }
    };
    socket.write = (bytes, done) => {
      order.push('GO'); socket.writes.push(bytes);
      assert.deepEqual(JSON.parse(bytes), message('GO', config.generation));
      if (options.write) { options.write(socket, done); return; }
      done();
      queueMicrotask(() => socket.emit('data', options.workloadBytes ?? encodeMessage(message('WORKLOAD', config.generation))));
    };
    socket.end = () => {
      order.push('EOF'); terminal = true;
      queueMicrotask(() => { socket.emit('end'); socket.destroy(); });
    };
    channels.push(socket);
    server.emit('connection', socket);
    if (!options.noReady) socket.emit('data', options.readyBytes ?? encodeMessage(message('READY', config.generation)));
    if (options.readyEof) socket.emit('end');
  };
  const spawnChild = (file, args, settings) => {
    let kind = args.includes('--property=Version') ? 'manager' :
      args.includes('/usr/bin/systemd-run') ? 'launch' : args.includes('stop') ? 'stop' : 'observation';
    if (args.includes('-l')) kind = `policy:${kind}`;
    order.push(kind);
    calls.push({ file, args, settings, kind });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kills = [];
    child.kill = signal => { child.kills.push(signal); return false; };
    child.finish = ({ text = '', code = 0, stderr = '', signal = null } = {}) => {
      child.stdout.emit('data', Buffer.from(text)); child.stderr.emit('data', Buffer.from(stderr));
      child.stdout.emit('end'); child.stderr.emit('end'); child.emit('exit', code, signal); child.emit('close', code, signal);
    };
    children.push(child);
    queueMicrotask(() => {
      child.emit('spawn');
      const number = kind === 'observation' ? ++observationCount : 0;
      const value = options.observation?.(number, terminal) ?? (terminal ? exited : running);
      const response = { text: kind === 'manager' ? '255\n' : kind === 'observation' ? wire(value) : '' };
      const override = options.command?.(kind, child, response);
      if (override === false) return;
      child.finish({ ...response, ...override });
      if (kind === 'launch') connect();
    });
    return child;
  };
  const input = { config: { ...config }, runtime, fs, hostFs, now, time, spawnChild,
    tempDirectory: () => '/tmp', beforeGo: options.beforeGo,
    createListener(value) { assert.deepEqual(value, { allowHalfOpen: true, pauseOnConnect: true }); return server; } };
  return { input, order, calls, channels, children, timers, root, socketStat,
    advance(ms) {
      elapsed = ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed && timers.delete(id)) timer.fn();
      }
    },
    prepare() { return prepareManagedLaunch({ ...input, deadline: createDeadline(config.started, now) }); },
    run() { return runManagedSession(input); },
  };
}

function noWork(result, f) {
  assert.equal(result.outcome, 'unverified');
  assert.equal(result.facts.go, false);
  assert.ok(!f.order.includes('GO'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
}

test('connected session composes real parsers, policy checks, private receipt, GO and normal wrapper exit', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.outcome, 'observed'); assert.equal(result.failure, null); assert.equal(result.cleanupFailure, null);
  assert.deepEqual(result.facts, { metadata: true, manager: true, policies: true, launchAttempted: true,
    launchAccepted: true, ready: true, owned: true, go: true, workload: true, controlClosed: true,
    waitingWrapper: 'normalExit', stop: 'notRequested', commandsClosed: true });
  assert.deepEqual(f.calls.map(call => call.kind), ['manager', 'policy:observation', 'policy:stop', 'policy:launch',
    'launch', 'observation', 'observation']);
  assert.ok(f.order.indexOf('hostMetadata') < f.order.indexOf('manager'));
  assert.ok(f.order.indexOf('observation') < f.order.indexOf('GO'));
  assert.equal(f.timers.size, 0); assert.ok(Object.isFrozen(result) && Object.isFrozen(result.facts));
  for (const forbidden of ['treeAbsent', 'destroyed', 'rootRemoved', 'invocation', 'InvocationID', config.root, unit]) {
    assert.ok(!JSON.stringify(result).includes(forbidden));
  }
});

test('invalid config, CI identity and root callers cannot reach metadata, commands or control', async () => {
  for (const mutate of [f => { f.input.config.uid++; }, f => { f.input.runtime.geteuid = () => 0; },
    f => { f.input.runtime.env = {}; }, f => { f.input.runtime.platform = 'win32'; },
    f => { Object.defineProperty(f.input.config, 'root', { get() { assert.fail('accessor ran'); }, enumerable: true }); }]) {
    const f = fixture(); mutate(f); noWork(await f.run(), f); assert.deepEqual(f.order, []);
  }
});

test('each prelaunch failure stops before launch and cannot mint ownership or stop authority', async () => {
  for (const stage of ['metadata', 'manager', 'policy:observation', 'policy:stop', 'policy:launch']) {
    const f = fixture({ metadata: stage === 'metadata' ? () => { throw Error('PRIVATE'); } : undefined,
      command: kind => kind === stage ? { code: 1 } : undefined });
    const result = await f.run(); noWork(result, f);
    assert.equal(result.facts.launchAttempted, false); assert.equal(result.facts.owned, false);
    assert.equal(result.facts.stop, 'notRequested'); assert.ok(!f.calls.some(call => call.kind === 'launch'));
    assert.equal(f.timers.size, 0);
  }
});

test('failed launch cannot adopt an observed READY, retry, capture a receipt or stop by name', async () => {
  const f = fixture({ command: kind => kind === 'launch' ? { code: 1 } : undefined });
  const result = await f.run(); noWork(result, f);
  assert.deepEqual(result.failure, { stage: 'launch', reason: 'exitFailed' });
  assert.equal(result.facts.launchAttempted, true); assert.equal(result.facts.launchAccepted, false);
  assert.equal(result.facts.commandsClosed, true); assert.equal(result.facts.stop, 'notRequested');
  assert.equal(f.calls.filter(call => call.kind === 'launch').length, 1);
  assert.ok(!f.calls.some(call => ['observation', 'stop'].includes(call.kind)));
  assert.equal(f.timers.size, 0);
});

test('wrong READY, unsolicited tails and premature EOF block capture and GO despite accepted launch', async () => {
  for (const options of [{ readyBytes: encodeMessage(message('READY', 'c'.repeat(32))) },
    { readyBytes: Buffer.concat([encodeMessage(message('READY', config.generation)), Buffer.from('{')]) },
    { readyEof: true }]) {
    const f = fixture(options); const result = await f.run(); noWork(result, f);
    assert.equal(result.facts.launchAccepted, true); assert.equal(result.facts.owned, false);
    assert.ok(!f.calls.some(call => ['observation', 'stop'].includes(call.kind)));
  }
});

test('READY cannot bypass a missing, failed, inactive or improperly configured unit', async () => {
  for (const mutation of [{ LoadState: 'not-found' }, { ActiveState: 'inactive' }, { MainPID: '0' },
    { KillMode: 'process' }, { NoNewPrivileges: 'no' }, { ExecMainStartTimestampMonotonic: '0' }]) {
    const f = fixture({ observation: () => ({ ...running, ...mutation }) });
    const result = await f.run(); noWork(result, f);
    assert.equal(result.facts.ready, true); assert.equal(result.facts.owned, false);
    assert.equal(result.facts.stop, 'notRequested'); assert.equal(result.failure.stage, 'ownership');
  }
});

test('before-GO failure is kept separate from a successful receipt-gated stop acknowledgement', async () => {
  const f = fixture({ beforeGo() { throw Error('PRIVATE'); } });
  const result = await f.run(); noWork(result, f);
  assert.deepEqual(result.failure, { stage: 'go', reason: 'unverified' });
  assert.equal(result.facts.owned, true); assert.equal(result.facts.stop, 'commandAccepted');
  assert.equal(result.facts.waitingWrapper, 'unverified'); assert.equal(result.facts.controlClosed, false);
  assert.equal(result.cleanupFailure, null);
  assert.deepEqual(f.calls.slice(-2).map(call => call.kind), ['observation', 'stop']);
});

test('stale invocation/start, missing unit and changed policy refuse stop without losing the first failure', async () => {
  for (const mutation of [{ InvocationID: 'c'.repeat(32) }, { ExecMainStartTimestampMonotonic: '1000001' },
    { LoadState: 'not-found' }, { KillMode: 'process' }]) {
    const f = fixture({ beforeGo() { throw Error('PRIVATE'); },
      observation: number => number > 1 ? { ...running, ...mutation } : running });
    const result = await f.run(); noWork(result, f);
    assert.equal(result.failure.stage, 'go'); assert.equal(result.cleanupFailure.stage, 'stop');
    assert.equal(result.facts.stop, 'unverified'); assert.ok(!f.calls.some(call => call.kind === 'stop'));
  }
});

test('stop denial or dirty output cannot overwrite an earlier workload failure', async () => {
  for (const override of [{ code: 1 }, { text: 'PRIVATE' }, { stderr: 'PRIVATE' }]) {
    const f = fixture({ workloadBytes: Buffer.from('PRIVATE\n'), command: kind => kind === 'stop' ? override : undefined });
    const result = await f.run();
    assert.equal(result.failure.stage, 'workload'); assert.equal(result.cleanupFailure.stage, 'stop');
    assert.equal(result.facts.go, true); assert.equal(result.facts.workload, false);
    assert.equal(result.facts.stop, 'unverified'); assert.equal(result.outcome, 'unverified');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('original READY budget bounds missing readiness and asynchronous before-GO work, with no late GO', async () => {
  for (const mode of ['ready', 'beforeGo']) {
    let release;
    const f = fixture({ noReady: mode === 'ready',
      beforeGo: mode === 'beforeGo' ? () => new Promise(resolve => { release = resolve; }) : undefined });
    const run = f.run(); await setImmediate(); f.advance(budgets.ready);
    const result = await run; noWork(result, f);
    assert.equal(result.failure.reason, 'deadlineExceeded');
    if (release) release(); else f.channels[0].emit('data', encodeMessage(message('READY', config.generation)));
    await setImmediate(); assert.ok(!f.order.includes('GO')); assert.equal(f.timers.size, 0);
  }
});

test('unit transition observations are paced under the original deadline and never count as proof', async () => {
  const f = fixture({ observation: number => number === 2 ? running : number === 3 ?
    { ...running, ActiveState: 'deactivating', SubState: 'stop-sigterm' } : undefined });
  let finished = false;
  const run = f.run().then(value => { finished = true; return value; });
  await setImmediate(); assert.equal(finished, false);
  f.advance(25); await setImmediate(); assert.equal(finished, false);
  f.advance(50); const result = await run;
  assert.equal(result.outcome, 'observed'); assert.equal(f.calls.filter(call => call.kind === 'observation').length, 4);
  assert.equal(f.timers.size, 0);
});

test('terminal signal, timeout, wrong exit or invocation cannot substitute for normal wrapper exit', async () => {
  for (const mutation of [{ ExecMainStatus: '0' }, { ExecMainCode: '2', ExecMainStatus: '9' },
    { Result: 'timeout' }, { InvocationID: 'c'.repeat(32) }, { ExecMainStartTimestampMonotonic: '1000001' },
    { ActiveState: 'inactive', SubState: 'dead' }]) {
    const f = fixture({ observation: number => number > 1 ? { ...exited, ...mutation } : running });
    const result = await f.run();
    assert.equal(result.facts.workload, true); assert.equal(result.facts.controlClosed, true);
    assert.equal(result.facts.waitingWrapper, 'unverified'); assert.equal(result.failure.stage, 'wrapper');
    assert.equal(result.outcome, 'unverified');
  }
});

test('an ambiguous GO write is post-GO and never retried or promoted by a later workload response', async () => {
  const f = fixture({ write(socket, done) {
    done(Error('PRIVATE'));
    socket.emit('data', encodeMessage(message('WORKLOAD', config.generation)));
  } });
  const result = await f.run();
  assert.equal(result.failure.stage, 'go'); assert.equal(result.facts.go, true); assert.equal(result.facts.workload, false);
  assert.equal(f.order.filter(value => value === 'GO').length, 1); assert.equal(result.outcome, 'unverified');
});

test('late launch close cannot adopt a unit and unclosed command cleanup is explicitly bounded', async () => {
  const f = fixture({ command: kind => kind === 'launch' ? false : undefined });
  let finished = false; const run = f.run().then(value => { finished = true; return value; });
  await setImmediate(); f.advance(budgets.ready); await setImmediate(); assert.equal(finished, false);
  f.advance(budgets.wrapper); const result = await run; noWork(result, f);
  assert.deepEqual(result.failure, { stage: 'launch', reason: 'deadlineExceeded' });
  assert.equal(result.facts.commandsClosed, false); assert.equal(result.cleanupFailure.stage, 'commandDrain');
  assert.deepEqual(f.children.at(-1).kills, ['SIGKILL']);
  f.children.at(-1).finish(); await setImmediate(); assert.ok(!f.order.includes('GO'));
  assert.equal(result.facts.commandsClosed, false); assert.equal(f.timers.size, 0);
});

test('private unit capability requires accepted launch, captures once and serializes repeated stop', async () => {
  const f = fixture(); const prepared = f.prepare();
  assert.throws(() => prepared.own()); assert.equal(f.calls.length, 0);
  await prepared.authorize().result;
  assert.throws(() => prepared.own());
  await prepared.launch().result;
  const first = prepared.own(); assert.equal(prepared.own(), first);
  const owned = await first;
  assert.deepEqual(Object.keys(owned), ['observeWrapper', 'stop']); assert.ok(Object.isFrozen(owned));
  const stop = owned.stop(); assert.equal(owned.stop(), stop);
  await assert.rejects(owned.observeWrapper());
  assert.deepEqual(await stop, { kind: 'stopCommandAccepted' });
  assert.equal(owned.stop(), stop);
  assert.equal(f.calls.filter(call => call.kind === 'stop').length, 1);
  await prepared.settleCommands(); assert.equal(prepared.commandsClosed(), true); assert.equal(f.timers.size, 0);
});

test('caller config mutation cannot redirect the frozen session command or control endpoint', async () => {
  let f;
  f = fixture({ beforeGo() {
    f.input.config.generation = 'c'.repeat(32); f.input.config.root = '/tmp/eky-managed-ns-DEF456';
    f.input.config.uid = 77;
  } });
  const result = await f.run(); assert.equal(result.outcome, 'observed');
  for (const call of f.calls.filter(value => ['observation', 'launch'].includes(value.kind))) {
    assert.ok(call.args.some(arg => arg.includes(unit)));
  }
  assert.equal(f.order.filter(value => value === 'GO').length, 1);
});

async function ownedFixture(options) {
  const f = fixture(options);
  const prepared = f.prepare();
  await prepared.authorize().result;
  await prepared.launch().result;
  const owned = await prepared.own();
  return { ...f, prepared, owned };
}

test('stop cannot overlap a failed observation whose command child has not closed', async () => {
  let count = 0;
  let held;
  const f = await ownedFixture({ command(kind, child) {
    if (kind === 'observation' && ++count === 2) {
      held = child; child.stderr.emit('data', Buffer.from('PRIVATE')); return false;
    }
  } });
  await assert.rejects(f.owned.observeWrapper());
  const stop = f.owned.stop(); await setImmediate();
  assert.equal(count, 2); assert.ok(!f.calls.some(call => call.kind === 'stop'));
  held.finish();
  await stop; await f.prepared.settleCommands();
  assert.equal(count, 3); assert.equal(f.calls.filter(call => call.kind === 'stop').length, 1);
});

test('drain seals new operations and includes a stop queued before its first query starts', async () => {
  let count = 0;
  let held;
  const f = await ownedFixture({ command(kind, child) {
    if (kind === 'observation' && ++count === 2) { held = child; return false; }
  } });
  const stop = f.owned.stop();
  let drained = false;
  const drain = f.prepared.settleCommands().then(() => { drained = true; });
  await setImmediate(); assert.equal(drained, false); assert.equal(f.prepared.commandsClosed(), false);
  held.finish({ text: wire(running) });
  await stop; await drain;
  assert.equal(f.prepared.commandsClosed(), true); assert.equal(f.owned.stop(), stop);
  const countBefore = f.calls.length;
  await assert.rejects(f.owned.observeWrapper()); assert.equal(f.calls.length, countBefore);
});

test('sentinel failure reason survives a later stop rejection without disclosing raw errors', async () => {
  const f = fixture({ beforeGo() { throw new NamespaceFailure('sentinelFailed'); },
    command: kind => kind === 'stop' ? { code: 1 } : undefined });
  const result = await f.run(); noWork(result, f);
  assert.deepEqual(result.failure, { stage: 'go', reason: 'sentinelFailed' });
  assert.deepEqual(result.cleanupFailure, { stage: 'stop', reason: 'exitFailed' });
});

test('session retains first query failure and refuses stop when the query child never closes', async () => {
  let count = 0;
  const f = fixture({ command(kind, child) {
    if (kind === 'observation' && ++count === 2) {
      child.stderr.emit('data', Buffer.from('PRIVATE')); return false;
    }
  } });
  const run = f.run(); await setImmediate();
  assert.equal(count, 2); assert.ok(!f.calls.some(call => call.kind === 'stop'));
  f.advance(budgets.wrapper); const result = await run;
  assert.deepEqual(result.failure, { stage: 'wrapper', reason: 'stderrNotEmpty' });
  assert.deepEqual(result.cleanupFailure, { stage: 'stop', reason: 'deadlineExceeded' });
  assert.equal(result.facts.commandsClosed, false); assert.equal(result.facts.waitingWrapper, 'unverified');
  assert.equal(count, 2); assert.ok(!f.calls.some(call => call.kind === 'stop'));
  f.children.at(-1).finish(); await setImmediate(); assert.equal(count, 2);
  assert.equal(f.timers.size, 0);
});

test('concurrent wrapper queries are serialized and draining cannot schedule further commands', async () => {
  let count = 0;
  let held;
  const f = await ownedFixture({ command(kind, child) {
    if (kind === 'observation' && ++count === 2) { held = child; return false; }
  } });
  const first = f.owned.observeWrapper();
  const second = f.owned.observeWrapper();
  await setImmediate(); assert.equal(count, 2);
  held.finish({ text: wire(running) });
  assert.deepEqual(await first, { waitingWrapper: 'pending' });
  assert.deepEqual(await second, { waitingWrapper: 'pending' });
  assert.equal(count, 3);
  await f.prepared.settleCommands();
  await assert.rejects(f.owned.observeWrapper()); assert.throws(() => f.owned.stop());
  assert.equal(count, 3); assert.equal(f.prepared.commandsClosed(), true);
});

test('ready deadline expires while ownership query is closing: no receipt, GO or name-only stop', async () => {
  let f;
  f = fixture({ command(kind) {
    if (kind === 'observation') f.advance(budgets.ready);
  } });
  const result = await f.run(); noWork(result, f);
  assert.equal(result.failure.stage, 'ownership'); assert.equal(result.failure.reason, 'deadlineExceeded');
  assert.equal(result.facts.owned, false); assert.equal(result.facts.stop, 'notRequested');
});

test('permanently nonterminal wrapper never passes at the original wrapper deadline', async () => {
  const f = fixture({ observation: () => running });
  const run = f.run(); await setImmediate();
  f.advance(budgets.wrapper); const result = await run;
  assert.equal(result.failure.reason, 'deadlineExceeded'); assert.equal(result.failure.stage, 'wrapper');
  assert.equal(result.facts.waitingWrapper, 'unverified'); assert.equal(result.outcome, 'unverified');
  assert.ok(!f.calls.some(call => call.kind === 'stop')); assert.equal(f.timers.size, 0);
});

test('late protocol corruption cannot be concealed by a correct manager exit receipt', async () => {
  let f;
  f = fixture({ command(kind) {
    if (kind === 'observation' && f.order.includes('EOF')) f.channels[0].emit('error', Error('PRIVATE'));
  } });
  const result = await f.run();
  assert.equal(result.facts.waitingWrapper, 'normalExit'); assert.equal(result.outcome, 'unverified');
  assert.equal(result.failure.stage, 'finalize'); assert.equal(result.failure.reason, 'channelFailed');
});

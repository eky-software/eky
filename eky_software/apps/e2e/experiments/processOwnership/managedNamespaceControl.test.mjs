import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { listenManagedControl } from './managedNamespaceControl.mjs';
import { runManagedNamespaceInit } from './managedNamespaceInit.mjs';
import { inspectManagedRoot, inspectManagedSocket, managedControlPath, parseManagedInitArguments } from './managedNamespaceRoot.mjs';
import { actorArguments, budgets, createDeadline, encodeMessage, expectedEofExit, failureExit, message } from './pidNamespaceContract.mjs';

const config = { generation: 'a'.repeat(32), started: '1000000', uid: 1001, gid: 1002, root: '/tmp/eky-managed-ns-ABC123' };
const environment = { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true' };
const status = 'Pid:\t1\nUid:\t1001\t1001\t1001\t1001\nGid:\t1002\t1002\t1002\t1002\n' +
  ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd'].map(name => `${name}:\t0000000000000000\n`).join('') +
  'NoNewPrivs:\t1\nGroups:\t\n';

function clock() {
  let elapsed = 0;
  let key = 0;
  const timers = new Map();
  const time = { setTimeout(fn, delay) { timers.set(++key, { fn, at: elapsed + delay }); return key; },
    clearTimeout(id) { timers.delete(id); } };
  const now = () => 1000000n + BigInt(elapsed) * 1000000n;
  return { now, time, timers, deadline: createDeadline(config.started, now),
    set(ms) { elapsed = ms; },
    advance(ms) {
      elapsed = ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed && timers.delete(id)) timer.fn();
      }
    } };
}

function channel() {
  const value = new EventEmitter();
  value.writes = []; value.ends = 0; value.resumes = 0; value.destroyed = false;
  value.write = (bytes, done) => { value.writes.push(bytes); done?.(); };
  value.end = () => { value.ends++; };
  value.resume = () => { value.resumes++; };
  value.destroy = () => { if (!value.destroyed) { value.destroyed = true; value.emit('close'); } };
  value.finish = () => { value.emit('end'); value.destroy(); };
  return value;
}

function fixture(options = {}) {
  const c = clock();
  const accesses = [];
  let exists = Boolean(options.socketExists);
  const root = { uid: 1001, gid: 1002, mode: 0o40700, dev: 2, ino: 3,
    isDirectory: () => true, isSymbolicLink: () => false };
  const endpoint = { uid: 1001, gid: 1002, mode: 0o140600, dev: 2, ino: 4,
    isSocket: () => true, isSymbolicLink: () => false };
  const fs = {
    lstatSync(path) {
      accesses.push(['lstat', path]);
      if (path === config.root) return root;
      assert.equal(path, managedControlPath(config.root));
      if (!exists) throw Object.assign(Error('PRIVATE'), { code: options.lookupCode ?? 'ENOENT' });
      return endpoint;
    },
    realpathSync(path) { accesses.push(['realpath', path]); return path; },
    chmodSync(path, mode) { assert.equal(path, managedControlPath(config.root)); endpoint.mode = 0o140000 | mode; },
  };
  const runtime = { platform: 'linux', env: environment, pid: 1,
    argv: ['node', 'managedNamespaceInit.mjs', ...actorArguments(config), `--root=${config.root}`],
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 };
  let creates = 0;
  const server = new EventEmitter();
  const sockets = [];
  server.closes = 0;
  server.bind = () => { exists = true; server.emit('listening'); };
  server.listen = value => { assert.deepEqual(value, { path: managedControlPath(config.root) });
    if (!options.deferredListen) server.bind(); };
  server.close = () => {
    server.closes++;
    if (sockets.every(socket => socket.destroyed)) queueMicrotask(() => server.emit('close'));
  };
  const accept = () => {
    const socket = channel();
    sockets.push(socket);
    server.emit('connection', socket);
    return socket;
  };
  const operations = { config, runtime, fs, tempDirectory: () => '/tmp', deadline: c.deadline, time: c.time,
    createListener(value) {
      assert.deepEqual(value, { allowHalfOpen: true, pauseOnConnect: true }); creates++; return server;
    } };
  return { ...c, accesses, root, endpoint, fs, runtime, server, accept, operations, sockets,
    get creates() { return creates; }, setExists(value) { exists = value; } };
}

async function openedFixture(options) {
  const f = fixture(options);
  const transport = await listenManagedControl(f.operations);
  const socket = f.accept();
  const connection = await transport.connection;
  return { ...f, transport, socket, connection };
}

test('managed init arguments and IPC path are fixed, short and non-expanding', () => {
  assert.deepEqual(parseManagedInitArguments([...actorArguments(config), `--root=${config.root}`]), config);
  assert.equal(managedControlPath(config.root), `${config.root}/control.sock`);
  for (const root of ['', 'relative', '/tmp/eky-managed-ns-short', `${config.root}/`, `/tmp/../tmp/eky-managed-ns-ABC123`,
    '/tmp/eky-managed-ns-ABC123\n', '/tmp/%n/eky-managed-ns-ABC123', `/${'x'.repeat(90)}/eky-managed-ns-ABC123`]) {
    assert.throws(() => managedControlPath(root));
  }
  for (const args of [actorArguments(config), [...actorArguments(config), '--root='],
    [...actorArguments(config), `--root=${config.root}`, '--extra=1']]) assert.throws(() => parseManagedInitArguments(args));
});

test('private root and socket receipts reject ownership, permission, link and identity changes', () => {
  for (const [target, changes] of [['root', [{ uid: 0 }, { gid: 0 }, { mode: 0o40750 }, { ino: 0 },
    { isDirectory: () => false }, { isSymbolicLink: () => true }]],
  ['endpoint', [{ uid: 0 }, { gid: 0 }, { mode: 0o140660 }, { ino: 0 },
    { isSocket: () => false }, { isSymbolicLink: () => true }]]]) {
    for (const change of changes) {
      const f = fixture({ socketExists: true });
      Object.assign(f[target], change);
      const inspect = target === 'root' ? inspectManagedRoot : inspectManagedSocket;
      assert.throws(() => inspect(config.root, config, { fs: f.fs, tempDirectory: () => '/tmp' }));
    }
  }
  for (const inspect of [inspectManagedRoot, inspectManagedSocket]) {
    const f = fixture({ socketExists: true });
    assert.throws(() => inspect(config.root, config, { fs: f.fs, tempDirectory: () => '/tmp', previous: { dev: 2, ino: 99 } }));
  }
  const f = fixture();
  assert.throws(() => inspectManagedRoot(config.root, config, { fs: f.fs, tempDirectory: () => '/other' }));
  f.fs.realpathSync = () => '/different';
  assert.throws(() => inspectManagedRoot(config.root, config, { fs: f.fs, tempDirectory: () => '/tmp' }));
});

test('controller rejects context, root user and expired deadline before any filesystem or listen', async () => {
  for (const mode of ['platform', 'env', 'uid', 'deadline']) {
    const f = fixture();
    if (mode === 'platform') f.runtime.platform = 'win32';
    if (mode === 'env') f.runtime.env = {};
    if (mode === 'uid') f.runtime.getuid = () => 0;
    if (mode === 'deadline') f.set(budgets.ready);
    await assert.rejects(listenManagedControl(f.operations));
    assert.equal(f.accesses.length, 0); assert.equal(f.creates, 0);
  }
});

test('controller never unlinks an existing endpoint or treats unknown lookup failure as absence', async () => {
  for (const options of [{ socketExists: true }, { lookupCode: 'EACCES' }]) {
    const f = fixture(options);
    await assert.rejects(listenManagedControl(f.operations));
    assert.equal(f.creates, 0); assert.equal(f.timers.size, 0);
  }
});

test('listen errors, changed root and late filesystem callback cannot yield an open transport', async () => {
  for (const mode of ['error', 'rootChanged', 'lateRead', 'chmodFailed']) {
    const f = fixture({ deferredListen: true });
    const opening = listenManagedControl(f.operations);
    if (mode === 'error') f.server.emit('error', Error('PRIVATE'));
    if (mode === 'rootChanged') f.root.ino++;
    if (mode === 'lateRead') f.fs.chmodSync = () => { f.set(budgets.ready); };
    if (mode === 'chmodFailed') f.fs.chmodSync = () => { throw Error('PRIVATE'); };
    if (mode !== 'error') f.server.bind();
    await assert.rejects(opening);
    assert.equal(f.accept().destroyed, true);
    await setImmediate();
    assert.equal(f.timers.size, 0);
  }
});

test('duplex control keeps its read side until expected EOF and verifies only transport closure', async () => {
  const f = await openedFixture();
  assert.equal(f.socket.resumes, 1);
  f.socket.emit('data', encodeMessage(message('READY', config.generation)));
  await f.connection.ready;
  f.transport.checkOpen();
  assert.throws(() => f.transport.verifyClosed());
  f.transport.end();
  assert.equal(f.socket.ends, 1); assert.equal(f.socket.destroyed, false);
  assert.throws(() => f.transport.checkOpen());
  f.socket.finish();
  await f.transport.closed;
  f.transport.verifyClosed();
  assert.equal(f.timers.size, 0);
});

test('READY then premature EOF poisons GO gate even though generic response check permits ended stream', async () => {
  const f = await openedFixture();
  f.socket.emit('data', encodeMessage(message('READY', config.generation)));
  await f.connection.ready;
  f.socket.emit('end');
  await f.transport.closed;
  assert.throws(() => f.transport.checkOpen());
  assert.throws(() => f.transport.end());
  assert.throws(() => f.transport.verifyClosed());
});

test('control rejects duplicate connection even after first disconnect; a new channel never replaces it', async () => {
  for (const afterDisconnect of [false, true]) {
    const f = await openedFixture();
    f.socket.emit('data', encodeMessage(message('READY', config.generation)));
    await f.connection.ready;
    if (afterDisconnect) f.socket.destroy();
    const extra = f.accept();
    assert.equal(extra.destroyed, true); assert.equal(f.socket.destroyed, true);
    await f.transport.closed;
    assert.throws(() => f.transport.verifyClosed());
    assert.throws(() => f.transport.checkOpen());
  }
});

test('wrong, replayed, partial and over-limit replies never authorize the open gate', async () => {
  for (const bytes of [Buffer.from('PRIVATE\n'), encodeMessage(message('READY', 'b'.repeat(32))),
    Buffer.concat([encodeMessage(message('READY', config.generation)), Buffer.from('{')]),
    Buffer.concat([encodeMessage(message('READY', config.generation)), encodeMessage(message('READY', config.generation))]),
    Buffer.alloc(4097, 32)]) {
    const f = await openedFixture();
    f.socket.emit('data', bytes);
    await f.connection.ready.catch(() => {});
    assert.throws(() => f.transport.checkOpen());
    await f.transport.dispose();
    assert.throws(() => f.transport.verifyClosed());
  }
});

test('late listen and late connection cannot publish usable control after the original ready deadline', async () => {
  const f = fixture({ deferredListen: true });
  const opening = listenManagedControl(f.operations);
  f.advance(budgets.ready);
  await assert.rejects(opening);
  f.server.bind();
  const late = f.accept();
  assert.equal(late.destroyed, true);
  assert.equal(f.timers.size, 0);
});

test('ready and whole transport deadlines never reset and dispose live sockets', async () => {
  for (const ready of [false, true]) {
    const f = await openedFixture();
    if (ready) {
      f.socket.emit('data', encodeMessage(message('READY', config.generation)));
      await f.connection.ready;
    }
    f.advance(ready ? budgets.wrapper : budgets.ready);
    await f.transport.closed;
    assert.equal(f.socket.destroyed, true);
    assert.throws(() => f.transport.verifyClosed());
    assert.equal(f.timers.size, 0);
  }
});

test('open gate revalidates root and socket inode before control use', async () => {
  for (const target of ['root', 'endpoint']) {
    const f = await openedFixture();
    f.socket.emit('data', encodeMessage(message('READY', config.generation)));
    await f.connection.ready;
    f[target].ino++;
    assert.throws(() => f.transport.checkOpen());
    await f.transport.dispose();
  }
});

function initFixture(options = {}) {
  const f = fixture({ socketExists: true });
  const socket = channel();
  const exits = []; const launches = []; const connections = [];
  const leaf = channel();
  const child = Object.assign(new EventEmitter(), { stdio: [null, null, null, null, leaf] });
  Object.assign(f.runtime, { stdin: channel(), cwd: () => config.root, execPath: '/synthetic/node',
    stderr: channel(), exit: code => exits.push(code) }, options.runtime);
  const run = () => {
    runManagedNamespaceInit({ runtime: f.runtime, fs: f.fs, tempDirectory: () => '/tmp',
      readStatus: () => options.status ?? status, now: f.now, time: f.time, nonce: () => 'b'.repeat(32),
      connect(value) { connections.push(value); return socket; },
      spawnChild(...args) { launches.push(args); return child; },
    });
    if (!options.deferredConnect) socket.emit('connect');
  };
  return { ...f, socket, leaf, child, exits, launches, connections, run };
}

test('managed init checks CI, PID1 and every dropped credential before filesystem, connect or READY', () => {
  for (const options of [{ runtime: { platform: 'win32' } }, { runtime: { env: {} } }, { runtime: { pid: 2 } },
    { runtime: { getuid: () => 0 } }, { status: status.replace('Groups:\t\n', 'Groups:\t27\n') },
    { status: status.replace('CapBnd:\t0000000000000000', 'CapBnd:\t0000000000000001') },
    { status: status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0') }]) {
    const f = initFixture(options); f.run();
    assert.deepEqual(f.exits, [failureExit]); assert.deepEqual(f.launches, []);
    assert.deepEqual(f.connections, []); assert.deepEqual(f.socket.writes, []);
    assert.deepEqual(f.accesses, []);
  }
});

test('managed init connects only to exact private endpoint and shares the original workload/EOF protocol', () => {
  const f = initFixture(); f.run();
  assert.deepEqual(f.connections, [{ path: `${config.root}/control.sock`, allowHalfOpen: true }]);
  assert.equal(JSON.parse(f.socket.writes[0]).type, 'READY');
  f.socket.emit('data', encodeMessage(message('GO', config.generation)));
  assert.equal(f.launches.length, 1);
  f.child.emit('message', message('HANDOFF', config.generation));
  f.child.emit('exit', 0, null);
  f.leaf.emit('data', encodeMessage(message('ALIVE', config.generation, 'b'.repeat(32))));
  assert.equal(JSON.parse(f.socket.writes[1]).type, 'WORKLOAD');
  f.socket.emit('end');
  assert.deepEqual(f.exits, [expectedEofExit]); assert.equal(f.timers.size, 0);
  assert.equal(f.socket.ends, 0);
});

test('init rejects same-chunk duplicate or partial GO tails before the first workload launch', () => {
  for (const tail of [Buffer.from('{'), encodeMessage(message('GO', config.generation))]) {
    const f = initFixture(); f.run();
    f.socket.emit('data', Buffer.concat([encodeMessage(message('GO', config.generation)), tail]));
    assert.deepEqual(f.launches, []); assert.deepEqual(f.exits, [failureExit]);
  }
});

test('unsolicited bytes after a valid GO fail immediately without waiting for a frame or extending the deadline', () => {
  const f = initFixture(); f.run();
  f.socket.emit('data', encodeMessage(message('GO', config.generation)));
  assert.equal(f.launches.length, 1);
  f.socket.emit('data', Buffer.from('{'));
  assert.deepEqual(f.exits, [failureExit]);
  f.socket.emit('end');
  assert.deepEqual(f.exits, [failureExit]);
});

test('managed init rejects stale paths, connect errors and delayed READY write callback', () => {
  for (const mode of ['root', 'socket', 'error', 'lateWrite']) {
    const f = initFixture();
    if (mode === 'root') f.root.mode = 0o40777;
    if (mode === 'socket') f.endpoint.isSocket = () => false;
    if (mode === 'lateWrite') f.socket.write = (_bytes, done) => { f.set(budgets.ready); done(); };
    f.run();
    if (mode === 'error') f.socket.emit('error', Error('PRIVATE'));
    assert.deepEqual(f.exits, [failureExit]); assert.deepEqual(f.launches, []);
  }
});

test('filesystem delay prevents connection and delayed connect never queues or writes READY', () => {
  for (const mode of ['filesystem', 'connect', 'expiredInit']) {
    const f = initFixture({ deferredConnect: true });
    if (mode === 'filesystem') f.fs.realpathSync = path => { f.set(budgets.ready); return path; };
    f.run();
    assert.deepEqual(f.socket.writes, []);
    if (mode === 'filesystem') assert.deepEqual(f.connections, []);
    else {
      assert.equal(f.connections.length, 1);
      if (mode === 'connect') f.set(budgets.ready);
      else f.advance(budgets.init);
      f.socket.emit('connect');
    }
    assert.deepEqual(f.socket.writes, []); assert.deepEqual(f.launches, []);
    assert.deepEqual(f.exits, [failureExit]);
  }
});

test('init owner loss before GO and ready deadline exhaustion never launch work', () => {
  for (const mode of ['eof', 'deadline', 'lateGo']) {
    const f = initFixture();
    if (mode === 'deadline') f.set(budgets.ready);
    f.run();
    if (mode === 'eof') f.socket.emit('end');
    if (mode === 'lateGo') { f.set(budgets.ready); f.socket.emit('data', encodeMessage(message('GO', config.generation))); }
    assert.deepEqual(f.exits, [failureExit]); assert.deepEqual(f.launches, []);
  }
});

test('transport error after READY stays failed through late clean close', async () => {
  const f = await openedFixture();
  f.socket.emit('data', encodeMessage(message('READY', config.generation)));
  await f.connection.ready;
  f.socket.emit('error', Error('PRIVATE'));
  await f.transport.closed;
  f.socket.emit('end');
  await setImmediate();
  assert.throws(() => f.transport.verifyClosed());
});

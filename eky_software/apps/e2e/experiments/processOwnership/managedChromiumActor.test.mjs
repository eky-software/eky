import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { runManagedChromiumActor } from './managedChromiumActor.mjs';
import { readManagedChromiumFailure } from './managedChromiumFailure.mjs';
import { actorArguments, budgets, childEnvironment } from './pidNamespaceContract.mjs';
import { installE2eBrowserNetworkBoundary } from '../../src/environment/e2eBrowserNetworkBoundary.ts';

const config = { generation: 'a'.repeat(32), started: '1000000', uid: 1001, gid: 1002, role: 'root' };
const root = '/tmp/eky-managed-ns-ABC123';
const temp = `${root}/browser-tmp`;
const home = `${root}/browser-home`;
const failurePath = `${root}/chromium-failure.json`;

function fixture() {
  let elapsed = 0;
  let key = 0;
  const timers = new Map();
  const calls = [];
  const actions = {};
  const state = { connected: false, pageText: 'Pending', clickText: 'Chromium ready', leaveTemps: false };
  const step = async name => { calls.push(name); await actions[name]?.(); };
  const now = () => 1000000n + BigInt(elapsed) * 1000000n;
  const time = { setTimeout(fn, delay) { timers.set(++key, { fn, at: elapsed + delay }); return key; },
    clearTimeout(id) { timers.delete(id); } };
  const dir = ino => ({ uid: config.uid, gid: config.gid, mode: 0o40700, dev: 2, ino,
    isDirectory: () => true, isSymbolicLink: () => false });
  const dirs = new Map([[root, dir(3)]]);
  let failureBytes;
  const fileStat = () => ({ uid: config.uid, gid: config.gid, mode: 0o100600, dev: 2, ino: 9, nlink: 1,
    size: failureBytes?.length ?? 0, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false });
  const missing = () => Object.assign(Error('PRIVATE'), { code: 'ENOENT' });
  const fs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048 },
    realpathSync: path => path,
    lstatSync(path) {
      if (dirs.has(path)) return { ...dirs.get(path) };
      if (path === failurePath && failureBytes !== undefined) return fileStat();
      throw missing();
    },
    mkdirSync(path, options) {
      calls.push(`mkdir:${path}`); assert.deepEqual(options, { mode: 0o700 });
      if (dirs.has(path)) throw Error('PRIVATE existing directory');
      dirs.set(path, dir(dirs.size + 3));
    },
    rmdirSync(path) {
      calls.push('removeTemp'); assert.equal(path, temp);
      if ([...dirs.keys()].some(name => name.startsWith(`${path}/`))) throw Error('PRIVATE nonempty');
      dirs.delete(path);
    },
    promises: { async rm(path, options) {
      assert.equal(path, home); assert.deepEqual(options, { recursive: true, force: false, maxRetries: 0 });
      await step('removeHome');
      for (const name of dirs.keys()) if (name === home || name.startsWith(`${home}/`)) dirs.delete(name);
    } },
    openSync(path, flags, mode) {
      assert.equal(path, failurePath);
      if (flags === 'wx') {
        calls.push('writeFailure'); assert.equal(mode, 0o600);
        if (failureBytes !== undefined) throw Error('PRIVATE already written');
        failureBytes = Buffer.alloc(0);
      } else assert.equal(flags, fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      return 7;
    },
    fstatSync: () => fileStat(),
    writeSync(fd, bytes, offset, length) {
      assert.equal(fd, 7); failureBytes = Buffer.from(bytes.subarray(offset, offset + length)); return length;
    },
    readSync(fd, bytes, offset, length, position) {
      assert.equal(fd, 7);
      const count = Math.min(length, Math.max(0, failureBytes.length - position));
      failureBytes.copy(bytes, offset, position, position + count); return count;
    },
    closeSync() {},
  };
  const exits = [];
  const runtime = { platform: 'linux', env: childEnvironment(), pid: 2, ppid: 1, connected: true,
    getuid: () => config.uid, geteuid: () => config.uid, getgid: () => config.gid, getegid: () => config.gid,
    cwd: () => root, send() { throw Error('No worker IPC handoff'); }, exit(code) { exits.push(code); } };
  const routes = {};
  const server = new EventEmitter();
  server.listening = false;
  server.address = () => ({ address: '127.0.0.1', port: 43123 });
  server.listen = (port, host, done) => {
    assert.equal(port, 0); assert.equal(host, '127.0.0.1');
    void step('listen').then(() => { server.listening = true; done(); }, error => server.emit('error', error));
  };
  server.close = done => {
    void step('serverClose').then(() => { server.listening = false; done(); }, done);
  };
  server.request = (method, url, host = '127.0.0.1:43123') => {
    const result = {};
    server.handler({ method, url, headers: { host }, resume() {} }, {
      writeHead(status, headers) { result.status = status; result.headers = headers; },
      end(body) { result.body = body; },
    });
    return result;
  };
  const browser = new EventEmitter();
  browser.isConnected = () => state.connected;
  browser.close = async () => {
    await step('browserClose'); state.connected = false; browser.emit('disconnected');
    if (!state.leaveTemps) for (const path of [...dirs.keys()]) if (path.startsWith(`${temp}/`)) dirs.delete(path);
  };
  const page = new EventEmitter();
  page.goto = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:43123'); assert.equal(options.waitUntil, 'load');
    assert.ok(options.timeout > 0 && options.timeout <= budgets.workload);
    await step('goto');
    const result = server.request('GET', '/');
    assert.match(result.body, /Run proof/u); return { status: () => state.navigationStatus ?? result.status };
  };
  page.getByRole = (role, options) => {
    if (role === 'button') {
      assert.deepEqual(options, { name: 'Run proof', exact: true });
      return { async click({ timeout }) { assert.ok(timeout > 0); await step('click'); state.pageText = state.clickText; } };
    }
    assert.equal(role, 'status');
    return { async textContent({ timeout }) { assert.ok(timeout > 0); await step('dom'); return state.pageText; } };
  };
  const context = {
    async route(pattern, handler) { assert.equal(pattern, '**/*'); routes.http = handler; await step('route'); },
    async routeWebSocket(pattern, handler) { assert.ok(pattern instanceof RegExp); routes.ws = handler; await step('routeWs'); },
    async newPage() { await step('newPage'); return page; },
    async close() { await step('contextClose'); },
    request: { async get(url, options) {
      assert.equal(url, 'http://127.0.0.1:43123/proof'); assert.equal(options.maxRedirects, 0); assert.ok(options.timeout > 0);
      await step('apiGet');
      const result = server.request('GET', '/proof');
      return { status: () => state.apiStatus ?? result.status, url: () => state.apiUrl ?? url,
        async text() { await step('apiText'); return state.apiBody ?? result.body; },
        async dispose() { await step('responseDispose'); } };
    } },
  };
  browser.newContext = async options => {
    assert.deepEqual(options, { locale: 'fi-FI', timezoneId: 'Europe/Helsinki', serviceWorkers: 'block' });
    await step('newContext'); return context;
  };
  const chromium = { async launch(options) {
    assert.deepEqual(Object.keys(options), ['headless', 'env', 'timeout']);
    assert.equal(options.headless, true); assert.ok(options.timeout > 0 && options.timeout <= budgets.workload);
    assert.deepEqual(options.env, runtime.env);
    assert.equal(options.env.TMPDIR, temp); assert.equal(options.env.HOME, home);
    await step('launch');
    dirs.set(`${temp}/playwright-artifacts-fixture`, dir(7));
    dirs.set(`${temp}/playwright_chromiumdev_profile-fixture`, dir(8));
    state.connected = true; return browser;
  } };
  const handoffs = [];
  const operations = { runtime, fs, now, time, tempDirectory: () => '/tmp',
    argv: [...actorArguments(config, 'root'), `--root=${root}`],
    createHttpServer(handler) { calls.push('createServer'); server.handler = handler; return server; },
    async loadPlaywright() { assert.deepEqual(runtime.env, childEnvironment()); await step('import'); return { chromium }; },
    async loadNetworkBoundary() { await step('boundaryImport'); return { installE2eBrowserNetworkBoundary }; },
    handoff(value, options) { calls.push('handoff'); handoffs.push(value); assert.equal(options.now, now); assert.equal(options.runtime, runtime); },
  };
  const scope = { root, generation: config.generation, uid: config.uid, gid: config.gid,
    tempRoot: '/tmp', rootReceipt: { dev: 2, ino: 3 } };
  return { calls, actions, state, timers, dirs, fs, runtime, server, browser, page, routes, exits, handoffs, operations,
    diagnostic: () => readManagedChromiumFailure(scope, { fs, runtime }),
    get failureBytes() { return failureBytes; },
    set(ms) { elapsed = ms; },
    advance(ms) {
      elapsed = ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed && timers.delete(id)) timer.fn();
      }
    } };
}

test('fixed Page/API workload closes everything and removes only owned scratch before original actor handoff', async () => {
  const f = fixture(); assert.equal(await runManagedChromiumActor(f.operations), true);
  assert.deepEqual(f.handoffs, [config]); assert.deepEqual(f.exits, []); assert.equal(f.timers.size, 0);
  assert.deepEqual([...f.dirs.keys()], [root]); assert.equal(f.failureBytes, undefined);
  assert.deepEqual(f.calls.filter(name => ['responseDispose', 'contextClose', 'browserClose', 'serverClose',
    'removeTemp', 'removeHome', 'handoff'].includes(name)),
  ['responseDispose', 'contextClose', 'browserClose', 'serverClose', 'removeTemp', 'removeHome', 'handoff']);
  assert.equal(f.server.request('POST', '/proof').status, 404);
  assert.equal(f.server.request('GET', '/', 'external.invalid').status, 404);
  assert.equal(f.server.request('GET', '/unknown').status, 404);
  assert.equal(f.runtime.env.XDG_CACHE_HOME, `${home}/cache`);
});

test('default dynamic TS boundary import works with native Node and mocked browser/HTTP', async () => {
  const f = fixture(); delete f.operations.loadNetworkBoundary;
  assert.equal(await runManagedChromiumActor(f.operations), true);
  assert.equal(typeof f.routes.http, 'function'); assert.equal(typeof f.routes.ws, 'function');
  assert.deepEqual(f.handoffs, [config]);
});

for (const mode of ['platform', 'env', 'unsafeEnv', 'identity', 'ipc', 'pid', 'role', 'extra', 'root', 'cwd', 'deadline']) {
  test(`guards refuse ${mode} before imports, HTTP or browser launch`, async () => {
    const f = fixture();
    if (mode === 'platform') f.runtime.platform = 'win32';
    if (mode === 'env') f.runtime.env.EKY_E2E = '0';
    if (mode === 'unsafeEnv') f.runtime.env.NODE_OPTIONS = '--require=PRIVATE';
    if (mode === 'identity') f.runtime.geteuid = () => 0;
    if (mode === 'ipc') f.runtime.connected = false;
    if (mode === 'pid') f.runtime.ppid = 99;
    if (mode === 'role') f.operations.argv[4] = '--role=leaf';
    if (mode === 'extra') f.operations.argv.push('--extra=1');
    if (mode === 'root') f.operations.argv[5] = '--root=/unowned';
    if (mode === 'cwd') f.runtime.cwd = () => '/different';
    if (mode === 'deadline') f.set(budgets.workload);
    assert.equal(await runManagedChromiumActor(f.operations), false);
    assert.deepEqual(f.exits, [42]); assert.deepEqual(f.handoffs, []);
    assert.equal(f.calls.includes('import'), false); assert.equal(f.calls.includes('createServer'), false);
    assert.equal(f.timers.size, 0);
  });
}

for (const [operation, phase] of [
  ['import', 'import'], ['boundaryImport', 'import'], ['listen', 'launch'], ['launch', 'launch'],
  ['newContext', 'launch'], ['route', 'launch'], ['goto', 'assert'], ['apiGet', 'assert'],
  ['contextClose', 'close'], ['browserClose', 'close'], ['serverClose', 'close'], ['removeHome', 'tempCleanup'],
]) {
  test(`${operation} failure is bounded, classified and never hands off`, async () => {
    const f = fixture(); f.actions[operation] = () => { throw Error('PRIVATE path /secret/browser'); };
    assert.equal(await runManagedChromiumActor(f.operations), false);
    assert.deepEqual(f.exits, [42]); assert.deepEqual(f.handoffs, []); assert.equal(f.timers.size, 0);
    assert.deepEqual(f.diagnostic(), { status: 'valid', phase, reason: 'operationFailed' });
    assert.doesNotMatch(f.failureBytes.toString(), /PRIVATE|secret|stack/u);
  });
}

for (const [field, value] of [['navigationStatus', 500], ['clickText', 'wrong'], ['apiStatus', 500],
  ['apiUrl', 'http://external.invalid/proof'], ['apiBody', '{"proof":"wrong"}']]) {
  test(`incorrect ${field} is an assertion failure, not an actor fallback`, async () => {
    const f = fixture(); f.state[field] = value;
    assert.equal(await runManagedChromiumActor(f.operations), false);
    assert.deepEqual(f.diagnostic(), { status: 'valid', phase: 'assert', reason: 'postconditionFailed' });
    assert.deepEqual(f.handoffs, []);
  });
}

test('actual TypeScript boundary blocks external requests without a runtime loader or network', async () => {
  const f = fixture(); let aborted = false;
  f.actions.goto = async () => f.routes.http({ request: () => ({ url: () => 'https://external.invalid/' }),
    abort: async () => { aborted = true; }, continue: async () => { throw Error('Must not connect'); } });
  assert.equal(await runManagedChromiumActor(f.operations), false); assert.equal(aborted, true);
  assert.deepEqual(f.diagnostic(), { status: 'valid', phase: 'assert', reason: 'operationFailed' });
});

test('unexpected browser disconnection, page crash and server failure cannot complete', async () => {
  for (const trigger of [f => f.browser.emit('disconnected'), f => f.page.emit('crash'),
    f => f.server.emit('error', Error('PRIVATE'))]) {
    const f = fixture(); f.actions.goto = () => trigger(f);
    assert.equal(await runManagedChromiumActor(f.operations), false);
    assert.deepEqual(f.exits, [42]); assert.deepEqual(f.handoffs, []);
    assert.equal(f.calls.filter(name => name === 'writeFailure').length, 1);
  }
});

test('Playwright temp leftovers are retained, never recursively swept', async () => {
  const f = fixture(); f.state.leaveTemps = true;
  assert.equal(await runManagedChromiumActor(f.operations), false);
  assert.deepEqual(f.diagnostic(), { status: 'valid', phase: 'tempCleanup', reason: 'operationFailed' });
  assert.equal(f.calls.includes('removeHome'), false); assert.ok(f.dirs.has(temp)); assert.ok(f.dirs.has(home));
});

test('preexisting, replaced or linked scratch/root prevents cleanup and handoff', async () => {
  for (const mode of ['existing', 'homeInode', 'tempLink', 'rootInode', 'uid']) {
    const f = fixture();
    if (mode === 'existing') f.dirs.set(temp, f.dirs.get(root));
    else f.actions.serverClose = () => {
      if (mode === 'homeInode') f.dirs.get(home).ino++;
      if (mode === 'tempLink') f.dirs.get(temp).isSymbolicLink = () => true;
      if (mode === 'rootInode') f.dirs.get(root).ino++;
      if (mode === 'uid') f.runtime.getuid = () => 0;
    };
    assert.equal(await runManagedChromiumActor(f.operations), false);
    assert.deepEqual(f.handoffs, []); assert.equal(f.calls.includes('removeHome'), false);
    assert.ok(f.dirs.has(root));
  }
});

for (const [operation, phase] of [['import', 'import'], ['launch', 'launch'], ['apiGet', 'assert'],
  ['browserClose', 'close'], ['removeHome', 'tempCleanup']]) {
  test(`pending ${operation} stops at original 8s; late continuation cannot hand off`, async () => {
    const f = fixture(); let release;
    f.actions[operation] = () => new Promise(resolve => { release = resolve; });
    f.set(4800);
    const running = runManagedChromiumActor(f.operations);
    await setImmediate(); assert.equal(typeof release, 'function');
    assert.deepEqual([...f.timers.values()].map(timer => timer.at), [budgets.workload]);
    f.advance(budgets.workload); assert.equal(await running, false);
    assert.deepEqual(f.exits, [42]);
    assert.deepEqual(f.diagnostic(), { status: 'valid', phase, reason: 'deadlineExceeded' });
    const count = f.calls.length;
    release(); await setImmediate();
    assert.deepEqual(f.handoffs, []); assert.deepEqual(f.exits, [42]); assert.equal(f.calls.length, count);
  });
}

test('clock expiry without timer delivery is rejected after await and synchronous cleanup', async () => {
  for (const operation of ['apiGet', 'removeHome']) {
    const f = fixture(); f.actions[operation] = () => f.set(budgets.workload);
    assert.equal(await runManagedChromiumActor(f.operations), false);
    assert.equal(f.diagnostic().reason, 'deadlineExceeded'); assert.deepEqual(f.handoffs, []);
  }
});

test('diagnostic write failure does not allow handoff or a second write attempt', async () => {
  const f = fixture(); f.actions.goto = () => { throw Error('PRIVATE'); };
  let attempts = 0; f.fs.openSync = () => { attempts++; throw Error('PRIVATE'); };
  assert.equal(await runManagedChromiumActor(f.operations), false);
  f.server.emit('error', Error('another PRIVATE failure'));
  assert.equal(attempts, 1); assert.deepEqual(f.exits, [42]); assert.deepEqual(f.handoffs, []);
});

test('later server/browser errors and deadline cannot overwrite the first assertion failure', async () => {
  const f = fixture(); f.state.clickText = 'wrong';
  assert.equal(await runManagedChromiumActor(f.operations), false);
  const first = Buffer.from(f.failureBytes);
  f.server.emit('error', Error('PRIVATE cleanup'));
  f.browser.emit('disconnected'); f.advance(budgets.workload);
  assert.deepEqual(f.failureBytes, first);
  assert.deepEqual(f.diagnostic(), { status: 'valid', phase: 'assert', reason: 'postconditionFailed' });
  assert.deepEqual(f.exits, [42]); assert.deepEqual(f.handoffs, []);
});

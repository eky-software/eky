import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { guardLinuxService, serviceDeadlines, serviceFrames, serviceMessage, encodeServiceMessage,
  validateServiceConfig, validateServiceMessage, linuxChromiumPaths, linuxChromiumBrowserConfig } from './linuxServiceContract.mjs';
import { linuxServiceLaunchCommand, createLinuxServiceManager } from './linuxServiceManager.mjs';
import { linuxServiceWorkload, prepareLinuxService, readLinuxServiceConfig, removeLinuxServiceControl,
  readLinuxChromiumConfig } from './linuxServiceConfiguration.mjs';
import { runLinuxOwnedChromiumServer } from '../../src/environment/linuxOwnedChromiumServer.mjs';
import { requireChromiumReady } from '../../src/environment/chromiumWorkerContract.mjs';
import { readLinuxWorkloadIdentity, readLinuxWorkloadRss, spawnLinuxServiceWorkload } from './linuxServiceWorkload.mjs';
import { managedUnitProperties, managedUnitName } from './managedNamespaceUnitContract.mjs';

const generation = 'a'.repeat(32);
// The simulated Linux host is independent of the test runner's host paths.
const linuxServiceInitPath = '/source/apps/e2e/experiments/processOwnership/linuxServiceInit.mjs';
const runtime = () => ({ platform: 'linux', env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true',
  PRIVATE: 'DO_NOT_INHERIT', NODE_OPTIONS: '--require=private' }, execPath: '/opt/node/bin/node',
getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 });
const config = (profile = 'backend') => ({ version: 1, profile, generation, uid: 1001, gid: 1002,
  root: '/tmp/eky-managed-ns-abcdef', repositoryRoot: '/source', runRoot: '/tmp/eky-e2e/run-abcdef',
  node: '/opt/node/bin/node', startUntil: '45001000000', workUntil: '90001000000', redactedValues: ['PRIVATE'],
  ...(profile === 'backend' ? { runtimeConfigPath: '/tmp/eky-e2e/run-abcdef/CASE/runtime-config.json' }
    : profile === 'chromium' ? { browserExecutable: '/cache/chromium-1234/chrome-linux64/chrome', browserGeneration: 'b'.repeat(64) }
    : { webPort: 3456, environmentRoot: '/tmp/eky-e2e/run-abcdef/CASE/temp', backendOrigin: 'http://127.0.0.1:3455',
      sessionSecret: 's'.repeat(43) }) });

function fakeFs(value = config()) {
  const entries = new Map();
  const writes = [];
  const directories = new Set();
  const removed = [];
  const files = new Map([
    [linuxServiceInitPath, 'synthetic init'], ['/opt/node/bin/node', 'synthetic node'],
    ['/source/apps/e2e/src/environment/linuxOwnedChromiumServer.mjs', 'synthetic server'],
    ['/cache/chromium-1234/chrome-linux64/chrome', 'synthetic browser'],
    ['/source/apps/backend/e2e-dist/e2e/backendEntrypoint.js', 'synthetic backend'],
    ['/source/apps/web/vite.config.ts', 'synthetic vite config'],
    ['/tmp/eky-e2e/run-abcdef/CASE/runtime-config.json', '{}'],
    ['/source/node_modules/.pnpm/vite@7.0.0/node_modules/vite/package.json',
      JSON.stringify({ name: 'vite', version: '7.0.0', bin: { vite: 'bin/vite.js' } })],
    ['/source/node_modules/.pnpm/vite@7.0.0/node_modules/vite/bin/vite.js', 'synthetic vite'],
    [value.root + '/service.json', JSON.stringify(value)],
  ]);
  const selector = '/source/apps/web/node_modules/vite';
  const target = '/source/node_modules/.pnpm/vite@7.0.0/node_modules/vite';
  let fd = 0;
  const opened = new Map();
  const fs = {
    lstatSync(path) {
      if (entries.has(path)) return entries.get(path);
      const file = files.has(path);
      if (!file && !directories.has(path) && (removed.includes(path) || /(?:\.json|\.pending)$/u.test(path))) {
        throw Object.assign(new Error('synthetic missing'), { code: 'ENOENT' });
      }
      return { uid: 1001, gid: 1002, mode: file ? 0o100700 : 0o40700, dev: 1, ino: 1, nlink: 1,
        size: file ? Buffer.byteLength(files.get(path)) : 0, mtimeMs: 0, ctimeMs: 0,
        isFile: () => file, isDirectory: () => !file && path !== selector, isSymbolicLink: () => path === selector };
    },
    realpathSync: path => path === selector ? target : path,
    readlinkSync: () => '../../../node_modules/.pnpm/vite@7.0.0/node_modules/vite',
    openSync(path) { opened.set(++fd, path); return fd; },
    fstatSync: handle => fs.lstatSync(opened.get(handle)),
    readSync(handle, buffer) { const bytes = Buffer.from(files.get(opened.get(handle))); bytes.copy(buffer); return bytes.length; },
    closeSync(handle) { opened.delete(handle); },
    mkdtempSync(prefix) { writes.push('root'); directories.add(prefix + 'abcdef'); return prefix + 'abcdef'; },
    mkdirSync(path) { directories.add(path); writes.push('directory'); },
    chmodSync() {},
    writeFileSync(path, bytes, options) { writes.push({ path, options }); files.set(path, bytes);
      entries.set(path, { ...fs.lstatSync(path), mode: 0o100600 }); },
    readdirSync(path) { return [...files.keys(), ...directories].filter(name => name.startsWith(path + '/') &&
      !name.slice(path.length + 1).includes('/')).map(name => name.slice(path.length + 1)); },
    unlinkSync(path) { files.delete(path); entries.delete(path); removed.push(path); },
    rmdirSync(path) { assert.deepEqual(fs.readdirSync(path), []); directories.delete(path); removed.push(path); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from);
      entries.set(to, entries.get(from)); entries.delete(from); },
  };
  return { fs, files, entries, writes, removed, options: { fs, tempDirectory: () => '/tmp', initPath: linuxServiceInitPath } };
}

test('service profiles reject arbitrary commands, paths, environment and mixed profile payloads', () => {
  validateServiceConfig(config()); validateServiceConfig(config('vite'));
  for (const extra of [{ command: '/bin/sh' }, { env: { PRIVATE: 'value' } }, { args: ['--eval'] },
    { profile: 'actor' }, { profile: 'chromium' }, { runtimeConfigPath: '/tmp/outside.json' },
    { repositoryRoot: '/source\n' }, { root: '/tmp/eky-managed-ns-abcdef/other' }, { uid: 0 },
    { startUntil: '99001000000' }, { redactedValues: ['\0'] }]) {
    assert.throws(() => validateServiceConfig({ ...config(), ...extra }));
  }
  for (const extra of [{ backendOrigin: 'http://external.test:3455' }, { backendOrigin: 'http://127.0.0.1:80' },
    { sessionSecret: 'invalid' }, { webPort: 0 }, { environmentRoot: '/outside' }]) {
    assert.throws(() => validateServiceConfig({ ...config('vite'), ...extra }));
  }
});

test('non-Linux, non-CI and root callers fail before file or command access', () => {
  guardLinuxService(runtime());
  for (const change of [r => { r.platform = 'win32'; }, r => { r.env.CI = 'false'; },
    r => { delete r.env.GITHUB_ACTIONS; }, r => { r.env.EKY_E2E = '0'; }, r => { r.getuid = () => 0; },
    r => { r.getegid = () => 9; }]) {
    const r = runtime(); change(r);
    const f = fakeFs();
    assert.throws(() => prepareLinuxService('backend', {}, { runtime: r, fs: f.fs }));
    assert.deepEqual(f.writes, []);
  }
});

test('fixed backend and Vite launches inherit no environment or shell hooks', () => {
  for (const profile of ['backend', 'vite']) {
    const f = fakeFs(config(profile));
    const command = linuxServiceWorkload(config(profile), f.options);
    assert.equal(command.file, '/opt/node/bin/node');
    assert.equal(command.env.PRIVATE, undefined); assert.equal(command.env.NODE_OPTIONS, undefined);
    assert.equal(command.env.NODE_ENV, 'test');
    assert.equal(command.env.PATH, '/usr/bin:/bin');
    assert.equal(command.env.HOME, '/tmp/eky-e2e/run-abcdef/CASE/temp');
    assert.equal(command.env.TMPDIR, command.env.HOME);
    if (profile === 'backend') {
      assert.deepEqual(command.args,
        ['/source/apps/backend/e2e-dist/e2e/backendEntrypoint.js', '--config', config().runtimeConfigPath]);
      assert.equal(command.env.EKY_E2E_OS_TEMP_ROOT, '/tmp');
      assert.equal(command.env.TEMP, command.env.TMPDIR);
      assert.equal(command.env.TMP, command.env.TMPDIR);
    }
    else {
      assert.deepEqual(command.args.slice(1), ['--config', 'vite.config.ts', '--host', '127.0.0.1',
        '--port', '3456', '--strictPort', '--mode', 'eky-e2e']);
      assert.equal(command.env.EKY_E2E_RUNTIME_SESSION, 's'.repeat(43));
    }
  }
});

test('Vite selector, manifest and source paths are checked before artifacts', () => {
  for (const mutate of [f => { f.fs.readlinkSync = () => '/outside/vite'; },
    f => { f.files.set('/source/node_modules/.pnpm/vite@7.0.0/node_modules/vite/package.json',
      JSON.stringify({ name: 'other', version: '7.0.0', bin: { vite: 'bin/vite.js' } })); },
    f => { f.entries.set('/source/apps/web/vite.config.ts', { isSymbolicLink: () => true }); }]) {
    const f = fakeFs(config('vite')); mutate(f);
    assert.throws(() => linuxServiceWorkload(config('vite'), f.options));
    assert.deepEqual(f.writes, []);
  }
});

test('preparation consumes the original lifetime once and anchors before its read', () => {
  const f = fakeFs(); let now = 1_000_000n; let reads = 0;
  const prepared = prepareLinuxService('backend', { ...config(), startupDeadline: 45_001,
    lifetime: { readRemainingWorkMilliseconds() { reads++; now += 10_000_000n; return 90_000; } } },
  { ...f.options, runtime: runtime(), now: () => now, performanceNow: () => 1, nonce: () => generation });
  assert.equal(reads, 1);
  assert.equal(prepared.config.startUntil, '45001000000');
  assert.equal(prepared.config.workUntil, '90001000000');
  assert.deepEqual(f.writes[1].options, { flag: 'wx', mode: 0o600 });
});

test('private configuration rejects links, hardlinks, changed metadata and extra fields', () => {
  for (const mutate of [f => { f.entries.set(config().root + '/service.json', { ...f.fs.lstatSync(config().root + '/service.json'), nlink: 2 }); },
    f => { f.files.set(config().root + '/service.json', JSON.stringify({ ...config(), env: {} })); },
    f => { const old = f.fs.fstatSync; f.fs.fstatSync = fd => ({ ...old(fd), ino: 8 }); }]) {
    const f = fakeFs();
    const path = config().root + '/service.json';
    f.entries.set(path, { ...f.fs.lstatSync(path), mode: 0o100600 });
    mutate(f);
    assert.throws(() => readLinuxServiceConfig(config().root, { ...f.options, runtime: runtime() }));
  }
});

test('service deadlines are absolute, stop is latched and clock reversal is sticky', () => {
  let now = 1_000_000n;
  const clock = serviceDeadlines(config(), () => now);
  assert.equal(clock.remaining('ready'), 45_000); assert.equal(clock.remaining('work'), 90_000);
  now += 20_000_000_000n; assert.equal(clock.remaining('ready'), 25_000);
  clock.beginCleanup(); assert.equal(clock.remaining('wrapper'), 3000);
  now += 1_000_000_000n; clock.beginCleanup(); assert.equal(clock.remaining('wrapper'), 2000);
  now -= 1n; assert.throws(() => clock.check('work'));
  now += 2n; assert.throws(() => clock.check('work'));
});

test('LM launch preserves containment but uses service deadlines rather than experiment limits', () => {
  const clock = serviceDeadlines(config(), () => 1_000_000n);
  const command = linuxServiceLaunchCommand(config(), clock, linuxServiceInitPath);
  assert.equal(command.file, '/usr/bin/sudo');
  for (const value of ['TimeoutStartSec=45000ms', 'RuntimeMaxSec=93000ms', 'TimeoutStopSec=1000ms',
    'KillMode=control-group', 'RemainAfterExit=no', 'CollectMode=inactive', 'SuccessExitStatus=',
    'User=root', 'Group=root', 'NoNewPrivileges=yes', 'ProtectControlGroups=yes']) {
    assert.ok(command.args.includes('--property=' + value), value);
  }
  assert.ok(command.args.indexOf('/usr/bin/setpriv') < command.args.indexOf(config().node));
  assert.ok(command.args.includes('--clear-groups')); assert.ok(command.args.includes('--bounding-set=-all'));
  assert.ok(!command.args.some(value => value.includes('PRIVATE') || value.includes('sessionSecret')));
  assert.deepEqual(command.args.slice(-3), [config().node, linuxServiceInitPath, '--root=' + config().root]);
});

test('protocol rejects extra fields, stale generation, duplicate keys and pipelined GO before delivery', () => {
  const value = serviceMessage(generation, 'go', 1);
  assert.throws(() => validateServiceMessage({ ...value, pid: 123 }, generation));
  assert.throws(() => validateServiceMessage(value, 'b'.repeat(32)));
  let delivered = 0;
  for (const bytes of [Buffer.concat([encodeServiceMessage(value), Buffer.from('{')]),
    Buffer.from(JSON.stringify(value).replace('"version":1', '"version":1,"version":1') + '\n'),
    Buffer.alloc(524_289, 65)]) {
    const frames = serviceFrames(() => { delivered++; });
    assert.throws(() => frames.push(bytes));
  }
  assert.equal(delivered, 0);
});

function procFs({ start = '100', rss = 'VmRSS:\t512 kB\n', replacement } = {}) {
  let reads = 0;
  return { openSync: path => path, closeSync() {}, readSync(path, buffer) {
    const text = path.endsWith('/stat') ? `23 (node) S 1 ${Array(17).fill('0').join(' ')} ${++reads > 1 && replacement ? replacement : start} 0 0\n` : rss;
    const bytes = Buffer.from(text); bytes.copy(buffer); return bytes.length;
  } };
}
test('RSS binds the retained namespace child and start tick, never a host or wrapper PID', () => {
  const child = { pid: 23, exitCode: null, signalCode: null };
  assert.equal(readLinuxWorkloadIdentity(23, procFs()), '100');
  assert.equal(readLinuxWorkloadRss(child, '100', procFs()), 512 * 1024);
  for (const fs of [procFs({ replacement: '200' }), procFs({ rss: 'VmRSS:\t0 kB\n' }),
    procFs({ rss: 'VmRSS:\t512 kB\nVmRSS:\t512 kB\n' })]) {
    assert.throws(() => readLinuxWorkloadRss(child, '100', fs));
  }
  assert.throws(() => readLinuxWorkloadRss({ ...child, exitCode: 0 }, '100', procFs()));
  assert.throws(() => readLinuxWorkloadIdentity(1, procFs()));
});

test('actual child events supply startup and root exit; output is bounded and split secrets are redacted', async () => {
  const child = new EventEmitter(); Object.assign(child, { pid: 23, exitCode: null, signalCode: null,
    stdout: new EventEmitter(), stderr: new EventEmitter() });
  const terminals = [];
  let spawnOptions;
  const workload = spawnLinuxServiceWorkload({ file: '/opt/node/bin/node', args: ['fixed'], cwd: '/source', env: {} },
    ['PRIVATE'], value => terminals.push(value), { fs: procFs(), spawnChild(file, args, options) { spawnOptions = options; return child; } });
  child.emit('spawn'); assert.equal((await workload.started).state, 'running');
  assert.equal(spawnOptions.shell, false); assert.equal(spawnOptions.detached, false);
  child.stdout.emit('data', Buffer.from('PRI')); child.stdout.emit('data', Buffer.from('VATE\n'));
  child.stderr.emit('data', Buffer.alloc(80_000, 65)); child.stderr.emit('data', Buffer.from('\n'));
  assert.equal(workload.snapshot().stdout, '[REDACTED]\n'); assert.equal(workload.snapshot().stderr, '');
  child.emit('exit', 1, null); child.emit('close', 1, null);
  assert.equal(terminals.length, 1); assert.equal(terminals[0].state, 'exited');
  assert.throws(() => workload.rss());
});

test('manager uses exact invocation receipt and never treats stop command acceptance as absence', async () => {
  const unit = managedUnitName(generation);
  const running = { Id: unit, InvocationID: 'b'.repeat(32), LoadState: 'loaded', Transient: 'yes',
    ActiveState: 'active', SubState: 'running', Result: 'success', MainPID: '123', ControlPID: '0',
    ControlGroup: '/system.slice/' + unit, ExecMainCode: '0', ExecMainStatus: '0',
    ExecMainStartTimestampMonotonic: '1000', ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties };
  let observation = running;
  const calls = [];
  const manager = createLinuxServiceManager(config(), serviceDeadlines(config(), () => 1_000_000n), {
    initPath: linuxServiceInitPath,
    runtime: runtime(), startCommand: () => ({ result: Promise.resolve(observation), closed: Promise.resolve() }),
    spawnChild(file, args, options) {
      calls.push({ file, args, options });
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => { child.emit('spawn'); child.stdout.emit('end'); child.stderr.emit('end');
        child.emit('exit', 0, null); child.emit('close', 0, null); });
      return child;
    },
  });
  await manager.prepare(); await manager.launch(); await manager.own();
  assert.deepEqual(await manager.observe(), { waitingWrapper: 'pending' });
  observation = { ...running, MainPID: '0', ActiveState: 'failed', SubState: 'failed', Result: 'exit-code',
    ExecMainCode: '1', ExecMainStatus: '41', ExecMainExitTimestampMonotonic: '2000' };
  assert.equal((await manager.observe()).waitingWrapper, 'normalExit');
  observation = { ...observation, InvocationID: 'c'.repeat(32) };
  await assert.rejects(manager.emergencyStop());
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.env.PRIVATE, undefined);
  await manager.settle();
});

test('manager command exit alone is pending; error plus later zero close does not synthesize success', async () => {
  for (const error of [false, true]) {
    let child;
    let kills = 0;
    const manager = createLinuxServiceManager(config(), serviceDeadlines(config(), () => 1_000_000n), {
      initPath: linuxServiceInitPath,
      runtime: runtime(), startCommand: () => ({ result: Promise.resolve(), closed: Promise.resolve() }),
      spawnChild() {
        child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        child.kill = () => { kills++; return false; };
        return child;
      },
    });
    const preparing = manager.prepare();
    void preparing.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    child.emit('spawn');
    if (error) child.emit('error', new Error('PRIVATE error'));
    child.stdout.emit('end'); child.stderr.emit('end'); child.emit('exit', 0, null);
    let closed = false; const draining = manager.settle().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    child.emit('close', 0, null); await draining;
    if (error) {
      await assert.rejects(preparing, failure => failure.reason === 'launchFailed' &&
        !JSON.stringify(failure).includes('PRIVATE'));
      assert.equal(kills, 1);
    } else { await preparing; assert.equal(kills, 0); }
  }
});

test('exhausted original fixture lifetime rejects before creating a new owner root', () => {
  const f = fakeFs();
  assert.throws(() => prepareLinuxService('backend', { ...config(), startupDeadline: 45001,
    lifetime: { readRemainingWorkMilliseconds: () => 0 } }, { ...f.options, runtime: runtime(),
    now: () => 1_000_000n, performanceNow: () => 1 }), { reason: 'startupDeadlineExceeded' });
  assert.deepEqual(f.writes, []);
});

function prepareChromium(f = fakeFs(config('chromium')), changes = {}) {
  const input = { ...config('chromium'), startupDeadline: 45001,
    lifetime: { readRemainingWorkMilliseconds: () => 90000 }, ...changes };
  const prepared = prepareLinuxService('chromium', input, { ...f.options, runtime: runtime(),
    now: () => 1_000_000n, performanceNow: () => 1, nonce: () => generation, browserNonce: () => 'b'.repeat(64) });
  return { f, prepared, paths: linuxChromiumPaths(prepared.config) };
}

test('Chromium closed profile separates the manager generation, browser nonce and control artifacts', () => {
  const { f, prepared, paths } = prepareChromium();
  assert.equal(prepared.config.generation.length, 32);
  assert.equal(prepared.config.browserGeneration.length, 64);
  const command = linuxServiceWorkload(prepared.config, f.options);
  assert.deepEqual(command.args, ['/source/apps/e2e/src/environment/linuxOwnedChromiumServer.mjs', paths.config]);
  assert.ok(paths.ready.startsWith(prepared.config.runRoot + '/'));
  assert.ok(!paths.config.startsWith(prepared.config.root + '/'));
  assert.equal(command.env.PLAYWRIGHT_BROWSERS_PATH, '/cache');
  assert.equal(command.env.HOME, paths.temp); assert.equal(command.env.TMPDIR, paths.temp);
  assert.deepEqual(Object.keys(command.env).sort(), ['CI', 'EKY_E2E', 'GITHUB_ACTIONS', 'HOME', 'LANG',
    'LC_ALL', 'NODE_ENV', 'PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'TMPDIR'].sort());
  assert.deepEqual(JSON.parse(f.files.get(paths.config)), linuxChromiumBrowserConfig(prepared.config));
  assert.deepEqual(f.fs.readdirSync(prepared.config.root), ['service.json']);
  removeLinuxServiceControl(prepared, { ...f.options, runtime: runtime() });
  assert.ok(f.files.has(paths.config), 'worker owns browser files until connection and namespace cleanup');
});

test('Chromium rejects mixed profile fields, noncanonical executable and invalid nonce before creation', () => {
  for (const extra of [{ browserGeneration: generation }, { browserGeneration: 'b'.repeat(64) + '\n' },
    { endpoint: 'ws://127.0.0.1:3456/' + 'x'.repeat(32) }, { args: ['--no-sandbox'] },
    { browserExecutable: '/cache/chromium-1234/chrome-linux64/other' }, { sessionSecret: 's'.repeat(43) }]) {
    assert.throws(() => validateServiceConfig({ ...config('chromium'), ...extra }));
  }
  for (const mutate of [f => { f.entries.set('/cache/chromium-1234', { isSymbolicLink: () => true }); },
    f => { const path = config('chromium').browserExecutable; f.entries.set(path, { ...f.fs.lstatSync(path), mode: 0o100600 }); }]) {
    const f = fakeFs(config('chromium')); mutate(f);
    assert.throws(() => prepareChromium(f)); assert.deepEqual(f.writes, []);
  }
});

test('post-mkdtemp failures roll back only owned artifacts and leave caller data intact', () => {
  for (const failAt of ['chmod', 'serviceWrite', 'browserWrite']) {
    const f = fakeFs(config('chromium'));
    f.files.delete(config().root + '/service.json');
    if (failAt === 'chmod') f.fs.chmodSync = () => { throw new Error('synthetic chmod'); };
    else {
      const write = f.fs.writeFileSync;
      f.fs.writeFileSync = (path, bytes, options) => {
        write(path, bytes, options);
        if (path.endsWith(failAt === 'serviceWrite' ? '/service.json' : '/browser.json')) throw new Error('synthetic write');
      };
    }
    assert.throws(() => prepareChromium(f));
    assert.ok(f.removed.includes(config().root));
    assert.ok(f.files.has(config().runtimeConfigPath));
    assert.ok(!f.removed.includes(config().runRoot));
    assert.ok(![...f.files.keys()].some(path => path.includes('/chromium-browser-')));
  }
});

test('rollback refuses replaced roots and foreign files, exposing cleanup uncertainty', () => {
  for (const replacement of [true, false]) {
    const f = fakeFs(); f.files.delete(config().root + '/service.json');
    f.fs.chmodSync = path => {
      if (replacement) f.entries.set(path, { ...f.fs.lstatSync(path), ino: 2 });
      else f.files.set(path + '/foreign', 'untouched');
      throw new Error('synthetic chmod');
    };
    assert.throws(() => prepareChromium(f), error => error.preparationCleanupUnverified === true);
    assert.ok(!f.removed.includes(config().root));
  }
});

test('browser configuration reader rejects extra keys, links and changed identity', () => {
  for (const mutate of [(f, paths) => { f.files.set(paths.config, JSON.stringify({
    ...JSON.parse(f.files.get(paths.config)), endpoint: 'private' })); },
  (f, paths) => { f.entries.set(paths.config, { ...f.fs.lstatSync(paths.config), nlink: 2 }); },
  (f, paths) => { f.entries.set(paths.root, { ...f.fs.lstatSync(paths.root), isSymbolicLink: () => true }); },
  f => { const original = f.fs.fstatSync; f.fs.fstatSync = handle => ({ ...original(handle), ino: 2 }); }]) {
    const { f, paths } = prepareChromium(); mutate(f, paths);
    assert.throws(() => readLinuxChromiumConfig(paths.config, { fs: f.fs, identity: { uid: 1001, gid: 1002 } }));
  }
});

function browserServerFixture() {
  const { f, paths, prepared } = prepareChromium();
  const command = linuxServiceWorkload(prepared.config, f.options);
  const r = { ...runtime(), env: command.env };
  let clock = 1_000_000n;
  let launches = 0;
  let options;
  const server = new EventEmitter();
  server.wsEndpoint = () => 'ws://127.0.0.1:3456/' + 'x'.repeat(32);
  const chromium = { executablePath: () => prepared.config.browserExecutable,
    async launchServer(value) { launches++; options = value; return server; } };
  const dependencies = { fs: f.fs, runtime: r, now: () => clock, loadChromium: async () => chromium };
  return { f, paths, prepared, r, server, chromium, dependencies, setClock: value => { clock = value; },
    launches: () => launches, options: () => options,
    run: () => runLinuxOwnedChromiumServer(paths.config, dependencies) };
}

test('public Linux server preserves launch defaults and atomically publishes only the four-key ready frame', async () => {
  const f = browserServerFixture(); await f.run();
  assert.deepEqual(f.options(), { host: '127.0.0.1', port: 0, headless: true,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  const ready = JSON.parse(f.f.files.get(f.paths.ready));
  assert.deepEqual(Object.keys(ready).sort(), ['endpoint', 'generation', 'protocol', 'schemaVersion']);
  assert.equal(requireChromiumReady(ready, 'b'.repeat(64)), f.server.wsEndpoint());
  assert.equal(f.f.files.has(f.paths.ready + '.pending'), false);
  assert.deepEqual(f.f.writes.at(-1).options, { flag: 'wx', mode: 0o600 });
  f.server.emit('close'); assert.equal(f.r.exitCode, 1);
});

test('server guard, default executable mismatch and stale ready fail before public launch', async () => {
  for (const mutate of [f => { f.r.platform = 'win32'; }, f => { f.r.env = { ...f.r.env, CI: 'false' }; },
    f => { f.chromium.executablePath = () => '/other/chrome'; },
    f => { f.f.files.set(f.paths.ready, '{}'); },
    f => { f.r.env = { ...f.r.env, PLAYWRIGHT_BROWSERS_PATH: '/other' }; }]) {
    const f = browserServerFixture(); mutate(f);
    await assert.rejects(f.run(), { message: 'E2E_CHROMIUM_SERVER_FAILED' }); assert.equal(f.launches(), 0);
  }
});

test('server rejects late launch, invalid endpoint and publication error without leaking capability', async () => {
  for (const mutate of [f => { f.chromium.launchServer = async () => {
    f.setClock(BigInt(f.prepared.config.startUntil)); return f.server; }; },
  f => { f.server.wsEndpoint = () => 'ws://external.test/private-capability'; },
  f => { f.f.fs.writeFileSync = () => { throw new Error('private-capability'); }; },
  f => { f.chromium.launchServer = async () => { throw new Error('private-capability'); }; }]) {
    const f = browserServerFixture(); mutate(f);
    await assert.rejects(f.run(), error => error.message === 'E2E_CHROMIUM_SERVER_FAILED' &&
      !String(error.stack).includes('private-capability'));
    assert.equal(f.f.files.has(f.paths.ready), false);
  }
});

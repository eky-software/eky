import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs, { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { compileFunction } from 'node:vm';

const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const ts = rootRequire('typescript');
const e2eRequire = createRequire(new URL('../../package.json', import.meta.url));
const playwrightRequire = createRequire(e2eRequire.resolve('@playwright/test'));
const coreRequire = createRequire(playwrightRequire.resolve('playwright'));
const bundlePath = coreRequire.resolve('playwright-core/lib/coreBundle');
export const bundleRequire = createRequire(bundlePath);
export const BUNDLE_VERSION = '1.62.1';
// Reviewed installed bytes after the versioned pnpm patch; review again on every update.
export const BUNDLE_SHA256 = 'b3ca0c0a9c47f098f221be6053d3b02dac8c4f41cda31ae22438aea21f96e8c4';
// Provenance only, never an alternative accepted/evaluated digest.
export const PREVIOUS_BUNDLE_SHA256 = '0d8b43a8e50f5453ddde5e5055ca1102ffdd927acf785fb88f90fd00dc94eb85';
export const turn = () => new Promise((resolve) => setImmediate(resolve));
export const deferred = () => Promise.withResolvers();

export function verifyBundle(version, bytes) {
  assert.equal(version, BUNDLE_VERSION, 'review the Playwright version before evaluation');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), BUNDLE_SHA256,
    'review the Playwright source digest before evaluation');
}

export function readVerifiedBundle() {
  const { version } = JSON.parse(readFileSync(coreRequire.resolve('playwright-core/package.json'), 'utf8'));
  const bytes = readFileSync(bundlePath);
  verifyBundle(version, bytes);
  return { version, bytes };
}

function compileBundle() {
  const { bytes } = readVerifiedBundle();
  const source = bytes.toString('utf8');
  const ast = ts.createSourceFile(bundlePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  const calls = ast.statements.filter((node) => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'init_coreBundle' && node.expression.arguments.length === 0);
  assert.equal(calls.length, 1, 'expected exactly one top-level bundle bootstrap');
  // The inprocess entrypoint owns cycle-safe initialization; the electron leaf cannot run first.
  const definitions = source.slice(0, calls[0].getStart(ast));
  return compileFunction(definitions + `
    init_inprocess();
    const originalReadline = readline2;
    readline2 = { ...originalReadline, createInterface: options =>
      io.trackReadline(originalReadline.createInterface(options)) };
    eventsHelper = {
      addEventListener: (...args) => io.trackListener(EventsHelper.addEventListener(...args)),
      removeEventListeners: listeners => EventsHelper.removeEventListeners(listeners)
    };
    const originalLaunchProcess = launchProcess;
    launchProcess = options => io.launch(options);
    return {
      Electron, ElectronApplication, ProgressController, ManualPromise, EventsHelper, waitForLine,
      originalLaunchProcess, localProcess: process,
      platformObservation: () => ({ process: process.platform,
        os: import_os14.default.platform(), absolute: import_path29.default.isAbsolute("C:/fixture/test.exe") }),
      installTransports() {
        WebSocketTransport = { connect: (progress, url) => progress.race(io.connect(url)) };
        CRConnection = class { constructor() { this.rootSession = io.session; } };
        CRBrowser = { connect: () => io.browser() };
      },
      client() { init_inprocess(); return module.exports.inprocess.playwright; }
    };
  `, ['exports', 'require', 'module', '__filename', '__dirname', 'process', 'io'], { filename: bundlePath });
}

const stageNames = ['launch', 'nodeConnect', 'chromeConnect', 'browserConnect',
  'Runtime.enable', 'Runtime.evaluate', 'kill'];

const childProcessMethods = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
const guardedTests = new WeakSet();

export function createBundleAssetRequire(platformPath, {
  hostBundlePath = bundlePath, hostPath = path, requireHost = bundleRequire,
} = {}) {
  const hostDirectory = hostPath.dirname(hostBundlePath);
  const runtimeDirectory = hostDirectory.replaceAll('\\', '/');
  const runtimeRoot = platformPath.join(runtimeDirectory, '..');
  const assets = new Map(['package.json', 'browsers.json'].map((name) => [
    platformPath.join(runtimeRoot, name), hostPath.join(hostDirectory, '..', name),
  ]));
  // Only the bundle's own metadata crosses from simulated path semantics to host I/O.
  // Do not normalize caller paths, sibling assets or arbitrary module requests.
  return (id) => requireHost(assets.get(id) ?? id);
}

function createBoundary(t, platform, effects, hostAssets) {
  assert.ok(['win32', 'linux', 'darwin'].includes(platform));
  const forbidden = [];
  const deny = (name) => () => {
    forbidden.push(name);
    throw new Error(`PURE_TEST_SIDE_EFFECT_BLOCKED: ${name}`);
  };
  // Node's test-scoped mocks also block transitive CommonJS imports, and restore on teardown.
  // Tests using this harness must remain serial within their isolated Node test process.
  if (!guardedTests.has(t)) {
    guardedTests.add(t);
    for (const name of childProcessMethods) t.mock.method(childProcess, name, deny(`child_process.${name}`));
    for (const name of ['spawn', 'kill'])
      t.mock.method(childProcess.ChildProcess.prototype, name, deny(`ChildProcess.prototype.${name}`));
  }
  t.after(() => assert.deepEqual(forbidden, [], 'no real process or filesystem mutation attempted'));
  const localProcess = Object.create(process);
  const events = new EventEmitter();
  Object.defineProperty(localProcess, 'platform', { value: platform });
  localProcess.env = {};
  for (const method of ['on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners',
    'emit', 'listeners', 'listenerCount', 'eventNames']) localProcess[method] = events[method].bind(events);
  localProcess.kill = deny('process.kill');
  localProcess.exit = deny('process.exit');
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const { createAssetRequire = createBundleAssetRequire, ...assetOptions } = hostAssets;
  const requireAsset = createAssetRequire(platformPath, assetOptions);
  const platformOs = { ...os, platform: () => platform,
    tmpdir: () => platform === 'win32' ? 'C:\\eky-synthetic-temp' : '/tmp/eky-synthetic-temp' };
  const inertChildProcess = Object.fromEntries(childProcessMethods.map((name) => [name, deny(name)]));
  inertChildProcess.ChildProcess = class { constructor() { deny('ChildProcess')(); } };
  for (const name of ['spawn', 'spawnSync']) if (effects[name]) inertChildProcess[name] = effects[name];
  const inertFs = { ...fs, promises: { ...fs.promises } };
  for (const name of ['mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'writeFile', 'appendFile',
    'rename', 'copyFile', 'cp', 'link', 'symlink', 'chmod', 'chown', 'truncate', 'open']) {
    inertFs[name] = deny(`fs.${name}`);
    inertFs[name + 'Sync'] = deny(`fs.${name}Sync`);
    inertFs.promises[name] = deny(`fs.promises.${name}`);
  }
  inertFs.createWriteStream = deny('fs.createWriteStream');
  if (effects.rm) inertFs.promises.rm = effects.rm;
  const localRequire = (id) => {
    const name = id.replace(/^node:/, '');
    if (name === 'child_process') return inertChildProcess;
    if (name === 'process') return localProcess;
    if (name === 'path') return platformPath;
    if (name === 'os') return platformOs;
    if (name === 'fs') return inertFs;
    if (name === 'fs/promises') return inertFs.promises;
    if (id === 'electron/index.js') return 'C:\\eky-default\\electron.exe';
    return requireAsset(id);
  };
  localRequire.resolve = bundleRequire.resolve.bind(bundleRequire);
  return { localProcess, localRequire };
}

export function createElectronHarness(t, behavior = {}, {
  client = false, platform = 'win32', effects = {}, hostAssets = {},
} = {}) {
  const calls = [];
  const launches = [];
  const stages = Object.fromEntries(stageNames.map((name) => [name, deferred()]));
  const ready = deferred();
  const interfaces = [];
  const ownedListeners = [];
  const outcomes = [];
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  const stderrBaseline = new Map(['data', 'end', 'error'].map((name) => [name, child.stderr.listeners(name)]));
  const sentinel = () => {};
  child.on('error', sentinel);
  const context = new EventEmitter();
  context.setCustomCloseHandler = (handler) => { context.closeHandler = handler; };
  const session = new EventEmitter();
  const nodeTransport = { closes: 0, close() { this.closes++; } };
  const browser = { _defaultContext: context };
  function step(name, value) {
    calls.push(name);
    stages[name].resolve();
    return behavior[name] ? behavior[name]() : Promise.resolve(value);
  }
  session.send = (method) => step(method, {});
  const options = {
    executablePath: platform === 'win32' ? 'C:\\eky-synthetic\\Electron Folder\\electron.exe' : '/tmp/eky-unexecuted-electron',
    artifactsDir: platform === 'win32' ? 'C:\\eky-synthetic\\artifacts' : '/tmp/eky-unwritten-playwright-artifacts',
    args: [], env: [], chromiumSandbox: true,
  };
  const io = {
    session,
    trackReadline(rl) {
      rl.on("line", sentinel);
      interfaces.push(rl);
      if (interfaces.length === 4) ready.resolve();
      return rl;
    },
    trackListener(listener) { ownedListeners.push(listener); return listener; },
    launch(launchOptions) {
      launches.push(launchOptions);
      assert.notEqual(launchOptions.env, process.env);
      const expectedEnv = Object.fromEntries(options.env.filter((item) => item.name !== 'NODE_OPTIONS')
        .map((item) => [item.name, item.value]));
      assert.deepEqual(launchOptions.env, expectedEnv);
      assert.deepEqual(launchOptions.tempDirectories, []);
      return step('launch', { launchedProcess: child, gracefullyClose: async () => {},
        kill: () => step('kill') });
    },
    connect(url) {
      assert.ok(['ws://127.0.0.1/node', 'ws://127.0.0.1/chrome'].includes(url));
      return step(url.endsWith('/node') ? 'nodeConnect' : 'chromeConnect', nodeTransport);
    },
    browser: () => step('browserConnect', browser),
  };
  // Trusted dependency test isolation, not a security sandbox. Keep the host Error realm.
  const { localProcess, localRequire } = createBoundary(t, platform, effects, hostAssets);
  const module = { exports: {} };
  const { hostBundlePath = bundlePath, hostPath = path } = hostAssets;
  // Forward slashes keep dependency metadata resolution coherent in POSIX simulation on Windows.
  let api;
  try {
    api = compileBundle()(module.exports, localRequire, module, hostBundlePath.replaceAll('\\', '/'),
      hostPath.dirname(hostBundlePath).replaceAll('\\', '/'), localProcess, io);
  } catch (error) {
    child.stderr.destroy();
    throw error;
  }
  let clientAPI;
  let controller;
  let electron;
  if (client) {
    clientAPI = api.client();
  } else {
    api.installTransports();
    controller = new api.ProgressController();
    electron = new api.Electron({ attribution: { playwright: {} }, instrumentation: {} });
  }
  function activeController() {
    if (!client) return controller;
    return clientAPI._connection.toImpl(clientAPI._connection)._activeProgressControllers.values().next().value;
  }
  function observe(promise) {
    const result = promise.then((value) => ({ value }), (error) => ({ error }));
    outcomes.push(result);
    return result;
  }
  function assertReleased() {
    for (const { emitter, eventName, handler } of ownedListeners)
      assert.equal(emitter.listeners(eventName).includes(handler), false, `${eventName} listener retained`);
    assert.deepEqual(child.listeners('error'), [sentinel]);
    assert.equal(child.listenerCount('exit'), 0);
    assert.ok(interfaces.every((rl) => rl.listeners("line").includes(sentinel)));
  }
  async function endStderr() {
    child.stderr.end();
    child.stderr.resume();
    await turn();
    assert.ok(interfaces.every((rl) => rl.closed), 'readline must close after actual EOF');
    for (const [event, listeners] of stderrBaseline)
      assert.deepEqual(child.stderr.listeners(event), listeners, `readline retained stderr ${event}`);
  }
  const harness = {
    api, calls, launches, child, interfaces, ownedListeners, controller, nodeTransport, clientAPI, options,
    ready: ready.promise,
    reached: (stage) => stages[stage].promise,
    line: (line) => child.stderr.write(`${line}\n`),
    endpoints() {
      harness.line('Debugger listening on ws://127.0.0.1/node');
      harness.line('DevTools listening on ws://127.0.0.1/chrome');
    },
    event(name) {
      if (name === 'close') child.stderr.end();
      else if (name === 'error') child.emit('error', new Error('synthetic process error'));
      else child.emit('exit', 29, null);
    },
    run() {
      return observe(client ? clientAPI._electron.launch({ ...options, env: {}, timeout: 0 }) :
        controller.run((progress) => electron.launch(progress, options), 0));
    },
    waitForLine(regex) {
      return observe(controller.run((progress) => api.waitForLine(progress, child, regex), 0));
    },
    abort: (error) => activeController().abort(error),
    metadata: () => activeController()?.metadata,
    assertReleased, endStderr,
  };
  t.after(async () => {
    const current = activeController();
    const abort = current?._state === 'running' ? current.abort(new Error('test teardown')) : undefined;
    await endStderr();
    await Promise.all([...outcomes, abort]);
    await turn();
    assertReleased();
    child.stderr.destroy();
  });
  return harness;
}

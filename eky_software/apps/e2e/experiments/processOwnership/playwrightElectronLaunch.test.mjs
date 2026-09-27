import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { describe, test } from 'node:test';
import { BUNDLE_VERSION, BUNDLE_SHA256, PREVIOUS_BUNDLE_SHA256, readVerifiedBundle, verifyBundle,
  bundleRequire, createBundleAssetRequire, createElectronHarness, deferred, turn }
  from './playwrightElectronBundleHarness.mjs';
import { CLEANUP_UNVERIFIED_MARKER as marker, isExpectedElectronLaunchFailure }
  from './fixtures/electronLaunchFailure.cjs';

const settings = { concurrency: false, timeout: 5000 };
const markerCount = (metadata) => metadata.log.filter((line) => line === marker).length;

const flags = ['--inspect=0', '--remote-debugging-port=0'];
const literalArgs = ['', 'two words', 'a"b', 'C:\\trailing\\', 'a&b|c<d>e^f', '%PATH%', '!bang!', '\u00e4\u96ea'];
const literalEnv = [{ name: 'SYNTHETIC', value: 'literal % ! & value' },
  { name: 'NODE_OPTIONS', value: 'not-forwarded' }];
const flatten = (values) => values.map((value) => '"' + value.replace(/"/g, '\\"') + '"').join(' ');

async function captureLaunch(t, profile = {}, options = {}) {
  const primary = new Error('synthetic launch boundary');
  const h = createElectronHarness(t, { launch: () => Promise.reject(primary) }, profile);
  Object.assign(h.options, { args: [...literalArgs], env: literalEnv.map((item) => ({ ...item })),
    cwd: 'C:\\synthetic cwd' }, options);
  const before = structuredClone(h.options);
  assert.equal((await h.run()).error, primary);
  assert.equal(h.launches.length, 1, 'one launch; no shell fallback retry');
  assert.deepEqual(h.options, before, 'caller arguments and env were not mutated');
  const launch = h.launches[0];
  assert.deepEqual(launch.env, { SYNTHETIC: literalEnv[0].value });
  assert.equal(launch.cwd, h.options.cwd);
  assert.equal(launch.stdio, 'pipe');
  assert.deepEqual(launch.tempDirectories, []);
  assert.deepEqual([launch.handleSIGINT, launch.handleSIGTERM, launch.handleSIGHUP], [true, true, true]);
  return { h, launch };
}

for (const host of [
  { name: 'Linux', paths: path.posix, anchor: '/mnt/synthetic/playwright-core/lib/coreBundle.js',
    ownPackage: '/mnt/synthetic/playwright-core/package.json' },
  { name: 'Windows', paths: path.win32, anchor: 'C:\\synthetic\\playwright-core\\lib\\coreBundle.js',
    ownPackage: 'C:\\synthetic\\playwright-core\\package.json' },
]) {
  for (const platform of ['win32', 'linux']) {
    test(`bundle asset resolution: ${host.name} host with ${platform} paths maps only two own JSON assets`, settings, () => {
      const platformPath = platform === 'win32' ? path.win32 : path.posix;
      const requests = [];
      const metadata = { name: 'playwright-core', version: BUNDLE_VERSION };
      const browsers = { browsers: [] };
      const ownBrowsers = host.paths.join(host.paths.dirname(host.ownPackage), 'browsers.json');
      const requireAsset = createBundleAssetRequire(platformPath, {
        hostBundlePath: host.anchor, hostPath: host.paths,
        requireHost: (id) => {
          requests.push(id);
          if (id === host.ownPackage) return metadata;
          if (id === ownBrowsers) return browsers;
          return { unchangedRequest: id };
        },
      });
      const runtimeDirectory = host.paths.dirname(host.anchor).replaceAll('\\', '/');
      // Mirror the two joins in the digest-bound init_package, not host path resolution.
      const packageRoot = platformPath.join(runtimeDirectory, '..');
      const ownRequest = platformPath.join(packageRoot, 'package.json');
      if (host.name === 'Linux' && platform === 'win32') {
        assert.equal(ownRequest, '\\mnt\\synthetic\\playwright-core\\package.json');
        assert.notEqual(ownRequest, host.ownPackage, 'regression requires a real host/VM path mismatch');
      }
      assert.equal(requireAsset(ownRequest), metadata);
      const browsersRequest = platformPath.join(packageRoot, 'browsers.json');
      assert.equal(requireAsset(browsersRequest), browsers);
      assert.deepEqual(requests, [host.ownPackage, ownBrowsers], 'host resolver receives exactly two host asset paths');
      const unrelated = ['C:\\caller folder\\electron.exe', 'C:\\caller\\package.json',
        '\\mnt\\other\\package.json', '\\\\server\\share\\package.json',
        'C:\\caller\\browsers.json', '\\mnt\\other\\browsers.json', '\\\\server\\share\\browsers.json',
        platformPath.join(packageRoot, 'other-package.json'),
        `${packageRoot}${platformPath.sep}lib${platformPath.sep}..${platformPath.sep}package.json`,
        `${packageRoot}${platformPath.sep}lib${platformPath.sep}..${platformPath.sep}browsers.json`,
        './package.json', './browsers.json', 'node:path'];
      requests.length = 0;
      for (const id of unrelated) assert.deepEqual(requireAsset(id), { unchangedRequest: id });
      assert.deepEqual(requests, unrelated, 'no generic slash, dot-segment or caller-path normalization');
      const failure = new Error('host resolution failed');
      const failingRequire = createBundleAssetRequire(platformPath, {
        hostBundlePath: host.anchor, hostPath: host.paths,
        requireHost: () => { throw failure; },
      });
      assert.throws(() => failingRequire(ownRequest), (error) => error === failure);
      assert.throws(() => failingRequire(browsersRequest), (error) => error === failure);
    });
  }
}

function syntheticLinuxBundleAssets() {
  const metadataRequests = [];
  const rejectedAbsoluteRequests = [];
  const assets = new Map([
    ['/mnt/synthetic/playwright-core/package.json', '../package.json'],
    ['/mnt/synthetic/playwright-core/browsers.json', '../browsers.json'],
  ]);
  const hostAssets = {
    hostBundlePath: '/mnt/synthetic/playwright-core/lib/coreBundle.js', hostPath: path.posix,
    requireHost(id) {
      if (assets.has(id)) {
        metadataRequests.push(id);
        return bundleRequire(assets.get(id));
      }
      if (path.posix.isAbsolute(id) || path.win32.isAbsolute(id)) {
        rejectedAbsoluteRequests.push(id);
        throw Object.assign(new Error('unmapped synthetic host asset'), { code: 'MODULE_NOT_FOUND', request: id });
      }
      return bundleRequire(id);
    },
  };
  return { hostAssets, metadataRequests, rejectedAbsoluteRequests };
}

test('bundle asset resolution: real init_inprocess completes under Linux host anchor with Windows paths', settings, (t) => {
  const fixture = syntheticLinuxBundleAssets();
  const h = createElectronHarness(t, {}, { platform: 'win32', client: true, hostAssets: fixture.hostAssets });
  assert.deepEqual(fixture.metadataRequests, [
    '/mnt/synthetic/playwright-core/package.json', '/mnt/synthetic/playwright-core/browsers.json',
  ]);
  assert.deepEqual(fixture.rejectedAbsoluteRequests, []);
  for (const name of ['chromium', 'firefox', 'webkit', '_electron'])
    assert.equal(typeof h.clientAPI[name].launch, 'function', `${name} client initialized`);
  for (const name of ['Electron', 'ElectronApplication', 'ProgressController'])
    assert.equal(typeof h.api[name], 'function', `${name} server initialized`);
  assert.deepEqual(h.api.platformObservation(), { process: 'win32', os: 'win32', absolute: true });
  assert.deepEqual(h.calls, [], 'bootstrap does not launch a process');
});

test('bundle asset resolution: missing browsers map fails real init_inprocess instead of bypassing registry', settings, (t) => {
  const fixture = syntheticLinuxBundleAssets();
  const rawBrowsersRequest = '\\mnt\\synthetic\\playwright-core\\browsers.json';
  fixture.hostAssets.createAssetRequire = (platformPath, options) => {
    const mapped = createBundleAssetRequire(platformPath, options);
    // Reproduce the former package-only map during the real registry initialization.
    return (id) => id === rawBrowsersRequest ? options.requireHost(id) : mapped(id);
  };
  assert.throws(() => createElectronHarness(t, {}, {
    platform: 'win32', client: true, hostAssets: fixture.hostAssets,
  }), (error) => error.code === 'MODULE_NOT_FOUND' && error.request === rawBrowsersRequest);
  assert.deepEqual(fixture.metadataRequests, ['/mnt/synthetic/playwright-core/package.json']);
  assert.deepEqual(fixture.rejectedAbsoluteRequests, [rawBrowsersRequest]);
});

// Replay every existing assertion against installed bytes on both Windows branches and POSIX.
for (const profile of ['windowsDirect', 'windowsFallback', 'linux']) {
  describe(`existing launch lifecycle: ${profile}`, { concurrency: false }, () => {
    registerLifecycleCases((t, behavior, options) => {
      const h = createElectronHarness(t, behavior, {
        ...options, platform: profile === 'linux' ? 'linux' : 'win32',
      });
      if (profile === 'windowsFallback') h.options.executablePath = 'electron.exe';
      return h;
    });
  });
}

function registerLifecycleCases(createElectronHarness) {
  test("abort before run preserves the original error without launch or cleanup", settings, async (t) => {
    const h = createElectronHarness(t);
    const primary = new Error("abort before launch");
    const abort = h.abort(primary);
    assert.equal((await h.run()).error, primary);
    await abort;
    assert.deepEqual(h.calls, []);
    assert.equal(markerCount(h.controller.metadata), 0);
  });

  test("launcher rejection stays outside the post-spawn cleanup catch", settings, async (t) => {
    const primary = new Error("launcher failure");
    const h = createElectronHarness(t, { launch: () => Promise.reject(primary) });
    assert.equal((await h.run()).error, primary);
    assert.deepEqual(h.calls, ["launch"]);
    assert.equal(h.interfaces.length, 0);
  });

  test('source guard: exact version and reviewed bytes, independently of behavior', () => {
    const { version, bytes } = readVerifiedBundle();
    assert.equal(version, BUNDLE_VERSION);
    assert.equal(BUNDLE_SHA256.length, 64);
    assert.throws(() => verifyBundle('1.62.2', bytes), /version before evaluation/);
    assert.throws(() => verifyBundle(version, Buffer.concat([bytes, Buffer.from('\n')])), /digest before evaluation/);
  });

  test('each factory owns fresh real dependency classes', settings, (t) => {
    const a = createElectronHarness(t);
    const b = createElectronHarness(t);
    for (const name of ['Electron', 'ElectronApplication', 'ProgressController', 'ManualPromise', 'EventsHelper'])
      assert.notEqual(a.api[name], b.api[name]);
  });

  for (const event of ['match', 'error', 'exit', 'close', 'abort']) {
    test(`real waitForLine: ${event} removes only its owned listeners`, settings, async (t) => {
      const h = createElectronHarness(t);
      const result = h.waitForLine(/^endpoint (.+)$/);
      let settled = false;
      result.then(() => { settled = true; });
      h.line('unrelated stderr');
      await turn();
      assert.equal(settled, false);
      const abortError = new Error('synthetic abort');
      let abort;
      if (event === 'match') h.line('endpoint expected');
      else if (event === 'abort') abort = h.abort(abortError);
      else h.event(event);
      const outcome = await result;
      await abort;
      if (event === 'match') assert.equal(outcome.value[1], 'expected');
      else if (event === 'abort') assert.equal(outcome.error, abortError);
      else assert.equal(outcome.error.message, 'Process failed to launch!');
      h.assertReleased();
      await h.endStderr();
    });
  }

  for (const phase of ['beforeNode', 'nodeConnecting']) {
    for (const event of ['error', 'exit', 'close']) {
      test(`launch owns early ${event} rejections: ${phase}`, settings, async (t) => {
        const connection = deferred();
        const cleanup = deferred();
        const h = createElectronHarness(t, { nodeConnect: () => connection.promise, kill: () => cleanup.promise });
        const result = h.run();
        await h.ready;
        if (phase === 'nodeConnecting') {
          h.line('Debugger listening on ws://127.0.0.1/node');
          await h.reached('nodeConnect');
        }
        h.event(event);
        await turn(); // Leave the actual sibling rejections unconsumed for one event-loop turn.
        connection.resolve(h.nodeTransport);
        await h.reached('kill');
        cleanup.resolve();
        assert.equal((await result).error.message, 'Process failed to launch!');
        assert.equal(markerCount(h.controller.metadata), 0);
        assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
        h.assertReleased();
      });
    }
  }

  test('early X-server derived rejection stays owned and later becomes launch error', settings, async (t) => {
    const h = createElectronHarness(t);
    const result = h.run();
    await h.ready;
    h.line('Unable to open X display');
    await turn();
    h.line('Debugger listening on ws://127.0.0.1/node');
    assert.match((await result).error.message, /^Unable to open X display!/);
    assert.equal(h.calls.includes('chromeConnect'), false);
    h.event('exit');
    await turn();
    h.assertReleased();
  });

  for (const disconnect of ['early', 'late', 'reject']) {
    test(`normal launch does not await pending side waits; disconnect ${disconnect}`, settings, async (t) => {
      const h = createElectronHarness(t);
      const result = h.run();
      await h.ready;
      h.line('DevTools listening on ws://127.0.0.1/chrome');
      if (disconnect === 'early') h.line('Waiting for the debugger to disconnect...');
      h.line('Debugger listening on ws://127.0.0.1/node');
      const { value: app, error } = await result;
      assert.equal(error, undefined);
      assert.ok(app instanceof h.api.ElectronApplication);
      assert.deepEqual(h.calls.filter((name) => name.startsWith('Runtime.')), ['Runtime.enable', 'Runtime.evaluate']);
      if (disconnect === 'late') h.line('Waiting for the debugger to disconnect...');
      h.event('exit');
      await turn();
      assert.equal(h.nodeTransport.closes, disconnect === 'reject' ? 0 : 1);
      assert.equal(h.calls.includes('kill'), false);
      h.assertReleased();
    });
  }

  for (const stage of ['nodeConnect', 'chromeConnect', 'browserConnect', 'Runtime.enable', 'Runtime.evaluate']) {
    test(`launch preserves the original ${stage} failure`, settings, async (t) => {
      const primary = new Error(`primary ${stage}`);
      const h = createElectronHarness(t, { [stage]: () => Promise.reject(primary) });
      const result = h.run();
      await h.ready;
      h.endpoints();
      assert.equal((await result).error, primary);
      assert.equal(markerCount(h.controller.metadata), 0);
      assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
      h.event('exit');
      await turn();
      h.assertReleased();
    });
  }

  for (const cleanupMode of ['resolve', 'deferredResolve', 'throw', 'reject', 'abortPending', 'abortResolve', 'abortReject']) {
    test(`cleanup ${cleanupMode}: primary error retained and uncertainty marked`, settings, async (t) => {
      const primary = new Error('original launch failure');
      const secondary = new Error('secondary cleanup failure');
      const cleanup = deferred();
      const h = createElectronHarness(t, {
        nodeConnect: () => Promise.reject(primary),
        kill: () => {
          if (cleanupMode === 'throw') throw secondary;
          if (cleanupMode === 'reject') return Promise.reject(secondary);
          return cleanupMode === 'resolve' ? Promise.resolve() : cleanup.promise;
        },
      });
      const result = h.run();
      let settled = false;
      result.then(() => { settled = true; });
      await h.ready;
      h.endpoints();
      await h.reached('kill');
      let abort;
      if (cleanupMode === 'deferredResolve' || cleanupMode.startsWith('abort')) {
        await turn();
        assert.equal(settled, false, 'pending cleanup must not claim completion');
        if (cleanupMode === 'deferredResolve') cleanup.resolve();
        else abort = h.abort(new Error('cleanup abort'));
      }
      const outcome = await result;
      await abort;
      if (cleanupMode === 'abortResolve') cleanup.resolve();
      if (cleanupMode === 'abortReject') cleanup.reject(secondary);
      h.event('exit');
      await turn();
      h.assertReleased();
      assert.equal(outcome.error, primary);
      assert.equal(markerCount(h.controller.metadata), ['resolve', 'deferredResolve'].includes(cleanupMode) ? 0 : 1);
      assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
    });
  }

  for (const stage of ['nodeWait', 'nodeConnect', 'chromeWait', 'chromeConnect', 'browserConnect', 'Runtime.enable', 'Runtime.evaluate']) {
    test(`real controller abort at ${stage}, including late transport rejection`, settings, async (t) => {
      const pending = deferred();
      const h = createElectronHarness(t, { [stage]: () => pending.promise, kill: () => pending.promise });
      const result = h.run();
      await h.ready;
      if (stage !== 'nodeWait') h.line('Debugger listening on ws://127.0.0.1/node');
      if (!['nodeWait', 'nodeConnect', 'chromeWait'].includes(stage)) h.line('DevTools listening on ws://127.0.0.1/chrome');
      if (stage === 'chromeWait') { await h.reached('nodeConnect'); await turn(); }
      else if (stage !== 'nodeWait') await h.reached(stage);
      const primary = new Error(`abort at ${stage}`);
      const abort = h.abort(primary);
      const outcome = await result;
      await abort;
      pending.reject(new Error('late boundary rejection'));
      await turn();
      h.assertReleased();
      assert.equal(outcome.error, primary);
      assert.equal(markerCount(h.controller.metadata), 1, 'raw metadata must retain marker after abort');
    });
  }

  for (const cleanupMode of ['resolve', 'throw', 'reject', 'abort']) {
    test(`actual inprocess error chain and acceptance guard: cleanup ${cleanupMode}`, settings, async (t) => {
      const pending = deferred();
      const h = createElectronHarness(t, { kill: () => {
        if (cleanupMode === 'throw') throw new Error('cleanup throw');
        if (cleanupMode === 'reject') return Promise.reject(new Error('cleanup reject'));
        return cleanupMode === 'abort' ? pending.promise : Promise.resolve();
      } }, { client: true });
      const result = h.run();
      await h.ready;
      h.event('exit');
      await h.reached('kill');
      const metadata = h.metadata();
      const abort = cleanupMode === 'abort' ? h.abort(new Error('cleanup interrupted')) : undefined;
      const { error } = await result;
      await abort;
      await turn();
      h.assertReleased();
      const uncertain = cleanupMode !== 'resolve';
      assert.ok(error instanceof Error, 'real client errors must share the acceptance guard Error realm');
      assert.ok(error.message.includes('Process failed to launch!'));
      assert.equal(markerCount(metadata), uncertain ? 1 : 0);
      assert.equal(error.message.includes(marker), uncertain);
      assert.equal(isExpectedElectronLaunchFailure(error, h.clientAPI.errors.TimeoutError), !uncertain);
    });
  }

  test('actual acceptance guard rejects timeout and non-Error inputs', settings, (t) => {
    const h = createElectronHarness(t, {}, { client: true });
    const { TimeoutError } = h.clientAPI.errors;
    assert.equal(isExpectedElectronLaunchFailure(new Error('caught launch failure'), TimeoutError), true);
    for (const error of [new TimeoutError('deadline'), null, undefined, 'failure', { message: 'failure' }])
      assert.equal(isExpectedElectronLaunchFailure(error, TimeoutError), false);
  });
}

function readPreProcessOnlyBundle() {
  const { version, bytes } = readVerifiedBundle();
  let source = bytes.toString('utf8');
  const reverse = (name, current, previous) => {
    assert.equal(source.split(current).length, 2, `one exact reviewed ${name} hunk`);
    source = source.replace(current, previous);
  };
  reverse('internal process guard', [
    'async function launchProcess(options) {',
    '  if (options.windowsProcessOnly && (process.platform !== "win32" || options.shell))',
    '    throw new Error("windowsProcessOnly requires a direct Windows process");',
  ].join('\n'), 'async function launchProcess(options) {');
  reverse('handle-only kill branch', [
    '          if (options.windowsProcessOnly) {',
    '            // Eky: the childless bridge has a retained handle, not a PID-tree owner.',
    '            if (!spawnedProcess.kill("SIGKILL"))',
    '              options.log("windowsProcessOnlyKillNotDelivered");',
    '          } else {',
    '            const taskkillProcess = childProcess.spawnSync(`taskkill /pid ${spawnedProcess.pid} /T /F`, { shell: true });',
    '            const [stdout2, stderr2] = [taskkillProcess.stdout.toString(), taskkillProcess.stderr.toString()];',
    '            if (stdout2)',
    '              options.log(`[pid=${spawnedProcess.pid}] taskkill stdout: ${stdout2}`);',
    '            if (stderr2)',
    '              options.log(`[pid=${spawnedProcess.pid}] taskkill stderr: ${stderr2}`);',
    '          }',
  ].join('\n'), [
    '          const taskkillProcess = childProcess.spawnSync(`taskkill /pid ${spawnedProcess.pid} /T /F`, { shell: true });',
    '          const [stdout2, stderr2] = [taskkillProcess.stdout.toString(), taskkillProcess.stderr.toString()];',
    '          if (stdout2)',
    '            options.log(`[pid=${spawnedProcess.pid}] taskkill stdout: ${stdout2}`);',
    '          if (stderr2)',
    '            options.log(`[pid=${spawnedProcess.pid}] taskkill stderr: ${stderr2}`);',
  ].join('\n'));
  reverse('optional boolean protocol', [
    '    scheme.ElectronLaunchParams = tObject({',
    '      windowsProcessOnly: tOptional(tBoolean),',
  ].join('\n'), '    scheme.ElectronLaunchParams = tObject({');
  reverse('pre-temp Electron guard', [
    '        // Eky: opt-in is only safe for an explicitly selected childless EXE.',
    '        if (options.windowsProcessOnly !== void 0 && typeof options.windowsProcessOnly !== "boolean")',
    '          throw new Error("windowsProcessOnly must be a boolean");',
    '        const directWindowsExecutable = process.platform === "win32" &&',
    '          !!options.executablePath && import_path29.default.isAbsolute(options.executablePath) &&',
    '          import_path29.default.extname(options.executablePath).toLowerCase() === ".exe";',
    '        if (options.windowsProcessOnly && !directWindowsExecutable)',
    '          throw new Error("windowsProcessOnly requires an explicit absolute Windows EXE");',
    '',
  ].join('\n'), '');
  reverse('relocated direct EXE selector', [
    '        // Eky: explicit absolute EXE paths use direct Windows argument delivery.',
    '        let shell = false;',
  ].join('\n'), [
    '        // Eky: explicit absolute EXE paths use direct Windows argument delivery.',
    '        const directWindowsExecutable = process.platform === "win32" &&',
    '          !!options.executablePath && import_path29.default.isAbsolute(command) &&',
    '          import_path29.default.extname(command).toLowerCase() === ".exe";',
    '        let shell = false;',
  ].join('\n'));
  reverse('internal opt-in forwarding', [
    '          stdio: "pipe",',
    '          windowsProcessOnly: options.windowsProcessOnly === true,',
  ].join('\n'), '          stdio: "pipe",');
  const previous = Buffer.from(source);
  assert.equal(createHash('sha256').update(previous).digest('hex'),
    'b3ca0c0a9c47f098f221be6053d3b02dac8c4f41cda31ae22438aea21f96e8c4',
    'reversing only the opt-in hunks must restore the exact prior patched bundle');
  // Historical bytes are provenance only. Never pass them to the evaluator.
  return { version, bytes: previous };
}

test('same-version pre-process-only bundle is rejected despite retaining the earlier patches', settings, () => {
  const { version, bytes } = readPreProcessOnlyBundle();
  assert.equal(version, BUNDLE_VERSION);
  assert.throws(() => verifyBundle(version, bytes), /digest before evaluation/);
});

test('exact selector-only source delta: old digest is provenance, never an accepted runtime', settings, () => {
  const { version, bytes } = readPreProcessOnlyBundle();
  const current = bytes.toString('utf8');
  const before = '        let shell = false;\n        if (process.platform === "win32") {';
  const after = [
    '        // Eky: explicit absolute EXE paths use direct Windows argument delivery.',
    '        const directWindowsExecutable = process.platform === "win32" &&',
    '          !!options.executablePath && import_path29.default.isAbsolute(command) &&',
    '          import_path29.default.extname(command).toLowerCase() === ".exe";',
    '        let shell = false;',
    '        if (process.platform === "win32" && !directWindowsExecutable) {',
  ].join('\n');
  assert.equal(current.split(after).length, 2, 'one exact reviewed selector hunk');
  const previous = Buffer.from(current.replace(after, before));
  assert.equal(createHash('sha256').update(previous).digest('hex'), PREVIOUS_BUNDLE_SHA256);
  assert.throws(() => verifyBundle(version, previous), /digest before evaluation/);
  // The historical source is never evaluated. The delta digest also binds the prior error/cleanup patch.
});

for (const executablePath of ['C:\\fixture\\electron.exe', 'C:\\Fixture Folder\\ELECTRON.EXE',
  '\\\\server\\share\\electron.exe', '\\rooted\\electron.exe', '/rooted/electron.exe']) {
  test(`Windows selector positive: ${executablePath}`, settings, async (t) => {
    const { h, launch } = await captureLaunch(t, { platform: 'win32' }, { executablePath });
    assert.deepEqual(h.api.platformObservation(), { process: 'win32', os: 'win32', absolute: true });
    assert.equal(launch.command, executablePath);
    assert.equal(launch.shell, false);
    assert.deepEqual(launch.args, [...flags, ...literalArgs]);
  });
}

for (const executablePath of ['electron.exe', '.\\electron.exe', '..\\electron.exe', 'C:electron.exe',
  'C:\\fixture\\electron.cmd', 'C:\\fixture\\electron.bat', 'C:\\fixture\\electron',
  'C:\\fixture\\electron.exe.cmd', '"C:\\fixture\\electron.exe"']) {
  test(`Windows selector fallback unchanged: ${executablePath}`, settings, async (t) => {
    const { launch } = await captureLaunch(t, { platform: 'win32' }, { executablePath });
    assert.equal(launch.shell, true);
    assert.equal(launch.command, flatten([executablePath, ...flags, ...literalArgs]));
    assert.deepEqual(launch.args, []);
  });
}

for (const executablePath of [undefined, '']) {
  test(`omitted or empty executable preserves default loader/shell: ${String(executablePath)}`, settings, async (t) => {
    const { launch } = await captureLaunch(t, { platform: 'win32' }, { executablePath });
    assert.equal(launch.shell, true);
    assert.deepEqual(launch.args, []);
    assert.match(launch.command, /^"C:\\eky-default\\electron\.exe" "-r" ".*loader\.js" "--inspect=0"/);
    assert.ok(launch.command.endsWith(flatten([...flags, ...literalArgs])));
  });
}

for (const platform of ['linux', 'darwin']) {
  for (const chromiumSandbox of [true, false]) {
    test(`nonWindows unchanged: ${platform} sandbox ${chromiumSandbox}`, settings, async (t) => {
      const executablePath = '/tmp/fixture/electron.exe';
      const { h, launch } = await captureLaunch(t, { platform }, {
        executablePath, cwd: '/tmp/synthetic cwd', chromiumSandbox,
      });
      assert.deepEqual(h.api.platformObservation(), { process: platform, os: platform, absolute: false });
      assert.equal(launch.shell, false);
      assert.equal(launch.command, executablePath);
      const expected = platform === 'linux' && !chromiumSandbox ? ['--no-sandbox', ...flags, ...literalArgs] :
        [...flags, ...literalArgs];
      assert.deepEqual(launch.args, expected);
    });
  }
}

test('Linux existing no-sandbox argument is not duplicated', settings, async (t) => {
  const { launch } = await captureLaunch(t, { platform: 'linux' }, { chromiumSandbox: false, args: ['--no-sandbox'] });
  assert.deepEqual(launch.args, [...flags, '--no-sandbox']);
});

function inertChild(t, pid = 424242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.stdio = [null, ...Array.from({ length: 4 }, () => new PassThrough())];
  [child.stdout, child.stderr] = child.stdio.slice(1, 3);
  t.after(() => { for (const stream of child.stdio.slice(1)) stream.destroy(); });
  return child;
}

test('actual launchProcess receives direct argv/env/cwd and five slots; exit is not close or cleanup', settings, async (t) => {
  const child = inertChild(t);
  const spawnCalls = [];
  const kills = [];
  const removals = [];
  const cleanup = deferred();
  const { h, launch } = await captureLaunch(t, { effects: {
    spawn: (...values) => { spawnCalls.push(values); return child; },
    spawnSync: (...values) => { kills.push(values); return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; },
    rm: (...values) => { removals.push(values); return cleanup.promise; },
  } });
  const exits = [];
  const result = await h.api.originalLaunchProcess({ ...launch,
    tempDirectories: ['C:\\synthetic-never-created'], onExit: (...values) => exits.push(values) });
  assert.equal(result.launchedProcess, child);
  assert.deepEqual(spawnCalls, [[launch.command, [...flags, ...literalArgs], {
    detached: false, env: { SYNTHETIC: literalEnv[0].value }, cwd: 'C:\\synthetic cwd', shell: false,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  }]]);
  let settled = false;
  const stopped = result.kill().then(() => { settled = true; });
  assert.deepEqual(kills, [['taskkill /pid 424242 /T /F', { shell: true }]], 'inert taskkill request only');
  child.emit('exit', 0, null);
  await turn();
  assert.equal(settled, false);
  assert.deepEqual(exits, []);
  assert.deepEqual(removals, []);
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);
  await turn();
  assert.deepEqual(exits, [[0, null]]);
  assert.deepEqual(removals, [['C:\\synthetic-never-created', { recursive: true, force: true, maxRetries: 10 }]]);
  assert.equal(settled, false, 'close alone does not settle pending cleanup');
  cleanup.resolve();
  await stopped;
  assert.equal(settled, true);
  assert.deepEqual(h.api.localProcess.eventNames(), [], 'VM-local process handlers released');
});

test('actual launchProcess no-PID error has one spawn and original failure text, not a fallback', settings, async (t) => {
  const child = inertChild(t);
  child.pid = undefined;
  const spawnCalls = [];
  const { h, launch } = await captureLaunch(t, { effects: {
    spawn: (...values) => { spawnCalls.push(values); return child; },
  } });
  const pending = h.api.originalLaunchProcess(launch);
  const observed = pending.then((value) => ({ value }), (error) => ({ error }));
  child.emit('error', new Error('synthetic ENOENT'));
  const { error } = await observed;
  assert.equal(error.message, 'Failed to launch: Error: synthetic ENOENT');
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(h.api.localProcess.eventNames(), []);
});

test('actual launchProcess synchronous spawn throw preserves exact error identity', settings, async (t) => {
  const primary = new Error('synthetic spawn throw');
  let calls = 0;
  const { h, launch } = await captureLaunch(t, { effects: { spawn: () => { calls++; throw primary; } } });
  await assert.rejects(h.api.originalLaunchProcess(launch), (error) => error === primary);
  assert.equal(calls, 1);
  assert.deepEqual(h.api.localProcess.eventNames(), []);
});

for (const late of ['resolve', 'reject']) {
  test(`abort during direct launch then late ${late} does not manufacture a receipt`, settings, async (t) => {
    const pending = deferred();
    const h = createElectronHarness(t, { launch: () => pending.promise });
    const result = h.run();
    await h.reached('launch');
    const primary = new Error('abort at direct launch boundary');
    await h.abort(primary);
    assert.equal((await result).error, primary);
    if (late === 'resolve') pending.resolve({ launchedProcess: h.child,
      gracefullyClose: async () => {}, kill: () => { throw new Error('late receipt used'); } });
    else pending.reject(new Error('late spawn failure'));
    await turn();
    assert.deepEqual(h.calls, ['launch']);
    assert.equal(h.interfaces.length, 0);
    assert.equal(markerCount(h.controller.metadata), 0, 'outside post-spawn catch, no cleanup proof exists');
  });
}

test('abort during pending direct cleanup preserves first failure and latches uncertainty', settings, async (t) => {
  const cleanup = deferred();
  const primary = new Error('first node connect failure');
  const h = createElectronHarness(t, { nodeConnect: () => Promise.reject(primary), kill: () => cleanup.promise });
  const result = h.run();
  await h.ready;
  h.endpoints();
  await h.reached('kill');
  await h.abort(new Error('cleanup interrupted'));
  assert.equal((await result).error, primary);
  assert.equal(markerCount(h.controller.metadata), 1);
  cleanup.resolve();
  await turn();
  assert.equal(markerCount(h.controller.metadata), 1, 'late cleanup cannot reverse uncertainty');
  assert.equal(h.calls.filter((value) => value === 'kill').length, 1);
  h.event('exit');
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createLegacyUpgradeWindowsRuntime, inspectLegacyInstallerFootprint, startLegacyOwnedProcess } from './legacyUpgradeWindowsRuntime.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('legacy runtime binds both MSI operations to the observed process with unchanged install policy', {
  skip: process.platform !== 'win32',
}, async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-legacy-msi-binding-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifact = {
    source: { appVersion: '0.2.6', runtimeBuildRevision: 'a'.repeat(40), installerPath: resolve(root, 'source.msi') },
    target: { appVersion: '0.2.7', buildRevision: 'b'.repeat(40), installerPath: resolve(root, 'target.msi') },
  };
  const invocations = [];
  let child;
  const runtime = await createLegacyUpgradeWindowsRuntime({
    fixtureRoot: resolve(root, 'fixture'), runNonce: 'a'.repeat(64),
  }, artifact, {
    spawnMsiProcess(command, arguments_, options) {
      invocations.push({ command, arguments_, options });
      child = new EventEmitter();
      child.pid = 17;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  for (const [operation, role, exitCode] of [['sourceInstall', 'source', 0], ['majorUpgrade', 'target', 1603]]) {
    const observations = [];
    let settled = false;
    const outcome = runtime.runMsiOperation(operation, (code) => {
      observations.push(code);
      if (code === 'processExited') throw new Error('private diagnostic failure');
    }).then((result) => { settled = true; return result; });
    await setImmediate();
    assert.deepEqual(invocations.at(-1), {
      command: resolve(process.env.SystemRoot, 'System32', 'msiexec.exe'),
      arguments_: ['/i', artifact[role].installerPath, '/qn', '/norestart', '/l*v', resolve(root, 'msi-logs', `${operation}.log`)],
      options: { cwd: root, env: undefined, stdio: 'ignore', windowsHide: true },
    });
    child.emit('exit', exitCode, null);
    await setImmediate();
    assert.equal(settled, false);
    child.emit('close', exitCode, null);
    assert.equal(await outcome, exitCode);
    assert.deepEqual(observations, ['processSpawnRequested', 'processSpawned', 'processExited', 'processClosed']);
  }
  assert.equal(invocations.length, 2);
});

test('legacy process observations distinguish request, spawn, exit and close without deciding completion', async () => {
  const child = new EventEmitter();
  child.pid = 17;
  const observations = [];
  const execution = await startLegacyOwnedProcess('private-executable', ['private-argument'], {}, {
    observe: (code) => observations.push(code),
    spawnProcess(_command, _arguments, options) {
      assert.deepEqual(observations, ['processSpawnRequested']);
      assert.equal(options.stdio, 'ignore');
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  assert.deepEqual(observations, ['processSpawnRequested', 'processSpawned']);
  let completed = false;
  const outcome = execution.completion.then((result) => { completed = true; return result; });
  child.emit('exit', 1603, null);
  await setImmediate();
  assert.equal(completed, false);
  assert.deepEqual(observations, ['processSpawnRequested', 'processSpawned', 'processExited']);
  child.emit('close', 1603, null);
  assert.deepEqual(await outcome, { exitCode: 1603, processId: 17 });
  assert.deepEqual(observations, ['processSpawnRequested', 'processSpawned', 'processExited', 'processClosed']);
});

test('legacy process observation failure preserves success and nonzero exit', async () => {
  for (const exitCode of [0, 1603]) {
    const child = new EventEmitter();
    child.pid = 17;
    const observed = [];
    const execution = await startLegacyOwnedProcess('synthetic', [], {}, {
      observe(code) { observed.push(code); throw new Error('private observer failure'); },
      spawnProcess() { queueMicrotask(() => child.emit('spawn')); return child; },
    });
    child.emit('exit', exitCode, null);
    child.emit('close', exitCode, null);
    assert.deepEqual(await execution.completion, { exitCode, processId: 17 });
    assert.deepEqual(observed, ['processSpawnRequested', 'processSpawned', 'processExited', 'processClosed']);
  }
});

test('legacy synchronous creation failure is observed without replacing the original error', async () => {
  const original = new Error('private creation failure');
  const observations = [];
  await assert.rejects(startLegacyOwnedProcess('synthetic', [], {}, {
    observe(code) { observations.push(code); throw new Error('observer failure'); },
    spawnProcess() { throw original; },
  }), (error) => error === original);
  assert.deepEqual(observations, ['processSpawnRequested', 'processStartFailed']);
});

test('legacy owned process retains a post-spawn error until actual close', async () => {
  const child = new EventEmitter();
  child.pid = 1;
  const observations = [];
  const started = startLegacyOwnedProcess('synthetic', [], {}, {
    observe: (code) => observations.push(code),
    spawnProcess() { queueMicrotask(() => child.emit('spawn')); return child; },
  });
  const execution = await started;
  let settled = false;
  const outcome = execution.completion.then(() => { settled = true; }, (error) => {
    settled = true; return error.message;
  });
  child.emit('error', new Error('private failed send or kill'));
  await setImmediate();
  const settledBeforeClose = settled;
  child.emit('exit', 0, null);
  await setImmediate();
  const settledBeforeStreamsClosed = settled;
  child.emit('close', 0, null);
  const code = await outcome;
  assert.equal(settledBeforeClose, false);
  assert.equal(settledBeforeStreamsClosed, false);
  assert.equal(code, 'ownedProcessOperationFailed');
  assert.deepEqual(observations, ['processSpawnRequested', 'processSpawned', 'processOperationFailed', 'processExited', 'processClosed']);
});

test('legacy owned process rejects failed creation only after the close receipt', async () => {
  const child = new EventEmitter();
  let settled = false;
  const observations = [];
  const outcome = startLegacyOwnedProcess('synthetic', [], {}, {
    observe: (code) => observations.push(code),
    spawnProcess() { return child; },
  }).then(() => { settled = true; }, (error) => { settled = true; return error.message; });
  child.emit('error', new Error('private spawn failure'));
  await setImmediate();
  const beforeClose = settled;
  child.emit('close', -2, null);
  assert.equal(await outcome, 'ownedProcessStartFailed');
  assert.equal(beforeClose, false);
  assert.deepEqual(observations, ['processSpawnRequested', 'processStartFailed', 'processClosed']);
});

const FOOTPRINT_PATHS = Object.freeze({
  installRoot: 'synthetic-install-root',
  executablePath: 'synthetic-executable',
  shortcutPath: 'synthetic-shortcut',
});

function metadata(kind, nlink = 1n) {
  return {
    isSymbolicLink: () => kind === 'symlink',
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    nlink,
  };
}

test('footprint absence and installed kinds retain their existing meaning', async () => {
  for (const absent of [false, true]) {
    const result = await inspectLegacyInstallerFootprint(FOOTPRINT_PATHS, {
      async readMetadata(path, options) {
        assert.deepEqual(options, { bigint: true });
        if (absent) throw Object.assign(new Error('private'), { code: 'ENOENT' });
        return metadata(path === FOOTPRINT_PATHS.installRoot ? 'directory' : 'file');
      },
    });
    assert.deepEqual(result, {
      installRootExists: !absent, executableExists: !absent, shortcutExists: !absent,
    });
  }
});

for (const [role, key] of [
  ['InstallRoot', 'installRoot'], ['Executable', 'executablePath'], ['Shortcut', 'shortcutPath'],
]) {
  const cases = [
    ['MetadataReadFailed', () => { throw Object.assign(new Error('private-path-and-os-error'), { code: 'EACCES' }); }],
    ['SymbolicLink', () => metadata('symlink')],
    ['TypeInvalid', () => metadata(role === 'InstallRoot' ? 'file' : 'directory')],
    ...(role === 'InstallRoot' ? [] : [['LinkCountInvalid', () => metadata('file', 2n)]]),
  ];
  for (const [condition, invalidMetadata] of cases) {
    test(`footprint retains the first ${role} ${condition} rejection without private details`, async () => {
      const calls = [];
      await assert.rejects(inspectLegacyInstallerFootprint(FOOTPRINT_PATHS, {
        async readMetadata(path) {
          calls.push(path);
          if (path === FOOTPRINT_PATHS[key]) return invalidMetadata();
          return metadata(path === FOOTPRINT_PATHS.installRoot ? 'directory' : 'file');
        },
      }), (error) => {
        assert.equal(error.message, `installerFootprint${role}${condition}`);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(error.stack, /private-path-and-os-error|EACCES/);
        return true;
      });
      assert.deepEqual(calls, Object.values(FOOTPRINT_PATHS).slice(0, Object.keys(FOOTPRINT_PATHS).indexOf(key) + 1));
    });
  }
}

test('actual filesystem hardlink is rejected without writing the footprint', async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-footprint-contract-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    installRoot: resolve(root, 'install'),
    executablePath: resolve(root, 'install', 'synthetic-payload'),
    shortcutPath: resolve(root, 'synthetic-shortcut'),
  };
  await mkdir(paths.installRoot);
  await writeFile(paths.executablePath, 'synthetic bytes');
  await writeFile(paths.shortcutPath, 'synthetic shortcut');
  await link(paths.executablePath, resolve(root, 'second-name'));
  await assert.rejects(inspectLegacyInstallerFootprint(paths), {
    message: 'installerFootprintExecutableLinkCountInvalid',
  });
  assert.equal(await readFile(paths.executablePath, 'utf8'), 'synthetic bytes');
});

test('legacy worker runtime has no nested supervisor, process scan, timeout, or emergency cleanup', async () => {
  const files = await Promise.all(
    [
      'legacyUpgradeWindowsRuntime.mjs',
      'legacyUpgradeSourceSmoke.mjs',
      'legacyUpgradeStartupObserver.mjs',
    ].map((name) => readFile(resolve(DIRECTORY, name), 'utf8')),
  );
  const source = files.join('\n');
  assert.doesNotMatch(
    source,
    /WindowsProcessSupervisor|Get-CimInstance|taskkill|Stop-Process|wmic|setTimeout|Start-Sleep/iu,
  );
  assert.match(source, /requestWindowsApplicationClose\.ps1/u);
  assert.match(source, /runHistoricalPackagedSmokeProcessChain/u);
});

test('legacy worker runtime uses the artifact packages and normal source and target startup', async () => {
  const source = await readFile(
    resolve(DIRECTORY, 'legacyUpgradeWindowsRuntime.mjs'),
    'utf8',
  );
  assert.match(source, /artifact\[roleName\]\.installerPath/u);
  assert.match(source, /--desktop-smoke-restored/u);
  assert.match(source, /--user-data-dir=/u);
  assert.match(source, /windowsHide: false/u);
  assert.match(source, /runSourceStartup/u);
  assert.doesNotMatch(source, /w6b|packageWindows|buildWindows/iu);
});

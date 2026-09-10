import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { inspectLegacyInstallerFootprint, startLegacyOwnedProcess } from './legacyUpgradeWindowsRuntime.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('legacy owned process retains a post-spawn error until actual close', async () => {
  const child = new EventEmitter();
  child.pid = 1;
  const started = startLegacyOwnedProcess('synthetic', [], {}, {
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
});

test('legacy owned process rejects failed creation only after the close receipt', async () => {
  const child = new EventEmitter();
  let settled = false;
  const outcome = startLegacyOwnedProcess('synthetic', [], {}, {
    spawnProcess() { return child; },
  }).then(() => { settled = true; }, (error) => { settled = true; return error.message; });
  child.emit('error', new Error('private spawn failure'));
  await setImmediate();
  const beforeClose = settled;
  child.emit('close', -2, null);
  assert.equal(await outcome, 'ownedProcessStartFailed');
  assert.equal(beforeClose, false);
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

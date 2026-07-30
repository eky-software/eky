import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ElectronDevelopmentRuntimeError,
  resolveElectronDevelopmentRuntime,
} from './electron-development-runtime.mjs';

const desktopPackageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url),
);

test('resolves Electron through the desktop package context without assuming a node_modules layout', () => {
  const fixture = createRuntimeFixture();
  try {
    const runtime = resolveElectronDevelopmentRuntime({
      desktopPackageJsonPath: fixture.desktopPackageJsonPath,
    });

    assert.equal(runtime.executablePath, fixture.executablePath);
    assert.equal(runtime.version, '42.8.0');
    assert.doesNotThrow(() =>
      resolveElectronDevelopmentRuntime({
        desktopPackageJsonPath: fixture.desktopPackageJsonPath,
      }),
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('reports a missing materialized executable with a bounded code', () => {
  const fixture = createRuntimeFixture({ createExecutable: false });
  try {
    assertRuntimeError(
      () =>
        resolveElectronDevelopmentRuntime({
          desktopPackageJsonPath: fixture.desktopPackageJsonPath,
        }),
      'ELECTRON_EXECUTABLE_MISSING',
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('reports missing runtime metadata with a bounded code', () => {
  const fixture = createRuntimeFixture({ createPathFile: false });
  try {
    assertRuntimeError(
      () =>
        resolveElectronDevelopmentRuntime({
          desktopPackageJsonPath: fixture.desktopPackageJsonPath,
        }),
      'ELECTRON_EXECUTABLE_MISSING',
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('rejects a runtime path that escapes the Electron dist directory', () => {
  const fixture = createRuntimeFixture({ executableName: '../outside.exe' });
  try {
    assertRuntimeError(
      () =>
        resolveElectronDevelopmentRuntime({
          desktopPackageJsonPath: fixture.desktopPackageJsonPath,
        }),
      'ELECTRON_PACKAGE_INVALID',
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('rejects a runtime version that differs from the desktop manifest', () => {
  const fixture = createRuntimeFixture({ electronVersion: '42.7.0' });
  try {
    assertRuntimeError(
      () =>
        resolveElectronDevelopmentRuntime({
          desktopPackageJsonPath: fixture.desktopPackageJsonPath,
        }),
      'ELECTRON_VERSION_MISMATCH',
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('uses the pinned Electron on-demand installer before validation', () => {
  const desktopPackage = JSON.parse(
    readFileSync(desktopPackageJsonPath, 'utf8'),
  );
  assert.equal(
    desktopPackage.scripts['e2e:prepare-electron-runtime'],
    'pnpm exec install-electron --no && node scripts/assert-electron-development-runtime.mjs',
  );

  const source = readFileSync(
    fileURLToPath(
      new URL('./electron-development-runtime.mjs', import.meta.url),
    ),
    'utf8',
  );
  assert.doesNotMatch(source, /\.pnpm|node_modules[\\/]electron[\\/]dist/);
  assert.match(source, /createRequire/);
});

function createRuntimeFixture(input = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eky-electron-runtime-'));
  const desktopPackageJsonPath = join(
    root,
    'apps',
    'desktop',
    'package.json',
  );
  const electronRoot = join(root, 'node_modules', 'electron');
  const executableName = input.executableName ?? 'electron.exe';
  const executablePath = join(electronRoot, 'dist', executableName);
  mkdirSync(dirname(desktopPackageJsonPath), { recursive: true });
  mkdirSync(dirname(executablePath), { recursive: true });
  writeFileSync(
    desktopPackageJsonPath,
    `${JSON.stringify({
      devDependencies: { electron: '42.8.0' },
      private: true,
    })}\n`,
    'utf8',
  );
  writeFileSync(
    join(electronRoot, 'package.json'),
    `${JSON.stringify({
      main: 'index.cjs',
      name: 'electron',
      version: input.electronVersion ?? '42.8.0',
    })}\n`,
    'utf8',
  );
  if (input.createPathFile !== false) {
    writeFileSync(
      join(electronRoot, 'path.txt'),
      executableName,
      'utf8',
    );
  }
  if (input.createExecutable !== false) {
    writeFileSync(executablePath, 'synthetic executable', {
      encoding: 'utf8',
      mode: 0o700,
    });
  }

  return { desktopPackageJsonPath, executablePath, root };
}

function assertRuntimeError(action, code) {
  let actualError;
  try {
    action();
  } catch (error) {
    actualError = error;
  }
  assert.ok(actualError instanceof ElectronDevelopmentRuntimeError);
  assert.equal(actualError.code, code);
  assert.equal(actualError.message, code);
}

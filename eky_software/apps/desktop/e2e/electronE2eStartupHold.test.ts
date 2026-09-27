import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSafeDesktopStartup } from '../src/main/earlyStartup.js';
import {
  readElectronE2eConfig,
  type ElectronE2eConfig,
} from './electronE2eConfig.js';
import { createElectronE2eStartupHold } from './electronE2eStartupHold.js';

const runtimeInstanceId = '11111111-1111-4111-8111-111111111111';
const desktopRoot = resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Electron E2E startup hold', () => {
  it.each(['normal', 'backendStartFailure'] as const)(
    'does not introduce a wait in %s mode',
    async (startupMode) => {
      const hold = createElectronE2eStartupHold({ startupMode, runtimeInstanceId });
      const startDesktopComposition = vi.fn();
      const loadRuntime = vi.fn(async () => ({ startDesktopComposition }));
      const startRuntime = vi.fn(async () => {
        if (startupMode === 'backendStartFailure') {
          throw new Error('BACKEND_READINESS_TIMEOUT');
        }
      });
      const onFailure = vi.fn();
      const exitApplication = vi.fn();

      expect(hold.afterAppReady()).toBeUndefined();
      await runSafeDesktopStartup({
        exitApplication,
        loadRuntime,
        onFailure,
        startRuntime,
        async waitUntilReady() {
          const pending = hold.afterAppReady();
          if (pending !== undefined) await pending;
        },
      });

      expect(loadRuntime).toHaveBeenCalledOnce();
      expect(startRuntime).toHaveBeenCalledExactlyOnceWith(startDesktopComposition);
      expect(hold.snapshot()).toEqual({ held: false, runtimeInstanceId });
      if (startupMode === 'backendStartFailure') {
        expect(onFailure).toHaveBeenCalledExactlyOnceWith('BACKEND_READINESS_TIMEOUT');
        expect(exitApplication).toHaveBeenCalledExactlyOnceWith(1);
      } else {
        expect(onFailure).not.toHaveBeenCalled();
        expect(exitApplication).not.toHaveBeenCalled();
      }
    },
  );

  it('holds only after readiness and prevents runtime loading and composition', async () => {
    const hold = createElectronE2eStartupHold({
      startupMode: 'pendingFirstWindow',
      runtimeInstanceId,
    });
    let markReady!: () => void;
    const ready = new Promise<void>((resolveReady) => { markReady = resolveReady; });
    const loadRuntime = vi.fn(async () => ({ startDesktopComposition: vi.fn() }));
    const startRuntime = vi.fn(async () => {});
    const onFailure = vi.fn();
    const exitApplication = vi.fn();
    const completed = vi.fn();
    const startup = runSafeDesktopStartup({
      exitApplication,
      loadRuntime,
      onFailure,
      startRuntime,
      async waitUntilReady() {
        await ready;
        const pending = hold.afterAppReady();
        if (pending !== undefined) await pending;
      },
    });
    void startup.then(completed, completed);

    await Promise.resolve();
    expect(hold.snapshot()).toEqual({ held: false, runtimeInstanceId });
    expect(loadRuntime).not.toHaveBeenCalled();
    markReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(hold.snapshot()).toEqual({ held: true, runtimeInstanceId });
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(startRuntime).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(exitApplication).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });

  it('reuses a timer-free hold and exposes only immutable state and identity', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const immediate = vi.spyOn(globalThis, 'setImmediate');
    const config = { startupMode: 'pendingFirstWindow' as const, runtimeInstanceId };
    const hold = createElectronE2eStartupHold(config);
    const before = hold.snapshot();
    config.runtimeInstanceId = '22222222-2222-4222-8222-222222222222';
    const pending = hold.afterAppReady();

    expect(pending).toBeInstanceOf(Promise);
    expect(hold.afterAppReady()).toBe(pending);
    const settled = vi.fn();
    void pending!.then(settled, settled);
    await Promise.resolve();
    const snapshot = hold.snapshot();

    expect(settled).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(immediate).not.toHaveBeenCalled();
    expect(before).toEqual({ held: false, runtimeInstanceId });
    expect(snapshot).toEqual({ held: true, runtimeInstanceId });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Reflect.set(snapshot, 'held', false)).toBe(false);
    expect(hold.snapshot()).toEqual({ held: true, runtimeInstanceId });
  });
});

describe('Electron E2E startup mode config admission', () => {
  it.each(['normal', 'backendStartFailure', 'pendingFirstWindow'] as const)(
    'admits only the explicit %s mode with a valid E2E config',
    (startupMode) => {
      const fixture = createConfigFixture();
      fixture.config.startupMode = startupMode;
      fixture.write(fixture.config);
      expect(readElectronE2eConfig(fixture.path, fixture.environment)).toEqual(fixture.config);
    },
  );

  it.each([undefined, null, true, 1, '', 'pendingfirstwindow', 'pendingFirstWindow ', {}])(
    'rejects invalid or missing startup mode %j',
    (startupMode) => {
      const fixture = createConfigFixture();
      fixture.write({ ...fixture.config, startupMode });
      expect(() => readElectronE2eConfig(fixture.path, fixture.environment)).toThrow();
    },
  );

  it.each([
    { marker: 'NOT_E2E' },
    { runtimeInstanceId: 'not-a-runtime-identity' },
    { hold: true },
  ])('preserves closed identity and field validation for %j', (override) => {
    const fixture = createConfigFixture();
    fixture.write({ ...fixture.config, ...override });
    expect(() => readElectronE2eConfig(fixture.path, fixture.environment)).toThrow();
  });

  it('still requires the E2E marker and matching runtime root', () => {
    const fixture = createConfigFixture();
    expect(() => readElectronE2eConfig(fixture.path, {
      ...fixture.environment, EKY_E2E: undefined,
    })).toThrow('Electron E2E marker is missing.');
    expect(() => readElectronE2eConfig(fixture.path, {
      ...fixture.environment,
      EKY_ELECTRON_E2E_RUN_ROOT: fixture.config.paths.userDataPath,
    })).toThrow('Electron E2E runtime root is invalid.');
  });
});

describe('Electron E2E startup hold structure boundary', () => {
  it('keeps the hold and test controller out of production source and build inputs', () => {
    for (const path of listProductionSources(join(desktopRoot, 'src'))) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(
        /electronE2eStartupHold|pendingFirstWindow|__EKY_ELECTRON_E2E__|["'][^"']*\/e2e\//,
      );
    }
    const production = JSON.parse(readFileSync(join(desktopRoot, 'tsconfig.json'), 'utf8'));
    const build = JSON.parse(readFileSync(join(desktopRoot, 'tsconfig.build.json'), 'utf8'));
    const e2e = JSON.parse(readFileSync(join(desktopRoot, 'tsconfig.e2e.json'), 'utf8'));
    expect(production.compilerOptions.rootDir).toBe('src');
    expect(production.include).toEqual(['src']);
    expect(build.extends).toBe('./tsconfig.json');
    expect(build.include).toBeUndefined();
    expect(build.files).toBeUndefined();
    expect(e2e.include).toContain('e2e');
    expect(e2e.compilerOptions.outDir).not.toBe(production.compilerOptions.outDir);
  });

  it('wires the hold after app readiness and exposes only its snapshot', () => {
    const source = readFileSync(join(desktopRoot, 'e2e', 'electronE2eEntrypoint.ts'), 'utf8');
    expect(source).toMatch(
      /await app\.whenReady\(\);\s*startupObservation\.record\('appReady'\);\s*const pending = startupHold\.afterAppReady\(\);\s*if \(pending !== undefined\) \{\s*await pending;\s*\}/,
    );
    expect(source).toContain('startupHold: () => startupHold.snapshot()');
    const controller = source.slice(source.indexOf('__EKY_ELECTRON_E2E__:'));
    expect(controller).not.toContain('startupHold.afterAppReady');
    expect(controller).toContain('backendIsRunning: () => backendController.isRunning()');
    expect(controller).toContain('backendStartCount: () => backendController.getStartCount()');
    expect(controller).toContain('windowCount: () => BrowserWindow.getAllWindows().length');
  });
});

function createConfigFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eky-e2e-startup-hold-')));
  temporaryRoots.push(root);
  for (const name of ['application', 'archive', 'artifacts', 'resources', 'userData']) {
    mkdirSync(join(root, name));
  }
  const backendConfigPath = join(root, 'backend.json');
  writeFileSync(backendConfigPath, '{}');
  const config: ElectronE2eConfig = {
    backend: { configPath: backendConfigPath, port: 12345, sessionSecret: 'x'.repeat(43) },
    dialogMode: 'accept',
    formatVersion: 2,
    marker: 'EKY_E2E',
    nativeOpenDialog: { mode: 'accept', purpose: 'invoicePdfArchive' },
    paths: {
      applicationPath: join(root, 'application'),
      invoicePdfArchiveDirectoryPath: join(root, 'archive'),
      observationsPath: join(root, 'artifacts', 'observations.json'),
      resourcesPath: join(root, 'resources'),
      supportBundlePath: join(root, 'artifacts', 'support.zip'),
      userDataPath: join(root, 'userData'),
      workspaceBackupPath: null,
    },
    relaunchMode: 'playwrightManaged',
    runtimeInstanceId,
    runtimeRoot: root,
    scenarioId: 'PENDING-FIRST-WINDOW',
    startupMode: 'pendingFirstWindow',
  };
  const path = join(root, 'electron.json');
  const write = (value: unknown) => writeFileSync(path, JSON.stringify(value));
  write(config);
  return {
    config,
    path,
    write,
    environment: { EKY_E2E: '1', EKY_ELECTRON_E2E_RUN_ROOT: root },
  };
}

function listProductionSources(root: string): string[] {
  const extensions = new Set(['.cts', '.js', '.jsx', '.mts', '.ts', '.tsx']);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listProductionSources(path);
    return entry.isFile() && extensions.has(extname(entry.name)) &&
      !entry.name.includes('.test.') ? [path] : [];
  });
}

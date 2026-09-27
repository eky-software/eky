import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { prepareWindowsViteService } from '../../src/environment/windowsViteServiceConfiguration.js';
import {
  requireWindowsViteDescendant, resolveWindowsViteEntrypoint, validateWindowsViteServiceInput,
} from '../../src/environment/windowsViteServicePaths.js';

function fixture() {
  const osTempRoot = realpathSync.native(tmpdir());
  const repositoryRoot = realpathSync.native(mkdtempSync(join(osTempRoot, 'vite-source-contract-')));
  const namespace = join(osTempRoot, 'eky-e2e');
  mkdirSync(namespace, { recursive: true });
  const runRoot = realpathSync.native(mkdtempSync(join(namespace, 'run-')));
  const environmentRoot = join(runRoot, 'worker', 'temp');
  mkdirSync(environmentRoot, { recursive: true });
  const packageRoot = join(repositoryRoot, 'node_modules', '.pnpm', 'vite@8.2.1_peer', 'node_modules', 'vite');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  const manifest = join(packageRoot, 'package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'vite', version: '8.2.1', bin: { vite: 'bin/vite.js' } }));
  const entrypoint = join(packageRoot, 'bin', 'vite.js');
  writeFileSync(entrypoint, '// Synthetic inert fixture; never executed.\n');
  const web = join(repositoryRoot, 'apps', 'web');
  mkdirSync(join(web, 'node_modules'), { recursive: true });
  writeFileSync(join(web, 'vite.config.ts'), '// Synthetic inert configuration.\n');
  const selector = join(web, 'node_modules', 'vite');
  symlinkSync(packageRoot, selector, 'junction');
  const input = { repositoryRoot, runRoot, environmentRoot, webPort: 45123,
    backendOrigin: 'http://127.0.0.1:45124', sessionSecret: 's'.repeat(43),
    lifetime: { readRemainingWorkMilliseconds: () => 12_345 } };
  return { input, osTempRoot, manifest, selector, packageRoot, entrypoint,
    dispose() { rmSync(repositoryRoot, { recursive: true, force: true }); rmSync(runRoot, { recursive: true, force: true }); } };
}

test.describe('Windows Vite fixed configuration without owner launch', () => {
  test('binds only the named pnpm package and fixed manifest bin', () => {
    const f = fixture();
    try {
      expect(resolveWindowsViteEntrypoint(f.input.repositoryRoot)).toBe(realpathSync.native(f.entrypoint));
      expect(() => validateWindowsViteServiceInput(f.input, f.osTempRoot)).not.toThrow();
    } finally { f.dispose(); }
  });
  for (const [name, manifest] of Object.entries({
    wrongPackage: { name: 'other', version: '8.2.1', bin: { vite: 'bin/vite.js' } },
    arbitraryBin: { name: 'vite', version: '8.2.1', bin: { vite: '../../outside.js' } },
    stringBin: { name: 'vite', version: '8.2.1', bin: 'bin/vite.js' },
    extraBin: { name: 'vite', version: '8.2.1', bin: { vite: 'bin/vite.js', other: 'bin/other.js' } },
    missingVersion: { name: 'vite', bin: { vite: 'bin/vite.js' } },
    mismatchedVersion: { name: 'vite', version: '8.2.2', bin: { vite: 'bin/vite.js' } },
    invalidVersion: { name: 'vite', version: '../8.2.1', bin: { vite: 'bin/vite.js' } },
  })) {
    test(`rejects ${name}`, () => {
      const f = fixture();
      try {
        writeFileSync(f.manifest, JSON.stringify(manifest));
        expect(() => resolveWindowsViteEntrypoint(f.input.repositoryRoot)).toThrow();
      } finally { f.dispose(); }
    });
  }
  test('rejects a missing bin and a regular-directory selector', () => {
    const f = fixture();
    try {
      unlinkSync(f.entrypoint);
      expect(() => resolveWindowsViteEntrypoint(f.input.repositoryRoot)).toThrow();
      unlinkSync(f.selector);
      mkdirSync(f.selector);
      expect(() => resolveWindowsViteEntrypoint(f.input.repositoryRoot)).toThrow();
    } finally { f.dispose(); }
  });
  test('rejects selector escape and a second target link', () => {
    const f = fixture();
    const other = fixture();
    try {
      unlinkSync(f.selector);
      symlinkSync(other.packageRoot, f.selector, 'junction');
      expect(() => resolveWindowsViteEntrypoint(f.input.repositoryRoot)).toThrow();
      unlinkSync(f.selector);
      const intermediate = join(dirname(f.packageRoot), 'intermediate');
      symlinkSync(f.packageRoot, intermediate, 'junction');
      symlinkSync(intermediate, f.selector, 'junction');
      expect(() => resolveWindowsViteEntrypoint(f.input.repositoryRoot)).toThrow();
    } finally { f.dispose(); other.dispose(); }
  });
  test('rejects an original linked parent even when realpath is inside the same run', () => {
    const f = fixture();
    try {
      const linked = join(f.input.runRoot, 'linked');
      symlinkSync(dirname(f.input.environmentRoot), linked, 'junction');
      expect(() => validateWindowsViteServiceInput({ ...f.input, environmentRoot: join(linked, 'temp') }, f.osTempRoot)).toThrow();
    } finally { f.dispose(); }
  });
  test('rejects sibling runs, relative roots and cross-drive descendants', () => {
    const f = fixture();
    const sibling = fixture();
    try {
      expect(() => validateWindowsViteServiceInput({ ...f.input, environmentRoot: sibling.input.environmentRoot }, f.osTempRoot)).toThrow();
      expect(() => validateWindowsViteServiceInput({ ...f.input, environmentRoot: 'relative' }, f.osTempRoot)).toThrow();
      expect(() => requireWindowsViteDescendant(f.input.runRoot, f.input.runRoot)).toThrow();
      if (process.platform === 'win32') expect(() => requireWindowsViteDescendant('Z:\\other', 'C:\\run')).toThrow();
    } finally { f.dispose(); sibling.dispose(); }
  });
  test('rejects invalid ports, noncanonical origins and session encodings', () => {
    const f = fixture();
    try {
      for (const webPort of [0, 65_536, 1.5, NaN, Infinity]) {
        expect(() => validateWindowsViteServiceInput({ ...f.input, webPort }, f.osTempRoot)).toThrow();
      }
      for (const backendOrigin of ['http://localhost:12', 'https://127.0.0.1:12', 'http://127.0.0.1:12/',
        'http://user@127.0.0.1:12', 'http://127.0.0.1:65536', 'http://127.0.0.1:012', 'http://127.0.0.1:80']) {
        expect(() => validateWindowsViteServiceInput({ ...f.input, backendOrigin }, f.osTempRoot)).toThrow();
      }
      for (const sessionSecret of ['', 's'.repeat(42), 's'.repeat(44), '+'.repeat(43)]) {
        expect(() => validateWindowsViteServiceInput({ ...f.input, sessionSecret }, f.osTempRoot)).toThrow();
      }
    } finally { f.dispose(); }
  });
  test('serializes the exact Vite config and transfers session only through owner environment', () => {
    const f = fixture();
    try {
      if (process.platform !== 'win32') {
        expect(() => prepareWindowsViteService(f.input)).toThrow('E2E_VITE_OWNER_PLATFORM_INVALID');
        return;
      }
      let builds = 0;
      const prepared = prepareWindowsViteService(f.input, {
        assertBuild: root => { expect(root).toBe(f.input.repositoryRoot); builds++; return 'inert-owner-not-executed'; },
        now: () => 700,
      });
      expect(builds).toBe(1);
      expect(prepared.workDeadline).toBe(13_045);
      const raw = readFileSync(prepared.configPath, 'utf8');
      const config = JSON.parse(raw);
      expect(Object.keys(config)).toEqual(['protocol', 'schemaVersion', 'generation', 'launchNonce', 'nodeExecutable',
        'repositoryRoot', 'osTempRoot', 'runRoot', 'controlRoot', 'webPort', 'environment', 'workBudgetMilliseconds']);
      expect(config.protocol).toBe('eky.e2e.vite-service');
      expect(config.environment).toEqual({ EKY_E2E: '1', NODE_ENV: 'test',
        SystemRoot: realpathSync.native(process.env.SystemRoot!), WINDIR: realpathSync.native(process.env.WINDIR!),
        EKY_E2E_OS_TEMP_ROOT: f.osTempRoot, TEMP: join(config.controlRoot, 'temp'), TMP: join(config.controlRoot, 'temp'),
        USERPROFILE: join(config.controlRoot, 'profile'), APPDATA: join(config.controlRoot, 'profile'),
        LOCALAPPDATA: join(config.controlRoot, 'profile'), EKY_E2E_BACKEND_ORIGIN: f.input.backendOrigin,
        EKY_E2E_ENV_ROOT: f.input.environmentRoot });
      expect(raw).not.toContain(f.input.sessionSecret);
      expect(raw).not.toContain('runtimeConfigPath');
      expect(prepared.ownerEnvironment.EKY_E2E_RUNTIME_SESSION).toBe(f.input.sessionSecret);
      for (const key of ['HOME', 'PATH', 'Path', 'NODE_OPTIONS']) expect(prepared.ownerEnvironment).not.toHaveProperty(key);
    } finally { f.dispose(); }
  });
  test('requires a current build and rejects exhausted work before publishing config', () => {
    const f = fixture();
    try {
      if (process.platform !== 'win32') {
        expect(() => prepareWindowsViteService(f.input)).toThrow('E2E_VITE_OWNER_PLATFORM_INVALID');
        return;
      }
      expect(() => prepareWindowsViteService(f.input, { assertBuild: () => { throw new Error('STALE_BUILD'); } })).toThrow('STALE_BUILD');
      expect(() => prepareWindowsViteService({ ...f.input, lifetime: { readRemainingWorkMilliseconds: () => 0 } },
        { assertBuild: () => 'inert-owner-not-executed' })).toThrow('E2E_VITE_OWNER_DEADLINE_EXCEEDED');
    } finally { f.dispose(); }
  });
});

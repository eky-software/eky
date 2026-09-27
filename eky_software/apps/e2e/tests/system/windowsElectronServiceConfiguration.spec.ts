import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';

import { createElectronE2eProfile } from '../../src/environment/createElectronE2eProfile.js';
import { createElectronEnvironment } from '../../src/environment/createElectronEnvironment.js';
import { prepareWindowsServiceConfiguration } from '../../src/environment/windowsServiceConfiguration.js';
import { resolveWindowsElectronServiceExecutable, validateWindowsElectronServiceInput } from '../../src/environment/windowsElectronServicePaths.js';

function fixture() {
  const osTempRoot = realpathSync.native(tmpdir());
  const repositoryRoot = realpathSync.native(mkdtempSync(join(osTempRoot, 'electron-source-contract-')));
  const namespace = join(osTempRoot, 'eky-e2e');
  mkdirSync(namespace, { recursive: true });
  const runRoot = realpathSync.native(mkdtempSync(join(namespace, 'run-')));
  const runtimeRoot = join(runRoot, 'worker');
  const profile = join(runtimeRoot, 'windows-profile');
  for (const path of ['Temp', 'AppData/Local', 'AppData/Roaming']) mkdirSync(join(profile, path), { recursive: true });
  const runtimeConfigPath = join(runtimeRoot, 'electron-config.json');
  writeFileSync(runtimeConfigPath, '{}');
  const packageRoot = join(repositoryRoot, 'node_modules', '.pnpm', 'electron@43.0.0', 'node_modules', 'electron');
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  const manifest = join(packageRoot, 'package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'electron', version: '43.0.0' }));
  const executable = join(packageRoot, 'dist', 'electron.exe');
  writeFileSync(executable, 'Inert fixture, never executed.');
  const selectorPath = join(packageRoot, 'path.txt');
  writeFileSync(selectorPath, 'electron.exe\n');
  const desktop = join(repositoryRoot, 'apps', 'desktop');
  mkdirSync(join(desktop, 'node_modules'), { recursive: true });
  const application = join(desktop, 'e2e-dist');
  mkdirSync(join(application, 'e2e'), { recursive: true });
  const applicationManifest = join(application, 'package.json');
  writeFileSync(applicationManifest, JSON.stringify({ name: 'eky-desktop-e2e', type: 'module', main: 'e2e/electronE2eEntrypoint.js' }));
  const entrypoint = join(application, 'e2e', 'electronE2eEntrypoint.js');
  writeFileSync(entrypoint, '// Inert fixture; never executed.');
  const desktopManifest = join(desktop, 'package.json');
  writeFileSync(desktopManifest, JSON.stringify({ devDependencies: { electron: '43.0.0' } }));
  const selector = join(desktop, 'node_modules', 'electron');
  symlinkSync(packageRoot, selector, 'junction');
  const environment: Record<string, string> = { EKY_E2E: '1', NODE_ENV: 'test',
    EKY_ELECTRON_E2E_CONFIG: runtimeConfigPath, EKY_ELECTRON_E2E_RUN_ROOT: runtimeRoot,
    HOME: profile, USERPROFILE: profile, TEMP: join(profile, 'Temp'), TMP: join(profile, 'Temp'),
    APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'),
    SystemRoot: process.env.SystemRoot ?? osTempRoot, WINDIR: process.env.WINDIR ?? osTempRoot };
  const input = { repositoryRoot, runRoot, runtimeRoot, runtimeConfigPath, environment,
    lifetime: { readRemainingWorkMilliseconds: () => 12_345 } };
  return { input, osTempRoot, manifest, desktopManifest, applicationManifest, entrypoint, selectorPath, selector, packageRoot, executable,
    validate: () => validateWindowsElectronServiceInput(input, osTempRoot),
    dispose() { rmSync(repositoryRoot, { recursive: true, force: true }); rmSync(runRoot, { recursive: true, force: true }); } };
}

test.describe('Windows direct Electron fixed configuration without launch', () => {
  test('accepts only the pinned package selector and existing isolated runtime environment', () => {
    const f = fixture();
    try {
      expect(resolveWindowsElectronServiceExecutable(f.input.repositoryRoot)).toBe(realpathSync.native(f.executable));
      expect(f.validate).not.toThrow();
    } finally { f.dispose(); }
  });
  for (const [key, value] of [['name', 'other'], ['type', 'commonjs'], ['main', '../other.js']]) {
    test(`refuses redirected E2E application ${key}`, () => {
      const f = fixture();
      try { writeFileSync(f.applicationManifest, JSON.stringify({ name: 'eky-desktop-e2e', type: 'module',
        main: 'e2e/electronE2eEntrypoint.js', [key!]: value })); expect(f.validate).toThrow(); }
      finally { f.dispose(); }
    });
  }
  test('refuses missing or linked E2E entrypoint parent', () => {
    const f = fixture();
    try {
      unlinkSync(f.entrypoint); expect(f.validate).toThrow(); rmdirSync(dirname(f.entrypoint));
      const other = join(f.input.runRoot, 'entry'); mkdirSync(other);
      writeFileSync(join(other, 'electronE2eEntrypoint.js'), '// Inert.');
      symlinkSync(other, dirname(f.entrypoint), 'junction'); expect(f.validate).toThrow();
    } finally { f.dispose(); }
  });
  for (const [name, value] of Object.entries({ wrongName: { name: 'other', version: '43.0.0' },
    wrongVersion: { name: 'electron', version: '43.0.1' }, missingVersion: { name: 'electron' } })) {
    test(`rejects package ${name}`, () => {
      const f = fixture();
      try { writeFileSync(f.manifest, JSON.stringify(value)); expect(f.validate).toThrow(); }
      finally { f.dispose(); }
    });
  }
  for (const value of ['^43.0.0', '43.0.1', '../43.0.0']) {
    test(`rejects nonmatching desktop pin ${value}`, () => {
      const f = fixture();
      try { writeFileSync(f.desktopManifest, JSON.stringify({ devDependencies: { electron: value } })); expect(f.validate).toThrow(); }
      finally { f.dispose(); }
    });
  }
  for (const value of ['other.exe', '../electron.exe', 'electron.exe\nother.exe']) {
    test(`rejects alternative binary selector ${JSON.stringify(value)}`, () => {
      const f = fixture();
      try { writeFileSync(f.selectorPath, value); expect(f.validate).toThrow(); }
      finally { f.dispose(); }
    });
  }
  test('rejects regular selectors, external targets and a second target link', () => {
    const f = fixture(); const other = fixture();
    try {
      unlinkSync(f.selector); mkdirSync(f.selector); expect(f.validate).toThrow(); rmdirSync(f.selector);
      symlinkSync(other.packageRoot, f.selector, 'junction'); expect(f.validate).toThrow(); unlinkSync(f.selector);
      const intermediate = join(dirname(f.packageRoot), 'other');
      symlinkSync(f.packageRoot, intermediate, 'junction'); symlinkSync(intermediate, f.selector, 'junction');
      expect(f.validate).toThrow();
    } finally { f.dispose(); other.dispose(); }
  });
  test('rejects sibling runtime, linked parent and repository/run overlap in both directions', () => {
    const f = fixture(); const other = fixture();
    try {
      expect(() => validateWindowsElectronServiceInput({ ...f.input, runtimeRoot: other.input.runtimeRoot }, f.osTempRoot)).toThrow();
      const alias = join(f.input.runRoot, 'alias');
      symlinkSync(f.input.runtimeRoot, alias, 'junction');
      expect(() => validateWindowsElectronServiceInput({ ...f.input, runtimeRoot: alias }, f.osTempRoot)).toThrow();
      for (const repositoryRoot of [f.input.runRoot, dirname(f.input.runRoot), f.input.runtimeRoot]) {
        expect(() => validateWindowsElectronServiceInput({ ...f.input, repositoryRoot }, f.osTempRoot)).toThrow();
      }
    } finally { f.dispose(); other.dispose(); }
  });
  for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'EKY_E2E_OS_TEMP_ROOT', 'Path']) {
    test(`rejects unapproved child environment key ${key}`, () => {
      const f = fixture();
      try { f.input.environment[key] = 'unapproved'; expect(f.validate).toThrow(); }
      finally { f.dispose(); }
    });
  }
  for (const key of ['EKY_E2E', 'NODE_ENV', 'HOME', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
    'USERPROFILE', 'EKY_ELECTRON_E2E_CONFIG', 'EKY_ELECTRON_E2E_RUN_ROOT', 'SystemRoot', 'WINDIR']) {
    test(`rejects missing or mismatched ${key}`, () => {
      const f = fixture();
      try { delete f.input.environment[key]; expect(f.validate).toThrow();
        f.input.environment[key] = 'incorrect'; expect(f.validate).toThrow(); }
      finally { f.dispose(); }
    });
  }
  test('bounds optional PATH and refuses renamed runtime config', () => {
    const f = fixture();
    try {
      f.input.environment.PATH = 'x'.repeat(2048); expect(f.validate).not.toThrow();
      f.input.environment.PATH += 'x'; expect(f.validate).toThrow('E2E_ELECTRON_OWNER_ENVIRONMENT_VALUE_INVALID');
      f.input.environment.PATH = 'synthetic\0value';
      expect(f.validate).toThrow('E2E_ELECTRON_OWNER_ENVIRONMENT_VALUE_INVALID');
      delete f.input.environment.PATH;
      const runtimeConfigPath = join(f.input.runtimeRoot, 'other.json'); writeFileSync(runtimeConfigPath, '{}');
      expect(() => validateWindowsElectronServiceInput({ ...f.input, runtimeConfigPath }, f.osTempRoot)).toThrow();
    } finally { f.dispose(); }
  });
  for (const [name, sourcePath] of Object.entries({
    ordinary: { PATH: 'C:\\synthetic-tools' },
    oversizedMixedCase: { pAtH: 'x'.repeat(2049) },
    embeddedNul: { Path: 'synthetic\0value' },
    absent: {},
  })) {
    test(`generates a valid Windows Electron environment without inheriting ${name} search paths`, () => {
      const f = fixture();
      try {
        const environment = createElectronEnvironment({
          configPath: f.input.runtimeConfigPath,
          platform: 'win32',
          profile: createElectronE2eProfile(f.input.runtimeRoot),
          runRoot: f.input.runtimeRoot,
          sourceEnvironment: {
            SystemRoot: f.input.environment.SystemRoot,
            WINDIR: f.input.environment.WINDIR,
            ...sourcePath,
          },
        });
        expect(() => validateWindowsElectronServiceInput({ ...f.input, environment }, f.osTempRoot)).not.toThrow();
        expect(environment).not.toHaveProperty('PATH');
      } finally { f.dispose(); }
    });
  }
  test('serializes only the direct Electron profile and retains the original deadline', () => {
    const f = fixture();
    try {
      const prepare = () => prepareWindowsServiceConfiguration({ profile: 'electron', input: f.input },
        { assertBuild: () => 'inert-owner-never-executed', now: () => 700 });
      if (process.platform !== 'win32') { expect(prepare).toThrow('E2E_ELECTRON_OWNER_PLATFORM_INVALID'); return; }
      const result = prepare(); const config = JSON.parse(readFileSync(result.configPath, 'utf8'));
      expect(result.workDeadline).toBe(13_045);
      expect(Object.keys(config).sort()).toEqual(['protocol', 'schemaVersion', 'generation', 'launchNonce',
        'electronExecutable', 'repositoryRoot', 'osTempRoot', 'runRoot', 'controlRoot', 'runtimeConfigPath',
        'runtimeRoot', 'environment', 'workBudgetMilliseconds'].sort());
      expect(config.protocol).toBe('eky.e2e.electron-service'); expect(config.electronExecutable).toBe(f.executable);
      expect(config.environment).toEqual(f.input.environment);
      expect(result.ownerEnvironment.EKY_E2E_OS_TEMP_ROOT).toBe(f.osTempRoot);
      expect(config.environment).not.toHaveProperty('EKY_E2E_OS_TEMP_ROOT');
      expect(() => prepareWindowsServiceConfiguration({ profile: 'electron', input: { ...f.input,
        lifetime: { readRemainingWorkMilliseconds: () => 0 } } },
      { assertBuild: () => 'inert-owner-never-executed' })).toThrow('E2E_ELECTRON_OWNER_DEADLINE_EXCEEDED');
    } finally { f.dispose(); }
  });
});

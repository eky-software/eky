import { lstatSync, realpathSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import { test, expect } from '@playwright/test';

import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createElectronE2eProfile } from '../../src/environment/createElectronE2eProfile.js';
import { createElectronEnvironment } from '../../src/environment/createElectronEnvironment.js';

test('DESK-PROFILE-001 @critical creates an isolated profile without symbolic links', () => {
  const runRoot = createE2eRunRoot();
  try {
    const paths = createE2eWorkerPaths(runRoot, 'DESK-PROFILE-001');
    const profile = createElectronE2eProfile(paths.workerRoot);

    for (const path of Object.values(profile)) {
      expect(isAbsolute(path)).toBe(true);
      expect(path).toBe(realpathSync.native(path));
      expect(statSync(path).isDirectory()).toBe(true);
      expect(lstatSync(path).isSymbolicLink()).toBe(false);
      const relativePath = relative(runRoot, path);
      expect(relativePath).not.toBe('..');
      expect(relativePath.startsWith(`..${sep}`)).toBe(false);
    }
  } finally {
    rmSync(runRoot, { force: true, recursive: true });
  }
});

test('DESK-PROFILE-002 @critical exposes only allowlisted Windows launch variables', () => {
  const runRoot = createE2eRunRoot();
  try {
    const paths = createE2eWorkerPaths(runRoot, 'DESK-PROFILE-002');
    const profile = createElectronE2eProfile(paths.workerRoot);
    const environment = createElectronEnvironment({
      configPath: paths.runtimeConfigPath,
      platform: 'win32',
      profile,
      runRoot: paths.workerRoot,
      sourceEnvironment: {
        CI: 'true',
        GITHUB_TOKEN: 'synthetic-github-token',
        NODE_AUTH_TOKEN: 'synthetic-node-token',
        npm_config_userconfig: 'synthetic-user-config',
        PATH: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        'x-eky-local-session': 'synthetic-runtime-session',
      },
    });

    expect(environment).toEqual({
      APPDATA: profile.appDataRoaming,
      EKY_E2E: '1',
      EKY_ELECTRON_E2E_CONFIG: paths.runtimeConfigPath,
      EKY_ELECTRON_E2E_RUN_ROOT: paths.workerRoot,
      HOME: profile.root,
      LOCALAPPDATA: profile.appDataLocal,
      NODE_ENV: 'test',
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
      TEMP: profile.temp,
      TMP: profile.temp,
      USERPROFILE: profile.root,
      WINDIR: 'C:\\Windows',
    });
    for (const path of [
      environment.APPDATA,
      environment.EKY_ELECTRON_E2E_CONFIG,
      environment.EKY_ELECTRON_E2E_RUN_ROOT,
      environment.HOME,
      environment.LOCALAPPDATA,
      environment.TEMP,
      environment.TMP,
      environment.USERPROFILE,
    ]) {
      expect(path).toBeDefined();
      if (path === undefined) {
        throw new Error('Expected Electron profile path is missing.');
      }
      expect(isAbsolute(path)).toBe(true);
    }
    expect(JSON.stringify(environment)).not.toContain('synthetic-github');
    expect(JSON.stringify(environment)).not.toContain('synthetic-node');
    expect(JSON.stringify(environment)).not.toContain('synthetic-runtime');
    expect(Object.keys(environment)).not.toContain('npm_config_userconfig');
  } finally {
    rmSync(runRoot, { force: true, recursive: true });
  }
});

test('DESK-PROFILE-003 @critical keeps non-Windows launch environments bounded', () => {
  const runRoot = createE2eRunRoot();
  try {
    const paths = createE2eWorkerPaths(runRoot, 'DESK-PROFILE-003');
    const profile = createElectronE2eProfile(paths.workerRoot);
    const environment = createElectronEnvironment({
      configPath: paths.runtimeConfigPath,
      platform: 'linux',
      profile,
      runRoot: paths.workerRoot,
      sourceEnvironment: {
        GITHUB_TOKEN: 'synthetic-github-token',
        PATH: '/usr/local/bin:/usr/bin',
        SystemRoot: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
      },
    });

    expect(environment).toEqual({
      EKY_E2E: '1',
      EKY_ELECTRON_E2E_CONFIG: paths.runtimeConfigPath,
      EKY_ELECTRON_E2E_RUN_ROOT: paths.workerRoot,
      HOME: profile.root,
      NODE_ENV: 'test',
      PATH: '/usr/local/bin:/usr/bin',
      TEMP: profile.temp,
      TMP: profile.temp,
    });
  } finally {
    rmSync(runRoot, { force: true, recursive: true });
  }
});

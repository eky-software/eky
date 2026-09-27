import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { assertWindowsBackendOwnerBuild } from '../../scripts/windowsBackendOwnerBuild.mjs';

import { assertPathUnderRoot } from './assertE2eSafetyBoundary.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import { backendServiceProtocol, backendServiceSchemaVersion } from './windowsBackendServiceProtocol.js';

export function prepareWindowsBackendService(input: {
  readonly repositoryRoot: string;
  readonly runRoot: string;
  readonly runtimeConfigPath: string;
  readonly lifetime: E2eFixtureLifetime;
}) {
  if (process.platform !== 'win32') throw new Error('E2E_BACKEND_OWNER_PLATFORM_INVALID');
  const repositoryRoot = realpathSync.native(input.repositoryRoot);
  const runRoot = realpathSync.native(input.runRoot);
  assertPathUnderRoot(input.runtimeConfigPath, runRoot);
  const generation = randomBytes(32).toString('hex');
  const launchNonce = randomBytes(32).toString('hex');
  const controlRoot = join(runRoot, `backend-owner-${generation}`);
  mkdirSync(controlRoot, { mode: 0o700 });
  const profile = join(controlRoot, 'profile');
  const temp = join(controlRoot, 'temp');
  mkdirSync(profile, { mode: 0o700 });
  mkdirSync(temp, { mode: 0o700 });
  const systemRoot = realpathSync.native(requireEnvironment('SystemRoot'));
  const environment = {
    EKY_E2E: '1', NODE_ENV: 'test', SystemRoot: systemRoot,
    EKY_E2E_OS_TEMP_ROOT: realpathSync.native(tmpdir()),
    WINDIR: realpathSync.native(requireEnvironment('WINDIR')),
    TEMP: temp, TMP: temp, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile,
  };
  const executable = assertWindowsBackendOwnerBuild(repositoryRoot);
  const dotnetExecutable = process.env.EKY_DOTNET_EXE;
  const dotnetRoot = dotnetExecutable === undefined ? process.env.DOTNET_ROOT
    : dirname(realpathSync.native(dotnetExecutable));
  const budgetAnchor = performance.now();
  const workBudgetMilliseconds = input.lifetime.readRemainingWorkMilliseconds();
  if (workBudgetMilliseconds < 1) throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
  const workDeadline = budgetAnchor + workBudgetMilliseconds;
  const configPath = join(controlRoot, 'backend-service-config.json');
  writeFileSync(configPath, JSON.stringify({
    protocol: backendServiceProtocol, schemaVersion: backendServiceSchemaVersion,
    generation, launchNonce, nodeExecutable: realpathSync.native(process.execPath),
    repositoryRoot, osTempRoot: realpathSync.native(tmpdir()), runRoot, controlRoot,
    runtimeConfigPath: realpathSync.native(input.runtimeConfigPath), environment, workBudgetMilliseconds,
  }), { mode: 0o600, flag: 'wx' });
  return {
    generation, launchNonce, configPath, executable, repositoryRoot, workDeadline,
    ownerEnvironment: { ...environment, ...(dotnetRoot === undefined ? {} : { DOTNET_ROOT: dotnetRoot }) },
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error('E2E_BACKEND_OWNER_ENVIRONMENT_INVALID');
  return value;
}

import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { assertWindowsBackendOwnerBuild } from '../../scripts/windowsBackendOwnerBuild.mjs';
import { assertPathUnderRoot } from './assertE2eSafetyBoundary.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import type { PreparedWindowsService } from './startOwnedWindowsService.js';
import { windowsServiceProfiles } from './windowsServiceProfile.js';
import { windowsServiceSchemaVersion } from './windowsServiceProtocol.js';
import { requireWindowsVitePath, validateWindowsViteServiceInput } from './windowsViteServicePaths.js';

interface ServiceInput {
  readonly repositoryRoot: string;
  readonly runRoot: string;
  readonly lifetime: E2eFixtureLifetime;
}
export interface WindowsBackendServiceInput extends ServiceInput {
  readonly runtimeConfigPath: string;
}
export interface WindowsViteServiceInput extends ServiceInput {
  readonly webPort: number;
  readonly environmentRoot: string;
  readonly backendOrigin: string;
  readonly sessionSecret: string;
}
type Selection = { profile: 'backend'; input: WindowsBackendServiceInput }
  | { profile: 'vite'; input: WindowsViteServiceInput };
export interface WindowsServicePreparationDependencies {
  assertBuild: typeof assertWindowsBackendOwnerBuild;
  now(): number;
}

export function prepareWindowsServiceConfiguration(
  selection: Selection,
  overrides: Partial<WindowsServicePreparationDependencies> = {},
): PreparedWindowsService {
  const { profile, input } = selection;
  const identity = windowsServiceProfiles[profile];
  const fail = (reason: string) => new Error(identity.errorPrefix + '_OWNER_' + reason);
  if (process.platform !== 'win32') throw fail('PLATFORM_INVALID');
  const dependencies = { assertBuild: assertWindowsBackendOwnerBuild, now: () => performance.now(), ...overrides };
  const osTempRoot = realpathSync.native(tmpdir());
  if (selection.profile === 'vite') validateWindowsViteServiceInput(selection.input, osTempRoot);
  const repositoryRoot = realpathSync.native(input.repositoryRoot);
  const runRoot = realpathSync.native(input.runRoot);
  if (selection.profile === 'backend') assertPathUnderRoot(selection.input.runtimeConfigPath, runRoot);
  const generation = randomBytes(32).toString('hex');
  const launchNonce = randomBytes(32).toString('hex');
  const controlRoot = join(runRoot, `${profile}-owner-${generation}`);
  mkdirSync(controlRoot, { mode: 0o700 });
  const userProfile = join(controlRoot, 'profile');
  const temp = join(controlRoot, 'temp');
  mkdirSync(userProfile, { mode: 0o700 });
  mkdirSync(temp, { mode: 0o700 });
  const systemPath = (key: string) => {
    const value = process.env[key];
    if (value === undefined || value === '') throw fail('ENVIRONMENT_INVALID');
    return profile === 'vite' ? requireWindowsVitePath(value, true) : realpathSync.native(value);
  };
  const environment = {
    EKY_E2E: '1', NODE_ENV: 'test', SystemRoot: systemPath('SystemRoot'),
    EKY_E2E_OS_TEMP_ROOT: osTempRoot, WINDIR: systemPath('WINDIR'),
    TEMP: temp, TMP: temp, USERPROFILE: userProfile, APPDATA: userProfile, LOCALAPPDATA: userProfile,
    ...(selection.profile === 'vite' ? {
      EKY_E2E_BACKEND_ORIGIN: selection.input.backendOrigin,
      EKY_E2E_ENV_ROOT: requireWindowsVitePath(selection.input.environmentRoot, true),
    } : {}),
  };
  const executable = dependencies.assertBuild(repositoryRoot);
  const dotnetExecutable = process.env.EKY_DOTNET_EXE;
  const dotnetRoot = dotnetExecutable === undefined ? process.env.DOTNET_ROOT
    : dirname(realpathSync.native(dotnetExecutable));
  const budgetAnchor = dependencies.now();
  const workBudgetMilliseconds = input.lifetime.readRemainingWorkMilliseconds();
  if (!Number.isSafeInteger(workBudgetMilliseconds) || workBudgetMilliseconds < 1 ||
    workBudgetMilliseconds > 2_147_483_647 || !Number.isFinite(budgetAnchor) || budgetAnchor < 0) {
    throw fail('DEADLINE_EXCEEDED');
  }
  const workDeadline = budgetAnchor + workBudgetMilliseconds;
  const configPath = join(controlRoot, identity.configName);
  writeFileSync(configPath, JSON.stringify({
    protocol: identity.protocol, schemaVersion: windowsServiceSchemaVersion,
    generation, launchNonce, nodeExecutable: realpathSync.native(process.execPath),
    repositoryRoot, osTempRoot, runRoot, controlRoot,
    ...(selection.profile === 'backend'
      ? { runtimeConfigPath: realpathSync.native(selection.input.runtimeConfigPath) }
      : { webPort: selection.input.webPort }),
    environment, workBudgetMilliseconds,
  }), { mode: 0o600, flag: 'wx' });
  return {
    generation, launchNonce, configPath, executable, repositoryRoot, workDeadline,
    ownerEnvironment: { ...environment, ...(dotnetRoot === undefined ? {} : { DOTNET_ROOT: dotnetRoot }),
      ...(selection.profile === 'vite' ? { EKY_E2E_RUNTIME_SESSION: selection.input.sessionSecret } : {}) },
  };
}

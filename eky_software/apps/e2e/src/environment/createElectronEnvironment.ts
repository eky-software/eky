import type { ElectronE2eProfilePaths } from './createElectronE2eProfile.js';

export function createElectronEnvironment(input: {
  configPath: string;
  platform?: NodeJS.Platform;
  profile: ElectronE2eProfilePaths;
  runRoot: string;
  sourceEnvironment?: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const platform = input.platform ?? process.platform;
  const sourceEnvironment = input.sourceEnvironment ?? process.env;
  const environment: Record<string, string> = {
    EKY_E2E: '1',
    EKY_ELECTRON_E2E_CONFIG: input.configPath,
    EKY_ELECTRON_E2E_RUN_ROOT: input.runRoot,
    HOME: input.profile.root,
    NODE_ENV: 'test',
    TEMP: input.profile.temp,
    TMP: input.profile.temp,
  };

  copyEnvironmentValue(environment, sourceEnvironment, 'PATH');

  if (platform === 'win32') {
    environment.USERPROFILE = input.profile.root;
    environment.APPDATA = input.profile.appDataRoaming;
    environment.LOCALAPPDATA = input.profile.appDataLocal;
    copyEnvironmentValue(environment, sourceEnvironment, 'SystemRoot');
    copyEnvironmentValue(environment, sourceEnvironment, 'WINDIR');
  }

  return environment;
}

function copyEnvironmentValue(
  target: Record<string, string>,
  source: Readonly<Record<string, string | undefined>>,
  targetKey: string,
): void {
  const entry = Object.entries(source).find(
    ([sourceKey, value]) =>
      sourceKey.toLowerCase() === targetKey.toLowerCase() &&
      value !== undefined,
  );
  if (entry?.[1] !== undefined) {
    target[targetKey] = entry[1];
  }
}

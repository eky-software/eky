import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import { writeE2eBackendConfig } from './writeE2eBackendConfig.js';

export interface ElectronE2eRuntime {
  backendPort: number;
  configPath: string;
  observationsPath: string;
  runtimeInstanceId: string;
  sessionSecret: string;
  supportBundlePath: string;
  userDataPath: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

export function createElectronE2eRuntime(input: {
  backendPort: number;
  dialogMode?: 'accept' | 'cancel';
  paths: E2eWorkerPaths;
  scenarioId: string;
}): ElectronE2eRuntime {
  const applicationPath = createPrivateDirectory(
    join(input.paths.workerRoot, 'desktop-application'),
  );
  const resourcesPath = createPrivateDirectory(
    join(input.paths.workerRoot, 'desktop-resources'),
  );
  const userDataPath = createPrivateDirectory(
    join(input.paths.workerRoot, 'desktop-user-data'),
  );
  const desktopRuntimeRoot = createPrivateDirectory(
    join(userDataPath, 'runtime'),
  );
  const databaseRoot = createPrivateDirectory(
    join(desktopRuntimeRoot, 'data'),
  );
  const documentsRoot = createPrivateDirectory(
    join(desktopRuntimeRoot, 'storage', 'invoices'),
  );
  const logsRoot = createPrivateDirectory(join(desktopRuntimeRoot, 'logs'));
  const applicationDistPath = createPrivateDirectory(
    join(applicationPath, 'dist'),
  );
  const applicationWebPath = join(applicationPath, 'web');
  cpSync(
    resolve(repositoryRoot, 'apps/desktop/dist/preload'),
    join(applicationDistPath, 'preload'),
    { recursive: true },
  );
  cpSync(resolve(repositoryRoot, 'apps/web/dist'), applicationWebPath, {
    recursive: true,
  });

  const backendPaths: E2eWorkerPaths = {
    ...input.paths,
    databaseFilePath: join(databaseRoot, 'eky.sqlite'),
    documentsRoot,
    logsRoot,
  };
  const backendConfig = writeE2eBackendConfig({
    backendPort: input.backendPort,
    paths: backendPaths,
    scenarioId: input.scenarioId,
  });
  const runtimeInstanceId = randomUUID();
  const observationsPath = join(
    input.paths.artifactsRoot,
    'electron-observations.jsonl',
  );
  const supportBundlePath = join(
    input.paths.supportBundlesRoot,
    'electron-support-bundle.json.gz',
  );
  const configPath = join(input.paths.workerRoot, 'electron-config.json');
  const config = {
    backend: {
      configPath: input.paths.runtimeConfigPath,
      port: input.backendPort,
      sessionSecret: backendConfig.backend.sessionSecret,
    },
    dialogMode: input.dialogMode ?? 'accept',
    formatVersion: 1,
    marker: 'EKY_E2E',
    paths: {
      applicationPath,
      observationsPath,
      resourcesPath,
      supportBundlePath,
      userDataPath,
    },
    runtimeInstanceId,
    runtimeRoot: input.paths.workerRoot,
    scenarioId: input.scenarioId,
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  return {
    backendPort: input.backendPort,
    configPath,
    observationsPath,
    runtimeInstanceId,
    sessionSecret: backendConfig.backend.sessionSecret,
    supportBundlePath,
    userDataPath,
  };
}

export function resolveElectronExecutablePath(): string {
  const electronDist = resolve(
    repositoryRoot,
    'apps/desktop/node_modules/electron/dist',
  );
  if (process.platform === 'win32') {
    return join(electronDist, 'electron.exe');
  }
  if (process.platform === 'darwin') {
    return join(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return join(electronDist, 'electron');
}

export function resolveElectronE2eApplicationPath(): string {
  return resolve(repositoryRoot, 'apps/desktop/e2e-dist');
}

function createPrivateDirectory(path: string): string {
  mkdirSync(path, { mode: 0o700, recursive: true });
  return path;
}

import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import {
  createElectronE2eProfile,
  type ElectronE2eProfilePaths,
} from './createElectronE2eProfile.js';
import { writeE2eBackendConfig } from './writeE2eBackendConfig.js';

export interface ElectronE2eRuntime {
  backendPort: number;
  configPath: string;
  invoicePdfArchiveDirectoryPath: string;
  observationsPath: string;
  profile: ElectronE2eProfilePaths;
  runtimeInstanceId: string;
  runtimeRoot: string;
  sessionSecret: string;
  supportBundlePath: string;
  userDataPath: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

export function createElectronE2eRuntime(input: {
  backendPort: number;
  dialogMode?: 'accept' | 'cancel';
  nativeOpenDialogMode?: 'accept' | 'cancel';
  nativeOpenDialogPurpose?:
    | 'invoicePdfArchive'
    | 'workspaceBackupImport'
    | 'workspaceBackupReplacement';
  paths: E2eWorkerPaths;
  scenarioId: string;
  startupMode?: 'backendStartFailure' | 'normal';
  workspaceBackupPath?: string;
}): ElectronE2eRuntime {
  const applicationPath = createPrivateDirectory(
    join(input.paths.workerRoot, 'desktop-application'),
  );
  const profile = createElectronE2eProfile(input.paths.workerRoot);
  const resourcesPath = createPrivateDirectory(
    join(input.paths.workerRoot, 'desktop-resources'),
  );
  const userDataPath = createPrivateDirectory(
    join(input.paths.workerRoot, 'desktop-user-data'),
  );
  const applicationDistPath = createPrivateDirectory(
    join(applicationPath, 'dist'),
  );
  const backupPasswordPreloadDirectoryPath = createPrivateDirectory(
    join(applicationDistPath, 'profileBackup', 'passwordWindow'),
  );
  const applicationWebPath = join(applicationPath, 'web');
  cpSync(
    resolve(repositoryRoot, 'apps/desktop/dist/preload'),
    join(applicationDistPath, 'preload'),
    { recursive: true },
  );
  cpSync(
    resolve(
      repositoryRoot,
      'apps/desktop/dist/profileBackup/passwordWindow/backupPasswordPreload.cjs',
    ),
    join(backupPasswordPreloadDirectoryPath, 'backupPasswordPreload.cjs'),
  );
  cpSync(resolve(repositoryRoot, 'apps/web/dist'), applicationWebPath, {
    recursive: true,
  });
  cpSync(
    resolve(repositoryRoot, 'apps/desktop/e2e-backend-stage'),
    join(resourcesPath, 'backend'),
    { recursive: true },
  );
  cpSync(
    resolve(repositoryRoot, 'apps/desktop/dist/runtime'),
    join(resourcesPath, 'desktop-runtime', 'runtime'),
    { recursive: true },
  );

  const backendConfig = writeE2eBackendConfig({
    backendPort: input.backendPort,
    paths: input.paths,
    scenarioId: input.scenarioId,
  });
  const runtimeInstanceId = randomUUID();
  const observationsPath = join(
    input.paths.artifactsRoot,
    'electron-observations.jsonl',
  );
  const invoicePdfArchiveDirectoryPath = createPrivateDirectory(
    join(input.paths.artifactsRoot, 'invoice-pdf-archive'),
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
    formatVersion: 2,
    marker: 'EKY_E2E',
    nativeOpenDialog: {
      mode: input.nativeOpenDialogMode ?? 'accept',
      purpose: input.nativeOpenDialogPurpose ?? 'invoicePdfArchive',
    },
    paths: {
      applicationPath,
      invoicePdfArchiveDirectoryPath,
      observationsPath,
      resourcesPath,
      supportBundlePath,
      userDataPath,
      workspaceBackupPath: input.workspaceBackupPath ?? null,
    },
    relaunchMode: 'playwrightManaged',
    runtimeInstanceId,
    runtimeRoot: input.paths.workerRoot,
    scenarioId: input.scenarioId,
    startupMode: input.startupMode ?? 'normal',
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  return {
    backendPort: input.backendPort,
    configPath,
    invoicePdfArchiveDirectoryPath,
    observationsPath,
    profile,
    runtimeInstanceId,
    runtimeRoot: input.paths.workerRoot,
    sessionSecret: backendConfig.backend.sessionSecret,
    supportBundlePath,
    userDataPath,
  };
}

export function resolveElectronE2eApplicationPath(): string {
  return resolve(repositoryRoot, 'apps/desktop/e2e-dist');
}

function createPrivateDirectory(path: string): string {
  mkdirSync(path, { mode: 0o700, recursive: true });
  return realpathSync.native(path);
}

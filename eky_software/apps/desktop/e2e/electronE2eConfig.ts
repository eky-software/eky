import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ElectronE2eConfig {
  backend: {
    configPath: string;
    port: number;
    sessionSecret: string;
  };
  dialogMode: 'accept' | 'cancel';
  formatVersion: 2;
  marker: 'EKY_E2E';
  nativeOpenDialog: {
    mode: 'accept' | 'cancel';
    purpose: 'invoicePdfArchive' | 'workspaceBackupImport';
  };
  paths: {
    applicationPath: string;
    invoicePdfArchiveDirectoryPath: string;
    observationsPath: string;
    resourcesPath: string;
    supportBundlePath: string;
    userDataPath: string;
    workspaceBackupPath: string | null;
  };
  relaunchMode: 'playwrightManaged';
  runtimeInstanceId: string;
  runtimeRoot: string;
  scenarioId: string;
  startupMode: 'backendStartFailure' | 'normal';
}

const configSizeLimitBytes = 32 * 1024;
const scenarioIdPattern = /^[A-Z][A-Z0-9-]{2,63}$/;
const runtimeInstanceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionSecretPattern = /^[A-Za-z0-9_-]{43}$/;

export function readElectronE2eConfig(
  configPath: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ElectronE2eConfig {
  if (environment.EKY_E2E !== '1') {
    throw new Error('Electron E2E marker is missing.');
  }
  if (!isAbsolute(configPath)) {
    throw new Error('Electron E2E config path must be absolute.');
  }

  const configStats = lstatSync(configPath);
  if (!configStats.isFile() || configStats.isSymbolicLink()) {
    throw new Error('Electron E2E config must be a regular file.');
  }
  if (configStats.size > configSizeLimitBytes) {
    throw new Error('Electron E2E config is too large.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('Electron E2E config is invalid.');
  }

  const config = parseElectronE2eConfig(parsed);
  assertElectronE2ePaths(config, configPath, environment);
  return config;
}

function parseElectronE2eConfig(value: unknown): ElectronE2eConfig {
  const root = requireRecord(value);
  requireExactKeys(root, [
    'backend',
    'dialogMode',
    'formatVersion',
    'marker',
    'nativeOpenDialog',
    'paths',
    'relaunchMode',
    'runtimeInstanceId',
    'runtimeRoot',
    'scenarioId',
    'startupMode',
  ]);

  if (
    root.formatVersion !== 2 ||
    root.marker !== 'EKY_E2E' ||
    (root.dialogMode !== 'accept' && root.dialogMode !== 'cancel') ||
    typeof root.scenarioId !== 'string' ||
    !scenarioIdPattern.test(root.scenarioId) ||
    typeof root.runtimeInstanceId !== 'string' ||
    !runtimeInstanceIdPattern.test(root.runtimeInstanceId) ||
    (root.startupMode !== 'backendStartFailure' &&
      root.startupMode !== 'normal')
  ) {
    throw new Error('Electron E2E config identity is invalid.');
  }

  const nativeOpenDialog = requireRecord(root.nativeOpenDialog);
  requireExactKeys(nativeOpenDialog, ['mode', 'purpose']);
  if (
    (nativeOpenDialog.mode !== 'accept' &&
      nativeOpenDialog.mode !== 'cancel') ||
    (nativeOpenDialog.purpose !== 'invoicePdfArchive' &&
      nativeOpenDialog.purpose !== 'workspaceBackupImport') ||
    root.relaunchMode !== 'playwrightManaged'
  ) {
    throw new Error('Electron E2E native operation config is invalid.');
  }

  const backend = requireRecord(root.backend);
  requireExactKeys(backend, ['configPath', 'port', 'sessionSecret']);
  if (
    !isSafeAbsolutePath(backend.configPath) ||
    typeof backend.port !== 'number' ||
    !Number.isSafeInteger(backend.port) ||
    backend.port < 1 ||
    backend.port > 65_535 ||
    typeof backend.sessionSecret !== 'string' ||
    !sessionSecretPattern.test(backend.sessionSecret)
  ) {
    throw new Error('Electron E2E backend config is invalid.');
  }

  const paths = requireRecord(root.paths);
  requireExactKeys(paths, [
    'applicationPath',
    'invoicePdfArchiveDirectoryPath',
    'observationsPath',
    'resourcesPath',
    'supportBundlePath',
    'userDataPath',
    'workspaceBackupPath',
  ]);
  if (
    !isSafeAbsolutePath(paths.applicationPath) ||
    !isSafeAbsolutePath(paths.invoicePdfArchiveDirectoryPath) ||
    !isSafeAbsolutePath(paths.observationsPath) ||
    !isSafeAbsolutePath(paths.resourcesPath) ||
    !isSafeAbsolutePath(paths.supportBundlePath) ||
    !isSafeAbsolutePath(paths.userDataPath) ||
    (paths.workspaceBackupPath !== null &&
      !isSafeAbsolutePath(paths.workspaceBackupPath)) ||
    !isSafeAbsolutePath(root.runtimeRoot)
  ) {
    throw new Error('Electron E2E runtime path is invalid.');
  }
  if (
    (nativeOpenDialog.purpose === 'invoicePdfArchive' &&
      paths.workspaceBackupPath !== null) ||
    (nativeOpenDialog.purpose === 'workspaceBackupImport' &&
      nativeOpenDialog.mode === 'accept' &&
      paths.workspaceBackupPath === null)
  ) {
    throw new Error('Electron E2E native dialog path is invalid.');
  }

  return {
    backend: {
      configPath: backend.configPath,
      port: backend.port,
      sessionSecret: backend.sessionSecret,
    },
    dialogMode: root.dialogMode,
    formatVersion: 2,
    marker: 'EKY_E2E',
    nativeOpenDialog: {
      mode: nativeOpenDialog.mode,
      purpose: nativeOpenDialog.purpose,
    },
    paths: {
      applicationPath: paths.applicationPath,
      invoicePdfArchiveDirectoryPath:
        paths.invoicePdfArchiveDirectoryPath,
      observationsPath: paths.observationsPath,
      resourcesPath: paths.resourcesPath,
      supportBundlePath: paths.supportBundlePath,
      userDataPath: paths.userDataPath,
      workspaceBackupPath: paths.workspaceBackupPath,
    },
    relaunchMode: 'playwrightManaged',
    runtimeInstanceId: root.runtimeInstanceId,
    runtimeRoot: root.runtimeRoot,
    scenarioId: root.scenarioId,
    startupMode: root.startupMode,
  };
}

function assertElectronE2ePaths(
  config: ElectronE2eConfig,
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const runtimeRoot = requireRealDirectory(config.runtimeRoot);
  const expectedRuntimeRoot = environment.EKY_ELECTRON_E2E_RUN_ROOT;
  if (
    expectedRuntimeRoot === undefined ||
    !isAbsolute(expectedRuntimeRoot) ||
    requireRealDirectory(expectedRuntimeRoot) !== runtimeRoot
  ) {
    throw new Error('Electron E2E runtime root is invalid.');
  }

  for (const directoryPath of [
    config.paths.applicationPath,
    config.paths.invoicePdfArchiveDirectoryPath,
    config.paths.resourcesPath,
    config.paths.userDataPath,
    dirname(config.paths.observationsPath),
    dirname(config.paths.supportBundlePath),
  ]) {
    const realPath = requireRealDirectory(directoryPath);
    assertDescendant(realPath, runtimeRoot, false);
    assertNoSymbolicLinkSegments(runtimeRoot, realPath);
  }

  for (const filePath of [configPath, config.backend.configPath]) {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Electron E2E input must be a regular file.');
    }
    const realPath = realpathSync(filePath);
    assertDescendant(realPath, runtimeRoot, true);
    assertNoSymbolicLinkSegments(runtimeRoot, dirname(realPath));
  }

  if (config.paths.workspaceBackupPath !== null) {
    const backupPath = config.paths.workspaceBackupPath;
    const stats = lstatSync(backupPath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      !backupPath.toLowerCase().endsWith('.ekybackup')
    ) {
      throw new Error('Electron E2E workspace backup must be a regular file.');
    }
    const realPath = realpathSync(backupPath);
    assertDescendant(realPath, runtimeRoot, false);
    assertNoSymbolicLinkSegments(runtimeRoot, dirname(realPath));
  }
}

function requireRealDirectory(path: string): string {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Electron E2E runtime path must be a regular directory.');
  }
  return realpathSync(path);
}

function assertDescendant(
  candidate: string,
  root: string,
  allowSame: boolean,
): void {
  const relativePath = relative(root, candidate);
  if (
    (allowSame && relativePath === '') ||
    (relativePath !== '' &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))
  ) {
    return;
  }
  throw new Error('Electron E2E runtime path escapes its allowed root.');
}

function assertNoSymbolicLinkSegments(root: string, candidate: string): void {
  let current = root;
  for (const segment of relative(root, candidate).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('Electron E2E runtime path must not contain symlinks.');
    }
  }
}

function isSafeAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.includes('\0') &&
    isAbsolute(value)
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Electron E2E config value must be an object.');
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new Error('Electron E2E config fields are invalid.');
  }
}

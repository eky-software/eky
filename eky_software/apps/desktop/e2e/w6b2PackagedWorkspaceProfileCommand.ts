import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const W6B2_PACKAGED_PROFILE_OPERATION_ENV =
  'EKY_W6B2_PROFILE_OPERATION';
export const W6B2_PACKAGED_PROFILE_RESULT_FILE =
  'w6b2-profile-result.json';

export const w6b2PackagedProfileOperations = Object.freeze([
  'prepare',
  'targetFirstStart',
  'verifyBRestart',
  'rejectC',
  'verifyPreUpdateFailure',
  'verifyActiveRollback',
  'verifyAcceptanceRecovery',
  'verifyPassiveRecovery',
  'verifyBinaryFailedSafe',
] as const);

export type W6b2PackagedProfileOperation =
  (typeof w6b2PackagedProfileOperations)[number];

export type W6b2PackagedFaultProfileOperation = Exclude<
  W6b2PackagedProfileOperation,
  'prepare' | 'rejectC' | 'targetFirstStart' | 'verifyBRestart'
>;

export const w6b2PackagedProfileFailureStages = Object.freeze([
  'electronReady',
  'installedApplication',
  'proofConfiguration',
  'buildIdentity',
  'profileInput',
  'runtimePaths',
  'fixtureA',
  'fixtureB',
  'fixtureC',
  'migrationHistory',
  'registry',
  'acceptedBuild',
  'evidence',
  'profileState',
  'profileOperation',
] as const);

export type W6b2PackagedProfileFailureStage =
  (typeof w6b2PackagedProfileFailureStages)[number];

export type W6b2PackagedProfileCommandResult = Readonly<
  | {
      readonly formatVersion: 1;
      readonly operation: W6b2PackagedProfileOperation;
      readonly status: 'completed';
    }
  | {
      readonly errorCode:
        | 'W6B2_PROFILE_PREPARATION_FAILED'
        | 'W6B2_PROFILE_VERIFICATION_FAILED';
      readonly failureStage: W6b2PackagedProfileFailureStage;
      readonly formatVersion: 1;
      readonly operation: W6b2PackagedProfileOperation;
      readonly status: 'failed';
    }
>;

export interface W6b2InstalledApplicationPaths {
  readonly applicationPath: string;
  readonly resourcesPath: string;
}

export interface W6b2RawFileSystem {
  readonly lstat: typeof lstat;
  readonly realpath: typeof realpath;
}

const maximumResultBytes = 4 * 1024;
const completedResultKeys = ['formatVersion', 'operation', 'status'] as const;
const failedResultKeys = [
  'errorCode',
  'failureStage',
  'formatVersion',
  'operation',
  'status',
] as const;

export function parseW6b2PackagedProfileOperation(
  value: unknown,
): W6b2PackagedProfileOperation {
  if (
    typeof value !== 'string' ||
    !(w6b2PackagedProfileOperations as readonly string[]).includes(value)
  ) {
    throw new Error('W6B2_PROFILE_COMMAND_INVALID');
  }
  return value as W6b2PackagedProfileOperation;
}

export function expectedW6b2PackagedProfilePackage(
  operation: W6b2PackagedProfileOperation,
): Readonly<{
  appVersion: '0.2.7' | '0.2.8';
  faultScenario?:
    | 'acceptanceInterruption'
    | 'activeWorkspaceFirstStartFailure'
    | 'binaryRollbackFailure'
    | 'passiveWorkspaceMigrationFailure'
    | 'preUpdateRecoveryPointFailure';
  phase:
    | 'failedSafeVerification'
    | 'passiveWorkspaceRecovery'
    | 'sourceHandoff'
    | 'rollbackFirstStart'
    | 'targetAcceptanceRestart'
    | 'targetFirstStart'
    | 'verifyBRestart'
    | 'rejectC';
  role: 'source' | 'target';
}> {
  if (operation === 'prepare') {
    return Object.freeze({
      appVersion: '0.2.7',
      phase: 'sourceHandoff',
      role: 'source',
    });
  }
  const faultPackages = {
    verifyAcceptanceRecovery: {
      appVersion: '0.2.8',
      faultScenario: 'acceptanceInterruption',
      phase: 'targetAcceptanceRestart',
      role: 'target',
    },
    verifyActiveRollback: {
      appVersion: '0.2.7',
      faultScenario: 'activeWorkspaceFirstStartFailure',
      phase: 'rollbackFirstStart',
      role: 'source',
    },
    verifyBinaryFailedSafe: {
      appVersion: '0.2.8',
      faultScenario: 'binaryRollbackFailure',
      phase: 'failedSafeVerification',
      role: 'target',
    },
    verifyPassiveRecovery: {
      appVersion: '0.2.8',
      faultScenario: 'passiveWorkspaceMigrationFailure',
      phase: 'passiveWorkspaceRecovery',
      role: 'target',
    },
    verifyPreUpdateFailure: {
      appVersion: '0.2.7',
      faultScenario: 'preUpdateRecoveryPointFailure',
      phase: 'sourceHandoff',
      role: 'source',
    },
  } as const;
  if (isW6b2PackagedFaultProfileOperation(operation)) {
    return faultPackages[operation];
  }
  return Object.freeze({
    appVersion: '0.2.8',
    phase: operation,
    role: 'target',
  });
}

function isW6b2PackagedFaultProfileOperation(
  operation: W6b2PackagedProfileOperation,
): operation is W6b2PackagedFaultProfileOperation {
  return (
    operation === 'verifyAcceptanceRecovery' ||
    operation === 'verifyActiveRollback' ||
    operation === 'verifyBinaryFailedSafe' ||
    operation === 'verifyPassiveRecovery' ||
    operation === 'verifyPreUpdateFailure'
  );
}

export async function resolveW6b2InstalledApplicationPaths(
  localAppData: unknown,
  fileSystem: W6b2RawFileSystem = { lstat, realpath },
): Promise<Readonly<W6b2InstalledApplicationPaths>> {
  try {
    if (
      typeof localAppData !== 'string' ||
      !isAbsolute(localAppData) ||
      resolve(localAppData) !== localAppData
    ) {
      throw new Error('invalid');
    }
    const canonicalLocalAppData = await fileSystem.realpath(localAppData);
    if (!samePath(canonicalLocalAppData, localAppData)) {
      throw new Error('invalid');
    }
    const installRoot = join(canonicalLocalAppData, 'Programs', 'Eky');
    const resourcesPath = join(installRoot, 'resources');
    const applicationPath = join(resourcesPath, 'app.asar');
    await assertCanonicalDirectory(
      canonicalLocalAppData,
      installRoot,
      fileSystem,
    );
    await assertCanonicalDirectory(installRoot, resourcesPath, fileSystem);
    await assertCanonicalFile(resourcesPath, applicationPath, fileSystem);
    return Object.freeze({ applicationPath, resourcesPath });
  } catch {
    throw new Error('W6B2_PROFILE_COMMAND_INVALID');
  }
}

async function assertCanonicalFile(
  parent: string,
  file: string,
  fileSystem: W6b2RawFileSystem,
): Promise<void> {
  const metadata = await fileSystem.lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error('invalid');
  }
  const canonicalFile = await fileSystem.realpath(file);
  const child = relative(parent, canonicalFile);
  if (
    child.length === 0 ||
    child.startsWith('..') ||
    isAbsolute(child) ||
    !samePath(canonicalFile, file)
  ) {
    throw new Error('invalid');
  }
}

export function createW6b2PackagedProfileCommandResult(
  input:
    | {
        readonly operation: W6b2PackagedProfileOperation;
        readonly succeeded: true;
      }
    | {
        readonly failureStage: W6b2PackagedProfileFailureStage;
        readonly operation: W6b2PackagedProfileOperation;
        readonly succeeded: false;
      },
): W6b2PackagedProfileCommandResult {
  if (input.succeeded) {
    return Object.freeze({
      formatVersion: 1,
      operation: input.operation,
      status: 'completed',
    });
  }
  return Object.freeze({
    errorCode:
      input.operation === 'prepare'
        ? 'W6B2_PROFILE_PREPARATION_FAILED'
        : 'W6B2_PROFILE_VERIFICATION_FAILED',
    failureStage: input.failureStage,
    formatVersion: 1,
    operation: input.operation,
    status: 'failed',
  });
}

export function parseW6b2PackagedProfileCommandResult(
  value: unknown,
): W6b2PackagedProfileCommandResult {
  if (!isRecord(value) || value.formatVersion !== 1) {
    throw new Error('W6B2_PROFILE_RESULT_INVALID');
  }
  const operation = parseW6b2PackagedProfileOperation(value.operation);
  if (
    value.status === 'completed' &&
    hasExactKeys(value, completedResultKeys)
  ) {
    return createW6b2PackagedProfileCommandResult({
      operation,
      succeeded: true,
    });
  }
  const expectedErrorCode =
    operation === 'prepare'
      ? 'W6B2_PROFILE_PREPARATION_FAILED'
      : 'W6B2_PROFILE_VERIFICATION_FAILED';
  const failureStage = parseW6b2PackagedProfileFailureStage(
    value.failureStage,
  );
  if (
    value.status !== 'failed' ||
    !hasExactKeys(value, failedResultKeys) ||
    value.errorCode !== expectedErrorCode
  ) {
    throw new Error('W6B2_PROFILE_RESULT_INVALID');
  }
  return Object.freeze({
    errorCode: expectedErrorCode,
    failureStage,
    formatVersion: 1,
    operation,
    status: 'failed',
  });
}

function parseW6b2PackagedProfileFailureStage(
  value: unknown,
): W6b2PackagedProfileFailureStage {
  if (
    typeof value !== 'string' ||
    !(w6b2PackagedProfileFailureStages as readonly string[]).includes(value)
  ) {
    throw new Error('W6B2_PROFILE_RESULT_INVALID');
  }
  return value as W6b2PackagedProfileFailureStage;
}

export async function writeW6b2PackagedProfileCommandResult(
  proofRoot: string,
  value: unknown,
): Promise<void> {
  const result = parseW6b2PackagedProfileCommandResult(value);
  const resultDirectory = join(proofRoot, 'result');
  await mkdir(resultDirectory, { mode: 0o700, recursive: true });
  await assertCanonicalDirectory(proofRoot, resultDirectory);
  const resultPath = join(resultDirectory, W6B2_PACKAGED_PROFILE_RESULT_FILE);
  const temporaryPath = `${resultPath}.next`;
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, `${JSON.stringify(result)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await rm(resultPath, { force: true });
  await rename(temporaryPath, resultPath);
}

export async function readW6b2PackagedProfileCommandResult(
  proofRoot: string,
): Promise<W6b2PackagedProfileCommandResult> {
  try {
    const resultPath = join(
      proofRoot,
      'result',
      W6B2_PACKAGED_PROFILE_RESULT_FILE,
    );
    const metadata = await lstat(resultPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maximumResultBytes ||
      !samePath(await realpath(resultPath), resultPath)
    ) {
      throw new Error('invalid');
    }
    return parseW6b2PackagedProfileCommandResult(
      JSON.parse(await readFile(resultPath, 'utf8')) as unknown,
    );
  } catch {
    throw new Error('W6B2_PROFILE_RESULT_INVALID');
  }
}

async function assertCanonicalDirectory(
  parent: string,
  directory: string,
  fileSystem: W6b2RawFileSystem = { lstat, realpath },
): Promise<void> {
  const metadata = await fileSystem.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('invalid');
  }
  const canonicalDirectory = await fileSystem.realpath(directory);
  const child = relative(parent, canonicalDirectory);
  if (
    child.length === 0 ||
    child.startsWith('..') ||
    isAbsolute(child) ||
    !samePath(canonicalDirectory, directory)
  ) {
    throw new Error('invalid');
  }
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

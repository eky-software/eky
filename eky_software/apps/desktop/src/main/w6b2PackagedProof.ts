import { realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export const W6B2_PACKAGED_PROOF_SWITCH = 'w6b2-packaged-proof';
export const W6B2_PACKAGED_PROOF_TOKEN_ENV = 'EKY_W6B2_PROOF_TOKEN';
export const W6B2_PACKAGED_PROOF_MARKER_FILE =
  'w6b2-private-proof-v1.json';
export const W6B2_PACKAGED_PROOF_DIRECTORY_NAME = 'eky-w6b2';

export const w6b2PackagedProofPhases = Object.freeze([
  'sourceHandoff',
  'targetFirstStart',
  'switchToB',
  'verifyBRestart',
  'switchToA',
  'rejectC',
] as const);

export type W6b2PackagedProofPhase =
  (typeof w6b2PackagedProofPhases)[number];
export type W6b2PackagedProofRole = 'source' | 'target';

export interface W6b2PackagedProofBootstrapConfiguration {
  readonly enabled: boolean;
  readonly root: string | undefined;
  readonly userDataPath: string | undefined;
}

export interface W6b2PackagedProofConfiguration {
  readonly enabled: true;
  readonly phase: W6b2PackagedProofPhase;
  readonly resultFilePath: string;
  readonly role: W6b2PackagedProofRole;
  readonly root: string;
  readonly sourceManifestPath: string;
  readonly targetManifestPath: string;
  readonly userDataPath: string;
}

export type W6b2PackagedProofResult = Readonly<
  | {
      readonly formatVersion: 1;
      readonly phase: W6b2PackagedProofPhase;
      readonly status: 'completed' | 'relaunching';
    }
  | {
      readonly errorCode: W6b2PackagedProofErrorCode;
      readonly formatVersion: 1;
      readonly phase: W6b2PackagedProofPhase;
      readonly status: 'failed';
    }
>;

export type W6b2PackagedProofErrorCode =
  | 'W6B2_PROOF_CANDIDATE_STAGE_FAILED'
  | 'W6B2_PROOF_CONFIGURATION_INVALID'
  | 'W6B2_PROOF_HANDOFF_FAILED'
  | 'W6B2_PROOF_INSTALLER_HANDOFF_FAILED'
  | 'W6B2_PROOF_PACKAGE_MARKER_INVALID'
  | 'W6B2_PROOF_PREPARATION_CONCURRENCY_FAILED'
  | 'W6B2_PROOF_PREPARATION_FAILED'
  | 'W6B2_PROOF_PREPARATION_JOURNAL_FAILED'
  | 'W6B2_PROOF_PREPARATION_PACKAGE_FAILED'
  | 'W6B2_PROOF_PREPARATION_PROFILE_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_PROTECTION_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_ARTIFACTS_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_OPERATION_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_REQUEST_INVALID'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_UNAVAILABLE'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_STAGING_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_VALIDATION_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SOURCE_FAILED'
  | 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED'
  | 'W6B2_PROOF_QUIT_REQUEST_MISSING'
  | 'W6B2_PROOF_REJECTION_FAILED'
  | 'W6B2_PROOF_SHUTDOWN_FAILED'
  | 'W6B2_PROOF_SOURCE_STAGE_FAILED'
  | 'W6B2_PROOF_SWITCH_FAILED'
  | 'W6B2_PROOF_UNEXPECTED'
  | 'W6B2_PROOF_WORKSPACE_STATE_INVALID';

interface W6b2PackagedProofMarker {
  readonly appVersion: '0.2.7' | '0.2.8';
  readonly formatVersion: 1;
  readonly role: W6b2PackagedProofRole;
}

const proofTokenPattern = /^[0-9a-f]{64}$/u;
const maximumControlBytes = 4 * 1024;
const markerKeys = ['appVersion', 'formatVersion', 'role'] as const;
const controlKeys = ['formatVersion', 'phase'] as const;
const resultKeys = ['formatVersion', 'phase', 'status'] as const;
const failureResultKeys = [
  'errorCode',
  'formatVersion',
  'phase',
  'status',
] as const;
const resultErrorCodes = new Set<W6b2PackagedProofErrorCode>([
  'W6B2_PROOF_CANDIDATE_STAGE_FAILED',
  'W6B2_PROOF_CONFIGURATION_INVALID',
  'W6B2_PROOF_HANDOFF_FAILED',
  'W6B2_PROOF_INSTALLER_HANDOFF_FAILED',
  'W6B2_PROOF_PACKAGE_MARKER_INVALID',
  'W6B2_PROOF_PREPARATION_CONCURRENCY_FAILED',
  'W6B2_PROOF_PREPARATION_FAILED',
  'W6B2_PROOF_PREPARATION_JOURNAL_FAILED',
  'W6B2_PROOF_PREPARATION_PACKAGE_FAILED',
  'W6B2_PROOF_PREPARATION_PROFILE_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_PROTECTION_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_ARTIFACTS_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_OPERATION_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_REQUEST_INVALID',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_UNAVAILABLE',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_STAGING_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_VALIDATION_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SOURCE_FAILED',
  'W6B2_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED',
  'W6B2_PROOF_QUIT_REQUEST_MISSING',
  'W6B2_PROOF_REJECTION_FAILED',
  'W6B2_PROOF_SHUTDOWN_FAILED',
  'W6B2_PROOF_SOURCE_STAGE_FAILED',
  'W6B2_PROOF_SWITCH_FAILED',
  'W6B2_PROOF_UNEXPECTED',
  'W6B2_PROOF_WORKSPACE_STATE_INVALID',
]);

export function createW6b2PackagedProofBootstrapConfiguration(input: {
  readonly hasProofSwitch: boolean;
  readonly tempPath: string;
  readonly tokenValue: string | undefined;
}): Readonly<W6b2PackagedProofBootstrapConfiguration> {
  if (!input.hasProofSwitch) {
    return Object.freeze({
      enabled: false,
      root: undefined,
      userDataPath: undefined,
    });
  }
  if (
    typeof input.tokenValue !== 'string' ||
    !proofTokenPattern.test(input.tokenValue)
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }

  const canonicalTempPath = realpathSync.native(resolve(input.tempPath));
  const expectedRoot = join(
    canonicalTempPath,
    W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
    input.tokenValue,
  );
  const canonicalRoot = realpathSync.native(expectedRoot);
  assertExactDerivedRoot(canonicalTempPath, canonicalRoot, input.tokenValue);

  return Object.freeze({
    enabled: true,
    root: canonicalRoot,
    userDataPath: join(canonicalRoot, 'user-data'),
  });
}

export async function readW6b2PackagedProofConfiguration(input: {
  readonly appVersion: string;
  readonly bootstrap: Readonly<W6b2PackagedProofBootstrapConfiguration>;
  readonly resourcesPath: string;
}): Promise<Readonly<W6b2PackagedProofConfiguration> | undefined> {
  if (!input.bootstrap.enabled) return undefined;
  const root = requireProofRoot(input.bootstrap.root);
  const userDataPath = requireExactDerivedPath(
    root,
    input.bootstrap.userDataPath,
    'user-data',
  );
  const markerPath = join(
    resolve(input.resourcesPath),
    'backend',
    W6B2_PACKAGED_PROOF_MARKER_FILE,
  );
  const marker = parseMarker(await readBoundedRegularJson(markerPath));
  if (marker.appVersion !== input.appVersion) {
    throw new Error('W6B2_PROOF_PACKAGE_MARKER_INVALID');
  }
  const phase = parseControl(
    await readBoundedRegularJson(join(root, 'control', 'phase.json')),
  );
  if (
    (marker.role === 'source' && phase !== 'sourceHandoff') ||
    (marker.role === 'target' && phase === 'sourceHandoff')
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }

  return Object.freeze({
    enabled: true,
    phase,
    resultFilePath: join(root, 'result', 'w6b2-proof-result.json'),
    role: marker.role,
    root,
    sourceManifestPath: join(root, 'packages', 'source', 'manifest.json'),
    targetManifestPath: join(root, 'packages', 'target', 'manifest.json'),
    userDataPath,
  });
}

export async function writeW6b2PackagedProofResult(
  configuration: Readonly<W6b2PackagedProofConfiguration>,
  result: unknown,
): Promise<void> {
  const parsed = parseW6b2PackagedProofResult(result);
  const resultDirectory = dirname(configuration.resultFilePath);
  await mkdir(resultDirectory, { mode: 0o700, recursive: true });
  const temporaryPath = `${configuration.resultFilePath}.next`;
  await writeFile(temporaryPath, `${JSON.stringify(parsed)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rm(configuration.resultFilePath, { force: true });
  await rename(temporaryPath, configuration.resultFilePath);
}

export function parseW6b2PackagedProofResult(
  value: unknown,
): W6b2PackagedProofResult {
  if (!isRecord(value) || value.formatVersion !== 1) {
    throw new Error('W6B2_PROOF_RESULT_INVALID');
  }
  const phase = parsePhase(value.phase);
  if (value.status === 'completed' || value.status === 'relaunching') {
    if (!hasExactKeys(value, resultKeys)) {
      throw new Error('W6B2_PROOF_RESULT_INVALID');
    }
    return Object.freeze({ formatVersion: 1, phase, status: value.status });
  }
  if (
    value.status !== 'failed' ||
    !hasExactKeys(value, failureResultKeys) ||
    !resultErrorCodes.has(value.errorCode as W6b2PackagedProofErrorCode)
  ) {
    throw new Error('W6B2_PROOF_RESULT_INVALID');
  }
  return Object.freeze({
    errorCode: value.errorCode as W6b2PackagedProofErrorCode,
    formatVersion: 1,
    phase,
    status: 'failed',
  });
}

function parseMarker(value: unknown): Readonly<W6b2PackagedProofMarker> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, markerKeys) ||
    value.formatVersion !== 1 ||
    (value.role !== 'source' && value.role !== 'target') ||
    (value.appVersion !== '0.2.7' && value.appVersion !== '0.2.8') ||
    (value.role === 'source' && value.appVersion !== '0.2.7') ||
    (value.role === 'target' && value.appVersion !== '0.2.8')
  ) {
    throw new Error('W6B2_PROOF_PACKAGE_MARKER_INVALID');
  }
  return Object.freeze({
    appVersion: value.appVersion,
    formatVersion: 1,
    role: value.role,
  });
}

function parseControl(value: unknown): W6b2PackagedProofPhase {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, controlKeys) ||
    value.formatVersion !== 1
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  return parsePhase(value.phase);
}

function parsePhase(value: unknown): W6b2PackagedProofPhase {
  if (
    typeof value !== 'string' ||
    !(w6b2PackagedProofPhases as readonly string[]).includes(value)
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  return value as W6b2PackagedProofPhase;
}

async function readBoundedRegularJson(path: string): Promise<unknown> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > maximumControlBytes
    ) {
      throw new Error('invalid');
    }
    const canonicalPath = await realpath(path);
    if (!samePath(canonicalPath, resolve(path))) {
      throw new Error('invalid');
    }
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
}

function assertExactDerivedRoot(
  canonicalTempPath: string,
  canonicalRoot: string,
  token: string,
): void {
  const expectedRelative = join(W6B2_PACKAGED_PROOF_DIRECTORY_NAME, token);
  const actualRelative = relative(canonicalTempPath, canonicalRoot);
  if (
    actualRelative.startsWith('..') ||
    resolve(canonicalTempPath, actualRelative) !== resolve(canonicalRoot) ||
    !samePath(actualRelative, expectedRelative)
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
}

function requireProofRoot(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  return resolve(value);
}

function requireExactDerivedPath(
  root: string,
  value: string | undefined,
  child: string,
): string {
  const resolvedValue = requireProofRoot(value);
  if (!samePath(resolvedValue, join(root, child))) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  return resolvedValue;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => keys[index] === key)
  );
}

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
export const W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH = 32;
export const W6B2_PACKAGED_ROLLBACK_PROGRESS_FILE =
  'w6b2-rollback-installer-progress.jsonl';

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

export const w6b2PackagedFaultScenarios = Object.freeze([
  'preUpdateRecoveryPointFailure',
  'activeWorkspaceFirstStartFailure',
  'acceptanceInterruption',
  'passiveWorkspaceMigrationFailure',
  'binaryRollbackFailure',
] as const);

export type W6b2PackagedFaultScenario =
  (typeof w6b2PackagedFaultScenarios)[number];

export const w6b2PackagedFaultPhases = Object.freeze([
  'sourceHandoff',
  'targetFirstStartFailure',
  'businessRollback',
  'rollbackFirstStart',
  'targetAcceptanceInterruption',
  'targetAcceptanceRecovery',
  'targetAcceptanceRestart',
  'targetFirstStart',
  'switchToB',
  'passiveWorkspaceMigrationFailure',
  'passiveWorkspaceRecovery',
  'binaryRollbackFailure',
  'failedSafeVerification',
] as const);

export type W6b2PackagedFaultPhase =
  (typeof w6b2PackagedFaultPhases)[number];

export interface W6b2PackagedProofBootstrapConfiguration {
  readonly enabled: boolean;
  readonly root: string | undefined;
  readonly userDataPath: string | undefined;
}

export interface W6b2PackagedSuccessProofConfiguration {
  readonly controlFormatVersion: 1;
  readonly enabled: true;
  readonly phase: W6b2PackagedProofPhase;
  readonly resultFilePath: string;
  readonly role: W6b2PackagedProofRole;
  readonly root: string;
  readonly sourceManifestPath: string;
  readonly targetManifestPath: string;
  readonly userDataPath: string;
}

export interface W6b2PackagedFaultProofConfiguration {
  readonly controlFormatVersion: 2;
  readonly enabled: true;
  readonly faultScenario: W6b2PackagedFaultScenario;
  readonly phase: W6b2PackagedFaultPhase;
  readonly resultFilePath: string;
  readonly role: W6b2PackagedProofRole;
  readonly root: string;
  readonly sourceManifestPath: string;
  readonly targetManifestPath: string;
  readonly userDataPath: string;
}

export type W6b2PackagedProofConfiguration =
  | W6b2PackagedSuccessProofConfiguration
  | W6b2PackagedFaultProofConfiguration;

export type W6b2PackagedSuccessProofResult = Readonly<
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

export type W6b2PackagedFaultProofResult = Readonly<
  | {
      readonly faultScenario: W6b2PackagedFaultScenario;
      readonly formatVersion: 2;
      readonly phase: W6b2PackagedFaultPhase;
      readonly status: 'completed' | 'interrupted' | 'relaunching';
    }
  | {
      readonly errorCode: W6b2PackagedFaultProofErrorCode;
      readonly faultScenario: W6b2PackagedFaultScenario;
      readonly formatVersion: 2;
      readonly phase: W6b2PackagedFaultPhase;
      readonly status: 'failed';
    }
>;

export type W6b2PackagedProofResult =
  | W6b2PackagedSuccessProofResult
  | W6b2PackagedFaultProofResult;

export type W6b2PackagedFaultProofErrorCode =
  | 'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED'
  | 'W6B2_FAULT_PROOF_HANDOFF_FAILED'
  | 'W6B2_FAULT_PROOF_JOURNAL_STATE_INVALID'
  | 'W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED'
  | 'W6B2_FAULT_PROOF_SHUTDOWN_FAILED'
  | 'W6B2_FAULT_PROOF_UNEXPECTED'
  | 'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID';

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
const faultControlKeys = [
  'faultScenario',
  'formatVersion',
  'phase',
] as const;
const resultKeys = ['formatVersion', 'phase', 'status'] as const;
const failureResultKeys = [
  'errorCode',
  'formatVersion',
  'phase',
  'status',
] as const;
const faultResultKeys = [
  'faultScenario',
  'formatVersion',
  'phase',
  'status',
] as const;
const faultFailureResultKeys = [
  'errorCode',
  'faultScenario',
  'formatVersion',
  'phase',
  'status',
] as const;
const faultResultErrorCodes = new Set<W6b2PackagedFaultProofErrorCode>([
  'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
  'W6B2_FAULT_PROOF_HANDOFF_FAILED',
  'W6B2_FAULT_PROOF_JOURNAL_STATE_INVALID',
  'W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED',
  'W6B2_FAULT_PROOF_SHUTDOWN_FAILED',
  'W6B2_FAULT_PROOF_UNEXPECTED',
  'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
]);
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
    input.tokenValue.slice(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH),
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
  const control = parseControl(
    await readBoundedRegularJson(join(root, 'control', 'phase.json')),
  );
  if (!controlAllowsPackage(control, marker.role)) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }

  const paths = {
    enabled: true as const,
    resultFilePath: join(root, 'result', 'w6b2-proof-result.json'),
    role: marker.role,
    root,
    sourceManifestPath: join(root, 'packages', 'source', 'manifest.json'),
    targetManifestPath: join(root, 'packages', 'target', 'manifest.json'),
    userDataPath,
  };
  if (control.formatVersion === 1) {
    return Object.freeze({
      ...paths,
      controlFormatVersion: 1,
      phase: control.phase,
    });
  }
  return Object.freeze({
    ...paths,
    controlFormatVersion: 2,
    faultScenario: control.faultScenario,
    phase: control.phase,
  });
}

export function resolveW6b2PackagedRollbackProgressPath(
  configuration: Readonly<W6b2PackagedProofConfiguration> | undefined,
): string | undefined {
  if (
    configuration?.controlFormatVersion !== 2 ||
    configuration.faultScenario !== 'activeWorkspaceFirstStartFailure' ||
    configuration.phase !== 'businessRollback'
  ) {
    return undefined;
  }
  return join(
    configuration.root,
    'result',
    W6B2_PACKAGED_ROLLBACK_PROGRESS_FILE,
  );
}

export async function writeW6b2PackagedProofResult(
  configuration: Readonly<W6b2PackagedProofConfiguration>,
  result: unknown,
): Promise<void> {
  const parsed = parseW6b2PackagedProofResult(result);
  assertResultMatchesConfiguration(configuration, parsed);
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

export function createW6b2PackagedProofFallbackResult(
  configuration: Readonly<W6b2PackagedProofConfiguration>,
  input: Readonly<{
    quitRequested: boolean;
    relaunchRequested: boolean;
  }>,
): W6b2PackagedProofResult {
  if (configuration.controlFormatVersion === 1) {
    return Object.freeze({
      formatVersion: 1,
      phase: configuration.phase,
      status: 'relaunching',
    });
  }
  if (!input.quitRequested && !input.relaunchRequested) {
    return createW6b2PackagedProofUnexpectedFailure(configuration);
  }
  return Object.freeze({
    faultScenario: configuration.faultScenario,
    formatVersion: 2,
    phase: configuration.phase,
    status: 'relaunching',
  });
}

export function createW6b2PackagedProofUnexpectedFailure(
  configuration: Readonly<W6b2PackagedProofConfiguration>,
): W6b2PackagedProofResult {
  return configuration.controlFormatVersion === 1
    ? Object.freeze({
        errorCode: 'W6B2_PROOF_UNEXPECTED' as const,
        formatVersion: 1 as const,
        phase: configuration.phase,
        status: 'failed' as const,
      })
    : Object.freeze({
        errorCode: 'W6B2_FAULT_PROOF_UNEXPECTED' as const,
        faultScenario: configuration.faultScenario,
        formatVersion: 2 as const,
        phase: configuration.phase,
        status: 'failed' as const,
      });
}

export function parseW6b2PackagedProofResult(
  value: unknown,
): W6b2PackagedProofResult {
  if (!isRecord(value)) {
    throw new Error('W6B2_PROOF_RESULT_INVALID');
  }
  if (value.formatVersion === 2) {
    return parseFaultResult(value);
  }
  if (value.formatVersion !== 1) {
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

type W6b2PackagedProofControl = Readonly<
  | {
      readonly formatVersion: 1;
      readonly phase: W6b2PackagedProofPhase;
    }
  | {
      readonly faultScenario: W6b2PackagedFaultScenario;
      readonly formatVersion: 2;
      readonly phase: W6b2PackagedFaultPhase;
    }
>;

function parseControl(value: unknown): W6b2PackagedProofControl {
  if (!isRecord(value)) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  if (value.formatVersion === 1 && hasExactKeys(value, controlKeys)) {
    return Object.freeze({
      formatVersion: 1,
      phase: parsePhase(value.phase),
    });
  }
  if (value.formatVersion === 2 && hasExactKeys(value, faultControlKeys)) {
    const faultScenario = parseFaultScenario(value.faultScenario);
    const phase = parseFaultPhase(value.phase);
    if (!faultScenarioAllowsPhase(faultScenario, phase)) {
      throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
    }
    return Object.freeze({ faultScenario, formatVersion: 2, phase });
  }
  throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
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

function parseFaultScenario(value: unknown): W6b2PackagedFaultScenario {
  if (
    typeof value !== 'string' ||
    !(w6b2PackagedFaultScenarios as readonly string[]).includes(value)
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  return value as W6b2PackagedFaultScenario;
}

function parseFaultPhase(value: unknown): W6b2PackagedFaultPhase {
  if (
    typeof value !== 'string' ||
    !(w6b2PackagedFaultPhases as readonly string[]).includes(value)
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  return value as W6b2PackagedFaultPhase;
}

function controlAllowsPackage(
  control: W6b2PackagedProofControl,
  role: W6b2PackagedProofRole,
): boolean {
  if (control.formatVersion === 1) {
    return (
      (role === 'source' && control.phase === 'sourceHandoff') ||
      (role === 'target' && control.phase !== 'sourceHandoff')
    );
  }
  return roleAllowsFaultPhase(role, control.phase);
}

function roleAllowsFaultPhase(
  role: W6b2PackagedProofRole,
  phase: W6b2PackagedFaultPhase,
): boolean {
  if (role === 'source') {
    return phase === 'sourceHandoff' || phase === 'rollbackFirstStart';
  }
  return phase !== 'sourceHandoff' && phase !== 'rollbackFirstStart';
}

function faultScenarioAllowsPhase(
  scenario: W6b2PackagedFaultScenario,
  phase: W6b2PackagedFaultPhase,
): boolean {
  const allowed: Readonly<
    Record<W6b2PackagedFaultScenario, ReadonlySet<W6b2PackagedFaultPhase>>
  > = {
    preUpdateRecoveryPointFailure: new Set(['sourceHandoff']),
    activeWorkspaceFirstStartFailure: new Set([
      'sourceHandoff',
      'targetFirstStartFailure',
      'businessRollback',
      'rollbackFirstStart',
    ]),
    acceptanceInterruption: new Set([
      'sourceHandoff',
      'targetAcceptanceInterruption',
      'targetAcceptanceRecovery',
      'targetAcceptanceRestart',
    ]),
    passiveWorkspaceMigrationFailure: new Set([
      'sourceHandoff',
      'targetFirstStart',
      'switchToB',
      'passiveWorkspaceMigrationFailure',
      'passiveWorkspaceRecovery',
    ]),
    binaryRollbackFailure: new Set([
      'sourceHandoff',
      'targetFirstStartFailure',
      'businessRollback',
      'binaryRollbackFailure',
      'failedSafeVerification',
    ]),
  };
  return allowed[scenario].has(phase);
}

function parseFaultResult(
  value: Readonly<Record<string, unknown>>,
): W6b2PackagedFaultProofResult {
  const faultScenario = parseFaultScenario(value.faultScenario);
  const phase = parseFaultPhase(value.phase);
  if (!faultScenarioAllowsPhase(faultScenario, phase)) {
    throw new Error('W6B2_PROOF_RESULT_INVALID');
  }
  if (
    (value.status === 'completed' ||
      value.status === 'interrupted' ||
      value.status === 'relaunching') &&
    hasExactKeys(value, faultResultKeys)
  ) {
    return Object.freeze({
      faultScenario,
      formatVersion: 2,
      phase,
      status: value.status,
    });
  }
  if (
    value.status !== 'failed' ||
    !hasExactKeys(value, faultFailureResultKeys) ||
    !faultResultErrorCodes.has(
      value.errorCode as W6b2PackagedFaultProofErrorCode,
    )
  ) {
    throw new Error('W6B2_PROOF_RESULT_INVALID');
  }
  return Object.freeze({
    errorCode: value.errorCode as W6b2PackagedFaultProofErrorCode,
    faultScenario,
    formatVersion: 2,
    phase,
    status: 'failed',
  });
}

function assertResultMatchesConfiguration(
  configuration: Readonly<W6b2PackagedProofConfiguration>,
  result: Readonly<W6b2PackagedProofResult>,
): void {
  if (
    configuration.controlFormatVersion !== result.formatVersion ||
    configuration.phase !== result.phase ||
    (configuration.controlFormatVersion === 2 &&
      (result.formatVersion !== 2 ||
        configuration.faultScenario !== result.faultScenario))
  ) {
    throw new Error('W6B2_PROOF_RESULT_INVALID');
  }
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
  const expectedRelative = join(
    W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
    token.slice(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH),
  );
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

import { isAbsolute, relative, resolve, sep } from 'node:path';

export const workspaceCandidateProtocolVersion = 1;

const maximumMessageBytes = 32 * 1024;
const maximumPathCharacters = 4_096;
const runtimeSessionPattern = /^[A-Za-z0-9_-]{43}$/;
const canonicalIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const boundedReleaseValuePattern = /^[0-9A-Za-z.+_-]{1,100}$/;

interface WorkspaceCandidateCommonConfig {
  readonly appVersion: string;
  readonly artifactRoot: string;
  readonly backendRoot: string;
  readonly buildRevision: string;
  readonly candidateRoot: string;
  readonly databaseFilePath: string;
  readonly migrationsDirectory: string;
}

interface WorkspaceMigrationInspectionConfig {
  readonly appVersion: string;
  readonly backendRoot: string;
  readonly buildRevision: string;
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly migrationsDirectory: string;
  readonly operation: 'inspectPublishedMigration';
  readonly publishedRoot: string;
}

export type WorkspaceCandidateProcessOperation =
  | WorkspaceMigrationInspectionConfig
  | (WorkspaceCandidateCommonConfig & {
      readonly operation: 'bootstrapEmpty';
    })
  | (WorkspaceCandidateCommonConfig & {
      readonly expectedProfileId: string;
      readonly expectedSourceMigrationChainIdentity: string;
      readonly importStagingRoot: string;
      readonly operation: 'migrateBackup';
    })
  | (WorkspaceCandidateCommonConfig & {
      readonly expectedProfileId: string;
      readonly importStagingRoot: string;
      readonly operation: 'validateAndMaterialize';
    })
  | (WorkspaceCandidateCommonConfig & {
      readonly expectedProfileId?: string;
      readonly operation: 'validatePublished';
    });

interface WorkspaceCandidateProcessRequestIdentity {
  readonly operationId: string;
  readonly protocolVersion: typeof workspaceCandidateProtocolVersion;
  readonly requestId: string;
  readonly runtimeSession: string;
}

export type WorkspaceCandidateProcessCommand =
  | (WorkspaceCandidateProcessRequestIdentity & {
      readonly operation: WorkspaceCandidateProcessOperation;
      readonly type: 'start';
    })
  | (WorkspaceCandidateProcessRequestIdentity & {
      readonly type: 'shutdown';
    });

export type WorkspaceCandidateProcessResult =
  | {
      readonly appliedMigrationCount: number;
      readonly kind: 'migrationInspection';
      readonly pendingMigrationCount: number;
      readonly status:
        | 'compatiblePending'
        | 'current'
        | 'invalidHistory';
    }
  | {
      readonly kind: 'migration';
      readonly migrationChainIdentity: string;
      readonly profileId: string;
    }
  | {
      readonly actorId: 'local-owner';
      readonly artifactRootHealth: 'ready';
      readonly companyId: string;
      readonly databaseHealth: 'healthy';
      readonly foreignKeyHealth: 'healthy';
      readonly kind: 'readiness';
      readonly migrationChainIdentity: string;
      readonly profileId: string;
    };

export type WorkspaceCandidateProcessStatus =
  | {
      readonly protocolVersion: typeof workspaceCandidateProtocolVersion;
      readonly type: 'ready';
    }
  | (WorkspaceCandidateProcessRequestIdentity & {
      readonly result: WorkspaceCandidateProcessResult;
      readonly type: 'completed';
    })
  | (WorkspaceCandidateProcessRequestIdentity & {
      readonly code: 'WORKSPACE_CANDIDATE_OPERATION_FAILED';
      readonly type: 'failed';
    });

export function createWorkspaceCandidateStartCommand(input: {
  readonly operation: WorkspaceCandidateProcessOperation;
  readonly operationId: string;
  readonly requestId: string;
  readonly runtimeSession: string;
}): Extract<WorkspaceCandidateProcessCommand, { type: 'start' }> {
  const command = parseWorkspaceCandidateProcessCommand({
    ...requestIdentity(input),
    operation: input.operation,
    type: 'start',
  });
  if (command?.type !== 'start') {
    throw new Error('WORKSPACE_CANDIDATE_PROCESS_REQUEST_INVALID');
  }
  return command;
}

export function createWorkspaceCandidateShutdownCommand(input: {
  readonly operationId: string;
  readonly requestId: string;
  readonly runtimeSession: string;
}): Extract<WorkspaceCandidateProcessCommand, { type: 'shutdown' }> {
  const command = parseWorkspaceCandidateProcessCommand({
    ...requestIdentity(input),
    type: 'shutdown',
  });
  if (command?.type !== 'shutdown') {
    throw new Error('WORKSPACE_CANDIDATE_PROCESS_REQUEST_INVALID');
  }
  return command;
}

export function createWorkspaceCandidateReadyStatus(): Extract<
  WorkspaceCandidateProcessStatus,
  { type: 'ready' }
> {
  return {
    protocolVersion: workspaceCandidateProtocolVersion,
    type: 'ready',
  };
}

export function createWorkspaceCandidateCompletedStatus(input: {
  readonly operationId: string;
  readonly requestId: string;
  readonly result: WorkspaceCandidateProcessResult;
  readonly runtimeSession: string;
}): Extract<WorkspaceCandidateProcessStatus, { type: 'completed' }> {
  const status = parseWorkspaceCandidateProcessStatus({
    ...requestIdentity(input),
    result: input.result,
    type: 'completed',
  });
  if (status?.type !== 'completed') {
    throw new Error('WORKSPACE_CANDIDATE_PROCESS_STATUS_INVALID');
  }
  return status;
}

export function createWorkspaceCandidateFailedStatus(input: {
  readonly operationId: string;
  readonly requestId: string;
  readonly runtimeSession: string;
}): Extract<WorkspaceCandidateProcessStatus, { type: 'failed' }> {
  const status = parseWorkspaceCandidateProcessStatus({
    ...requestIdentity(input),
    code: 'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    type: 'failed',
  });
  if (status?.type !== 'failed') {
    throw new Error('WORKSPACE_CANDIDATE_PROCESS_STATUS_INVALID');
  }
  return status;
}

export function parseWorkspaceCandidateProcessCommand(
  value: unknown,
): WorkspaceCandidateProcessCommand | undefined {
  if (
    !isPlainRecord(value) ||
    serializedByteLength(value) > maximumMessageBytes ||
    !isRequestIdentity(value)
  ) {
    return undefined;
  }
  if (
    value.type === 'shutdown' &&
    hasExactKeys(value, [
      'operationId',
      'protocolVersion',
      'requestId',
      'runtimeSession',
      'type',
    ])
  ) {
    return {
      ...requestIdentity(value),
      type: 'shutdown',
    };
  }
  if (
    value.type !== 'start' ||
    !hasExactKeys(value, [
      'operation',
      'operationId',
      'protocolVersion',
      'requestId',
      'runtimeSession',
      'type',
    ])
  ) {
    return undefined;
  }
  const operation = parseOperation(value.operation);
  return operation === undefined
    ? undefined
    : {
        ...requestIdentity(value),
        operation,
        type: 'start',
      };
}

export function parseWorkspaceCandidateProcessStatus(
  value: unknown,
): WorkspaceCandidateProcessStatus | undefined {
  if (
    !isPlainRecord(value) ||
    serializedByteLength(value) > maximumMessageBytes ||
    value.protocolVersion !== workspaceCandidateProtocolVersion
  ) {
    return undefined;
  }
  if (
    value.type === 'ready' &&
    hasExactKeys(value, ['protocolVersion', 'type'])
  ) {
    return createWorkspaceCandidateReadyStatus();
  }
  if (!isRequestIdentity(value)) return undefined;
  if (
    value.type === 'failed' &&
    value.code === 'WORKSPACE_CANDIDATE_OPERATION_FAILED' &&
    hasExactKeys(value, [
      'code',
      'operationId',
      'protocolVersion',
      'requestId',
      'runtimeSession',
      'type',
    ])
  ) {
    return {
      ...requestIdentity(value),
      code: 'WORKSPACE_CANDIDATE_OPERATION_FAILED',
      type: 'failed',
    };
  }
  if (
    value.type !== 'completed' ||
    !hasExactKeys(value, [
      'operationId',
      'protocolVersion',
      'requestId',
      'result',
      'runtimeSession',
      'type',
    ])
  ) {
    return undefined;
  }
  const result = parseResult(value.result);
  return result === undefined
    ? undefined
    : {
        ...requestIdentity(value),
        result,
        type: 'completed',
      };
}

function parseOperation(
  value: unknown,
): WorkspaceCandidateProcessOperation | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (
    value.operation === 'inspectPublishedMigration' &&
    isWorkspaceMigrationInspectionConfig(value) &&
    hasExactKeys(value, [
      'appVersion',
      'backendRoot',
      'buildRevision',
      'databaseFilePath',
      'expectedProfileId',
      'migrationsDirectory',
      'operation',
      'publishedRoot',
    ])
  ) {
    return {
      appVersion: value.appVersion,
      backendRoot: value.backendRoot,
      buildRevision: value.buildRevision,
      databaseFilePath: value.databaseFilePath,
      expectedProfileId: value.expectedProfileId,
      migrationsDirectory: value.migrationsDirectory,
      operation: 'inspectPublishedMigration',
      publishedRoot: value.publishedRoot,
    };
  }
  if (!isCommonConfig(value)) return undefined;
  if (
    value.operation === 'bootstrapEmpty' &&
    hasExactKeys(value, commonKeys(['operation']))
  ) {
    return readCommonOperation(value, { operation: 'bootstrapEmpty' });
  }
  if (
    value.operation === 'migrateBackup' &&
    isSha256(value.expectedProfileId) &&
    isSha256(value.expectedSourceMigrationChainIdentity) &&
    isSafeAbsolutePath(value.importStagingRoot) &&
    hasExactKeys(
      value,
      commonKeys([
        'expectedProfileId',
        'expectedSourceMigrationChainIdentity',
        'importStagingRoot',
        'operation',
      ]),
    )
  ) {
    return {
      ...readCommonOperation(value, { operation: 'migrateBackup' }),
      expectedProfileId: value.expectedProfileId,
      expectedSourceMigrationChainIdentity:
        value.expectedSourceMigrationChainIdentity,
      importStagingRoot: value.importStagingRoot,
    };
  }
  if (
    value.operation === 'validateAndMaterialize' &&
    isSha256(value.expectedProfileId) &&
    isSafeAbsolutePath(value.importStagingRoot) &&
    hasExactKeys(
      value,
      commonKeys(['expectedProfileId', 'importStagingRoot', 'operation']),
    )
  ) {
    return {
      ...readCommonOperation(value, {
        operation: 'validateAndMaterialize',
      }),
      expectedProfileId: value.expectedProfileId,
      importStagingRoot: value.importStagingRoot,
    };
  }
  if (
    value.operation === 'validatePublished' &&
    (value.expectedProfileId === undefined ||
      isSha256(value.expectedProfileId)) &&
    hasExactKeys(
      value,
      value.expectedProfileId === undefined
        ? commonKeys(['operation'])
        : commonKeys(['expectedProfileId', 'operation']),
    )
  ) {
    return {
      ...readCommonOperation(value, { operation: 'validatePublished' }),
      ...(value.expectedProfileId === undefined
        ? {}
        : { expectedProfileId: value.expectedProfileId }),
    };
  }
  return undefined;
}

function parseResult(
  value: unknown,
): WorkspaceCandidateProcessResult | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (
    value.kind === 'migrationInspection' &&
    isMigrationInspectionStatus(value.status) &&
    isNonNegativeSafeInteger(value.appliedMigrationCount) &&
    isNonNegativeSafeInteger(value.pendingMigrationCount) &&
    isConsistentMigrationInspection(
      value.status,
      value.appliedMigrationCount,
      value.pendingMigrationCount,
    ) &&
    hasExactKeys(value, [
      'appliedMigrationCount',
      'kind',
      'pendingMigrationCount',
      'status',
    ])
  ) {
    return {
      appliedMigrationCount: value.appliedMigrationCount,
      kind: 'migrationInspection',
      pendingMigrationCount: value.pendingMigrationCount,
      status: value.status,
    };
  }
  if (
    value.kind === 'migration' &&
    isSha256(value.migrationChainIdentity) &&
    isSha256(value.profileId) &&
    hasExactKeys(value, ['kind', 'migrationChainIdentity', 'profileId'])
  ) {
    return {
      kind: 'migration',
      migrationChainIdentity: value.migrationChainIdentity,
      profileId: value.profileId,
    };
  }
  if (
    value.kind === 'readiness' &&
    value.actorId === 'local-owner' &&
    value.artifactRootHealth === 'ready' &&
    isBoundedIdentity(value.companyId) &&
    value.databaseHealth === 'healthy' &&
    value.foreignKeyHealth === 'healthy' &&
    isSha256(value.migrationChainIdentity) &&
    isSha256(value.profileId) &&
    hasExactKeys(value, [
      'actorId',
      'artifactRootHealth',
      'companyId',
      'databaseHealth',
      'foreignKeyHealth',
      'kind',
      'migrationChainIdentity',
      'profileId',
    ])
  ) {
    return {
      actorId: 'local-owner',
      artifactRootHealth: 'ready',
      companyId: value.companyId,
      databaseHealth: 'healthy',
      foreignKeyHealth: 'healthy',
      kind: 'readiness',
      migrationChainIdentity: value.migrationChainIdentity,
      profileId: value.profileId,
    };
  }
  return undefined;
}

function isCommonConfig(value: Record<string, unknown>): boolean {
  return (
    typeof value.appVersion === 'string' &&
    boundedReleaseValuePattern.test(value.appVersion) &&
    typeof value.buildRevision === 'string' &&
    boundedReleaseValuePattern.test(value.buildRevision) &&
    isSafeAbsolutePath(value.artifactRoot) &&
    isSafeAbsolutePath(value.backendRoot) &&
    isSafeAbsolutePath(value.candidateRoot) &&
    isSafeAbsolutePath(value.databaseFilePath) &&
    isSafeAbsolutePath(value.migrationsDirectory) &&
    isStrictlyContainedPath(value.candidateRoot, value.artifactRoot) &&
    isStrictlyContainedPath(value.candidateRoot, value.databaseFilePath) &&
    isStrictlyContainedPath(value.backendRoot, value.migrationsDirectory)
  );
}

function isWorkspaceMigrationInspectionConfig(
  value: Record<string, unknown>,
): value is Record<string, unknown> & WorkspaceMigrationInspectionConfig {
  return (
    typeof value.appVersion === 'string' &&
    boundedReleaseValuePattern.test(value.appVersion) &&
    typeof value.buildRevision === 'string' &&
    boundedReleaseValuePattern.test(value.buildRevision) &&
    isSafeAbsolutePath(value.backendRoot) &&
    isSafeAbsolutePath(value.publishedRoot) &&
    isSafeAbsolutePath(value.databaseFilePath) &&
    isSafeAbsolutePath(value.migrationsDirectory) &&
    isSha256(value.expectedProfileId) &&
    isStrictlyContainedPath(value.publishedRoot, value.databaseFilePath) &&
    isStrictlyContainedPath(value.backendRoot, value.migrationsDirectory)
  );
}

function isConsistentMigrationInspection(
  status: 'compatiblePending' | 'current' | 'invalidHistory',
  appliedMigrationCount: number,
  pendingMigrationCount: number,
): boolean {
  if (status === 'current') return pendingMigrationCount === 0;
  if (status === 'compatiblePending') return pendingMigrationCount > 0;
  return appliedMigrationCount === 0 && pendingMigrationCount === 0;
}

function readCommonOperation<
  T extends WorkspaceCandidateProcessOperation['operation'],
>(
  value: Record<string, unknown>,
  operation: { readonly operation: T },
): WorkspaceCandidateCommonConfig & { readonly operation: T } {
  return {
    appVersion: value.appVersion as string,
    artifactRoot: value.artifactRoot as string,
    backendRoot: value.backendRoot as string,
    buildRevision: value.buildRevision as string,
    candidateRoot: value.candidateRoot as string,
    databaseFilePath: value.databaseFilePath as string,
    migrationsDirectory: value.migrationsDirectory as string,
    operation: operation.operation,
  };
}

function commonKeys(extra: readonly string[]): string[] {
  return [
    'appVersion',
    'artifactRoot',
    'backendRoot',
    'buildRevision',
    'candidateRoot',
    'databaseFilePath',
    'migrationsDirectory',
    ...extra,
  ];
}

function requestIdentity(input: {
  readonly operationId: unknown;
  readonly requestId: unknown;
  readonly runtimeSession: unknown;
}): WorkspaceCandidateProcessRequestIdentity {
  return {
    operationId: input.operationId as string,
    protocolVersion: workspaceCandidateProtocolVersion,
    requestId: input.requestId as string,
    runtimeSession: input.runtimeSession as string,
  };
}

function isRequestIdentity(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  operationId: string;
  protocolVersion: typeof workspaceCandidateProtocolVersion;
  requestId: string;
  runtimeSession: string;
} {
  return (
    value.protocolVersion === workspaceCandidateProtocolVersion &&
    isCanonicalId(value.operationId) &&
    isCanonicalId(value.requestId) &&
    isRuntimeSession(value.runtimeSession)
  );
}

function isSafeAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumPathCharacters &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    resolve(value) === value
  );
}

function isStrictlyContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function isCanonicalId(value: unknown): value is string {
  return typeof value === 'string' && canonicalIdPattern.test(value);
}

function isRuntimeSession(value: unknown): value is string {
  return typeof value === 'string' && runtimeSessionPattern.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function isBoundedIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isMigrationInspectionStatus(
  value: unknown,
): value is
  | 'compatiblePending'
  | 'current'
  | 'invalidHistory' {
  return (
    value === 'compatiblePending' ||
    value === 'current' ||
    value === 'invalidHistory'
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function serializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

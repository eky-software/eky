export const profileSnapshotBrokerProtocolVersion = 7;

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationIdPattern = requestIdPattern;
const maximumArtifactCatalogBytes = 64 * 1024 * 1024;
const maximumMessageBytes = 1_024;

export type ProfileMaintenanceBrokerOperation =
  | 'beginProfileMaintenance'
  | 'createProfileSnapshot'
  | 'endProfileMaintenance'
  | 'getProfileMaintenanceStatus'
  | 'prepareProfileRestoreActivation'
  | 'validateActiveProfile'
  | 'validateProfileSnapshot';

export type ProfileSnapshotMigrationPolicy =
  | 'exactCurrentManifest'
  | 'compatibleHistoricalPrefix';

export type ProfileSnapshotBrokerRequest =
  | {
      migrationPolicy: ProfileSnapshotMigrationPolicy;
      operation: 'createProfileSnapshot';
      operationId: string;
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
    }
  | {
      operation:
        | 'beginProfileMaintenance'
        | 'endProfileMaintenance'
        | 'prepareProfileRestoreActivation'
        | 'validateProfileSnapshot';
      operationId: string;
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
    }
  | {
      operation: 'getProfileMaintenanceStatus' | 'validateActiveProfile';
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
    };

export type ProfileSnapshotBrokerErrorCode =
  | 'PROFILE_MAINTENANCE_BUSY'
  | 'PROFILE_MAINTENANCE_OPERATION_MISMATCH'
  | 'PROFILE_MAINTENANCE_TIMEOUT'
  | 'PROFILE_SNAPSHOT_ARTIFACTS_FAILED'
  | 'PROFILE_SNAPSHOT_DATABASE_FAILED'
  | 'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED'
  | 'PROFILE_SNAPSHOT_VALIDATION_FAILED'
  | 'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID'
  | 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED'
  | 'PROFILE_SNAPSHOT_STAGING_FAILED'
  | 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE';

export interface ProfileSnapshotBrokerReady {
  protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
  type: 'profileSnapshotBrokerReady';
}

export type ProfileSnapshotBrokerResponse =
  | {
      errorCode: ProfileSnapshotBrokerErrorCode;
      ok: false;
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
    }
  | {
      ok: true;
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
      result: {
        status: 'busy' | 'normal';
        type: 'maintenanceStatus';
      } | {
        artifactCount: number;
        artifactTotalByteSize: number;
        databaseHealth: 'healthy';
        migrationChainIdentity: string;
        profileId: string;
        type: 'activeProfileValidation';
      } | {
        artifactCatalog: {
          artifactCount: number;
          artifactTotalByteSize: number;
          catalogByteSize: number;
          logicalPath: 'snapshot-catalog-v1.json';
          sha256: string;
        };
        database: {
          databaseByteSize: number;
          logicalPath: 'profile.sqlite';
          sha256: string;
          totalPages: number;
        };
        type: 'profileSnapshot';
      } | {
        activeProfileIsEmpty: boolean;
        artifactCount: number;
        artifactTotalByteSize: number;
        databaseHealth: 'healthy';
        migrationChainIdentity: string;
        profileId: string;
        profileMatchesActive: boolean;
        type: 'profileSnapshotValidation';
      } | {
        artifactCount: number;
        artifactTotalByteSize: number;
        type: 'profileRestoreActivationPrepared';
      };
    };

export function createProfileSnapshotBrokerRequest(input: {
  migrationPolicy?: ProfileSnapshotMigrationPolicy;
  operation: ProfileMaintenanceBrokerOperation;
  operationId?: string;
  requestId: string;
}): ProfileSnapshotBrokerRequest {
  const value =
    input.operation === 'getProfileMaintenanceStatus' ||
    input.operation === 'validateActiveProfile'
      ? {
          operation: input.operation,
          protocolVersion: profileSnapshotBrokerProtocolVersion,
          requestId: input.requestId,
        }
      : input.operation === 'createProfileSnapshot'
        ? {
            migrationPolicy: input.migrationPolicy,
            operation: input.operation,
            operationId: input.operationId,
            protocolVersion: profileSnapshotBrokerProtocolVersion,
            requestId: input.requestId,
          }
        : {
            operation: input.operation,
            operationId: input.operationId,
            protocolVersion: profileSnapshotBrokerProtocolVersion,
            requestId: input.requestId,
          };
  const request = parseProfileSnapshotBrokerRequest(value);

  if (request === undefined) {
    throw new Error('PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID');
  }
  return request;
}

export function createProfileSnapshotBrokerReady(): ProfileSnapshotBrokerReady {
  return {
    protocolVersion: profileSnapshotBrokerProtocolVersion,
    type: 'profileSnapshotBrokerReady',
  };
}

export function isProfileSnapshotBrokerReadyCandidate(
  value: unknown,
): boolean {
  return (
    isRecord(value) && value.type === 'profileSnapshotBrokerReady'
  );
}

export function parseProfileSnapshotBrokerReady(
  value: unknown,
): ProfileSnapshotBrokerReady | undefined {
  return isRecord(value) &&
    hasExactKeys(value, ['protocolVersion', 'type']) &&
    value.protocolVersion === profileSnapshotBrokerProtocolVersion &&
    value.type === 'profileSnapshotBrokerReady'
    ? {
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        type: 'profileSnapshotBrokerReady',
      }
    : undefined;
}

export function parseProfileSnapshotBrokerRequest(
  value: unknown,
): ProfileSnapshotBrokerRequest | undefined {
  if (
    !isRecord(value) ||
    serializedByteLength(value) > maximumMessageBytes ||
    value.protocolVersion !== profileSnapshotBrokerProtocolVersion ||
    !isRequestId(value.requestId) ||
    typeof value.operation !== 'string'
  ) {
    return undefined;
  }

  if (
    value.operation === 'getProfileMaintenanceStatus' ||
    value.operation === 'validateActiveProfile'
  ) {
    return hasExactKeys(value, [
      'operation',
      'protocolVersion',
      'requestId',
    ])
      ? {
          operation: value.operation,
          protocolVersion: profileSnapshotBrokerProtocolVersion,
          requestId: value.requestId,
        }
      : undefined;
  }

  if (value.operation === 'createProfileSnapshot') {
    return hasExactKeys(value, [
      'migrationPolicy',
      'operation',
      'operationId',
      'protocolVersion',
      'requestId',
    ]) &&
      isOperationId(value.operationId) &&
      isMigrationPolicy(value.migrationPolicy)
      ? {
          migrationPolicy: value.migrationPolicy,
          operation: value.operation,
          operationId: value.operationId,
          protocolVersion: profileSnapshotBrokerProtocolVersion,
          requestId: value.requestId,
        }
      : undefined;
  }

  if (
    (value.operation !== 'beginProfileMaintenance' &&
      value.operation !== 'endProfileMaintenance' &&
      value.operation !== 'prepareProfileRestoreActivation' &&
      value.operation !== 'validateProfileSnapshot') ||
    !hasExactKeys(value, [
      'operation',
      'operationId',
      'protocolVersion',
      'requestId',
    ]) ||
    !isOperationId(value.operationId)
  ) {
    return undefined;
  }

  return {
    operation: value.operation,
    operationId: value.operationId,
    protocolVersion: profileSnapshotBrokerProtocolVersion,
    requestId: value.requestId,
  };
}

function isMigrationPolicy(
  value: unknown,
): value is ProfileSnapshotMigrationPolicy {
  return (
    value === 'exactCurrentManifest' ||
    value === 'compatibleHistoricalPrefix'
  );
}

export function parseProfileSnapshotBrokerResponse(
  value: unknown,
): ProfileSnapshotBrokerResponse | undefined {
  if (
    !isRecord(value) ||
    value.protocolVersion !== profileSnapshotBrokerProtocolVersion ||
    !isRequestId(value.requestId) ||
    typeof value.ok !== 'boolean'
  ) {
    return undefined;
  }

  if (value.ok === false) {
    return hasExactKeys(value, [
      'errorCode',
      'ok',
      'protocolVersion',
      'requestId',
    ]) && isErrorCode(value.errorCode)
      ? {
          errorCode: value.errorCode,
          ok: false,
          protocolVersion: profileSnapshotBrokerProtocolVersion,
          requestId: value.requestId,
        }
      : undefined;
  }

  if (
    !hasExactKeys(value, [
      'ok',
      'protocolVersion',
      'requestId',
      'result',
    ]) ||
    !isRecord(value.result) ||
    typeof value.result.type !== 'string'
  ) {
    return undefined;
  }

  if (
    value.result.type === 'maintenanceStatus' &&
    hasExactKeys(value.result, ['status', 'type']) &&
    (value.result.status === 'busy' || value.result.status === 'normal')
  ) {
    return {
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId: value.requestId,
      result: {
        status: value.result.status,
        type: 'maintenanceStatus',
      },
    };
  }

  if (
    value.result.type === 'activeProfileValidation' &&
    hasExactKeys(value.result, [
      'artifactCount',
      'artifactTotalByteSize',
      'databaseHealth',
      'migrationChainIdentity',
      'profileId',
      'type',
    ]) &&
    isBoundedNonNegativeSafeInteger(value.result.artifactCount, 100_000) &&
    isBoundedNonNegativeSafeInteger(
      value.result.artifactTotalByteSize,
      20 * 1024 * 1024 * 1024,
    ) &&
    value.result.databaseHealth === 'healthy' &&
    isSha256(value.result.migrationChainIdentity) &&
    isSha256(value.result.profileId)
  ) {
    return {
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId: value.requestId,
      result: {
        artifactCount: value.result.artifactCount,
        artifactTotalByteSize: value.result.artifactTotalByteSize,
        databaseHealth: 'healthy',
        migrationChainIdentity: value.result.migrationChainIdentity,
        profileId: value.result.profileId,
        type: 'activeProfileValidation',
      },
    };
  }

  if (
    value.result.type === 'profileSnapshot' &&
    hasExactKeys(value.result, [
      'artifactCatalog',
      'database',
      'type',
    ]) &&
    isArtifactCatalogMetadata(value.result.artifactCatalog) &&
    isDatabaseMetadata(value.result.database)
  ) {
    return {
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId: value.requestId,
      result: {
        artifactCatalog: value.result.artifactCatalog,
        database: value.result.database,
        type: 'profileSnapshot',
      },
    };
  }

  if (
    value.result.type === 'profileRestoreActivationPrepared' &&
    hasExactKeys(value.result, [
      'artifactCount',
      'artifactTotalByteSize',
      'type',
    ]) &&
    isBoundedNonNegativeSafeInteger(value.result.artifactCount, 100_000) &&
    isBoundedNonNegativeSafeInteger(
      value.result.artifactTotalByteSize,
      20 * 1024 * 1024 * 1024,
    )
  ) {
    return {
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId: value.requestId,
      result: {
        artifactCount: value.result.artifactCount,
        artifactTotalByteSize: value.result.artifactTotalByteSize,
        type: 'profileRestoreActivationPrepared',
      },
    };
  }

  if (
    value.result.type === 'profileSnapshotValidation' &&
    hasExactKeys(value.result, [
      'activeProfileIsEmpty',
      'artifactCount',
      'artifactTotalByteSize',
      'databaseHealth',
      'migrationChainIdentity',
      'profileId',
      'profileMatchesActive',
      'type',
    ]) &&
    typeof value.result.activeProfileIsEmpty === 'boolean' &&
    isBoundedNonNegativeSafeInteger(value.result.artifactCount, 100_000) &&
    isBoundedNonNegativeSafeInteger(
      value.result.artifactTotalByteSize,
      20 * 1024 * 1024 * 1024,
    ) &&
    value.result.databaseHealth === 'healthy' &&
    isSha256(value.result.migrationChainIdentity) &&
    isSha256(value.result.profileId) &&
    typeof value.result.profileMatchesActive === 'boolean'
  ) {
    return {
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId: value.requestId,
      result: {
        activeProfileIsEmpty: value.result.activeProfileIsEmpty,
        artifactCount: value.result.artifactCount,
        artifactTotalByteSize: value.result.artifactTotalByteSize,
        databaseHealth: 'healthy',
        migrationChainIdentity: value.result.migrationChainIdentity,
        profileId: value.result.profileId,
        profileMatchesActive: value.result.profileMatchesActive,
        type: 'profileSnapshotValidation',
      },
    };
  }

  return undefined;
}

export function readProfileSnapshotBrokerRequestId(
  value: unknown,
): string | undefined {
  return isRecord(value) && isRequestId(value.requestId)
    ? value.requestId
    : undefined;
}

function isErrorCode(value: unknown): value is ProfileSnapshotBrokerErrorCode {
  return (
    value === 'PROFILE_MAINTENANCE_BUSY' ||
    value === 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' ||
    value === 'PROFILE_MAINTENANCE_TIMEOUT' ||
    value === 'PROFILE_SNAPSHOT_ARTIFACTS_FAILED' ||
    value === 'PROFILE_SNAPSHOT_DATABASE_FAILED' ||
    value === 'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED' ||
    value === 'PROFILE_SNAPSHOT_VALIDATION_FAILED' ||
    value === 'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID' ||
    value === 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED' ||
    value === 'PROFILE_SNAPSHOT_STAGING_FAILED' ||
    value === 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE'
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isArtifactCatalogMetadata(value: unknown): value is {
  artifactCount: number;
  artifactTotalByteSize: number;
  catalogByteSize: number;
  logicalPath: 'snapshot-catalog-v1.json';
  sha256: string;
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'artifactCount',
      'artifactTotalByteSize',
      'catalogByteSize',
      'logicalPath',
      'sha256',
    ]) &&
    isBoundedNonNegativeSafeInteger(value.artifactCount, 100_000) &&
    isBoundedNonNegativeSafeInteger(
      value.artifactTotalByteSize,
      20 * 1024 * 1024 * 1024,
    ) &&
    isBoundedPositiveSafeInteger(
      value.catalogByteSize,
      maximumArtifactCatalogBytes,
    ) &&
    value.logicalPath === 'snapshot-catalog-v1.json' &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

function isDatabaseMetadata(value: unknown): value is {
  databaseByteSize: number;
  logicalPath: 'profile.sqlite';
  sha256: string;
  totalPages: number;
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'databaseByteSize',
      'logicalPath',
      'sha256',
      'totalPages',
    ]) &&
    isBoundedPositiveSafeInteger(value.databaseByteSize) &&
    value.logicalPath === 'profile.sqlite' &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    isBoundedPositiveSafeInteger(value.totalPages)
  );
}

function isBoundedPositiveSafeInteger(
  value: unknown,
  maximum = 20 * 1024 * 1024 * 1024,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maximum
  );
}

function isBoundedNonNegativeSafeInteger(
  value: unknown,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && requestIdPattern.test(value);
}

function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && operationIdPattern.test(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function serializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

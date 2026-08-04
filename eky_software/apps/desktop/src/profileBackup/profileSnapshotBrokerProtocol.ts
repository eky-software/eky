export const profileSnapshotBrokerProtocolVersion = 1;

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationIdPattern = requestIdPattern;
const maximumMessageBytes = 1_024;

export type ProfileMaintenanceBrokerOperation =
  | 'beginProfileMaintenance'
  | 'createSqliteSnapshot'
  | 'endProfileMaintenance'
  | 'getProfileMaintenanceStatus';

export type ProfileSnapshotBrokerRequest =
  | {
      operation:
        | 'beginProfileMaintenance'
        | 'createSqliteSnapshot'
        | 'endProfileMaintenance';
      operationId: string;
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
    }
  | {
      operation: 'getProfileMaintenanceStatus';
      protocolVersion: typeof profileSnapshotBrokerProtocolVersion;
      requestId: string;
    };

export type ProfileSnapshotBrokerErrorCode =
  | 'PROFILE_MAINTENANCE_BUSY'
  | 'PROFILE_MAINTENANCE_OPERATION_MISMATCH'
  | 'PROFILE_MAINTENANCE_TIMEOUT'
  | 'PROFILE_SNAPSHOT_DATABASE_FAILED'
  | 'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID'
  | 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE';

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
        databaseByteSize: number;
        logicalPath: 'profile.sqlite';
        sha256: string;
        totalPages: number;
        type: 'sqliteSnapshot';
      };
    };

export function createProfileSnapshotBrokerRequest(input: {
  operation: ProfileMaintenanceBrokerOperation;
  operationId?: string;
  requestId: string;
}): ProfileSnapshotBrokerRequest {
  const value =
    input.operation === 'getProfileMaintenanceStatus'
      ? {
          operation: input.operation,
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

  if (value.operation === 'getProfileMaintenanceStatus') {
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

  if (
    (value.operation !== 'beginProfileMaintenance' &&
      value.operation !== 'createSqliteSnapshot' &&
      value.operation !== 'endProfileMaintenance') ||
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
    value.result.type === 'sqliteSnapshot' &&
    hasExactKeys(value.result, [
      'databaseByteSize',
      'logicalPath',
      'sha256',
      'totalPages',
      'type',
    ]) &&
    isBoundedPositiveSafeInteger(value.result.databaseByteSize) &&
    value.result.logicalPath === 'profile.sqlite' &&
    typeof value.result.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.result.sha256) &&
    isBoundedPositiveSafeInteger(value.result.totalPages)
  ) {
    return {
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId: value.requestId,
      result: {
        databaseByteSize: value.result.databaseByteSize,
        logicalPath: 'profile.sqlite',
        sha256: value.result.sha256,
        totalPages: value.result.totalPages,
        type: 'sqliteSnapshot',
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
    value === 'PROFILE_SNAPSHOT_DATABASE_FAILED' ||
    value === 'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID' ||
    value === 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE'
  );
}

function isBoundedPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 20 * 1024 * 1024 * 1024
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

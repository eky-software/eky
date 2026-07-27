export interface SupportBundleDiagnosticEvent {
  appVersion?: string;
  buildRevision?: string;
  category: string;
  component: 'backend' | 'desktop';
  correlationId?: string;
  durationMs?: number;
  errorCode: string | null;
  eventName: string;
  fingerprint?: string;
  id: string;
  level: 'error' | 'info' | 'warn';
  occurredAt: string;
  operationId?: string;
  outcome: 'blocked' | 'failure' | 'success' | 'unknown';
  retryable?: boolean;
  runtimeInstanceId?: string;
  sideEffectState?: 'committed' | 'none' | 'rolledBack' | 'unknown';
  stage?: string;
}

type SupportBundleSideEffectState =
  SupportBundleDiagnosticEvent['sideEffectState'];

export interface SupportBundleBackendData {
  backendVersion: string;
  database: {
    appliedMigrationCount: number;
    health: 'ok';
    latestMigrationName: string | null;
  };
  diagnosticEvents: SupportBundleDiagnosticEvent[];
  diagnosticPeriodDays: 30;
  runtimeSummary: SupportBundleRuntimeSummary;
  truncated: boolean;
}

export interface SupportBundleRuntimeSummary {
  appVersion: string;
  appliedMigrationCount: number | null;
  architecture: string;
  buildCreatedAt: string;
  buildDirty: boolean;
  buildRevision: string;
  databaseHealth: 'failed' | 'ok' | 'unavailable';
  electronVersion: string | null;
  latestErrorAt: string | null;
  latestMigrationName: string | null;
  latestSecurityEventAt: string | null;
  latestWarningAt: string | null;
  nodeVersion: string;
  operationalLogNewestMonth: string | null;
  operationalLogOldestMonth: string | null;
  operationalLogsAvailable: boolean;
  operationalLogTotalBytes: number;
  platform: string;
  runtimeInstanceId: string;
}

const maximumDiagnosticEvents = 5_000;
const safeIdentifierPattern = /^[A-Za-z0-9._:-]+$/;
const safeMigrationNamePattern = /^[A-Za-z0-9._-]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readSupportBundleBackendData(
  value: unknown,
): SupportBundleBackendData {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'backendVersion',
      'database',
      'diagnosticEvents',
      'diagnosticPeriodDays',
      'runtimeSummary',
      'truncated',
    ]) ||
    !isSafeVersion(value.backendVersion) ||
    !isDatabaseSummary(value.database) ||
    !Array.isArray(value.diagnosticEvents) ||
    value.diagnosticEvents.length > maximumDiagnosticEvents ||
    value.diagnosticPeriodDays !== 30 ||
    !isRuntimeSummary(value.runtimeSummary) ||
    typeof value.truncated !== 'boolean'
  ) {
    throw new Error('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  }

  return {
    backendVersion: value.backendVersion,
    database: value.database,
    diagnosticEvents: value.diagnosticEvents.map(readDiagnosticEvent),
    diagnosticPeriodDays: 30,
    runtimeSummary: value.runtimeSummary,
    truncated: value.truncated,
  };
}

function isRuntimeSummary(
  value: unknown,
): value is SupportBundleRuntimeSummary {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'appVersion',
      'appliedMigrationCount',
      'architecture',
      'buildCreatedAt',
      'buildDirty',
      'buildRevision',
      'databaseHealth',
      'electronVersion',
      'latestErrorAt',
      'latestMigrationName',
      'latestSecurityEventAt',
      'latestWarningAt',
      'nodeVersion',
      'operationalLogNewestMonth',
      'operationalLogOldestMonth',
      'operationalLogsAvailable',
      'operationalLogTotalBytes',
      'platform',
      'runtimeInstanceId',
    ]) &&
    isSafeVersion(value.appVersion) &&
    isNullableNonNegativeInteger(value.appliedMigrationCount) &&
    isSafeIdentifier(value.architecture, 40) &&
    isTimestamp(value.buildCreatedAt) &&
    typeof value.buildDirty === 'boolean' &&
    typeof value.buildRevision === 'string' &&
    /^(?:[0-9a-f]{7,40}|development)$/.test(value.buildRevision) &&
    ['failed', 'ok', 'unavailable'].includes(
      value.databaseHealth as string,
    ) &&
    (value.electronVersion === null ||
      isSafeVersion(value.electronVersion)) &&
    isNullableTimestamp(value.latestErrorAt) &&
    (value.latestMigrationName === null ||
      (typeof value.latestMigrationName === 'string' &&
        value.latestMigrationName.length <= 160 &&
        safeMigrationNamePattern.test(value.latestMigrationName))) &&
    isNullableTimestamp(value.latestSecurityEventAt) &&
    isNullableTimestamp(value.latestWarningAt) &&
    isSafeVersion(value.nodeVersion) &&
    isNullableMonth(value.operationalLogNewestMonth) &&
    isNullableMonth(value.operationalLogOldestMonth) &&
    typeof value.operationalLogsAvailable === 'boolean' &&
    isNonNegativeInteger(value.operationalLogTotalBytes) &&
    isSafeIdentifier(value.platform, 40) &&
    typeof value.runtimeInstanceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.runtimeInstanceId,
    )
  );
}

function readDiagnosticEvent(value: unknown): SupportBundleDiagnosticEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'appVersion',
      'buildRevision',
      'category',
      'component',
      'correlationId',
      'durationMs',
      'errorCode',
      'eventName',
      'fingerprint',
      'id',
      'level',
      'occurredAt',
      'operationId',
      'outcome',
      'retryable',
      'runtimeInstanceId',
      'sideEffectState',
      'stage',
    ]) ||
    !isOptionalVersion(value.appVersion) ||
    !isOptionalBuildRevision(value.buildRevision) ||
    !isSafeIdentifier(value.category, 100) ||
    !['backend', 'desktop'].includes(value.component as string) ||
    !isOptionalUuid(value.correlationId) ||
    !isOptionalNonNegativeInteger(value.durationMs) ||
    !isNullableSafeIdentifier(value.errorCode, 120) ||
    !isSafeIdentifier(value.eventName, 160) ||
    !isOptionalSafeIdentifier(value.fingerprint, 300) ||
    !isSafeIdentifier(value.id, 240) ||
    !['error', 'info', 'warn'].includes(value.level as string) ||
    !isTimestamp(value.occurredAt) ||
    !isOptionalSafeIdentifier(value.operationId, 300) ||
    !['blocked', 'failure', 'success', 'unknown'].includes(
      value.outcome as string,
    ) ||
    !isOptionalBoolean(value.retryable) ||
    !isOptionalUuid(value.runtimeInstanceId) ||
    !isOptionalSideEffectState(value.sideEffectState) ||
    !isOptionalSafeIdentifier(value.stage, 300)
  ) {
    throw new Error('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  }

  return {
    ...(value.appVersion === undefined
      ? {}
      : { appVersion: value.appVersion }),
    ...(value.buildRevision === undefined
      ? {}
      : { buildRevision: value.buildRevision }),
    category: value.category,
    component: value.component as 'backend' | 'desktop',
    ...(value.correlationId === undefined
      ? {}
      : { correlationId: value.correlationId }),
    ...(value.durationMs === undefined
      ? {}
      : { durationMs: value.durationMs }),
    errorCode: value.errorCode,
    eventName: value.eventName,
    ...(value.fingerprint === undefined
      ? {}
      : { fingerprint: value.fingerprint }),
    id: value.id,
    level: value.level as 'error' | 'info' | 'warn',
    occurredAt: value.occurredAt,
    ...(value.operationId === undefined
      ? {}
      : { operationId: value.operationId }),
    outcome: value.outcome as
      | 'blocked'
      | 'failure'
      | 'success'
      | 'unknown',
    ...(value.retryable === undefined
      ? {}
      : { retryable: value.retryable }),
    ...(value.runtimeInstanceId === undefined
      ? {}
      : { runtimeInstanceId: value.runtimeInstanceId }),
    ...(value.sideEffectState === undefined
      ? {}
      : {
          sideEffectState: value.sideEffectState as
            | 'committed'
            | 'none'
            | 'rolledBack'
            | 'unknown',
        }),
    ...(value.stage === undefined ? {} : { stage: value.stage }),
  };
}

function isOptionalBoolean(
  value: unknown,
): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalBuildRevision(
  value: unknown,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      /^(?:[0-9a-f]{7,40}|development)$/.test(value))
  );
}

function isOptionalNonNegativeInteger(
  value: unknown,
): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalSafeIdentifier(
  value: unknown,
  maximumLength: number,
): value is string | undefined {
  return value === undefined || isSafeIdentifier(value, maximumLength);
}

function isOptionalSideEffectState(
  value: unknown,
): value is SupportBundleSideEffectState {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      ['committed', 'none', 'rolledBack', 'unknown'].includes(value))
  );
}

function isOptionalUuid(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && uuidPattern.test(value))
  );
}

function isOptionalVersion(value: unknown): value is string | undefined {
  return value === undefined || isSafeVersion(value);
}

function isDatabaseSummary(
  value: unknown,
): value is SupportBundleBackendData['database'] {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'appliedMigrationCount',
      'health',
      'latestMigrationName',
    ]) &&
    typeof value.appliedMigrationCount === 'number' &&
    Number.isSafeInteger(value.appliedMigrationCount) &&
    value.appliedMigrationCount >= 0 &&
    value.health === 'ok' &&
    (value.latestMigrationName === null ||
      (typeof value.latestMigrationName === 'string' &&
        value.latestMigrationName.length <= 160 &&
        safeMigrationNamePattern.test(value.latestMigrationName)))
  );
}

function isSafeIdentifier(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    safeIdentifierPattern.test(value)
  );
}

function isNullableSafeIdentifier(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return value === null || isSafeIdentifier(value, maximumLength);
}

function isSafeVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9.+_-]+$/.test(value)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isNullableNonNegativeInteger(
  value: unknown,
): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNullableMonth(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))
  );
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 40 &&
    value.endsWith('Z') &&
    Number.isFinite(Date.parse(value))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

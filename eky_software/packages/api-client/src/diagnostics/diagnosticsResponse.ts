import { EkyApiError, isRecord } from '../http.js';
import {
  diagnosticEventNames,
  type DiagnosticEventComponent,
  type DiagnosticEventItem,
  type DiagnosticEventLevel,
  type DiagnosticEventName,
  type DiagnosticEventOutcome,
  type RuntimeDiagnosticSummary,
} from './diagnosticsTypes.js';

const eventNames = new Set<DiagnosticEventName>(diagnosticEventNames);
const components = new Set<DiagnosticEventComponent>(['backend', 'desktop']);
const levels = new Set<DiagnosticEventLevel>(['error', 'info', 'warn']);
const outcomes = new Set<DiagnosticEventOutcome>([
  'blocked',
  'failure',
  'success',
  'unknown',
]);

export function readDiagnosticsResponse(value: unknown): DiagnosticEventItem[] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['diagnosticEvents']) ||
    !Array.isArray(value.diagnosticEvents)
  ) {
    throw invalidResponse(value);
  }

  return value.diagnosticEvents.map(readDiagnosticEvent);
}

export function readDiagnosticSummaryResponse(
  value: unknown,
): RuntimeDiagnosticSummary {
  const keys = [
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
  ] as const;

  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys) ||
    !isVersion(value.appVersion) ||
    !isNullableNonNegativeInteger(value.appliedMigrationCount) ||
    !isSafeIdentifier(value.architecture, 40) ||
    !isTimestamp(value.buildCreatedAt) ||
    typeof value.buildDirty !== 'boolean' ||
    typeof value.buildRevision !== 'string' ||
    !/^(?:[0-9a-f]{7,40}|development)$/.test(value.buildRevision) ||
    !['failed', 'ok', 'unavailable'].includes(
      value.databaseHealth as string,
    ) ||
    !isNullableVersion(value.electronVersion) ||
    !isNullableTimestamp(value.latestErrorAt) ||
    !isNullableMigrationName(value.latestMigrationName) ||
    !isNullableTimestamp(value.latestSecurityEventAt) ||
    !isNullableTimestamp(value.latestWarningAt) ||
    !isVersion(value.nodeVersion) ||
    !isNullableMonth(value.operationalLogNewestMonth) ||
    !isNullableMonth(value.operationalLogOldestMonth) ||
    typeof value.operationalLogsAvailable !== 'boolean' ||
    !isNonNegativeInteger(value.operationalLogTotalBytes) ||
    !isSafeIdentifier(value.platform, 40) ||
    typeof value.runtimeInstanceId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.runtimeInstanceId,
    )
  ) {
    throw invalidResponse(value);
  }

  return value as unknown as RuntimeDiagnosticSummary;
}

function readDiagnosticEvent(value: unknown): DiagnosticEventItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'category',
      'component',
      'errorCode',
      'eventName',
      'id',
      'level',
      'occurredAt',
      'outcome',
    ]) ||
    !isSafeIdentifier(value.category, 100) ||
    !isMember(value.component, components) ||
    !isMember(value.eventName, eventNames) ||
    !isSafeIdentifier(value.id, 240) ||
    !isMember(value.level, levels) ||
    !isTimestamp(value.occurredAt) ||
    !isMember(value.outcome, outcomes) ||
    !isNullableSafeIdentifier(value.errorCode, 120)
  ) {
    throw invalidResponse(value);
  }

  return {
    category: value.category,
    component: value.component,
    errorCode: value.errorCode,
    eventName: value.eventName,
    id: value.id,
    level: value.level,
    occurredAt: value.occurredAt,
    outcome: value.outcome,
  };
}

function isMember<Value extends string>(
  value: unknown,
  values: ReadonlySet<Value>,
): value is Value {
  return typeof value === 'string' && values.has(value as Value);
}

function isNullableSafeIdentifier(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return value === null || isSafeIdentifier(value, maximumLength);
}

function isSafeIdentifier(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
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

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9.+_-]+$/.test(value)
  );
}

function isNullableVersion(value: unknown): value is string | null {
  return value === null || isVersion(value);
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

function isNullableMigrationName(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 160 &&
      /^[A-Za-z0-9._-]+$/.test(value))
  );
}

function isNullableMonth(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalidResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid diagnostics response.', { responseBody });
}

import { EkyApiError, isRecord } from '../http.js';
import {
  diagnosticEventNames,
  type DiagnosticEventComponent,
  type DiagnosticEventItem,
  type DiagnosticEventLevel,
  type DiagnosticEventName,
  type DiagnosticEventOutcome,
  type DiagnosticEventSideEffectState,
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
const sideEffectStates = new Set<DiagnosticEventSideEffectState>([
  'committed',
  'none',
  'rolledBack',
  'unknown',
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      'appVersion',
      'buildRevision',
      'category',
      'cipherName',
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
      'peerCertificateFingerprint256',
      'retryable',
      'runtimeInstanceId',
      'sideEffectState',
      'stage',
      'smtpProfile',
      'tlsVersion',
    ]) ||
    !isOptionalVersion(value.appVersion) ||
    !isOptionalBuildRevision(value.buildRevision) ||
    !isSafeIdentifier(value.category, 100) ||
    !isOptionalSafeIdentifier(value.cipherName, 100) ||
    !isMember(value.component, components) ||
    !isOptionalUuid(value.correlationId) ||
    !isOptionalNonNegativeInteger(value.durationMs) ||
    !isMember(value.eventName, eventNames) ||
    !isOptionalSafeIdentifier(value.fingerprint, 300) ||
    !isSafeIdentifier(value.id, 240) ||
    !isMember(value.level, levels) ||
    !isTimestamp(value.occurredAt) ||
    !isOptionalSafeIdentifier(value.operationId, 300) ||
    !isMember(value.outcome, outcomes) ||
    !isOptionalCertificateFingerprint256(
      value.peerCertificateFingerprint256,
    ) ||
    !isOptionalBoolean(value.retryable) ||
    !isOptionalUuid(value.runtimeInstanceId) ||
    !isOptionalMember(value.sideEffectState, sideEffectStates) ||
    !isOptionalSafeIdentifier(value.stage, 300) ||
    !isOptionalExactValue(value.smtpProfile, 'dnaSmtp') ||
    !isOptionalTlsVersion(value.tlsVersion) ||
    !isNullableSafeIdentifier(value.errorCode, 120)
  ) {
    throw invalidResponse(value);
  }

  return {
    ...(value.appVersion === undefined
      ? {}
      : { appVersion: value.appVersion }),
    ...(value.buildRevision === undefined
      ? {}
      : { buildRevision: value.buildRevision }),
    category: value.category,
    ...(value.cipherName === undefined
      ? {}
      : { cipherName: value.cipherName }),
    component: value.component,
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
    level: value.level,
    occurredAt: value.occurredAt,
    ...(value.operationId === undefined
      ? {}
      : { operationId: value.operationId }),
    outcome: value.outcome,
    ...(value.peerCertificateFingerprint256 === undefined
      ? {}
      : {
          peerCertificateFingerprint256:
            value.peerCertificateFingerprint256,
        }),
    ...(value.retryable === undefined
      ? {}
      : { retryable: value.retryable }),
    ...(value.runtimeInstanceId === undefined
      ? {}
      : { runtimeInstanceId: value.runtimeInstanceId }),
    ...(value.sideEffectState === undefined
      ? {}
      : { sideEffectState: value.sideEffectState }),
    ...(value.stage === undefined ? {} : { stage: value.stage }),
    ...(value.smtpProfile === undefined
      ? {}
      : { smtpProfile: value.smtpProfile }),
    ...(value.tlsVersion === undefined
      ? {}
      : { tlsVersion: value.tlsVersion }),
  };
}

function isOptionalCertificateFingerprint256(
  value: unknown,
): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))
  );
}

function isOptionalExactValue<Value extends string>(
  value: unknown,
  expected: Value,
): value is Value | undefined {
  return value === undefined || value === expected;
}

function isOptionalTlsVersion(
  value: unknown,
): value is 'TLSv1.2' | 'TLSv1.3' | undefined {
  return (
    value === undefined ||
    value === 'TLSv1.2' ||
    value === 'TLSv1.3'
  );
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
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

function isOptionalMember<Value extends string>(
  value: unknown,
  values: ReadonlySet<Value>,
): value is Value | undefined {
  return value === undefined || isMember(value, values);
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

function isOptionalUuid(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && uuidPattern.test(value))
  );
}

function isOptionalVersion(value: unknown): value is string | undefined {
  return value === undefined || isVersion(value);
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

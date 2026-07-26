import { EkyApiError, isRecord } from '../http.js';
import {
  diagnosticEventNames,
  type DiagnosticEventComponent,
  type DiagnosticEventItem,
  type DiagnosticEventLevel,
  type DiagnosticEventName,
  type DiagnosticEventOutcome,
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


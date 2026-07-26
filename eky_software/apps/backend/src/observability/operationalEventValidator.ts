import {
  backendOperationalEventSpecs,
  backendRequiredPayloadFields,
  type BackendOperationalEvent,
  type BackendOperationalEventName,
  type OperationalSideEffectState,
} from './operationalEvent.js';

const coreFields = new Set([
  'appVersion',
  'category',
  'component',
  'eventId',
  'eventName',
  'level',
  'outcome',
  'schemaVersion',
  'timestamp',
]);
const forbiddenKeyPattern =
  /(password|secret|token|cookie|authorization|encryptionkey|requestbody|responsebody|mime|emailbody|iban|connectionstring|stack|message|details)/i;
const emailPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const ibanPattern = /\b[A-Z]{2}\s*\d{2}(?:[\s-]*[A-Z0-9]){11,30}\b/i;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/i;
const windowsUserPathPattern = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/i;
const finnishPersonalIdentityCodePattern =
  /\b\d{6}[+-A]\d{3}[0-9A-Y]\b/i;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumEventBytes = 16 * 1024;
const maximumStringLength = 300;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/g;
const identifierPattern = /^[A-Za-z0-9._:-]+$/;
const sideEffectStates = new Set<OperationalSideEffectState>([
  'committed',
  'none',
  'rolledBack',
  'unknown',
]);

export class OperationalEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationalEventValidationError';
  }
}

export function validateBackendOperationalEvent(
  value: unknown,
): BackendOperationalEvent {
  if (value instanceof Error || !isRecord(value)) {
    throw new OperationalEventValidationError(
      'Operational event must be a plain object.',
    );
  }

  assertNoForbiddenKeys(value);
  const eventName = readEventName(value.eventName);
  const spec = backendOperationalEventSpecs[eventName];
  const allowedFields = new Set([...coreFields, ...spec.payloadFields]);

  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new OperationalEventValidationError(
        'Operational event contains an unsupported field.',
      );
    }
  }

  const normalized = normalizeRecord(value);

  if (
    normalized.schemaVersion !== 1 ||
    normalized.component !== 'backend' ||
    normalized.category !== spec.category ||
    normalized.level !== spec.level ||
    normalized.outcome !== spec.outcome ||
    !isSafeIdentifier(normalized.eventId) ||
    !isSafeVersion(normalized.appVersion) ||
    typeof normalized.timestamp !== 'string' ||
    !isoTimestampPattern.test(normalized.timestamp) ||
    Number.isNaN(Date.parse(normalized.timestamp))
  ) {
    throw new OperationalEventValidationError(
      'Operational event core fields are invalid.',
    );
  }

  validatePayload(normalized, spec.payloadFields);
  assertRequiredPayloadFields(
    normalized,
    backendRequiredPayloadFields[eventName],
  );

  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > maximumEventBytes) {
    throw new OperationalEventValidationError(
      'Operational event exceeds the maximum size.',
    );
  }

  return Object.freeze(normalized) as BackendOperationalEvent;
}

function assertRequiredPayloadFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (value[field] === undefined) {
      throw new OperationalEventValidationError(
        'Operational event is missing a required field.',
      );
    }
  }
}

function validatePayload(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const fieldValue = value[field];

    if (fieldValue === undefined) {
      continue;
    }

    if (
      field === 'durationMs' ||
      field === 'deletedByteCount' ||
      field === 'deletedFileCount'
    ) {
      if (
        typeof fieldValue !== 'number' ||
        !Number.isSafeInteger(fieldValue) ||
        fieldValue < 0
      ) {
        throw new OperationalEventValidationError(
          'Operational event numeric field is invalid.',
        );
      }
      continue;
    }

    if (field === 'retryable') {
      if (typeof fieldValue !== 'boolean') {
        throw new OperationalEventValidationError(
          'Operational event retryable field is invalid.',
        );
      }
      continue;
    }

    if (field === 'sideEffectState') {
      if (
        typeof fieldValue !== 'string' ||
        !sideEffectStates.has(fieldValue as OperationalSideEffectState)
      ) {
        throw new OperationalEventValidationError(
          'Operational event side-effect state is invalid.',
        );
      }
      continue;
    }

    if (field === 'correlationId') {
      if (typeof fieldValue !== 'string' || !uuidPattern.test(fieldValue)) {
        throw new OperationalEventValidationError(
          'Operational event correlation id is invalid.',
        );
      }
      continue;
    }

    if (
      field === 'oldestRemainingMonth' &&
      (typeof fieldValue !== 'string' || !monthPattern.test(fieldValue))
    ) {
      throw new OperationalEventValidationError(
        'Operational event month is invalid.',
      );
    }

    if (
      field !== 'oldestRemainingMonth' &&
      (typeof fieldValue !== 'string' || !isSafeText(fieldValue))
    ) {
      throw new OperationalEventValidationError(
        'Operational event text field is invalid.',
      );
    }
  }
}

function normalizeRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    normalized[key] =
      typeof fieldValue === 'string'
        ? sanitizeOperationalText(fieldValue)
        : fieldValue;
  }

  return normalized;
}

export function sanitizeOperationalText(value: string): string {
  return value.replace(controlCharacterPattern, '').trim();
}

function isSafeText(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumStringLength &&
    identifierPattern.test(value) &&
    !emailPattern.test(value) &&
    !ibanPattern.test(value) &&
    !bearerPattern.test(value) &&
    !finnishPersonalIdentityCodePattern.test(value) &&
    !windowsUserPathPattern.test(value)
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    identifierPattern.test(value)
  );
}

function isSafeVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9.+_-]+$/.test(value)
  );
}

function readEventName(value: unknown): BackendOperationalEventName {
  if (
    typeof value !== 'string' ||
    !(value in backendOperationalEventSpecs)
  ) {
    throw new OperationalEventValidationError(
      'Operational event name is unsupported.',
    );
  }

  return value as BackendOperationalEventName;
}

function assertNoForbiddenKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (forbiddenKeyPattern.test(key)) {
      throw new OperationalEventValidationError(
        'Operational event contains a forbidden field.',
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

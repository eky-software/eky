import {
  desktopOperationalEventSpecs,
  desktopRequiredPayloadFields,
  type DesktopOperationalEvent,
  type DesktopOperationalEventName,
} from './desktopOperationalEvent.js';

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
const sensitiveValuePatterns = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /\b[A-Z]{2}\s*\d{2}(?:[\s-]*[A-Z0-9]){11,30}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/i,
  /\b\d{6}[+-A]\d{3}[0-9A-Y]\b/i,
];
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/g;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const maximumEventBytes = 16 * 1024;

export class DesktopOperationalEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopOperationalEventValidationError';
  }
}

export function validateDesktopOperationalEvent(
  value: unknown,
): DesktopOperationalEvent {
  if (value instanceof Error || !isRecord(value)) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event must be a plain object.',
    );
  }

  for (const key of Object.keys(value)) {
    if (forbiddenKeyPattern.test(key)) {
      throw new DesktopOperationalEventValidationError(
        'Desktop operational event contains a forbidden field.',
      );
    }
  }

  const eventName = readEventName(value.eventName);
  const spec = desktopOperationalEventSpecs[eventName];
  const allowedFields = new Set([...coreFields, ...spec.payloadFields]);

  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new DesktopOperationalEventValidationError(
        'Desktop operational event contains an unsupported field.',
      );
    }
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      typeof fieldValue === 'string'
        ? fieldValue.replace(controlCharacterPattern, '').trim()
        : fieldValue,
    ]),
  );

  if (
    normalized.schemaVersion !== 1 ||
    normalized.component !== 'desktop' ||
    normalized.category !== spec.category ||
    normalized.level !== spec.level ||
    normalized.outcome !== spec.outcome ||
    !isIdentifier(normalized.eventId) ||
    !isVersion(normalized.appVersion) ||
    typeof normalized.timestamp !== 'string' ||
    !timestampPattern.test(normalized.timestamp) ||
    Number.isNaN(Date.parse(normalized.timestamp))
  ) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event core fields are invalid.',
    );
  }

  for (const field of spec.payloadFields) {
    validatePayloadValue(field, normalized[field]);
  }
  for (const field of desktopRequiredPayloadFields[eventName]) {
    if (normalized[field] === undefined) {
      throw new DesktopOperationalEventValidationError(
        'Desktop operational event is missing a required field.',
      );
    }
  }

  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > maximumEventBytes) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event exceeds the maximum size.',
    );
  }

  return Object.freeze(normalized) as DesktopOperationalEvent;
}

function validatePayloadValue(field: string, value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (
    field === 'durationMs' ||
    field === 'deletedByteCount' ||
    field === 'deletedFileCount'
  ) {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new DesktopOperationalEventValidationError(
        'Desktop operational event numeric field is invalid.',
      );
    }
    return;
  }

  if (field === 'retryable') {
    if (typeof value !== 'boolean') {
      throw new DesktopOperationalEventValidationError(
        'Desktop operational event retryable field is invalid.',
      );
    }
    return;
  }

  if (
    field === 'sideEffectState' &&
    (typeof value !== 'string' ||
      !['committed', 'none', 'rolledBack', 'unknown'].includes(value))
  ) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event side-effect state is invalid.',
    );
  }

  if (
    field === 'oldestRemainingMonth' &&
    (typeof value !== 'string' || !monthPattern.test(value))
  ) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event month is invalid.',
    );
  }

  if (
    field !== 'sideEffectState' &&
    field !== 'oldestRemainingMonth' &&
    (typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 300 ||
      !/^[A-Za-z0-9._:-]+$/.test(value) ||
      sensitiveValuePatterns.some((pattern) => pattern.test(value)))
  ) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event text field is invalid.',
    );
  }
}

function readEventName(value: unknown): DesktopOperationalEventName {
  if (
    typeof value !== 'string' ||
    !(value in desktopOperationalEventSpecs)
  ) {
    throw new DesktopOperationalEventValidationError(
      'Desktop operational event name is unsupported.',
    );
  }

  return value as DesktopOperationalEventName;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9.+_-]+$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

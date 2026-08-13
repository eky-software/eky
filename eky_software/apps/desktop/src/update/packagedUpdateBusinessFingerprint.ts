import { createHash } from 'node:crypto';

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function createPackagedUpdateBusinessDataSha256(
  value: unknown,
): string {
  const canonicalJson = JSON.stringify(canonicalizeJsonValue(value));

  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

function canonicalizeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJsonValue(value[key])]),
    );
  }

  throw new Error('DESKTOP_UPDATE_SMOKE_BUSINESS_DATA_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

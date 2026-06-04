export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getOptionalStringField(
  body: Record<string, unknown>,
  fieldName: string,
): string {
  const value = body[fieldName];

  if (value === undefined || value === null) {
    return '';
  }

  return typeof value === 'string' ? value : '';
}

export function getStringField(
  body: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = body[fieldName];

  return typeof value === 'string' ? value : undefined;
}

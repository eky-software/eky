export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOnlyAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((fieldName) => allowedFields.has(fieldName));
}

export function readOptionalStringFields<FieldName extends string>(
  body: Record<string, unknown>,
  fieldNames: readonly FieldName[],
): Record<FieldName, string> | null {
  const fields = {} as Record<FieldName, string>;

  for (const fieldName of fieldNames) {
    const value = body[fieldName];

    if (value === undefined || value === null) {
      fields[fieldName] = '';
      continue;
    }
    if (typeof value !== 'string') {
      return null;
    }
    fields[fieldName] = value;
  }

  return fields;
}

export function getStringField(
  body: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = body[fieldName];

  return typeof value === 'string' ? value : undefined;
}

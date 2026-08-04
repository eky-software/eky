export function parseOptionalBoundedPositiveIntegerQuery(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : null;
}

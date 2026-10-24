const diagnosticCursorLength = 32;

export function isDiagnosticCursor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === diagnosticCursorLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

/** A native allocation failure, not an inference from the error's message. */
export function isSqliteMemoryError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && error.code === 'SQLITE_NOMEM';
}

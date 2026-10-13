export class RecoveryPointCleanupError extends Error {
  readonly code: string;
  readonly cleanupStatus = 'unverified';

  constructor(primary: unknown) {
    const code = readSafeRecoveryPointErrorCode(primary);
    super(code, { cause: primary });
    this.code = code;
    this.name = 'RecoveryPointCleanupError';
  }
}

export function readSafeRecoveryPointErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code)
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'RECOVERY_POINT_OPERATION_FAILED';
}

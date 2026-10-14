export type PortableProfileBackupErrorCode =
  | 'PROFILE_BACKUP_BUSY'
  | 'PROFILE_BACKUP_CREATE_FAILED'
  | 'PROFILE_BACKUP_DESTINATION_INVALID'
  | 'PROFILE_BACKUP_INSPECTION_FAILED';

export class PortableProfileBackupError extends Error {
  constructor(
    readonly code: PortableProfileBackupErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'PortableProfileBackupError';
  }
}

export class PortableProfileBackupCleanupError extends PortableProfileBackupError {
  readonly cleanupStatus = 'unverified';

  constructor(primary: unknown) {
    super('PROFILE_BACKUP_CREATE_FAILED', { cause: primary });
    this.name = 'PortableProfileBackupCleanupError';
  }
}

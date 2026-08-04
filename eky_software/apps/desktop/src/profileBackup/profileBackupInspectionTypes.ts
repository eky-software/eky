export type ProfileBackupInspectionErrorCode =
  | 'BACKUP_AUTHENTICATION_FAILED'
  | 'BACKUP_CONTENT_INVALID'
  | 'BACKUP_FILE_INVALID'
  | 'BACKUP_INSPECTION_UNAVAILABLE';

export interface ProfileBackupInspectionSummary {
  appVersion: string;
  compatibilityStatus: 'compatible';
  createdAt: string;
  databaseHealth: 'healthy';
  documentCount: number;
  formatVersion: 1;
  profileMatchStatus: 'different' | 'same';
  totalBusinessByteSize: number;
}

export class ProfileBackupInspectionError extends Error {
  constructor(readonly code: ProfileBackupInspectionErrorCode) {
    super(code);
    this.name = 'ProfileBackupInspectionError';
  }
}

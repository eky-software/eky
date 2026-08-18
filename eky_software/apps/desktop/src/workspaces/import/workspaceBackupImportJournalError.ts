export const WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID =
  'WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID';
export const WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE =
  'WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE';
export const WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY =
  'WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY';

export class WorkspaceBackupImportJournalValidationError extends Error {
  constructor() {
    super(WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID);
    this.name = 'WorkspaceBackupImportJournalValidationError';
  }
}

export class WorkspaceBackupImportJournalStoreError extends Error {
  constructor(
    readonly code:
      | typeof WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE
      | typeof WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY,
  ) {
    super(code);
    this.name = 'WorkspaceBackupImportJournalStoreError';
  }
}

export function workspaceBackupImportJournalInvalid(): never {
  throw new WorkspaceBackupImportJournalValidationError();
}

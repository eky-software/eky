export const WORKSPACE_CREATION_JOURNAL_INVALID =
  'WORKSPACE_CREATION_JOURNAL_INVALID';
export const WORKSPACE_CREATION_JOURNAL_UNAVAILABLE =
  'WORKSPACE_CREATION_JOURNAL_UNAVAILABLE';
export const WORKSPACE_CREATION_JOURNAL_BUSY =
  'WORKSPACE_CREATION_JOURNAL_BUSY';

export class WorkspaceCreationJournalValidationError extends Error {
  constructor() {
    super(WORKSPACE_CREATION_JOURNAL_INVALID);
    this.name = 'WorkspaceCreationJournalValidationError';
  }
}

export class WorkspaceCreationJournalStoreError extends Error {
  constructor(
    readonly code:
      | typeof WORKSPACE_CREATION_JOURNAL_UNAVAILABLE
      | typeof WORKSPACE_CREATION_JOURNAL_BUSY,
  ) {
    super(code);
    this.name = 'WorkspaceCreationJournalStoreError';
  }
}

export function workspaceCreationJournalInvalid(): never {
  throw new WorkspaceCreationJournalValidationError();
}

import type { ProfileRestoreActivationJournal } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import type { UpdateJournal } from './updateJournal.js';

export type StartupRecoveryAuthority =
  | 'none'
  | 'profileRestore'
  | 'updateBusinessRollback';

export class StartupRecoveryAuthorityConflictError extends Error {
  constructor() {
    super('The startup recovery authority is ambiguous.');
    this.name = 'StartupRecoveryAuthorityConflictError';
  }
}

const terminalUpdateStates = new Set<UpdateJournal['state']>([
  'accepted',
  'installerNotApplied',
  'rolledBack',
]);

export function resolveStartupRecoveryAuthority(input: {
  profileRestoreJournal:
    | Readonly<ProfileRestoreActivationJournal>
    | undefined;
  updateJournal: Readonly<UpdateJournal> | undefined;
}): StartupRecoveryAuthority {
  if (input.profileRestoreJournal === undefined) {
    return 'none';
  }

  if (
    input.updateJournal?.state === 'businessRollbackStarting' &&
    input.profileRestoreJournal.operationId ===
      input.updateJournal.correlationId
  ) {
    return 'updateBusinessRollback';
  }

  if (
    input.updateJournal !== undefined &&
    !terminalUpdateStates.has(input.updateJournal.state)
  ) {
    throw new StartupRecoveryAuthorityConflictError();
  }

  return 'profileRestore';
}

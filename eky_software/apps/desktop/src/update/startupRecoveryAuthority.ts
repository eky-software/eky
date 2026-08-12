import type { ProfileRestoreActivationJournal } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import type { DirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import type { UpdateJournal } from './updateJournal.js';

export type StartupRecoveryAuthority =
  | 'none'
  | 'directSetupBusinessRollback'
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
const terminalDirectSetupStates = new Set<DirectSetupMigrationRecovery['state']>([
  'accepted',
]);

export function resolveStartupRecoveryAuthority(input: {
  directSetupRecovery:
    | Readonly<DirectSetupMigrationRecovery>
    | undefined;
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
    input.directSetupRecovery?.state === 'businessRollbackStarting' &&
    input.profileRestoreJournal.operationId ===
      input.directSetupRecovery.correlationId
  ) {
    return 'directSetupBusinessRollback';
  }

  if (
    input.updateJournal !== undefined &&
    !terminalUpdateStates.has(input.updateJournal.state)
  ) {
    throw new StartupRecoveryAuthorityConflictError();
  }

  if (
    input.directSetupRecovery !== undefined &&
    !terminalDirectSetupStates.has(input.directSetupRecovery.state)
  ) {
    throw new StartupRecoveryAuthorityConflictError();
  }

  return 'profileRestore';
}

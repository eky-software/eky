import type { ProfileRestoreActivationJournal } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import type { UpdateJournal } from './updateJournal.js';

export type StartupRecoveryAuthority =
  | 'none'
  | 'profileRestore'
  | 'updateBusinessRollback'
  | 'workspaceReplacement';

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

export function isTerminalUpdateJournalState(
  state: UpdateJournal['state'],
): boolean {
  return terminalUpdateStates.has(state);
}

export function resolveStartupRecoveryAuthority(input: {
  profileRestoreJournal:
    | Readonly<ProfileRestoreActivationJournal>
    | undefined;
  updateJournal: Readonly<UpdateJournal> | undefined;
  workspaceReplacementRecoveryPending: boolean;
}): StartupRecoveryAuthority {
  const hasNonterminalUpdate =
    input.updateJournal !== undefined &&
    !isTerminalUpdateJournalState(input.updateJournal.state);

  if (input.workspaceReplacementRecoveryPending) {
    if (
      input.profileRestoreJournal !== undefined ||
      hasNonterminalUpdate
    ) {
      throw new StartupRecoveryAuthorityConflictError();
    }
    return 'workspaceReplacement';
  }

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

  if (hasNonterminalUpdate) {
    throw new StartupRecoveryAuthorityConflictError();
  }

  return 'profileRestore';
}

import type { ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';

export type ProfileRestoreOriginalRecoverySlot = 'active' | 'rollback' | 'absent';

interface ProfileRestoreRollbackRecoverySlot {
  readonly activePresent: boolean;
  readonly rollbackPresent: boolean;
  readonly stagedPresent: boolean;
  readonly failedPresent: boolean;
}

/** Retained target evidence distinguishes a restored original from a new active slot. */
export function readProfileRestoreRollbackRecoverySlot(input: {
  readonly phase: ProfileRestoreActivationPhase;
  readonly hadActive: boolean;
  readonly slots: ProfileRestoreRollbackRecoverySlot;
}): ProfileRestoreOriginalRecoverySlot {
  const { activePresent, rollbackPresent, stagedPresent, failedPresent } = input.slots;
  if (input.phase !== 'rollbackStarting' && input.phase !== 'rolledBack') {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
  let original: ProfileRestoreOriginalRecoverySlot;
  if (input.hadActive) {
    if (stagedPresent !== failedPresent && activePresent !== rollbackPresent) {
      original = activePresent ? 'active' : 'rollback';
    } else if (activePresent && rollbackPresent && !stagedPresent && !failedPresent) {
      original = 'rollback';
    } else {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
  } else {
    if (rollbackPresent || Number(activePresent) + Number(stagedPresent) + Number(failedPresent) !== 1) {
      throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    }
    original = 'absent';
  }
  if (input.phase === 'rolledBack' && (rollbackPresent || activePresent !== input.hadActive)) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
  return original;
}

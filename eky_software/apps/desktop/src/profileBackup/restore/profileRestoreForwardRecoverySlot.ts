import {
  profileRestoreForwardActivationPhases,
  type ProfileRestoreActivationPhase,
} from './profileRestoreActivationJournal.js';

interface ProfileRestoreForwardRecoverySlot {
  readonly activePresent: boolean;
  readonly rollbackPresent: boolean;
  readonly stagedPresent: boolean;
}

const slotPhases = {
  database: {
    movingCurrent: 'movingCurrentDatabase',
    activatingStaged: 'activatingStagedDatabase',
  },
  documents: {
    movingCurrent: 'movingCurrentDocuments',
    activatingStaged: 'activatingStagedDocuments',
  },
} as const;

/** An intent can be interrupted on either side of rename, never in both slots. */
export function readProfileRestoreForwardRecoverySlot(input: {
  readonly phase: ProfileRestoreActivationPhase;
  readonly kind: keyof typeof slotPhases;
  readonly hadActive: boolean;
  readonly slots: ProfileRestoreForwardRecoverySlot;
}): 'active' | 'staged' {
  const phases: readonly ProfileRestoreActivationPhase[] = profileRestoreForwardActivationPhases;
  const current = phases.indexOf(input.phase);
  if (current < 0) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  const movingCurrent = phases.indexOf(slotPhases[input.kind].movingCurrent);
  const activatingStaged = phases.indexOf(slotPhases[input.kind].activatingStaged);
  const { activePresent, rollbackPresent, stagedPresent } = input.slots;
  let valid: boolean;
  if (current < movingCurrent) {
    valid = activePresent === input.hadActive && !rollbackPresent && stagedPresent;
  } else if (current === movingCurrent) {
    valid = Number(activePresent) + Number(rollbackPresent) === Number(input.hadActive) && stagedPresent;
  } else if (current < activatingStaged) {
    valid = !activePresent && rollbackPresent === input.hadActive && stagedPresent;
  } else if (current === activatingStaged) {
    valid = activePresent !== stagedPresent && rollbackPresent === input.hadActive;
  } else {
    valid = activePresent && !stagedPresent && rollbackPresent === input.hadActive;
  }
  if (!valid) throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  return current >= activatingStaged && activePresent ? 'active' : 'staged';
}

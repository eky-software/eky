import { describe, expect, it } from 'vitest';

import type { ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';
import { readProfileRestoreRollbackRecoverySlot } from './profileRestoreRollbackRecoverySlot.js';

const statesWithOriginal = [
  { slots: [true, false, true, false], original: 'active' },
  { slots: [false, true, true, false], original: 'rollback' },
  { slots: [true, true, false, false], original: 'rollback' },
  { slots: [false, true, false, true], original: 'rollback' },
  { slots: [true, false, false, true], original: 'active' },
] as const;
const statesWithoutOriginal = [
  { slots: [false, false, true, false], original: 'absent' },
  { slots: [true, false, false, false], original: 'absent' },
  { slots: [false, false, false, true], original: 'absent' },
] as const;

describe('interrupted rollback slot selection', () => {
  it.each([true, false])('checks every presence combination against retained-target rules (hadActive=%s)', hadActive => {
    const allowed = hadActive ? statesWithOriginal : statesWithoutOriginal;
    for (const activePresent of [false, true]) {
      for (const rollbackPresent of [false, true]) {
        for (const stagedPresent of [false, true]) {
          for (const failedPresent of [false, true]) {
            const values = [activePresent, rollbackPresent, stagedPresent, failedPresent];
            const expected = allowed.find(state => state.slots.every((value, index) => value === values[index]));
            const slots = { activePresent, rollbackPresent, stagedPresent, failedPresent };
            for (const phase of ['rollbackStarting', 'rolledBack'] as const) {
              const read = () => readProfileRestoreRollbackRecoverySlot({ phase, hadActive, slots });
              const terminalAllowed = phase === 'rollbackStarting' || (!rollbackPresent && activePresent === hadActive);
              if (expected !== undefined && terminalAllowed) expect(read()).toBe(expected.original);
              else expect(read).toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
            }
          }
        }
      }
    }
  });

  it.each(['prepared', 'validationStarting', 'accepted', 'failedSafe'] satisfies ProfileRestoreActivationPhase[])(
    'does not give rollback selection to %s', phase => {
      expect(() => readProfileRestoreRollbackRecoverySlot({
        phase, hadActive: true,
        slots: { activePresent: true, rollbackPresent: false, stagedPresent: true, failedPresent: false },
      })).toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    },
  );
});

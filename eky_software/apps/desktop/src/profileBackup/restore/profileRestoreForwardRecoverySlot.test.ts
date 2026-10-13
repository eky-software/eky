import { describe, expect, it } from 'vitest';

import type { ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';
import { readProfileRestoreForwardRecoverySlot } from './profileRestoreForwardRecoverySlot.js';

type SlotStage = 'original' | 'movingOriginal' | 'originalMoved' | 'activating' | 'activated';
const cases: readonly [ProfileRestoreActivationPhase, SlotStage, SlotStage][] = [
  ['prepared', 'original', 'original'],
  ['movingCurrentDatabase', 'movingOriginal', 'original'],
  ['currentDatabaseMoved', 'originalMoved', 'original'],
  ['movingCurrentDocuments', 'originalMoved', 'movingOriginal'],
  ['currentDocumentsMoved', 'originalMoved', 'originalMoved'],
  ['activatingStagedDatabase', 'activating', 'originalMoved'],
  ['stagedDatabaseActivated', 'activated', 'originalMoved'],
  ['activatingStagedDocuments', 'activated', 'activating'],
  ['stagedDocumentsActivated', 'activated', 'activated'],
  ['validationStarting', 'activated', 'activated'],
];
const validStates: Record<SlotStage, readonly [readonly string[], readonly string[]]> = {
  original: [['001'], ['101']],
  movingOriginal: [['001'], ['101', '011']],
  originalMoved: [['001'], ['011']],
  activating: [['001', '100'], ['011', '110']],
  activated: [['100'], ['110']],
};

describe('profile restore forward recovery slot', () => {
  for (const [phase, databaseStage, documentsStage] of cases) {
    for (const kind of ['database', 'documents'] as const) {
      it.each([false, true])(`checks all slot states at ${phase} for ${kind}, hadActive=%s`, (hadActive) => {
        const stage = kind === 'database' ? databaseStage : documentsStage;
        for (const state of ['000', '001', '010', '011', '100', '101', '110', '111']) {
          const read = () => readProfileRestoreForwardRecoverySlot({
            phase, kind, hadActive,
            slots: { activePresent: state[0] === '1', rollbackPresent: state[1] === '1',
              stagedPresent: state[2] === '1' },
          });
          if (!validStates[stage][Number(hadActive)]!.includes(state)) {
            expect(read, state).toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
          } else {
            expect(read(), state).toBe((stage === 'activating' || stage === 'activated') &&
              state[0] === '1' ? 'active' : 'staged');
          }
        }
      });
    }
  }

  it.each(['accepted', 'rollbackStarting', 'rolledBack', 'failedSafe'] as const)(
    'does not give forward authority to %s', (phase) => {
      expect(() => readProfileRestoreForwardRecoverySlot({
        phase, kind: 'database', hadActive: true,
        slots: { activePresent: true, rollbackPresent: true, stagedPresent: false },
      })).toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    },
  );
});

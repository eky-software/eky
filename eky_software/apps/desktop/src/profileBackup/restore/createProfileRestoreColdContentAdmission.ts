import { join } from 'node:path';

import { parseProfileInspectionColdSources, type ProfileInspectionDeployment } from '../../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from '../inspectOwnedEncryptedProfileBackup.js';
import { assertProfileRestoreColdSourceBytes } from './assertProfileRestoreColdSourceBytes.js';
import { assertProfileRestoreContentMatches } from './profileRestoreContentIdentity.js';
import {
  assertProfileRestoreActivationJournalMatches, captureProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import type { ProfileRestoreColdContentContext } from './prepareProfileRestoreColdForwardRecovery.js';
import { runProfileRestoreColdInspection, type ProfileRestoreColdInspectionResult } from './runProfileRestoreColdInspection.js';

/** One forward operation's immutable content; fresh census and bytes still gate every mutation. */
export function createProfileRestoreColdContentAdmission(input: {
  readonly operationId: string;
  readonly workspaceRoot: string;
  readonly stagingRoot: string;
  readonly runnerPath: string;
  readonly deployment: ProfileInspectionDeployment;
  readonly journalStore: Pick<ProfileRestoreActivationJournalStore, 'peek'>;
  readonly transaction: Pick<ProfileRestoreActivationTransaction, 'readForwardRecoverySources'>;
  readonly assertLineage: (profileId: string) => void;
  readonly inspect?: typeof runProfileRestoreColdInspection;
}) {
  let initial: ProfileRestoreColdInspectionResult | undefined;
  let selected: ProfileRestoreColdInspectionResult | undefined;
  return async (context: ProfileRestoreColdContentContext): Promise<void> => {
    const journal = captureProfileRestoreActivationJournal(context.journal);
    if (journal.operationId !== input.operationId) throw invalid();
    const read = async <T>(task: () => Promise<T>): Promise<T> => {
      context.assertAuthority();
      context.reservation.assertMainCurrent();
      let settled = false;
      const pending = Promise.resolve().then(task).finally(() => { settled = true; });
      try {
        const value = await waitForInspectionPhase(pending, context.signal);
        context.assertAuthority();
        context.reservation.assertMainCurrent();
        return value;
      } finally {
        // A late main read is not permission to release or discard the operation.
        if (!settled) context.reservation.invalidate();
      }
    };
    const readSources = async () => {
      await context.assertCurrent();
      assertProfileRestoreActivationJournalMatches(journal, await read(() => input.journalStore.peek()));
      const slots = await read(() => input.transaction.readForwardRecoverySources(journal));
      await context.assertCurrent();
      const sources = parseProfileInspectionColdSources({ workspaceRoot: input.workspaceRoot, ...slots });
      if (sources === undefined) throw invalid();
      return sources;
    };
    let sources = await readSources();
    if (selected === undefined || selected.receipt.databaseSlot !== sources.databaseSlot ||
        selected.receipt.documentsSlot !== sources.documentsSlot) {
      const result = await (input.inspect ?? runProfileRestoreColdInspection)({
        operationId: input.operationId, runnerPath: input.runnerPath, deployment: input.deployment,
        reservation: context.reservation, assertAuthority: context.assertAuthority,
        assertLineage: input.assertLineage, readSources, signal: context.signal, deadline: context.deadline,
      });
      if (initial !== undefined) assertProfileRestoreContentMatches(initial, result);
      initial ??= result;
      selected = result;
    }
    sources = await readSources();
    if (selected.receipt.databaseSlot !== sources.databaseSlot || selected.receipt.documentsSlot !== sources.documentsSlot) throw invalid();
    input.assertLineage(selected.receipt.profileId);
    await context.assertCurrent();
    input.assertLineage(selected.receipt.profileId);
    await read(() => assertProfileRestoreColdSourceBytes({
      operationRoot: join(input.stagingRoot, input.operationId), sources, result: selected!,
      signal: context.signal, deadline: context.deadline, assertAuthority() {
        context.assertAuthority();
        context.reservation.assertMainCurrent();
      },
      async assertFinalAuthority() {
        const current = await readSources();
        if (current.databaseSlot !== sources.databaseSlot || current.documentsSlot !== sources.documentsSlot) throw invalid();
        input.assertLineage(selected!.receipt.profileId);
        await context.assertCurrent();
        input.assertLineage(selected!.receipt.profileId);
      },
    }));
    context.assertAuthority();
  };
}

function invalid(): Error { return new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); }

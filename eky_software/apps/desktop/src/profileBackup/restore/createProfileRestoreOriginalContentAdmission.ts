import { join } from 'node:path';

import {
  decodeProfileInspectionDocumentBindings, encodeProfileInspectionDocumentBindings,
} from '../../runtime/profileInspectionDocumentBindings.js';
import {
  parseProfileInspectionOriginalSources, parseProfileInspectionStatus, type ProfileInspectionDeployment,
  type ProfileInspectionOriginalSources,
} from '../../runtime/profileInspectionMessages.js';
import { waitForInspectionPhase } from '../inspectOwnedEncryptedProfileBackup.js';
import { assertProfileRestoreOriginalSourceBytes } from './assertProfileRestoreColdSourceBytes.js';
import { assertProfileRestoreContentMatches } from './profileRestoreContentIdentity.js';
import {
  assertProfileRestoreActivationJournalMatches, captureProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationJournalStore } from './profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import type { ProfileRestoreColdContentContext } from './prepareProfileRestoreColdForwardRecovery.js';
import { runProfileRestoreOriginalInspection, type ProfileRestoreOriginalInspectionResult } from './runProfileRestoreOriginalInspection.js';

/** Original content stays bound across rollback moves; target/forward receipts cannot grant it. */
export function createProfileRestoreOriginalContentAdmission(input: {
  readonly operationId: string;
  readonly workspaceRoot: string;
  readonly failedRoot: string;
  readonly layout: ProfileInspectionOriginalSources['layout'];
  readonly runnerPath: string;
  readonly deployment: ProfileInspectionDeployment;
  readonly journalStore: Pick<ProfileRestoreActivationJournalStore, 'peek'>;
  readonly transaction: Pick<ProfileRestoreActivationTransaction, 'readRollbackRecoverySources'>;
  readonly assertLineage: (profileId: string) => void;
  readonly inspect?: typeof runProfileRestoreOriginalInspection;
}) {
  let initial: ProfileRestoreOriginalInspectionResult | undefined;
  let selected: ProfileRestoreOriginalInspectionResult | undefined;
  return async (context: ProfileRestoreColdContentContext): Promise<void> => {
    const journal = captureProfileRestoreActivationJournal(context.journal);
    if (journal.operationId !== input.operationId || (journal.phase !== 'validationStarting' &&
        journal.phase !== 'rollbackStarting' && journal.phase !== 'rolledBack')) throw invalid();
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
      } finally { if (!settled) context.reservation.invalidate(); }
    };
    const readSources = async () => {
      await context.assertCurrent();
      assertProfileRestoreActivationJournalMatches(journal, await read(() => input.journalStore.peek()));
      const slots = await read(() => input.transaction.readRollbackRecoverySources(journal));
      await context.assertCurrent();
      const sources = parseProfileInspectionOriginalSources({ workspaceRoot: input.workspaceRoot, layout: input.layout, ...slots });
      if (sources === undefined) throw invalid();
      return sources;
    };
    let sources = await readSources();
    if (selected === undefined || selected.status.result.databaseSlot !== sources.databaseSlot ||
        selected.status.result.documentsSlot !== sources.documentsSlot) {
      const returned = await (input.inspect ?? runProfileRestoreOriginalInspection)({
        operationId: input.operationId, runnerPath: input.runnerPath, deployment: input.deployment,
        reservation: context.reservation, assertAuthority: context.assertAuthority,
        assertLineage: input.assertLineage, readSources, signal: context.signal, deadline: context.deadline,
      });
      const status = parseProfileInspectionStatus(returned.status);
      if (status?.type !== 'originalCompleted' || status.operationId !== input.operationId || status.result.layout !== input.layout ||
          status.result.databaseSlot !== sources.databaseSlot || status.result.documentsSlot !== sources.documentsSlot) throw invalid();
      const receipt = status.result;
      if (receipt.databaseSlot !== 'absent' && returned.documents === undefined) throw invalid();
      const result: ProfileRestoreOriginalInspectionResult = receipt.databaseSlot === 'absent'
        ? Object.freeze({ status })
        : Object.freeze({ status, documents: decodeProfileInspectionDocumentBindings(
            encodeProfileInspectionDocumentBindings(returned.documents ?? []), receipt) });
      if (receipt.databaseSlot === 'absent' && returned.documents !== undefined) throw invalid();
      if (initial !== undefined) {
        const first = initial.status.result;
        if (first.databaseSlot === 'absent' || receipt.databaseSlot === 'absent') {
          if (first.databaseSlot !== 'absent' || receipt.databaseSlot !== 'absent') throw invalid();
        } else {
          assertProfileRestoreContentMatches({ receipt: first, documents: initial.documents! },
            { receipt, documents: result.documents! });
        }
      }
      initial ??= result;
      selected = result;
    }
    sources = await readSources();
    const receipt = selected.status.result;
    if (receipt.databaseSlot !== sources.databaseSlot || receipt.documentsSlot !== sources.documentsSlot) throw invalid();
    const assertLineage = () => { if (receipt.databaseSlot !== 'absent') input.assertLineage(receipt.profileId); };
    assertLineage();
    await context.assertCurrent();
    assertLineage();
    await read(() => assertProfileRestoreOriginalSourceBytes({
      operationRoot: join(input.failedRoot, input.operationId), sources, result: selected!,
      signal: context.signal, deadline: context.deadline,
      assertAuthority() { context.assertAuthority(); context.reservation.assertMainCurrent(); },
      async assertFinalAuthority() {
        const current = await readSources();
        if (current.databaseSlot !== sources.databaseSlot || current.documentsSlot !== sources.documentsSlot) throw invalid();
        assertLineage();
        await context.assertCurrent();
        assertLineage();
      },
    }));
    context.assertAuthority();
  };
}

function invalid(): Error { return new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); }

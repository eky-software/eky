import type { UpdateJournalState } from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';

const protectedStates: ReadonlySet<UpdateJournalState> = new Set([
  'recoveryPointValidated',
  'runtimeStopping',
  'awaitingFirstStart',
  'firstStartValidating',
  'rollbackRequired',
]);

export async function readUpdateProtectedRecoveryPointReferences(
  store: Pick<UpdateJournalStore, 'read'>,
): Promise<readonly string[]> {
  const journal = await store.read();
  if (
    journal === undefined ||
    !protectedStates.has(journal.state) ||
    journal.recoveryPointReference === undefined
  ) {
    return [];
  }
  return [journal.recoveryPointReference];
}

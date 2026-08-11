import type { UpdateJournalState } from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';
import type { DirectSetupMigrationRecoveryStore } from './directSetupMigrationRecoveryStore.js';

const protectedStates: ReadonlySet<UpdateJournalState> = new Set([
  'recoveryPointValidated',
  'runtimeStopping',
  'awaitingFirstStart',
  'firstStartValidating',
  'rollbackRequired',
]);

export async function readUpdateProtectedRecoveryPointReferences(
  store: Pick<UpdateJournalStore, 'read'>,
  directSetupStore?: Pick<DirectSetupMigrationRecoveryStore, 'read'>,
): Promise<readonly string[]> {
  const [journal, directSetupRecovery] = await Promise.all([
    store.read(),
    directSetupStore?.read(),
  ]);
  return [
    ...(journal !== undefined &&
    protectedStates.has(journal.state) &&
    journal.recoveryPointReference !== undefined
      ? [journal.recoveryPointReference]
      : []),
    ...(directSetupRecovery === undefined
      ? []
      : [directSetupRecovery.recoveryPointReference]),
  ].filter((reference, index, references) =>
    references.indexOf(reference) === index,
  );
}

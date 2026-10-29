import { join } from 'node:path';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import { CrashSafeByteSlotStore } from '../persistence/crashSafeByteSlotStore.js';
import { parseWorkspaceBackupImportJournalBytes } from './workspaceBackupImportJournalBytes.js';
import { createNodeWorkspaceBackupImportJournalFileSystem } from './workspaceBackupImportJournalFileSystem.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from './workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { validateWorkspaceBackupImportJournal } from './workspaceBackupImportJournalValidation.js';

// Readonly admission only: recovery still owns its lease, exact slots and runtime proof.
export async function inspectWorkspaceBackupImportBindingAdmission(userDataRoot: string, value: unknown): Promise<'unbound' | 'bound'> {
  try {
    const journal = validateWorkspaceBackupImportJournal(value);
    if (journal.formatVersion !== 2) throw new WorkspaceManagementRecoveryRequiredError();
    const expected = Buffer.from(serializeWorkspaceBackupImportJournal(journal));
    const journalStore = new CrashSafeByteSlotStore(createNodeWorkspaceBackupImportJournalFileSystem(
      createWorkspaceBackupImportJournalPaths(userDataRoot, join(userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)),
    ));
    const assertJournalSelected = async () => {
      const actual = (await journalStore.inspect(parseWorkspaceBackupImportJournalBytes))?.value;
      if (actual === undefined || !expected.equals(Buffer.from(serializeWorkspaceBackupImportJournal(actual)))) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
    };
    const store = new WorkspaceRemnantBindingStore(userDataRoot, { owner: 'workspaceImport', operationId: journal.operationId });
    const observed = await store.inspect({ assertAuthority() {}, assertExternalSelection: assertJournalSelected });
    if (observed.mode === 'absent') return 'unbound';
    const binding = observed.value;
    if (binding.owner !== 'workspaceImport' || binding.operationId !== journal.operationId || binding.workspaceId !== journal.workspaceId ||
        (journal.lineageIdentity !== null && binding.lineageIdentity.profileId !== journal.lineageIdentity.profileId)) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    return 'bound';
  } catch (error) {
    if (error instanceof WorkspaceManagementRecoveryRequiredError) throw error;
    throw new WorkspaceManagementRecoveryRequiredError();
  }
}

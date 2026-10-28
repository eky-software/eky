import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import type { BackupPasswordWindowController } from './passwordWindow/backupPasswordWindow.js';
import { createPortableProfileBackupFileName, ensurePortableProfileBackupExtension, type DeletionBackupPreparationOwner,
  type PortableProfileBackupService } from './portableProfileBackup.js';
import { readDeletionBackupExportIdentity } from './readDeletionBackupExportIdentity.js';

interface DeletionBackupExportOptions {
  backupService: Pick<PortableProfileBackupService, 'createForDeletion'>;
  passwordWindow: Pick<BackupPasswordWindowController, 'requestPassword'>;
  readActiveWorkspaceLabel(): Promise<string | undefined>;
  selectBackupTarget(defaultFileName: string): Promise<string | null>;
}

/** One admitted export; only the selected path and its live guard survive it. */
export function createDeletionBackupExport(options: Readonly<DeletionBackupExportOptions>) {
  let started = false;
  let selected: { path: string; assertCurrent(): void } | undefined;
  return {
    async createBackup(owner: DeletionBackupPreparationOwner) {
      if (started) throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
      started = true;
      const guard = () => assertUpdateJournalAuthority(owner.assertValid.bind(owner));
      const assertCurrent = async () => { guard(); await owner.assertCurrent(); guard(); };
      await assertCurrent();
      const label = await options.readActiveWorkspaceLabel();
      await assertCurrent();
      if (label === undefined) throw new Error('WORKSPACE_DELETE_BACKUP_OWNER_UNAVAILABLE');
      const path = await options.selectBackupTarget(createPortableProfileBackupFileName(new Date(), label));
      await assertCurrent();
      if (path === null) return null;
      const destinationPath = ensurePortableProfileBackupExtension(path);
      const password = await options.passwordWindow.requestPassword('create');
      await assertCurrent();
      if (password === null) return null;
      const content = await options.backupService.createForDeletion({ destinationPath, password }, owner);
      await assertCurrent();
      selected = { path: destinationPath, assertCurrent: guard };
      return content;
    },
    async recheckExport() {
      if (selected === undefined) throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
      return readDeletionBackupExportIdentity(selected.path, selected.assertCurrent);
    },
  };
}

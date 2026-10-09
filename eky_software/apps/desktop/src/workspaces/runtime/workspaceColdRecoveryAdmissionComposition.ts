import { join } from 'node:path';

import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import {
  parseWorkspaceCreationJournalBytes,
  WORKSPACE_CREATION_JOURNAL_MAX_BYTES,
} from '../creation/workspaceCreationJournalBytes.js';
import {
  createWorkspaceCreationJournalPaths,
  WORKSPACE_CREATION_JOURNAL_FILE_NAME,
} from '../creation/workspaceCreationJournalPaths.js';
import {
  parseWorkspaceBackupImportJournalBytes,
  WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES,
} from '../import/workspaceBackupImportJournalBytes.js';
import {
  createWorkspaceBackupImportJournalPaths,
  WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
} from '../import/workspaceBackupImportJournalPaths.js';
import { createReadOnlyJournalSlotPaths } from '../management/mainOwnedWorkspaceManagementOperationGuard.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import { CrashSafeByteSlotStore } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { hasAnyJournalSlot } from '../persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { createNodeWorkspaceRegistryFileSystem } from '../registry/workspaceRegistryFileSystem.js';
import {
  createWorkspaceRegistryPaths,
  WORKSPACE_REGISTRY_FILE_NAME,
} from '../registry/workspaceRegistryPaths.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { createWorkspaceSwitchJournalPaths } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../update/workspaceFirstStartMigrationJournalPaths.js';
import {
  readWorkspaceColdRecoveryAdmission,
  type WorkspaceColdRecoveryAdmission,
} from './workspaceColdRecoveryAdmission.js';

export async function assertColdWorkspaceRecoveryAdmissionFromRoot(
  userDataRoot: string,
  expectedOwner: Exclude<WorkspaceColdRecoveryAdmission, 'none'>,
): Promise<void> {
  if (await readColdWorkspaceRecoveryAdmissionFromRoot(userDataRoot) !== expectedOwner) {
    throw new WorkspaceManagementRecoveryRequiredError();
  }
}

// The root comes from main, never from renderer or journal contents. This probe
// neither repairs slots nor grants runtime-absence or recovery permission.
export async function readColdWorkspaceRecoveryAdmissionFromRoot(
  userDataRoot: string,
): Promise<WorkspaceColdRecoveryAdmission> {
  try {
    const creationPaths = createWorkspaceCreationJournalPaths(
      userDataRoot, join(userDataRoot, WORKSPACE_CREATION_JOURNAL_FILE_NAME),
    );
    const importPaths = createWorkspaceBackupImportJournalPaths(
      userDataRoot, join(userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME),
    );
    const [creation, importBackup] = await Promise.all([
      hasAnyJournalSlot(creationPaths), hasAnyJournalSlot(importPaths),
    ]);
    if (!creation && !importBackup) return 'none';
    if (creation && importBackup) throw new WorkspaceManagementRecoveryRequiredError();

    const journal = creation
      ? (await new CrashSafeByteSlotStore(createNodeCrashSafeFileSlotFileSystem(
        creationPaths, WORKSPACE_CREATION_JOURNAL_MAX_BYTES,
      )).inspect(parseWorkspaceCreationJournalBytes))?.value
      : (await new CrashSafeByteSlotStore(createNodeCrashSafeFileSlotFileSystem(
        importPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES,
      )).inspect(parseWorkspaceBackupImportJournalBytes))?.value;
    if (journal === undefined || journal.formatVersion !== 2) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }

    const root = creationPaths.directoryPath;
    const registryPaths = createWorkspaceRegistryPaths(
      root, join(root, WORKSPACE_REGISTRY_FILE_NAME),
    );
    const registry = (await new CrashSafeByteSlotStore(
      createNodeWorkspaceRegistryFileSystem(registryPaths),
    ).inspect(parseWorkspaceRegistryBytes))?.value;
    const workspaceIds = new Set<WorkspaceId>([
      journal.workspaceId,
      ...registry?.workspaces.map((entry) => entry.workspaceId) ?? [],
    ]);
    if (journal.previousActiveWorkspaceId !== null) {
      workspaceIds.add(journal.previousActiveWorkspaceId);
    }
    const legacyRuntimeRoot = createDesktopProfilePaths(root).runtimeRoot;
    const profileRuntimeRoots = [legacyRuntimeRoot, ...[...workspaceIds].map((id) =>
      createDesktopProfilePaths(deriveWorkspaceRoot(root, id, 1).workspaceRoot).runtimeRoot,
    )];
    const updatePaths = createLocalUpdateRuntimePaths({
      userDataPath: root, legacyRuntimeRoot,
    });
    const replacementPaths = deriveWorkspaceBackupReplacementRuntimePaths(
      root, journal.workspaceId,
    );
    const admission = await readWorkspaceColdRecoveryAdmission({
      adoptionJournal: createWorkspaceLegacyAdoptionJournalPaths(root),
      creationJournal: creationPaths,
      directSetupRecovery: createReadOnlyJournalSlotPaths(updatePaths.directSetupMigrationRecoveryPath),
      firstStartMigrationJournal: createWorkspaceFirstStartMigrationJournalPaths(root),
      importJournal: importPaths,
      legacyUpdateJournal: createReadOnlyJournalSlotPaths(updatePaths.legacyJournalPath),
      profileRestoreJournals: profileRuntimeRoots.map((runtimeRoot) =>
        createReadOnlyJournalSlotPaths(
          createProfileSnapshotRuntimePaths(runtimeRoot).restoreActivationJournalPath,
        ),
      ),
      replacementJournal: createReadOnlyJournalSlotPaths(replacementPaths.activationJournalPath),
      switchJournal: createWorkspaceSwitchJournalPaths(root),
      updateJournal: createReadOnlyJournalSlotPaths(updatePaths.journalPath),
    });
    if (admission !== (creation ? 'creation' : 'import')) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    return admission;
  } catch {
    throw new WorkspaceManagementRecoveryRequiredError();
  }
}

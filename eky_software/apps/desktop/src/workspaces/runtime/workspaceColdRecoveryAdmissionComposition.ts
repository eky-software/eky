import { join } from 'node:path';

import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { parseDirectSetupMigrationRecovery } from '../../update/directSetupMigrationRecovery.js';
import { maximumDirectSetupMigrationRecoveryBytes } from '../../update/directSetupMigrationRecoveryStore.js';
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
import { hasAnyJournalSlot, hasTerminalJournalConflict } from '../persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { createNodeWorkspaceRegistryFileSystem } from '../registry/workspaceRegistryFileSystem.js';
import {
  createWorkspaceRegistryPaths,
  WORKSPACE_REGISTRY_FILE_NAME,
} from '../registry/workspaceRegistryPaths.js';
import type { LocalWorkspaceRegistry, WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
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

// This census is only the recovery-conflict part of selector preparation.
// The caller retains the installation reservation and rechecks the registry.
export async function assertNoSelectorWorkspaceRecoveryFromRoot(
  userDataRoot: string,
  registry: Readonly<LocalWorkspaceRegistry>,
): Promise<void> {
  return assertSelectorWorkspaceRecoveryFromRoot(userDataRoot, registry, async () => {
    if (await hasAnyJournalSlot(createWorkspaceSwitchJournalPaths(userDataRoot))) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
  });
}

// This is only the OTHER owners' census, including W6 and profile recovery.
// The selected switch writer separately owns exact registry/journal guards,
// also during its own partial writes. This census is not mutation authority.
export async function assertSelectorReturnRecoveryConflictsFromRoot(
  userDataRoot: string,
  registry: Readonly<LocalWorkspaceRegistry>,
): Promise<void> {
  await assertSelectorWorkspaceRecoveryFromRoot(userDataRoot, registry);
}

async function assertSelectorWorkspaceRecoveryFromRoot(
  userDataRoot: string,
  registry: Readonly<LocalWorkspaceRegistry>,
  assertSwitchSelection?: () => Promise<void>,
): Promise<void> {
  try {
    const selected = validateWorkspaceRegistry(registry);
    if (selected.activeWorkspaceId !== null) throw new WorkspaceManagementRecoveryRequiredError();
    await assertSwitchSelection?.();
    const legacyRuntimeRoot = createDesktopProfilePaths(userDataRoot).runtimeRoot;
    const updatePaths = createLocalUpdateRuntimePaths({ userDataPath: userDataRoot, legacyRuntimeRoot });
    const pending = [
      createWorkspaceLegacyAdoptionJournalPaths(userDataRoot),
      createWorkspaceCreationJournalPaths(userDataRoot, join(userDataRoot, WORKSPACE_CREATION_JOURNAL_FILE_NAME)),
      createWorkspaceBackupImportJournalPaths(userDataRoot, join(userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)),
      createWorkspaceFirstStartMigrationJournalPaths(userDataRoot),
      createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(legacyRuntimeRoot).restoreActivationJournalPath),
      ...selected.workspaces.flatMap(entry => {
        const runtimeRoot = createDesktopProfilePaths(
          deriveWorkspaceRoot(userDataRoot, entry.workspaceId, entry.layoutVersion).workspaceRoot,
        ).runtimeRoot;
        return [
          createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(runtimeRoot).restoreActivationJournalPath),
          createReadOnlyJournalSlotPaths(
            deriveWorkspaceBackupReplacementRuntimePaths(userDataRoot, entry.workspaceId).activationJournalPath,
          ),
        ];
      }),
    ];
    // Preserve the existing accepted Direct Setup terminal, without clearing it
    // or treating it as authority for a new business acceptance.
    if (await hasTerminalJournalConflict(
      createReadOnlyJournalSlotPaths(updatePaths.directSetupMigrationRecoveryPath),
      maximumDirectSetupMigrationRecoveryBytes, parseDirectSetupMigrationRecovery,
      record => record.state === 'accepted',
    )) throw new WorkspaceManagementRecoveryRequiredError();
    for (const paths of pending) {
      if (await hasAnyJournalSlot(paths)) throw new WorkspaceManagementRecoveryRequiredError();
    }
    await assertSwitchSelection?.();
  } catch (error) {
    if (error instanceof WorkspaceManagementRecoveryRequiredError) throw error;
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

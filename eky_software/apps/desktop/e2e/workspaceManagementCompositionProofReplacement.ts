import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ProfileRestoreActivationPhase } from '../src/profileBackup/restore/profileRestoreActivationJournal.js';
import { ProfileRestoreActivationJournalStore } from '../src/profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../src/profileBackup/restore/profileRestoreActivationTransaction.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import type { WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { createWorkspaceBackupReplacementStartupRecovery } from '../src/workspaces/replacement/workspaceBackupReplacementStartupRecovery.js';
import { generateWorkspaceBackupReplacementOperationId } from '../src/workspaces/replacement/workspaceBackupReplacementOperationId.js';
import {
  deriveWorkspaceBackupReplacementPaths,
  deriveWorkspaceBackupReplacementRuntimePaths,
} from '../src/workspaces/replacement/workspaceBackupReplacementPaths.js';
import { validateProofPublishedWorkspace } from './workspaceManagementCompositionProofBackup.js';
import {
  sha256File,
  sha256Tree,
  snapshotActiveWorkspace,
  snapshotsEqual,
} from './workspaceManagementCompositionProofHash.js';
import type { WorkspaceManagementCompositionProofInput } from './workspaceManagementCompositionProofTypes.js';

export async function proveReplacementActivationRollback(input: {
  readonly activeDatabasePath: string;
  readonly activePdfPath: string;
  readonly primaryRoot: string;
  readonly workspaceId: WorkspaceId;
}): Promise<boolean> {
  const activeSnapshot = await snapshotActiveWorkspace({
    databasePath: input.activeDatabasePath,
    pdfPath: input.activePdfPath,
  });
  for (const faultPhase of [
    'prepared',
    'stagedDocumentsActivated',
  ] as const satisfies readonly ProfileRestoreActivationPhase[]) {
    const operationId = generateWorkspaceBackupReplacementOperationId();
    const paths = deriveWorkspaceBackupReplacementPaths(
      input.primaryRoot,
      operationId,
      input.workspaceId,
    );
    await mkdir(dirname(paths.candidateDatabasePath), {
      mode: 0o700,
      recursive: true,
    });
    await copyFile(input.activeDatabasePath, paths.candidateDatabasePath);
    const candidatePdfPath = join(
      paths.candidateArtifactRoot,
      'proof',
      'approved-invoice.pdf',
    );
    await mkdir(dirname(candidatePdfPath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(
      candidatePdfPath,
      `%PDF-1.7\n% Interrupted at ${faultPhase}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );

    const journalStore = new ProfileRestoreActivationJournalStore(
      paths.activationJournalPath,
    );
    let faultReached = false;
    const transaction = createActivationTransaction({
      afterPhasePersisted(phase) {
        if (phase === faultPhase) {
          faultReached = true;
          throw new Error('WORKSPACE_COMPOSITION_SYNTHETIC_INTERRUPTION');
        }
      },
      journalStore,
      paths,
    });
    try {
      await transaction.prepare(operationId);
      await transaction.advanceToValidation();
    } catch {
      // Recovery below must restore the original bytes at both fault points.
    }

    const recoveryTransaction = createActivationTransaction({
      journalStore,
      paths,
    });
    const journal = await journalStore.read();
    if (journal !== undefined) {
      await recoveryTransaction.rollback();
      await recoveryTransaction.clearRolledBack();
    }
    if (
      !faultReached ||
      !snapshotsEqual(
        activeSnapshot,
        await snapshotActiveWorkspace({
          databasePath: input.activeDatabasePath,
          pdfPath: input.activePdfPath,
        }),
      )
    ) {
      return false;
    }
  }
  return true;
}

export async function snapshotReplacementIsolation(input: {
  readonly importedWorkspaceId: WorkspaceId;
  readonly primaryRoot: string;
  readonly secondWorkspaceId: WorkspaceId;
}) {
  return Object.freeze({
    importedWorkspaceHash: await sha256Tree(
      deriveWorkspaceRoot(input.primaryRoot, input.importedWorkspaceId, 1)
        .workspaceRoot,
    ),
    registryHash: await sha256File(
      join(input.primaryRoot, WORKSPACE_REGISTRY_FILE_NAME),
    ),
    secondWorkspaceHash: await sha256Tree(
      deriveWorkspaceRoot(input.primaryRoot, input.secondWorkspaceId, 1)
        .workspaceRoot,
    ),
  });
}

export async function completeReplacementStartupRecovery(
  input: WorkspaceManagementCompositionProofInput & {
    readonly expectedProfileId: string;
    readonly workspaceId: WorkspaceId;
  },
): Promise<boolean> {
  const replacementPaths = deriveWorkspaceBackupReplacementRuntimePaths(
    input.userDataRoot,
    input.workspaceId,
  );
  const replacementRecovery =
    createWorkspaceBackupReplacementStartupRecovery({
      paths: replacementPaths,
    }).recovery;
  const recoveryMode = await replacementRecovery.prepareBeforeBackend();
  const replacementReadiness = await validateProofPublishedWorkspace(input);
  const recoveryOutcome = await replacementRecovery.validateAfterBackend({
    mode: recoveryMode,
    async stopBackend() {},
    async validateActiveProfile() {
      if (
        replacementReadiness.lineageIdentity.profileId !==
        input.expectedProfileId
      ) {
        throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
      }
    },
  });
  return recoveryMode === 'validateRestoredProfile' && recoveryOutcome === 'ready';
}

function createActivationTransaction(input: {
  readonly afterPhasePersisted?: (
    phase: ProfileRestoreActivationPhase,
  ) => void;
  readonly journalStore: ProfileRestoreActivationJournalStore;
  readonly paths: ReturnType<typeof deriveWorkspaceBackupReplacementPaths>;
}): ProfileRestoreActivationTransaction {
  return new ProfileRestoreActivationTransaction({
    ...(input.afterPhasePersisted === undefined
      ? {}
      : { afterPhasePersisted: input.afterPhasePersisted }),
    journalStore: input.journalStore,
    paths: {
      activeDatabasePath: input.paths.activeDatabasePath,
      activeDocumentsRoot: input.paths.activeArtifactRoot,
      failedRoot: input.paths.activationFailedRoot,
      rollbackRoot: input.paths.activationRollbackRoot,
      stagingRoot: input.paths.activationStagingRoot,
    },
  });
}

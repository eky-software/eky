import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { app } from 'electron';

import { writeBackupContainer } from '../src/profileBackup/container/backupContainerWriter.js';
import { createProfileBackupSourceEntries } from '../src/profileBackup/createProfileBackupSourceEntries.js';
import type { ProfileRestoreActivationPhase } from '../src/profileBackup/restore/profileRestoreActivationJournal.js';
import { ProfileRestoreActivationJournalStore } from '../src/profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../src/profileBackup/restore/profileRestoreActivationTransaction.js';
import { createWorkspaceBackupReplacementStartupRecovery } from '../src/workspaces/replacement/workspaceBackupReplacementStartupRecovery.js';
import {
  deriveWorkspaceBackupReplacementPaths,
  deriveWorkspaceBackupReplacementRuntimePaths,
} from '../src/workspaces/replacement/workspaceBackupReplacementPaths.js';
import { generateWorkspaceBackupReplacementOperationId } from '../src/workspaces/replacement/workspaceBackupReplacementOperationId.js';
import type { ActiveWorkspaceLifecyclePort } from '../src/workspaces/runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../src/workspaces/runtime/workspaceRuntimeAbsencePort.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../src/workspaces/runtime/workspaceCandidateRuntimePaths.js';
import { validateWorkspaceBackupImportOperationId } from '../src/workspaces/import/workspaceBackupImportOperationId.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../src/workspaces/import/privateWorkspaceBackupCandidateAdapter.js';
import { InMemoryWorkspaceMaintenanceLease } from '../src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import { WorkspaceSwitchJournalStore } from '../src/workspaces/switch/workspaceSwitchJournal.js';
import {
  createWorkspaceManagementComposition,
  type WorkspaceManagementComposition,
} from '../src/workspaces/management/workspaceManagementComposition.js';

const proofPassword = 'synthetic-composition-proof-password-Aa1!';

type WorkspaceManagementCompositionProofStage =
  | 'sourceComposition'
  | 'sourceCreate'
  | 'sourceBackup'
  | 'primaryComposition'
  | 'primaryCreate'
  | 'secondaryCreate'
  | 'import'
  | 'rename'
  | 'noOpSwitch'
  | 'maintenanceLease'
  | 'operationGuard'
  | 'replacementBackup'
  | 'replacementFaults'
  | 'replacement'
  | 'replacementRecovery'
  | 'switch'
  | 'result';

export interface WorkspaceManagementCompositionProofResult {
  readonly activeWorkspacePreservedDuringCreate: boolean;
  readonly activeWorkspacePreservedDuringImport: boolean;
  readonly candidateProcessesReleased: boolean;
  readonly createdWorkspaceCount: number;
  readonly importedWorkspaceValidated: boolean;
  readonly importedWorkspaceCount: number;
  readonly maximumBackendOwners: number;
  readonly maximumSqliteOwners: number;
  readonly noOpSwitchPreservedRuntime: boolean;
  readonly renamePersisted: boolean;
  readonly renamePreservedRuntime: boolean;
  readonly replacementAcceptedAfterRestart: boolean;
  readonly replacementFaultsRolledBack: boolean;
  readonly replacementLifecycleOrdered: boolean;
  readonly replacementPreservedUnrelatedWorkspaces: boolean;
  readonly sharedLeaseBlockedConcurrentOperation: boolean;
  readonly sourceBackupPreserved: boolean;
  readonly switchJournalPersisted: boolean;
  readonly switchRequestedRelaunch: boolean;
  readonly unresolvedOperationBlockedMutation: boolean;
}

export async function runWorkspaceManagementCompositionProof(input: {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
}): Promise<Readonly<WorkspaceManagementCompositionProofResult>> {
  const proofRoot = join(input.userDataRoot, 'w');
  const primaryRoot = join(proofRoot, 'p');
  const sourceRoot = join(proofRoot, 's');
  const processCountBefore = countUtilityProcesses();
  let stage: WorkspaceManagementCompositionProofStage = 'sourceComposition';
  let primaryComposition: WorkspaceManagementComposition | undefined;
  let sourceComposition: WorkspaceManagementComposition | undefined;

  await rm(proofRoot, { force: true, recursive: true });
  await Promise.all(
    [proofRoot, primaryRoot, sourceRoot].map((root) =>
      mkdir(root, { mode: 0o700, recursive: true }),
    ),
  );

  try {
    const sourceLifecycle = new ProofActiveWorkspaceLifecycle(null);
    const sourceLease = new InMemoryWorkspaceMaintenanceLease();
    const sourceRelaunch = new ProofRuntimeRelaunch();
    sourceComposition = await createProofComposition({
      ...input,
      activeWorkspaceId: createWorkspaceId(),
      activeWorkspaceLifecycle: sourceLifecycle,
      maintenanceLease: sourceLease,
      runtimeRelaunch: sourceRelaunch,
      userDataRoot: sourceRoot,
    });
    stage = 'sourceCreate';
    const sourceWorkspace = await sourceComposition.service.createEmpty(
      'Synthetic import source',
    );
    sourceLifecycle.setRunningWorkspace(sourceWorkspace.workspaceId);
    const sourceBackupPath = join(proofRoot, 'source.ekybackup');
    stage = 'sourceBackup';
    const sourceReadiness = await createWorkspaceBackup({
      ...input,
      backupPath: sourceBackupPath,
      userDataRoot: sourceRoot,
      workspaceId: sourceWorkspace.workspaceId,
    });
    const sourceBackupHash = await sha256File(sourceBackupPath);
    sourceComposition.dispose();
    sourceComposition = undefined;

    stage = 'primaryComposition';
    const primaryLifecycle = new ProofActiveWorkspaceLifecycle(null);
    const primaryLease = new InMemoryWorkspaceMaintenanceLease();
    const primaryRelaunch = new ProofRuntimeRelaunch();
    primaryComposition = await createProofComposition({
      ...input,
      activeWorkspaceId: createWorkspaceId(),
      activeWorkspaceLifecycle: primaryLifecycle,
      maintenanceLease: primaryLease,
      runtimeRelaunch: primaryRelaunch,
      userDataRoot: primaryRoot,
    });
    stage = 'primaryCreate';
    const firstWorkspace = await primaryComposition.service.createEmpty(
      'Synthetic primary',
    );
    primaryLifecycle.setRunningWorkspace(firstWorkspace.workspaceId);
    primaryComposition.dispose();
    primaryComposition = await createProofComposition({
      ...input,
      activeWorkspaceId: firstWorkspace.workspaceId,
      activeWorkspaceLifecycle: primaryLifecycle,
      maintenanceLease: primaryLease,
      runtimeRelaunch: primaryRelaunch,
      userDataRoot: primaryRoot,
    });
    const firstWorkspacePaths = deriveWorkspaceBackupReplacementRuntimePaths(
      primaryRoot,
      firstWorkspace.workspaceId,
    );
    const firstWorkspacePdfPath = join(
      firstWorkspacePaths.activeArtifactRoot,
      'proof',
      'approved-invoice.pdf',
    );
    await mkdir(dirname(firstWorkspacePdfPath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(
      firstWorkspacePdfPath,
      '%PDF-1.7\n% Eky workspace composition proof\n',
      { encoding: 'utf8', mode: 0o600 },
    );
    const activeSnapshotBeforeExpansion = await snapshotActiveWorkspace({
      databasePath: firstWorkspacePaths.activeDatabasePath,
      pdfPath: firstWorkspacePdfPath,
    });

    stage = 'secondaryCreate';
    const secondWorkspace = await primaryComposition.service.createEmpty(
      'Synthetic secondary',
    );
    const activeWorkspacePreservedDuringCreate =
      (await readRegistry(primaryRoot)).activeWorkspaceId ===
        firstWorkspace.workspaceId &&
      snapshotsEqual(
        activeSnapshotBeforeExpansion,
        await snapshotActiveWorkspace({
          databasePath: firstWorkspacePaths.activeDatabasePath,
          pdfPath: firstWorkspacePdfPath,
        }),
      );
    stage = 'import';
    const importedWorkspace =
      await primaryComposition.service.importBackupAsNew({
        containerPath: sourceBackupPath,
        password: proofPassword,
        workspaceLabel: 'Synthetic imported',
      });
    const registryAfterImport = await readRegistry(primaryRoot);
    const importedEntry = registryAfterImport.workspaces.find(
      (workspace) => workspace.workspaceId === importedWorkspace.workspaceId,
    );
    if (importedEntry === undefined) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    const importedReadiness = await validatePublishedWorkspace({
      ...input,
      expectedProfileId: importedEntry.lineageIdentity.profileId,
      userDataRoot: primaryRoot,
      workspaceId: importedWorkspace.workspaceId,
    });
    const importedWorkspaceValidated =
      importedReadiness.lineageIdentity.profileId ===
        sourceReadiness.lineageIdentity.profileId &&
      importedReadiness.migrationChainIdentity ===
        sourceReadiness.migrationChainIdentity &&
      importedReadiness.companyId === sourceReadiness.companyId;
    const sourceBackupPreserved =
      (await sha256File(sourceBackupPath)) === sourceBackupHash;
    const activeWorkspacePreservedDuringImport =
      registryAfterImport.activeWorkspaceId === firstWorkspace.workspaceId &&
      snapshotsEqual(
        activeSnapshotBeforeExpansion,
        await snapshotActiveWorkspace({
          databasePath: firstWorkspacePaths.activeDatabasePath,
          pdfPath: firstWorkspacePdfPath,
        }),
      );
    stage = 'rename';
    const lifecycleEventsBeforeRename = primaryLifecycle.events.length;
    const relaunchRequestsBeforeRename = primaryRelaunch.requestCount;
    const inactiveRename = await primaryComposition.service.rename(
      secondWorkspace.workspaceId,
      'Synthetic renamed secondary',
    );
    const activeRename = await primaryComposition.service.rename(
      firstWorkspace.workspaceId,
      'Synthetic renamed primary',
    );
    const sameLabelRename = await primaryComposition.service.rename(
      firstWorkspace.workspaceId,
      'Synthetic renamed primary',
    );
    const statusAfterRename = await primaryComposition.service.getStatus();
    const renamePersisted =
      statusAfterRename.workspaces.some(
        (workspace) =>
          workspace.workspaceId === secondWorkspace.workspaceId &&
          workspace.workspaceLabel === 'Synthetic renamed secondary',
      ) &&
      statusAfterRename.workspaces.some(
        (workspace) =>
          workspace.workspaceId === firstWorkspace.workspaceId &&
          workspace.workspaceLabel === 'Synthetic renamed primary',
      );
    const renamePreservedRuntime =
      inactiveRename.changed &&
      activeRename.changed &&
      !sameLabelRename.changed &&
      primaryLifecycle.events.length === lifecycleEventsBeforeRename &&
      primaryRelaunch.requestCount === relaunchRequestsBeforeRename;

    stage = 'noOpSwitch';
    const lifecycleEventsBeforeNoOp = primaryLifecycle.events.length;
    const relaunchRequestsBeforeNoOp = primaryRelaunch.requestCount;
    await primaryComposition.service.switchTo(firstWorkspace.workspaceId);
    const noOpSwitchPreservedRuntime =
      primaryLifecycle.events.length === lifecycleEventsBeforeNoOp &&
      primaryRelaunch.requestCount === relaunchRequestsBeforeNoOp;

    stage = 'maintenanceLease';
    const heldLease = await primaryLease.acquire('backup');
    let sharedLeaseBlockedConcurrentOperation = false;
    try {
      await primaryComposition.service.rename(
        importedWorkspace.workspaceId,
        'Must remain blocked',
      );
    } catch (error) {
      sharedLeaseBlockedConcurrentOperation =
        readSafeErrorCode(error) === 'WORKSPACE_MANAGEMENT_BUSY';
    } finally {
      await heldLease.release();
    }

    stage = 'operationGuard';
    const unresolvedJournalPath = join(
      primaryRoot,
      'workspace-creation-journal-v1.json',
    );
    await writeFile(unresolvedJournalPath, '{}\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    let unresolvedOperationBlockedRename = false;
    let unresolvedOperationBlockedSwitch = false;
    try {
      await primaryComposition.service.rename(
        importedWorkspace.workspaceId,
        'Must remain recovery blocked',
      );
    } catch (error) {
      unresolvedOperationBlockedRename =
        readSafeErrorCode(error) ===
        'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED';
    }
    try {
      await primaryComposition.service.switchTo(secondWorkspace.workspaceId);
    } catch (error) {
      unresolvedOperationBlockedSwitch =
        readSafeErrorCode(error) ===
        'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED';
    } finally {
      await rm(unresolvedJournalPath, { force: true });
    }
    const unresolvedOperationBlockedMutation =
      unresolvedOperationBlockedRename && unresolvedOperationBlockedSwitch;

    stage = 'replacementBackup';
    const replacementBackupPath = join(proofRoot, 'replacement.ekybackup');
    await createWorkspaceBackup({
      ...input,
      backupPath: replacementBackupPath,
      userDataRoot: primaryRoot,
      workspaceId: firstWorkspace.workspaceId,
    });
    const replacementIsolationBefore = await snapshotReplacementIsolation({
      importedWorkspaceId: importedWorkspace.workspaceId,
      primaryRoot,
      secondWorkspaceId: secondWorkspace.workspaceId,
    });
    stage = 'replacementFaults';
    const replacementFaultsRolledBack =
      await proveReplacementActivationRollback({
        activeDatabasePath: firstWorkspacePaths.activeDatabasePath,
        activePdfPath: firstWorkspacePdfPath,
        primaryRoot,
        workspaceId: firstWorkspace.workspaceId,
      });
    stage = 'replacement';
    const replacementLifecycleStart = primaryLifecycle.events.length;
    await primaryComposition.service.replaceActiveFromBackup({
      containerPath: replacementBackupPath,
      password: proofPassword,
      targetWorkspaceId: firstWorkspace.workspaceId,
    });
    const replacementLifecycleOrdered = arraysEqual(
      primaryLifecycle.events.slice(replacementLifecycleStart),
      ['quiesced', 'preRestore', 'stopped', 'absent'],
    );
    stage = 'replacementRecovery';
    const replacementPaths = deriveWorkspaceBackupReplacementRuntimePaths(
      primaryRoot,
      firstWorkspace.workspaceId,
    );
    const replacementRecovery =
      createWorkspaceBackupReplacementStartupRecovery({
        paths: replacementPaths,
      }).recovery;
    const recoveryMode = await replacementRecovery.prepareBeforeBackend();
    const replacementRegistry = await readRegistry(primaryRoot);
    const replacementEntry = replacementRegistry.workspaces.find(
      (workspace) => workspace.workspaceId === firstWorkspace.workspaceId,
    );
    if (replacementEntry === undefined) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    const replacementReadiness = await validatePublishedWorkspace({
      ...input,
      expectedProfileId: replacementEntry.lineageIdentity.profileId,
      userDataRoot: primaryRoot,
      workspaceId: firstWorkspace.workspaceId,
    });
    const recoveryOutcome = await replacementRecovery.validateAfterBackend({
      mode: recoveryMode,
      async stopBackend() {},
      async validateActiveProfile() {
        if (
          replacementReadiness.lineageIdentity.profileId !==
          replacementEntry.lineageIdentity.profileId
        ) {
          throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
        }
      },
    });
    primaryLifecycle.setRunningWorkspace(firstWorkspace.workspaceId);
    const replacementAcceptedAfterRestart =
      recoveryMode === 'validateRestoredProfile' &&
      recoveryOutcome === 'ready';
    const replacementPreservedUnrelatedWorkspaces = snapshotsEqual(
      replacementIsolationBefore,
      await snapshotReplacementIsolation({
        importedWorkspaceId: importedWorkspace.workspaceId,
        primaryRoot,
        secondWorkspaceId: secondWorkspace.workspaceId,
      }),
    );

    stage = 'switch';
    await primaryComposition.service.switchTo(secondWorkspace.workspaceId);
    const switchedRegistry = await readRegistry(primaryRoot);
    const switchJournal = await new WorkspaceSwitchJournalStore(
      primaryRoot,
    ).read();
    const switchJournalPersisted =
      switchJournal?.sourceWorkspaceId === firstWorkspace.workspaceId &&
      switchJournal.targetWorkspaceId === secondWorkspace.workspaceId &&
      switchJournal.state === 'targetSelected';
    const switchRequestedRelaunch =
      switchedRegistry.activeWorkspaceId === secondWorkspace.workspaceId &&
      primaryRelaunch.requestCount >= 2;

    stage = 'result';
    const finalStatusWorkspaceCount = switchedRegistry.workspaces.length;
    const candidateProcessesReleased = await waitForUtilityProcessCount(
      processCountBefore,
    );
    const result = {
      activeWorkspacePreservedDuringCreate,
      activeWorkspacePreservedDuringImport,
      candidateProcessesReleased,
      createdWorkspaceCount: 2,
      importedWorkspaceValidated,
      importedWorkspaceCount:
        finalStatusWorkspaceCount === 3 && importedWorkspace !== undefined
          ? 1
          : 0,
      maximumBackendOwners: primaryLifecycle.maximumBackendOwners,
      maximumSqliteOwners: primaryLifecycle.maximumSqliteOwners,
      noOpSwitchPreservedRuntime,
      renamePersisted,
      renamePreservedRuntime,
      replacementAcceptedAfterRestart,
      replacementFaultsRolledBack,
      replacementLifecycleOrdered,
      replacementPreservedUnrelatedWorkspaces,
      sharedLeaseBlockedConcurrentOperation,
      sourceBackupPreserved,
      switchJournalPersisted,
      switchRequestedRelaunch,
      unresolvedOperationBlockedMutation,
    } as const;
    assertProofResult(result);
    return Object.freeze(result);
  } catch (error) {
    const errorCode = readSafeErrorCode(error);
    const safeErrorCode =
      errorCode !== undefined && /^[A-Z][A-Z0-9_]{1,100}$/u.test(errorCode)
        ? errorCode
        : 'UNKNOWN';
    throw new Error(
      `WORKSPACE_MANAGEMENT_COMPOSITION_PROOF_FAILED_${stage.toUpperCase()}_${safeErrorCode}`,
    );
  } finally {
    primaryComposition?.dispose();
    sourceComposition?.dispose();
    await rm(proofRoot, { force: true, recursive: true });
  }
}

async function createProofComposition(input: {
  readonly activeWorkspaceId: WorkspaceId;
  readonly activeWorkspaceLifecycle: ProofActiveWorkspaceLifecycle;
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly maintenanceLease: InMemoryWorkspaceMaintenanceLease;
  readonly resourcesPath: string;
  readonly runtimeRelaunch: ProofRuntimeRelaunch;
  readonly userDataRoot: string;
}) {
  return createWorkspaceManagementComposition({
    activeWorkspaceId: input.activeWorkspaceId,
    activeWorkspaceLifecycle: input.activeWorkspaceLifecycle,
    appVersion: input.appVersion,
    buildRevision: input.buildRevision,
    localUpdateRuntimePaths: {
      directSetupMigrationRecoveryPath: join(
        input.userDataRoot,
        'update-state',
        'direct-setup-recovery-v1.json',
      ),
      journalPath: join(
        input.userDataRoot,
        'update-state',
        'update-journal-v1.json',
      ),
    },
    maintenanceLease: input.maintenanceLease,
    profileRestoreActivationJournalPath: join(
      input.userDataRoot,
      'profile-restore',
      'activation-journal-v1.json',
    ),
    recoveryPointService: {
      async createPreRestore() {
        input.activeWorkspaceLifecycle.recordPreRestore();
        return {
          artifactId: randomUUID(),
          byteSize: 1,
          createdAt: '2026-08-20T00:00:00.000Z',
          kind: 'preRestore' as const,
          state: 'validatedGood' as const,
          validatedAt: '2026-08-20T00:00:00.000Z',
        };
      },
    },
    resourcesPath: input.resourcesPath,
    runtimeRelaunch: input.runtimeRelaunch,
    userDataRoot: input.userDataRoot,
  });
}

async function createWorkspaceBackup(input: {
  readonly appVersion: string;
  readonly backupPath: string;
  readonly buildRevision: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
  readonly workspaceId: WorkspaceId;
}) {
  const readiness = await validatePublishedWorkspace(input);
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    input.workspaceId,
    1,
  ).workspaceRoot;
  const sourceRoot = join(
    input.userDataRoot,
    'workspace-composition-proof-backup-source',
    randomUUID(),
  );
  await mkdir(sourceRoot, { mode: 0o700, recursive: true });
  try {
    await copyFile(
      join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
      join(sourceRoot, 'profile.sqlite'),
    );
    await writeFile(
      join(sourceRoot, 'snapshot-catalog-v1.json'),
      `${JSON.stringify({ artifacts: [], formatVersion: 1 })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await writeBackupContainer({
      destinationPath: input.backupPath,
      entries: await createProfileBackupSourceEntries(sourceRoot),
      manifest: {
        appVersion: input.appVersion,
        createdAtEpochMilliseconds: BigInt(
          new Date('2026-08-20T00:00:00.000Z').getTime(),
        ),
        migrationChainIdentity: readiness.migrationChainIdentity,
        profileId: readiness.lineageIdentity.profileId,
      },
      password: proofPassword,
    });
  } finally {
    await rm(sourceRoot, { force: true, recursive: true });
  }
  return readiness;
}

async function proveReplacementActivationRollback(input: {
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

async function snapshotActiveWorkspace(input: {
  readonly databasePath: string;
  readonly pdfPath: string;
}) {
  return Object.freeze({
    databaseHash: await sha256File(input.databasePath),
    pdfHash: await sha256File(input.pdfPath),
  });
}

async function snapshotReplacementIsolation(input: {
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

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function sha256Tree(root: string): Promise<string> {
  const hash = createHash('sha256');
  await appendDirectoryHash(hash, root, '');
  return hash.digest('hex');
}

async function appendDirectoryHash(
  hash: ReturnType<typeof createHash>,
  root: string,
  relativeRoot: string,
): Promise<void> {
  const entries = await readdir(join(root, relativeRoot), {
    withFileTypes: true,
  });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      hash.update(`directory:${relativePath}\n`);
      await appendDirectoryHash(hash, root, relativePath);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    hash.update(`file:${relativePath}\n`);
    hash.update(await readFile(join(root, relativePath)));
  }
}

async function validatePublishedWorkspace(input: {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly expectedProfileId?: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
  readonly workspaceId: WorkspaceId;
}) {
  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    input.resourcesPath,
  );
  const candidate = new PrivateWorkspaceBackupCandidateAdapter(
    new ElectronWorkspaceCandidateRuntimeFactory({
      appVersion: input.appVersion,
      backendRoot: runtimePaths.backendRoot,
      buildRevision: input.buildRevision,
      migrationsDirectory: runtimePaths.migrationsDirectory,
      runnerPath: runtimePaths.runnerPath,
    }),
  );
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    input.workspaceId,
    1,
  ).workspaceRoot;
  const registry = await readRegistry(input.userDataRoot);
  const entry = registry.workspaces.find(
    (workspace) => workspace.workspaceId === input.workspaceId,
  );
  const expectedProfileId =
    input.expectedProfileId ?? entry?.lineageIdentity.profileId;
  if (expectedProfileId === undefined) {
    throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
  }
  return candidate.validatePublished({
    artifactRoot: join(workspaceRoot, 'runtime', 'storage', 'invoices'),
    databaseFilePath: join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
    expectedProfileId,
    operationId: validateWorkspaceBackupImportOperationId(randomUUID()),
    publishedRoot: workspaceRoot,
    workspaceId: input.workspaceId,
  });
}

function readRegistry(userDataRoot: string) {
  return new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  }).read().then((registry) => {
    if (registry === undefined) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    return registry;
  });
}

class ProofActiveWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort, WorkspaceRuntimeAbsencePort
{
  backendOwners = 0;
  readonly events: string[] = [];
  maximumBackendOwners = 0;
  maximumSqliteOwners = 0;
  private activeWorkspaceId: WorkspaceId | null;
  private sqliteOwners = 0;

  constructor(activeWorkspaceId: WorkspaceId | null) {
    this.activeWorkspaceId = activeWorkspaceId;
    if (activeWorkspaceId !== null) this.setOwners(1);
  }

  async quiesceWrites(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.assertExpected(previousActiveWorkspaceId);
    this.events.push('quiesced');
  }

  recordPreRestore(): void {
    this.events.push('preRestore');
  }

  async stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }> {
    this.assertExpected(previousActiveWorkspaceId);
    this.setOwners(0);
    this.events.push('stopped');
    return { handlesClosed: true };
  }

  async ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.activeWorkspaceId = previousActiveWorkspaceId;
    this.setOwners(previousActiveWorkspaceId === null ? 0 : 1);
    this.events.push('running');
  }

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    if (this.backendOwners !== 0 || this.sqliteOwners !== 0) {
      throw new Error('WORKSPACE_RUNTIME_ABSENCE_FAILED');
    }
    this.events.push('absent');
  }

  setRunningWorkspace(workspaceId: WorkspaceId): void {
    this.activeWorkspaceId = workspaceId;
    this.setOwners(1);
  }

  private assertExpected(workspaceId: WorkspaceId | null): void {
    if (workspaceId !== this.activeWorkspaceId) {
      throw new Error('WORKSPACE_RUNTIME_OWNERSHIP_FAILED');
    }
  }

  private setOwners(count: 0 | 1): void {
    this.backendOwners = count;
    this.sqliteOwners = count;
    this.maximumBackendOwners = Math.max(this.maximumBackendOwners, count);
    this.maximumSqliteOwners = Math.max(this.maximumSqliteOwners, count);
  }
}

class ProofRuntimeRelaunch {
  requestCount = 0;

  request(): void {
    this.requestCount += 1;
  }

  complete(): void {}
}

function countUtilityProcesses(): number {
  return app.getAppMetrics().filter((metric) => metric.type === 'Utility').length;
}

async function waitForUtilityProcessCount(
  expectedCount: number,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (countUtilityProcesses() !== expectedCount) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

function createWorkspaceId(): WorkspaceId {
  return validateWorkspaceId(randomUUID());
}

function readSafeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return error instanceof Error ? error.message : undefined;
}

function assertProofResult(
  result: Readonly<WorkspaceManagementCompositionProofResult>,
): void {
  if (
    !result.activeWorkspacePreservedDuringCreate ||
    !result.activeWorkspacePreservedDuringImport ||
    !result.candidateProcessesReleased ||
    result.createdWorkspaceCount !== 2 ||
    !result.importedWorkspaceValidated ||
    result.importedWorkspaceCount !== 1 ||
    result.maximumBackendOwners !== 1 ||
    result.maximumSqliteOwners !== 1 ||
    !result.noOpSwitchPreservedRuntime ||
    !result.renamePersisted ||
    !result.renamePreservedRuntime ||
    !result.replacementAcceptedAfterRestart ||
    !result.replacementFaultsRolledBack ||
    !result.replacementLifecycleOrdered ||
    !result.replacementPreservedUnrelatedWorkspaces ||
    !result.sharedLeaseBlockedConcurrentOperation ||
    !result.sourceBackupPreserved ||
    !result.switchJournalPersisted ||
    !result.switchRequestedRelaunch ||
    !result.unresolvedOperationBlockedMutation
  ) {
    throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
  }
}

function snapshotsEqual(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function arraysEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

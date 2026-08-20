import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { InMemoryWorkspaceMaintenanceLease } from '../src/workspaces/maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../src/workspaces/replacement/workspaceBackupReplacementPaths.js';
import { WorkspaceSwitchJournalStore } from '../src/workspaces/switch/workspaceSwitchJournal.js';
import {
  createWorkspaceManagementComposition,
  type WorkspaceManagementComposition,
} from '../src/workspaces/management/workspaceManagementComposition.js';
import {
  createProofWorkspaceBackup,
  readProofWorkspaceRegistry,
  validateProofPublishedWorkspace,
  WORKSPACE_MANAGEMENT_PROOF_PASSWORD,
} from './workspaceManagementCompositionProofBackup.js';
import {
  sha256File,
  snapshotActiveWorkspace,
  snapshotsEqual,
} from './workspaceManagementCompositionProofHash.js';
import {
  completeReplacementStartupRecovery,
  proveReplacementActivationRollback,
  snapshotReplacementIsolation,
} from './workspaceManagementCompositionProofReplacement.js';
import {
  arraysEqual,
  captureUtilityProcessBaseline,
  createWorkspaceId,
  ProofActiveWorkspaceLifecycle,
  ProofRuntimeRelaunch,
  readSafeErrorCode,
  waitForProofUtilityProcessesReleased,
} from './workspaceManagementCompositionProofRuntime.js';
import type {
  WorkspaceManagementCompositionProofInput,
  WorkspaceManagementCompositionProofResult,
  WorkspaceManagementCompositionProofStage,
} from './workspaceManagementCompositionProofTypes.js';

export async function runWorkspaceManagementCompositionProof(
  input: WorkspaceManagementCompositionProofInput,
): Promise<Readonly<WorkspaceManagementCompositionProofResult>> {
  const proofRoot = join(input.userDataRoot, 'w');
  const primaryRoot = join(proofRoot, 'p');
  const sourceRoot = join(proofRoot, 's');
  const utilityProcessBaseline = captureUtilityProcessBaseline();
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
    const sourceReadiness = await createProofWorkspaceBackup({
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
      (await readProofWorkspaceRegistry(primaryRoot)).activeWorkspaceId ===
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
        password: WORKSPACE_MANAGEMENT_PROOF_PASSWORD,
        workspaceLabel: 'Synthetic imported',
      });
    const registryAfterImport = await readProofWorkspaceRegistry(primaryRoot);
    const importedEntry = registryAfterImport.workspaces.find(
      (workspace) => workspace.workspaceId === importedWorkspace.workspaceId,
    );
    if (importedEntry === undefined) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    const importedReadiness = await validateProofPublishedWorkspace({
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
    await createProofWorkspaceBackup({
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
      password: WORKSPACE_MANAGEMENT_PROOF_PASSWORD,
      targetWorkspaceId: firstWorkspace.workspaceId,
    });
    const replacementLifecycleOrdered = arraysEqual(
      primaryLifecycle.events.slice(replacementLifecycleStart),
      ['quiesced', 'preRestore', 'stopped', 'absent'],
    );
    stage = 'replacementRecovery';
    const replacementRegistry = await readProofWorkspaceRegistry(primaryRoot);
    const replacementEntry = replacementRegistry.workspaces.find(
      (workspace) => workspace.workspaceId === firstWorkspace.workspaceId,
    );
    if (replacementEntry === undefined) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    const replacementAcceptedAfterRestart =
      await completeReplacementStartupRecovery({
        ...input,
        expectedProfileId: replacementEntry.lineageIdentity.profileId,
        userDataRoot: primaryRoot,
        workspaceId: firstWorkspace.workspaceId,
      });
    primaryLifecycle.setRunningWorkspace(firstWorkspace.workspaceId);
    const replacementPreservedUnrelatedWorkspaces = snapshotsEqual(
      replacementIsolationBefore,
      await snapshotReplacementIsolation({
        importedWorkspaceId: importedWorkspace.workspaceId,
        primaryRoot,
        secondWorkspaceId: secondWorkspace.workspaceId,
      }),
    );

    stage = 'switch';
    const relaunchRequestsBeforeSwitch = primaryRelaunch.requestCount;
    await primaryComposition.service.switchTo(secondWorkspace.workspaceId);
    const switchedRegistry = await readProofWorkspaceRegistry(primaryRoot);
    const switchJournal = await new WorkspaceSwitchJournalStore(
      primaryRoot,
    ).read();
    const switchJournalPersisted =
      switchJournal?.sourceWorkspaceId === firstWorkspace.workspaceId &&
      switchJournal.targetWorkspaceId === secondWorkspace.workspaceId &&
      switchJournal.state === 'targetSelected';
    const switchRequestedRelaunch =
      switchedRegistry.activeWorkspaceId === secondWorkspace.workspaceId &&
      primaryRelaunch.requestCount === relaunchRequestsBeforeSwitch + 1;

    stage = 'result';
    const finalWorkspaceCounts = deriveFinalWorkspaceCounts({
      createdWorkspaceIds: [
        firstWorkspace.workspaceId,
        secondWorkspace.workspaceId,
      ],
      importedWorkspaceId: importedWorkspace.workspaceId,
      registryWorkspaceIds: switchedRegistry.workspaces.map(
        (workspace) => workspace.workspaceId,
      ),
    });
    const candidateProcessesReleased =
      await waitForProofUtilityProcessesReleased(utilityProcessBaseline);
    const result = {
      activeWorkspacePreservedDuringCreate,
      activeWorkspacePreservedDuringImport,
      candidateAppVersion: input.appVersion,
      candidateProcessesReleased,
      createdWorkspaceCount: finalWorkspaceCounts.createdWorkspaceCount,
      importedWorkspaceValidated,
      importedWorkspaceCount: finalWorkspaceCounts.importedWorkspaceCount,
      modeledMaximumBackendOwners:
        primaryLifecycle.modeledMaximumBackendOwners,
      modeledMaximumSqliteOwners: primaryLifecycle.modeledMaximumSqliteOwners,
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
    assertProofResult(result, input.appVersion);
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

function assertProofResult(
  result: Readonly<WorkspaceManagementCompositionProofResult>,
  expectedAppVersion: string,
): void {
  if (
    !result.activeWorkspacePreservedDuringCreate ||
    !result.activeWorkspacePreservedDuringImport ||
    result.candidateAppVersion !== expectedAppVersion ||
    !result.candidateProcessesReleased ||
    result.createdWorkspaceCount !== 2 ||
    !result.importedWorkspaceValidated ||
    result.importedWorkspaceCount !== 1 ||
    result.modeledMaximumBackendOwners !== 1 ||
    result.modeledMaximumSqliteOwners !== 1 ||
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

function deriveFinalWorkspaceCounts(input: {
  readonly createdWorkspaceIds: readonly WorkspaceId[];
  readonly importedWorkspaceId: WorkspaceId;
  readonly registryWorkspaceIds: readonly WorkspaceId[];
}): {
  readonly createdWorkspaceCount: number;
  readonly importedWorkspaceCount: number;
} {
  const expectedWorkspaceIds = [
    ...input.createdWorkspaceIds,
    input.importedWorkspaceId,
  ];
  const containsOnlyExpectedWorkspaceIds =
    input.registryWorkspaceIds.length === expectedWorkspaceIds.length &&
    input.registryWorkspaceIds.every((workspaceId) =>
      expectedWorkspaceIds.includes(workspaceId),
    );
  if (!containsOnlyExpectedWorkspaceIds) {
    return { createdWorkspaceCount: 0, importedWorkspaceCount: 0 };
  }
  const countOccurrences = (workspaceId: WorkspaceId) =>
    input.registryWorkspaceIds.filter((candidate) => candidate === workspaceId)
      .length;
  return {
    createdWorkspaceCount: input.createdWorkspaceIds.filter(
      (workspaceId) => countOccurrences(workspaceId) === 1,
    ).length,
    importedWorkspaceCount:
      countOccurrences(input.importedWorkspaceId) === 1 ? 1 : 0,
  };
}

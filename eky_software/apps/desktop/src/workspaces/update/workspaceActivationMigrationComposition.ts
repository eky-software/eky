import { join } from 'node:path';

import type { RecoveryPointService } from '../../profileBackup/recoveryPoint/recoveryPointService.js';
import type { RecoveryPointStore } from '../../profileBackup/recoveryPoint/recoveryPointStore.js';
import type { ProfileSnapshotInspectionPort } from '../../profileBackup/profileSnapshotInspectionPort.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../import/privateWorkspaceBackupCandidateAdapter.js';
import type { InMemoryWorkspaceMaintenanceLease, WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from '../replacement/workspaceBackupReplacementActivationFactory.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import { ElectronWorkspaceCandidateRuntimeFactory, type WorkspaceCandidateReservationOwner } from '../runtime/electronWorkspaceCandidateRuntimeFactory.js';
import type { ActiveWorkspaceStartupSelection } from '../runtime/resolveActiveWorkspaceStartup.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../runtime/workspaceCandidateRuntimePaths.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { NodeWorkspaceActivationMigrationStaging } from './nodeWorkspaceActivationMigrationStaging.js';
import { WorkspaceActivationMigrationCoordinator, type WorkspaceActivationMigrationRecoveryReceipt } from './workspaceActivationMigrationCoordinator.js';
import { createWorkspaceActivationMigrationCandidate } from './workspaceActivationMigrationCandidate.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';
import { WorkspaceActivationMigrationInspector } from './workspaceActivationMigrationInspector.js';
import { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';
import { WorkspaceActivationMigrationStartup } from './workspaceActivationMigrationStartup.js';
import { WorkspaceActivationMigrationBinding } from './workspaceActivationMigrationBinding.js';

export interface WorkspaceActivationMigrationCompositionOptions {
  readonly activeWorkspace: Readonly<ActiveWorkspaceStartupSelection>;
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly beforeCandidateMigration?: () => void;
  readonly completeSelectorRollback?: (receipt: WorkspaceActivationMigrationRecoveryReceipt) => Promise<void>;
  readonly maintenanceLease: WorkspaceMaintenanceLease & Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  readonly recoveryPointService: Pick<
    RecoveryPointService,
    'createPreMigration'
  >;
  readonly recoveryPointStore: Pick<RecoveryPointStore, 'stageForRestore'>;
  readonly recoveryPointStagingRoot: string;
  readonly recoveryPointStagingOwner: Pick<ProfileSnapshotInspectionPort, 'removeProfileSnapshot'>;
  readonly requestRelaunch: () => void;
  readonly resourcesPath: string;
  readonly reservationOwner: WorkspaceCandidateReservationOwner;
  readonly assertMainReservationOwned: () => Promise<void>;
  readonly assertMainReservationCurrent: () => void;
  readonly assertStartupCurrent: () => void;
  readonly blockContinuation: () => void;
  readonly userDataRoot: string;
}

export async function createWorkspaceActivationMigrationComposition(
  options: Readonly<WorkspaceActivationMigrationCompositionOptions>,
): Promise<WorkspaceActivationMigrationStartup> {
  const selector = options.activeWorkspace.switchContext?.sourceWorkspaceId === null;
  const completeSelectorRollback = options.completeSelectorRollback?.bind(options);
  const assertStartupCurrent = options.assertStartupCurrent.bind(options);
  const assertMainCurrent = options.assertMainReservationCurrent.bind(options);
  const assertMainOwned = options.assertMainReservationOwned.bind(options);
  const blockContinuation = options.blockContinuation.bind(options);
  const maintenanceLease = options.maintenanceLease;
  const userDataRoot = options.userDataRoot;
  if (
    options.activeWorkspace.mode !== 'targetValidation' ||
    options.activeWorkspace.switchContext === undefined ||
    options.activeWorkspace.rejectInvalidTarget === undefined ||
    options.activeWorkspace.requireRecovery === undefined ||
    (options.activeWorkspace.switchContext.sourceWorkspaceId === null) !==
      (options.activeWorkspace.selectorActivationAuthority !== undefined) ||
    (selector && completeSelectorRollback === undefined)
  ) {
    throw new WorkspaceActivationMigrationError(
      'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    );
  }

  const recoverSource = options.activeWorkspace.recoverFromFailure.bind(options.activeWorkspace);
  const switchOperationId = options.activeWorkspace.switchContext.operationId;
  let selectorRecoveryState: 'unused' | 'active' | 'complete' | 'failed' = 'unused';

  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    options.resourcesPath,
  );
  const runtimeFactory = new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: options.appVersion,
    backendRoot: runtimePaths.backendRoot,
    buildRevision: options.buildRevision,
    migrationsDirectory: runtimePaths.migrationsDirectory,
    runnerPath: runtimePaths.runnerPath,
    reservationOwner: options.reservationOwner,
  });
  const backupCandidate = new PrivateWorkspaceBackupCandidateAdapter(
    runtimeFactory,
  );
  const migrationCandidate = createWorkspaceActivationMigrationCandidate({
    candidate: backupCandidate,
    ...(options.beforeCandidateMigration === undefined
      ? {}
      : { beforeMigration: options.beforeCandidateMigration }),
  });
  const registry = new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  });
  const switchJournal = new WorkspaceSwitchJournalStore(
    userDataRoot,
  );
  const guard = new WorkspaceActivationMigrationGuard(
    registry,
    switchJournal,
    options.activeWorkspace.selectorActivationAuthority,
  );
  const runtimeAbsence = new StartupWorkspaceRuntimeAbsence(assertMainOwned);
  const recoveryPoint = new WorkspaceActivationMigrationRecoveryPoint(
    options.recoveryPointService,
    options.recoveryPointStore,
    new NodeWorkspaceActivationMigrationStaging(
      options.recoveryPointStagingRoot,
      options.recoveryPointStagingOwner,
    ),
  );
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    activationAuthorityFactory:
      new ProfileRestoreWorkspaceReplacementActivationFactory(),
    backupCandidate: migrationCandidate,
    createBinding: ({ lease, proof }) => new WorkspaceActivationMigrationBinding({
      userDataRoot, proof, lease,
      maintenanceLease, registry, switchJournal,
      startupOwner: { assertCurrent: assertStartupCurrent },
      stoppedOwner: { assertCurrent: assertMainCurrent, assertOwned: assertMainOwned },
      runtimeAbsence, onUncertain: blockContinuation,
    }),
    blockContinuation,
    guard,
    maintenanceLease,
    recoveryPoint,
    requestRelaunch: options.requestRelaunch,
    rootStore: new NodeWorkspaceBackupReplacementRootStore(),
    sourceRecovery: {
      async recoverFromFailure(receipt) {
        if (!selector) return recoverSource();
        try {
          if (selectorRecoveryState !== 'unused' || receipt === undefined ||
              (receipt.kind !== 'noActivation' && receipt.kind !== 'rolledBack') ||
              (receipt.kind === 'rolledBack' && (receipt.journal.operationId !== switchOperationId ||
                receipt.journal.phase !== 'rolledBack' || !receipt.journal.hadActiveDatabase))) {
            throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
          }
          selectorRecoveryState = 'active';
          await completeSelectorRollback!(receipt);
          if (selectorRecoveryState !== 'active') {
            throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
          }
          const outcome = await recoverSource();
          if (selectorRecoveryState !== 'active') {
            throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
          }
          selectorRecoveryState = 'complete';
          return outcome;
        } catch (error) {
          selectorRecoveryState = 'failed';
          throw error;
        }
      },
      requireRecovery: () => options.activeWorkspace.requireRecovery!(),
    },
    userDataRoot,
    workspaceRuntimeAbsence: runtimeAbsence,
  });
  const profilePaths = createDesktopProfilePaths(
    options.activeWorkspace.workspaceRoot,
  );

  return new WorkspaceActivationMigrationStartup({
    activeWorkspace: options.activeWorkspace,
    coordinator,
    guard,
    historicalValidation: backupCandidate,
    inspector: new WorkspaceActivationMigrationInspector(runtimeFactory),
    markTargetRuntimeStopped: () => runtimeAbsence.markStopped(),
    publishedValidationInput: {
      artifactRoot: profilePaths.invoiceDocumentStorageRoot,
      databaseFilePath: profilePaths.databaseFilePath,
      expectedProfileId:
        options.activeWorkspace.switchContext.targetProfileId,
      publishedRoot: options.activeWorkspace.workspaceRoot,
    },
    requestRelaunch: options.requestRelaunch,
    userDataRoot,
  });
}

class StartupWorkspaceRuntimeAbsence implements WorkspaceRuntimeAbsencePort {
  private stopped = false;

  constructor(private readonly assertMainReservationOwned: () => Promise<void>) {}

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    if (!this.stopped) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
    await this.assertMainReservationOwned();
  }

  markStopped(): void {
    this.stopped = true;
  }
}

import { join } from 'node:path';

import type { RecoveryPointService } from '../../profileBackup/recoveryPoint/recoveryPointService.js';
import type { RecoveryPointStore } from '../../profileBackup/recoveryPoint/recoveryPointStore.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../import/privateWorkspaceBackupCandidateAdapter.js';
import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from '../replacement/workspaceBackupReplacementActivationFactory.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../runtime/electronWorkspaceCandidateRuntimeFactory.js';
import type { ActiveWorkspaceStartupSelection } from '../runtime/resolveActiveWorkspaceStartup.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../runtime/workspaceCandidateRuntimePaths.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { NodeWorkspaceActivationMigrationStaging } from './nodeWorkspaceActivationMigrationStaging.js';
import { WorkspaceActivationMigrationCoordinator } from './workspaceActivationMigrationCoordinator.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';
import { WorkspaceActivationMigrationInspector } from './workspaceActivationMigrationInspector.js';
import { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';
import { WorkspaceActivationMigrationStartup } from './workspaceActivationMigrationStartup.js';

export interface WorkspaceActivationMigrationCompositionOptions {
  readonly activeWorkspace: Readonly<ActiveWorkspaceStartupSelection>;
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly recoveryPointService: Pick<
    RecoveryPointService,
    'createPreMigration'
  >;
  readonly recoveryPointStore: Pick<RecoveryPointStore, 'stageForRestore'>;
  readonly recoveryPointStagingRoot: string;
  readonly requestRelaunch: () => void;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
}

export async function createWorkspaceActivationMigrationComposition(
  options: Readonly<WorkspaceActivationMigrationCompositionOptions>,
): Promise<WorkspaceActivationMigrationStartup> {
  if (
    options.activeWorkspace.mode !== 'targetValidation' ||
    options.activeWorkspace.switchContext === undefined ||
    options.activeWorkspace.rejectInvalidTarget === undefined ||
    options.activeWorkspace.requireRecovery === undefined
  ) {
    throw new WorkspaceActivationMigrationError(
      'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    );
  }

  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    options.resourcesPath,
  );
  const runtimeFactory = new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: options.appVersion,
    backendRoot: runtimePaths.backendRoot,
    buildRevision: options.buildRevision,
    migrationsDirectory: runtimePaths.migrationsDirectory,
    runnerPath: runtimePaths.runnerPath,
  });
  const backupCandidate = new PrivateWorkspaceBackupCandidateAdapter(
    runtimeFactory,
  );
  const registry = new WorkspaceRegistryStore({
    filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: options.userDataRoot,
  });
  const switchJournal = new WorkspaceSwitchJournalStore(
    options.userDataRoot,
  );
  const guard = new WorkspaceActivationMigrationGuard(
    registry,
    switchJournal,
  );
  const runtimeAbsence = new StartupWorkspaceRuntimeAbsence();
  const recoveryPoint = new WorkspaceActivationMigrationRecoveryPoint(
    options.recoveryPointService,
    options.recoveryPointStore,
    new NodeWorkspaceActivationMigrationStaging(
      options.recoveryPointStagingRoot,
    ),
  );
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    activationAuthorityFactory:
      new ProfileRestoreWorkspaceReplacementActivationFactory(),
    backupCandidate,
    guard,
    maintenanceLease: options.maintenanceLease,
    recoveryPoint,
    requestRelaunch: options.requestRelaunch,
    rootStore: new NodeWorkspaceBackupReplacementRootStore(),
    sourceRecovery: {
      recoverFromFailure: () => options.activeWorkspace.recoverFromFailure(),
      requireRecovery: () => options.activeWorkspace.requireRecovery!(),
    },
    userDataRoot: options.userDataRoot,
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
    userDataRoot: options.userDataRoot,
  });
}

class StartupWorkspaceRuntimeAbsence implements WorkspaceRuntimeAbsencePort {
  private stopped = false;

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    if (!this.stopped) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }

  markStopped(): void {
    this.stopped = true;
  }
}

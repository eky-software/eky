import { join } from 'node:path';

import type { RecoveryPointService } from '../../profileBackup/recoveryPoint/recoveryPointService.js';
import type { LocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { EmptyWorkspaceCreationCoordinator } from '../creation/emptyWorkspaceCreationCoordinator.js';
import { PrivateEmptyWorkspaceBootstrapAdapter } from '../creation/privateEmptyWorkspaceBootstrapAdapter.js';
import {
  WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  createWorkspaceCreationJournalPaths,
} from '../creation/workspaceCreationJournalPaths.js';
import { WorkspaceCreationJournalStore } from '../creation/workspaceCreationJournalStore.js';
import { NodeWorkspaceCreationRootStore } from '../creation/workspaceCreationRootStore.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../import/privateWorkspaceBackupCandidateAdapter.js';
import { WorkspaceBackupContainerAdapter } from '../import/workspaceBackupContainerAdapter.js';
import { WorkspaceBackupImportCoordinator } from '../import/workspaceBackupImportCoordinator.js';
import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
  createWorkspaceBackupImportJournalPaths,
} from '../import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { NodeWorkspaceBackupImportRootStore } from '../import/workspaceBackupImportRootStore.js';
import { WorkspaceBackupPlaintextQuarantine } from '../import/workspaceBackupPlaintextQuarantine.js';
import type {
  WorkspaceMaintenanceLease,
  WorkspaceMaintenanceStateReader,
} from '../maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from '../replacement/workspaceBackupReplacementActivationFactory.js';
import { WorkspaceBackupReplacementCoordinator } from '../replacement/workspaceBackupReplacementCoordinator.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import type { WorkspaceReplacementRuntimeReadinessPort } from '../replacement/workspaceBackupReplacementPorts.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeRelaunchCompletion } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../runtime/workspaceCandidateRuntimePaths.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceSwitchCoordinator } from '../switch/workspaceSwitchCoordinator.js';
import {
  createWorkspaceSwitchJournalPaths,
  WorkspaceSwitchJournalStore,
} from '../switch/workspaceSwitchJournal.js';
import {
  createReadOnlyJournalSlotPaths,
  MainOwnedWorkspaceManagementOperationGuard,
} from './mainOwnedWorkspaceManagementOperationGuard.js';
import { WorkspaceLabelRename } from './workspaceLabelRename.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';

interface SharedWorkspaceRuntimeRelaunch
  extends WorkspaceRuntimeRelaunchCompletion {
  request(): void;
}

interface SharedWorkspaceMaintenanceLease
  extends WorkspaceMaintenanceLease,
    WorkspaceMaintenanceStateReader {}

interface SharedActiveWorkspaceLifecycle
  extends ActiveWorkspaceLifecyclePort,
    WorkspaceRuntimeAbsencePort {}

export interface WorkspaceManagementCompositionOptions {
  readonly activeWorkspaceId: WorkspaceId;
  readonly activeWorkspaceLifecycle: SharedActiveWorkspaceLifecycle;
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly localUpdateRuntimePaths: Pick<
    LocalUpdateRuntimePaths,
    'directSetupMigrationRecoveryPath' | 'journalPath'
  >;
  readonly maintenanceLease: SharedWorkspaceMaintenanceLease;
  readonly profileRestoreActivationJournalPath: string;
  readonly recoveryPointService: Pick<RecoveryPointService, 'createPreRestore'>;
  readonly resourcesPath: string;
  readonly runtimeRelaunch: SharedWorkspaceRuntimeRelaunch;
  readonly userDataRoot: string;
}

export interface WorkspaceManagementComposition {
  readonly service: WorkspaceManagementService;
  dispose(): void;
}

export async function createWorkspaceManagementComposition(
  options: Readonly<WorkspaceManagementCompositionOptions>,
): Promise<Readonly<WorkspaceManagementComposition>> {
  const candidateRuntimePaths = await resolveWorkspaceCandidateRuntimePaths(
    options.resourcesPath,
  );
  const candidateRuntimeFactory = new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: options.appVersion,
    backendRoot: candidateRuntimePaths.backendRoot,
    buildRevision: options.buildRevision,
    migrationsDirectory: candidateRuntimePaths.migrationsDirectory,
    runnerPath: candidateRuntimePaths.runnerPath,
  });
  const backupCandidate = new PrivateWorkspaceBackupCandidateAdapter(
    candidateRuntimeFactory,
  );
  const plaintextQuarantine = new WorkspaceBackupPlaintextQuarantine({
    userDataRoot: options.userDataRoot,
  });
  const backupContainer = new WorkspaceBackupContainerAdapter({
    plaintextQuarantine,
  });
  const registry = new WorkspaceRegistryStore({
    filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: options.userDataRoot,
  });
  const creationJournalPath = join(
    options.userDataRoot,
    WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  );
  const importJournalPath = join(
    options.userDataRoot,
    WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
  );
  const replacementRuntimePaths =
    deriveWorkspaceBackupReplacementRuntimePaths(
      options.userDataRoot,
      options.activeWorkspaceId,
    );
  const operationGuard = new MainOwnedWorkspaceManagementOperationGuard({
    adoptionJournal: createWorkspaceLegacyAdoptionJournalPaths(
      options.userDataRoot,
    ),
    creationJournal: createWorkspaceCreationJournalPaths(
      options.userDataRoot,
      creationJournalPath,
    ),
    directSetupRecovery: createReadOnlyJournalSlotPaths(
      options.localUpdateRuntimePaths.directSetupMigrationRecoveryPath,
    ),
    importJournal: createWorkspaceBackupImportJournalPaths(
      options.userDataRoot,
      importJournalPath,
    ),
    profileRestoreJournal: createReadOnlyJournalSlotPaths(
      options.profileRestoreActivationJournalPath,
    ),
    replacementJournal: createReadOnlyJournalSlotPaths(
      replacementRuntimePaths.activationJournalPath,
    ),
    switchJournal: createWorkspaceSwitchJournalPaths(options.userDataRoot),
    updateJournal: createReadOnlyJournalSlotPaths(
      options.localUpdateRuntimePaths.journalPath,
    ),
  });
  const createEmpty = new EmptyWorkspaceCreationCoordinator({
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    bootstrap: new PrivateEmptyWorkspaceBootstrapAdapter(
      candidateRuntimeFactory,
    ),
    creationJournal: new WorkspaceCreationJournalStore({
      filePath: creationJournalPath,
      installationRoot: options.userDataRoot,
    }),
    maintenanceLease: options.maintenanceLease,
    registry,
    rootStore: new NodeWorkspaceCreationRootStore(),
    userDataRoot: options.userDataRoot,
  });
  const importBackup = new WorkspaceBackupImportCoordinator({
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    backupCandidate,
    backupContainer,
    importJournal: new WorkspaceBackupImportJournalStore({
      filePath: importJournalPath,
      installationRoot: options.userDataRoot,
    }),
    maintenanceLease: options.maintenanceLease,
    plaintextQuarantine,
    registry,
    rootStore: new NodeWorkspaceBackupImportRootStore(),
    userDataRoot: options.userDataRoot,
    workspaceRuntimeAbsence: options.activeWorkspaceLifecycle,
  });
  const replaceActive = new WorkspaceBackupReplacementCoordinator({
    activationAuthorityFactory:
      new ProfileRestoreWorkspaceReplacementActivationFactory(),
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    backupCandidate,
    backupContainer,
    maintenanceLease: options.maintenanceLease,
    operationGuard,
    preRestoreRecoveryPoint: {
      async createPreRestore() {
        await options.recoveryPointService.createPreRestore();
      },
    },
    registry,
    rootStore: new NodeWorkspaceBackupReplacementRootStore(),
    runtimeHandoff: {
      requestRelaunch: () => options.runtimeRelaunch.request(),
    },
    runtimeReadiness: relaunchOnlyRuntimeReadiness,
    userDataRoot: options.userDataRoot,
    workspaceRuntimeAbsence: options.activeWorkspaceLifecycle,
  });
  const switchWorkspace = new WorkspaceSwitchCoordinator({
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    journal: new WorkspaceSwitchJournalStore(options.userDataRoot),
    maintenanceLease: options.maintenanceLease,
    registry,
    relaunchApplication: () => options.runtimeRelaunch.request(),
  });
  const renameWorkspace = new WorkspaceLabelRename({
    maintenanceLease: options.maintenanceLease,
    operationGuard,
    registry,
  });
  const service = new WorkspaceManagementService({
    createEmpty,
    importBackup,
    maintenanceState: options.maintenanceLease,
    operationGuard,
    registry,
    renameWorkspace,
    replaceActive,
    runtimeRelaunchCompletion: options.runtimeRelaunch,
    switchWorkspace,
  });

  return Object.freeze({
    service,
    dispose() {
      operationGuard.dispose();
    },
  });
}

const relaunchOnlyRuntimeReadiness: WorkspaceReplacementRuntimeReadinessPort =
  Object.freeze({
    async assertReady() {
      throw new Error('WORKSPACE_RUNTIME_RELAUNCH_REQUIRED');
    },
  });

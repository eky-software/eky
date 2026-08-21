import { join } from 'node:path';

import type { DesktopBuildInfo } from '../../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../../release/desktopReleaseInfo.js';
import type { AcceptedBuildMetadataStore } from '../../update/acceptedBuildMetadataStore.js';
import type { DirectSetupMigrationRecoveryStore } from '../../update/directSetupMigrationRecoveryStore.js';
import { PreBackendFirstStartFailureAuthority } from '../../update/preBackendFirstStartFailureAuthority.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import type { UpdateJournalStore } from '../../update/updateJournalStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../runtime/workspaceCandidateRuntimePaths.js';
import { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import { WorkspaceFirstStartMigrationOrchestrator } from './workspaceFirstStartMigrationOrchestrator.js';
import type { WorkspaceFirstStartMigrationOrchestration } from './workspaceFirstStartMigrationOrchestratorTypes.js';
import { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';
import { WorkspaceMigrationInventoryCoordinator } from './workspaceMigrationInventoryCoordinator.js';

export interface WorkspaceFirstStartMigrationCompositionOptions {
  readonly acceptedBuildStore: AcceptedBuildMetadataStore;
  readonly admission: PreWorkspaceBuildAdmission;
  readonly buildInfo: Readonly<DesktopBuildInfo>;
  readonly directSetupRecoveryStore: DirectSetupMigrationRecoveryStore;
  readonly releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  readonly resourcesPath: string;
  readonly updateJournalStore: UpdateJournalStore;
  readonly userDataRoot: string;
}

export function createWorkspaceFirstStartMigrationComposition(
  options: Readonly<WorkspaceFirstStartMigrationCompositionOptions>,
): WorkspaceFirstStartMigrationOrchestration {
  const registry = new WorkspaceRegistryStore({
    filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: options.userDataRoot,
  });
  const journal = new WorkspaceFirstStartMigrationJournalStore({
    userDataPath: options.userDataRoot,
  });
  const transitions = new WorkspaceFirstStartMigrationTransitionCoordinator({
    acceptedBuild: options.acceptedBuildStore,
    journal,
    registry,
  });
  let inventoryCoordinator:
    | Promise<WorkspaceMigrationInventoryCoordinator>
    | undefined;

  return new WorkspaceFirstStartMigrationOrchestrator({
    acceptedBuild: options.acceptedBuildStore,
    admission: options.admission,
    failureAuthority: new PreBackendFirstStartFailureAuthority({
      acceptedBuildStore: options.acceptedBuildStore,
      directSetupRecoveryStore: options.directSetupRecoveryStore,
      journalStore: options.updateJournalStore,
      releaseInfo: options.releaseInfo,
    }),
    inventory: {
      async inspect(signal) {
        inventoryCoordinator ??= createInventoryCoordinator(options, registry);
        return (await inventoryCoordinator).inspect(signal);
      },
    },
    journal,
    registry,
    runningBuild: Object.freeze({
      appVersion: options.buildInfo.appVersion,
      buildRevision: options.buildInfo.buildRevision,
    }),
    transitions,
  });
}

async function createInventoryCoordinator(
  options: Readonly<WorkspaceFirstStartMigrationCompositionOptions>,
  registry: WorkspaceRegistryStore,
): Promise<WorkspaceMigrationInventoryCoordinator> {
  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    options.resourcesPath,
  );
  const runtimeFactory = new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: options.buildInfo.appVersion,
    backendRoot: runtimePaths.backendRoot,
    buildRevision: options.buildInfo.buildRevision,
    migrationsDirectory: runtimePaths.migrationsDirectory,
    runnerPath: runtimePaths.runnerPath,
  });
  return new WorkspaceMigrationInventoryCoordinator({
    registry,
    runtimeFactory,
    userDataRoot: options.userDataRoot,
  });
}

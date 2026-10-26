import { join } from 'node:path';

import type { DesktopBuildInfo } from '../../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../../release/desktopReleaseInfo.js';
import type { AcceptedBuildMetadataStore } from '../../update/acceptedBuildMetadataStore.js';
import type { DirectSetupMigrationRecoveryStore } from '../../update/directSetupMigrationRecoveryStore.js';
import { PreBackendFirstStartFailureAuthority } from '../../update/preBackendFirstStartFailureAuthority.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import type { UpdateJournalStore } from '../../update/updateJournalStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import type { WorkspaceRegistryInspectionPort } from '../registry/workspaceRegistryPort.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { ElectronWorkspaceCandidateRuntimeFactory, type WorkspaceCandidateReservationOwner } from '../runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../runtime/workspaceCandidateRuntimePaths.js';
import { WorkspaceFirstStartMigrationJournalStore } from './workspaceFirstStartMigrationJournalStore.js';
import { WorkspaceFirstStartMigrationOrchestrator } from './workspaceFirstStartMigrationOrchestrator.js';
import type { WorkspaceFirstStartMigrationOrchestration } from './workspaceFirstStartMigrationOrchestratorTypes.js';
import { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';
import { WorkspaceMigrationInventoryCoordinator } from './workspaceMigrationInventoryCoordinator.js';
import type { WorkspaceFirstStartDeferredBusinessAuthority } from './workspaceFirstStartDeferredBusiness.js';
import { createWorkspaceFirstStartSelectedPersistence, type WorkspaceFirstStartSelectedPersistenceAuthority } from './workspaceFirstStartSelectedPersistence.js';
import { WorkspaceFirstStartMigrationTransitionError } from './workspaceFirstStartMigrationJournalError.js';
import type { VersionedAcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import type { WorkspaceFirstStartMigrationJournalPort } from './workspaceFirstStartMigrationJournalTypes.js';

export interface WorkspaceFirstStartMigrationCompositionOptions {
  readonly acceptedBuildStore: AcceptedBuildMetadataStore;
  readonly admission: PreWorkspaceBuildAdmission;
  // Main admits an exact business build and the absence of W6 work. Both
  // existing owners read that bound observation without legacy slot repair.
  readonly acceptedSelector?: Readonly<{
    readAcceptedBuild(): Promise<VersionedAcceptedBuildMetadata>;
    readFirstStartJournal: WorkspaceFirstStartMigrationJournalPort['read'];
    rejectWrite(): Promise<never>;
  }>;
  readonly deferredBusiness?: WorkspaceFirstStartDeferredBusinessAuthority & {
    readonly persistence: WorkspaceFirstStartSelectedPersistenceAuthority;
  };
  readonly operationIdFactory?: () => string;
  readonly buildInfo: Readonly<DesktopBuildInfo>;
  readonly directSetupRecoveryStore: DirectSetupMigrationRecoveryStore;
  readonly releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  readonly resourcesPath: string;
  readonly reservationOwner: WorkspaceCandidateReservationOwner;
  readonly updateJournalStore: UpdateJournalStore;
  readonly userDataRoot: string;
}

export function createWorkspaceFirstStartMigrationComposition(
  options: Readonly<WorkspaceFirstStartMigrationCompositionOptions>,
): WorkspaceFirstStartMigrationOrchestration {
  const acceptedSelector = options.acceptedSelector;
  if (acceptedSelector !== undefined && (options.admission !== 'exactAcceptedBuild' || options.deferredBusiness !== undefined)) {
    throw new WorkspaceFirstStartMigrationTransitionError('recoveryRequired');
  }
  const registryStore = new WorkspaceRegistryStore({
    filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: options.userDataRoot,
  });
  const journalStore = new WorkspaceFirstStartMigrationJournalStore({
    userDataPath: options.userDataRoot,
  });
  const persistence = acceptedSelector !== undefined ? {
    registry: { inspect: registryStore.inspect.bind(registryStore),
      read: registryStore.inspect.bind(registryStore), write: acceptedSelector.rejectWrite },
    journal: {
      read: acceptedSelector.readFirstStartJournal,
      async inspect() { await acceptedSelector.readFirstStartJournal(); return undefined; },
      write: acceptedSelector.rejectWrite, discardPrepared: acceptedSelector.rejectWrite,
      removeTransitioned: acceptedSelector.rejectWrite,
    },
  } : options.deferredBusiness === undefined
    ? { registry: registryStore, journal: journalStore }
    : createWorkspaceFirstStartSelectedPersistence({ registry: registryStore, journal: journalStore },
      options.deferredBusiness.persistence);
  const { registry, journal } = persistence;
  const inspectAccepted = options.acceptedBuildStore.inspectSlots.bind(options.acceptedBuildStore);
  const acceptedBuild = acceptedSelector !== undefined ? { read: acceptedSelector.readAcceptedBuild }
    : options.deferredBusiness === undefined ? options.acceptedBuildStore : {
    async read() {
      const slots = await inspectAccepted();
      if (slots.current?.identity === undefined || slots.next !== undefined || slots.backup !== undefined) {
        throw new WorkspaceFirstStartMigrationTransitionError('recoveryRequired');
      }
      return slots.current.value;
    },
  };
  const transitions = new WorkspaceFirstStartMigrationTransitionCoordinator({
    acceptedBuild,
    journal,
    registry,
    ...(options.deferredBusiness === undefined ? {} : { deferredBusiness: options.deferredBusiness }),
  });
  let inventoryCoordinator:
    | Promise<WorkspaceMigrationInventoryCoordinator>
    | undefined;

  return new WorkspaceFirstStartMigrationOrchestrator({
    acceptedBuild,
    admission: options.admission,
    ...(options.operationIdFactory === undefined ? {} : { operationIdFactory: options.operationIdFactory }),
    ...(options.deferredBusiness === undefined ? {} : { deferredBusiness: options.deferredBusiness }),
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
    ...('settleSelectorRegistry' in persistence ? { settleSelectorRegistry: persistence.settleSelectorRegistry } : {}),
  });
}

async function createInventoryCoordinator(
  options: Readonly<WorkspaceFirstStartMigrationCompositionOptions>,
  registry: WorkspaceRegistryInspectionPort,
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
    reservationOwner: options.reservationOwner,
  });
  return new WorkspaceMigrationInventoryCoordinator({
    registry,
    runtimeFactory,
    userDataRoot: options.userDataRoot,
  });
}

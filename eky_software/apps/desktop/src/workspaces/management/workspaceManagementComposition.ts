import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { RecoveryPointService } from '../../profileBackup/recoveryPoint/recoveryPointService.js';
import type { LocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { isTerminalUpdateJournalState } from '../../update/startupRecoveryAuthority.js';
import { parseUpdateJournal } from '../../update/updateJournal.js';
import { assertUpdateJournalAuthority, maximumUpdateJournalBytes } from '../../update/updateJournalStore.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { EmptyWorkspaceCreationCoordinator } from '../creation/emptyWorkspaceCreationCoordinator.js';
import { EmptyWorkspaceCreationRecovery } from '../creation/emptyWorkspaceCreationRecovery.js';
import { PrivateEmptyWorkspaceBootstrapAdapter, PrivatePublishedWorkspaceValidationAdapter } from '../creation/privateEmptyWorkspaceBootstrapAdapter.js';
import {
  WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  createWorkspaceCreationJournalPaths,
} from '../creation/workspaceCreationJournalPaths.js';
import { WorkspaceCreationJournalStore } from '../creation/workspaceCreationJournalStore.js';
import { NodeWorkspaceCreationRootStore } from '../creation/workspaceCreationRootStore.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../import/privateWorkspaceBackupCandidateAdapter.js';
import { WorkspaceBackupContainerAdapter } from '../import/workspaceBackupContainerAdapter.js';
import { WorkspaceBackupImportCoordinator } from '../import/workspaceBackupImportCoordinator.js';
import { WorkspaceBackupImportRecovery } from '../import/workspaceBackupImportRecovery.js';
import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME,
  createWorkspaceBackupImportJournalPaths,
} from '../import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { NodeWorkspaceBackupImportRootStore } from '../import/workspaceBackupImportRootStore.js';
import { WorkspaceBackupPlaintextQuarantine } from '../import/workspaceBackupPlaintextQuarantine.js';
import type {
  InMemoryWorkspaceMaintenanceLease,
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
import { ElectronWorkspaceCandidateRuntimeFactory, type WorkspaceCandidateReservationOwner } from '../runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../runtime/workspaceCandidateRuntimePaths.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { assertNoSelectorWorkspaceRecoveryFromRoot } from '../runtime/workspaceColdRecoveryAdmissionComposition.js';
import { hasAnyJournalSlot, hasTerminalJournalConflict } from '../persistence/readOnlyJournalSlots.js';
import { captureWorkspaceSelectorSwitchSelection } from '../switch/workspaceSelectorSwitchSelection.js';
import type { WorkspaceColdRecoveryAdmission } from '../runtime/workspaceColdRecoveryAdmission.js';
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
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { createWorkspaceBackupOperationalObserver } from './workspaceBackupOperationalObserver.js';
import { prepareWorkspaceDeletion, type WorkspaceDeletionPreparationOptions } from './workspaceDeletionPreparation.js';
import type { DesktopOperationalIdentity } from '../../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../../observability/desktopOperationalLogger.js';

interface SharedWorkspaceRuntimeRelaunch
  extends WorkspaceRuntimeRelaunchCompletion {
  request(): void;
}

interface SharedWorkspaceMaintenanceLease
  extends WorkspaceMaintenanceLease,
    WorkspaceMaintenanceStateReader,
    Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'> {}

export interface WorkspaceDeletionPreparationCompositionOptions extends Pick<WorkspaceDeletionPreparationOptions,
  'runtimeGeneration' | 'assertMainReservation' | 'assertMainReservationCurrent' |
  'confirmDataLoss' | 'confirmDeletion' | 'confirmReturn' | 'publish'> {
  createRuntime(): WorkspaceDeletionPreparationOptions['runtime'];
}

interface SharedActiveWorkspaceLifecycle
  extends ActiveWorkspaceLifecyclePort,
    WorkspaceRuntimeAbsencePort {}

export interface WorkspaceManagementCompositionOptions {
  readonly mode?: 'active';
  readonly operationalIdentity: DesktopOperationalIdentity;
  readonly operationalLogger: DesktopOperationalLogger;
  readonly activeWorkspaceId: WorkspaceId;
  readonly activeWorkspaceLifecycle: SharedActiveWorkspaceLifecycle;
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly deletionPreparation?: Readonly<WorkspaceDeletionPreparationCompositionOptions>;
  readonly localUpdateRuntimePaths: Pick<
    LocalUpdateRuntimePaths,
    'directSetupMigrationRecoveryPath' | 'journalPath'
  >;
  readonly maintenanceLease: SharedWorkspaceMaintenanceLease;
  readonly profileRestoreActivationJournalPath: string;
  readonly recoveryPointService: Pick<RecoveryPointService, 'createPreRestore'>;
  readonly resourcesPath: string;
  readonly reservationOwner: WorkspaceCandidateReservationOwner;
  readonly runtimeRelaunch: SharedWorkspaceRuntimeRelaunch;
  readonly userDataRoot: string;
}

export interface SelectorWorkspaceManagementCompositionOptions extends Omit<WorkspaceManagementCompositionOptions,
  'mode' | 'activeWorkspaceId' | 'activeWorkspaceLifecycle' | 'localUpdateRuntimePaths' |
  'profileRestoreActivationJournalPath' | 'recoveryPointService'> {
  readonly mode: 'selector';
  readonly activeWorkspaceLifecycle: MainOwnedSelectorWorkspaceLifecycle;
  readonly maintenanceLease: SharedWorkspaceMaintenanceLease & Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  readonly localUpdateRuntimePaths: Pick<LocalUpdateRuntimePaths,
    'directSetupMigrationRecoveryPath' | 'journalPath' | 'legacyJournalPath'>;
  assertCurrent(): void;
}

export interface WorkspaceManagementComposition {
  readonly service: WorkspaceManagementService;
  readActiveWorkspaceLabel(): Promise<string>;
  dispose(): void;
  shutdown(): Promise<void>;
}

export type SelectorWorkspaceManagementComposition = Omit<WorkspaceManagementComposition, 'readActiveWorkspaceLabel'>;

type WorkspaceCandidateCompositionOptions = Pick<WorkspaceManagementCompositionOptions,
  'appVersion' | 'buildRevision' | 'resourcesPath' | 'reservationOwner'>;

export async function recoverWorkspaceManagementBeforeRuntime(
  options: Readonly<WorkspaceCandidateCompositionOptions & {
    admission: WorkspaceColdRecoveryAdmission;
    assertRecoveryAdmission(): Promise<void>;
    maintenanceLease: WorkspaceMaintenanceLease;
    userDataRoot: string;
    workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
  }>,
): Promise<void> {
  await options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
  await options.assertRecoveryAdmission();
  const plaintextQuarantine = new WorkspaceBackupPlaintextQuarantine({ userDataRoot: options.userDataRoot });
  if (options.admission !== 'import') {
    // Without a guarded import journal, an old writer cannot be ruled out.
    await plaintextQuarantine.assertNoStalePayloads();
  }
  if (options.admission === 'none') return;

  const runtime = await createCandidateRuntimeFactory(options);
  const registry = new WorkspaceRegistryStore({
    filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: options.userDataRoot,
  });
  const shared = {
    completionMode: 'beforeRuntimeStart' as const,
    assertRecoveryAdmission: options.assertRecoveryAdmission,
    maintenanceLease: options.maintenanceLease,
    registry,
    userDataRoot: options.userDataRoot,
    workspaceRuntimeAbsence: options.workspaceRuntimeAbsence,
  };
  if (options.admission === 'creation') {
    await new EmptyWorkspaceCreationRecovery({
      ...shared,
      creationJournal: new WorkspaceCreationJournalStore({
        installationRoot: options.userDataRoot,
        filePath: join(options.userDataRoot, WORKSPACE_CREATION_JOURNAL_FILE_NAME),
      }),
      rootStore: new NodeWorkspaceCreationRootStore(),
      publishedWorkspaceValidation: new PrivatePublishedWorkspaceValidationAdapter(runtime),
    }).recover();
  } else {
    await new WorkspaceBackupImportRecovery({
      ...shared,
      importJournal: new WorkspaceBackupImportJournalStore({
        installationRoot: options.userDataRoot,
        filePath: join(options.userDataRoot, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME),
      }),
      rootStore: new NodeWorkspaceBackupImportRootStore(),
      backupCandidate: new PrivateWorkspaceBackupCandidateAdapter(runtime),
      plaintextQuarantine,
    }).recover();
  }
  await options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
}

export function createWorkspaceManagementComposition(
  options: Readonly<WorkspaceManagementCompositionOptions>,
): Promise<Readonly<WorkspaceManagementComposition>>;
export function createWorkspaceManagementComposition(
  options: Readonly<SelectorWorkspaceManagementCompositionOptions>,
): Promise<Readonly<SelectorWorkspaceManagementComposition>>;
export async function createWorkspaceManagementComposition(
  options: Readonly<WorkspaceManagementCompositionOptions | SelectorWorkspaceManagementCompositionOptions>,
): Promise<Readonly<WorkspaceManagementComposition | SelectorWorkspaceManagementComposition>> {
  const candidateRuntimeFactory = await createCandidateRuntimeFactory(options);
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
  const operationGuard = options.mode === 'selector'
    ? createSelectorOperationGuard(options)
    : new MainOwnedWorkspaceManagementOperationGuard({
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
      deriveWorkspaceBackupReplacementRuntimePaths(options.userDataRoot, options.activeWorkspaceId).activationJournalPath,
    ),
    switchJournal: createWorkspaceSwitchJournalPaths(options.userDataRoot),
    updateJournal: createReadOnlyJournalSlotPaths(
      options.localUpdateRuntimePaths.journalPath,
    ),
  });
  const createEmpty = new EmptyWorkspaceCreationCoordinator({
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    workspaceRuntimeAbsence: options.activeWorkspaceLifecycle,
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
  const replaceActive = options.mode === 'selector' ? undefined : new WorkspaceBackupReplacementCoordinator({
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
  const switchWorkspace = new WorkspaceSwitchCoordinator(options.mode === 'selector' ? {
    mode: 'selector',
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    assertCurrent: options.assertCurrent.bind(options),
    journal: new WorkspaceSwitchJournalStore(options.userDataRoot),
    maintenanceLease: options.maintenanceLease,
    registry,
    relaunchApplication: () => options.runtimeRelaunch.request(),
  } : {
    activeWorkspaceLifecycle: options.activeWorkspaceLifecycle,
    journal: new WorkspaceSwitchJournalStore(options.userDataRoot),
    maintenanceLease: options.maintenanceLease,
    registry,
    relaunchApplication: () => options.runtimeRelaunch.request(),
  });
  const renameOptions = {
    maintenanceLease: options.maintenanceLease,
    operationGuard,
    registry,
  };
  const renameWorkspace = new WorkspaceLabelRename(options.mode === 'selector' ? {
    ...renameOptions, mode: 'selector', assertCurrent: options.assertCurrent.bind(options),
    captureCurrentOwner: () => options.maintenanceLease.captureCurrentOwner(['rename']),
  } : renameOptions);
  let assertDeletionReturn: (() => void) | undefined;
  const deletion = options.deletionPreparation;
  const service = new WorkspaceManagementService({
    observer: createWorkspaceBackupOperationalObserver({
      operationalIdentity: options.operationalIdentity,
      operationalLogger: options.operationalLogger,
    }),
    createEmpty,
    importBackup,
    maintenanceState: options.maintenanceLease,
    operationGuard,
    registry: options.mode === 'selector' ? { read: () => new WorkspaceRegistryStore({
      installationRoot: options.userDataRoot,
      filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    }).inspect() } : registry,
    renameWorkspace,
    ...(replaceActive === undefined ? {} : { replaceActive }),
    ...(deletion === undefined ? {} : { deletionPreparation: {
      maintenanceLease: options.maintenanceLease,
      prepare: (request, lifetime, assertLease) => prepareWorkspaceDeletion({
        operationId: randomUUID(), installationRoot: options.userDataRoot,
        runtimeGeneration: deletion.runtimeGeneration, registry, request, lifetime, assertLease,
        runtime: deletion.createRuntime(),
        assertMainReservation: () => deletion.assertMainReservation(),
        assertMainReservationCurrent: () => deletion.assertMainReservationCurrent(),
        confirmDataLoss: target => deletion.confirmDataLoss(target),
        confirmDeletion: target => deletion.confirmDeletion(target),
        confirmReturn: target => deletion.confirmReturn(target),
        closeServiceAdmission: (): void => service.closeAdmission(),
        setReturnGuard(guard) {
          if (assertDeletionReturn !== undefined) throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
          assertDeletionReturn = guard;
        },
        publish: (assertAuthority, assertSelection, target) => deletion.publish(assertAuthority, assertSelection, target),
      }),
    } }),
    runtimeRelaunchCompletion: deletion === undefined ? options.runtimeRelaunch : {
      complete(assertCurrent) {
        // The service still owns the exact lease while both guards run.
        const assertReturn = assertDeletionReturn;
        try {
          options.runtimeRelaunch.complete(() => {
            if (assertCurrent !== undefined) assertUpdateJournalAuthority(assertCurrent);
            if (assertReturn !== undefined) assertUpdateJournalAuthority(assertReturn);
          });
        } finally { assertDeletionReturn = undefined; }
      },
    },
    switchWorkspace,
  });

  const composition: SelectorWorkspaceManagementComposition = Object.freeze({
    service,
    dispose() {
      service.closeAdmission();
      operationGuard.dispose();
    },
    async shutdown() {
      await service.shutdown();
      operationGuard.dispose();
    },
  });
  if (options.mode === 'selector') return composition;
  return Object.freeze({ ...composition, async readActiveWorkspaceLabel() {
    const current = await registry.inspect();
    const workspace = current?.workspaces.find(entry => entry.workspaceId === options.activeWorkspaceId);
    if (current?.activeWorkspaceId !== options.activeWorkspaceId || workspace?.lifecycleState !== 'ready') {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
    }
    return workspace.workspaceLabel;
  } });
}

function createSelectorOperationGuard(options: Readonly<SelectorWorkspaceManagementCompositionOptions>) {
  const assertCurrent = () => {
    const result: unknown = options.assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
    }
  };
  return new MainOwnedWorkspaceManagementOperationGuard({ mode: 'selector',
    async assertNoUnresolvedSelectorOperations() {
      assertCurrent();
      // Each admitted read owns its inspectors; status may overlap a command.
      const registry = new WorkspaceRegistryStore({ installationRoot: options.userDataRoot,
        filePath: join(options.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) });
      const journal = new WorkspaceSwitchJournalStore(options.userDataRoot);
      const registrySlots = await registry.inspectSlots();
      assertCurrent();
      const journalSlots = await journal.inspectSlots();
      assertCurrent();
      const selected = registrySlots.current?.value;
      if (selected?.formatVersion !== 2 || selected.activeWorkspaceId !== null ||
        registrySlots.next !== undefined || registrySlots.backup !== undefined) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      }
      const captured = captureWorkspaceSelectorSwitchSelection({ registrySlots, journalSlots,
        readRegistrySlots: () => registry.inspectSlots(), assertAuthority: assertCurrent });
      await assertNoSelectorWorkspaceRecoveryFromRoot(options.userDataRoot, selected);
      assertCurrent();
      if (await hasAnyJournalSlot(createReadOnlyJournalSlotPaths(options.localUpdateRuntimePaths.legacyJournalPath)) ||
        await hasTerminalJournalConflict(createReadOnlyJournalSlotPaths(options.localUpdateRuntimePaths.journalPath),
          maximumUpdateJournalBytes, parseUpdateJournal, value => isTerminalUpdateJournalState(value.state))) {
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
      }
      await captured.guard.assertExternalSelection();
      captured.assertJournalSelection(await journal.inspectSlots());
      await captured.guard.assertExternalSelection();
      assertCurrent();
    },
  });
}

async function createCandidateRuntimeFactory(options: Readonly<WorkspaceCandidateCompositionOptions>) {
  const paths = await resolveWorkspaceCandidateRuntimePaths(options.resourcesPath);
  return new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: options.appVersion,
    backendRoot: paths.backendRoot,
    buildRevision: options.buildRevision,
    migrationsDirectory: paths.migrationsDirectory,
    runnerPath: paths.runnerPath,
    reservationOwner: options.reservationOwner,
  });
}

const relaunchOnlyRuntimeReadiness: WorkspaceReplacementRuntimeReadinessPort =
  Object.freeze({
    async assertReady() {
      throw new Error('WORKSPACE_RUNTIME_RELAUNCH_REQUIRED');
    },
  });

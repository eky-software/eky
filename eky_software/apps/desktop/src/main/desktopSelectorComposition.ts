import { join } from 'node:path';
import { bindWorkspaceDeletionContinuation, createWorkspaceDeletionResultRuntime } from './workspaceDeletionContinuation.js';
import { BrowserWindow, ipcMain, session } from 'electron';

import { createOperationalLogFailureCapability } from '../diagnostics/operationalLogFailureCapability.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalEventInput, DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import type { IncidentIndexDesktopLogFailureSink } from '../observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import { createBackupPasswordWindowController, type BackupPasswordWindowController } from '../profileBackup/passwordWindow/backupPasswordWindow.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { registerElectronPermissionPolicy } from '../security/electronPermissionPolicy.js';
import { createDesktopOnlySupportBundleCapability } from '../supportBundle/supportBundleCapability.js';
import { readSupportBundleDesktopData } from '../supportBundle/supportBundleDesktopData.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import type { LocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceManagementCapability } from '../workspaces/management/workspaceManagementCapability.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { createWorkspaceManagementComposition, type SelectorWorkspaceManagementComposition } from '../workspaces/management/workspaceManagementComposition.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import { createWorkspaceDeletionConfirmations } from '../workspaces/management/createWorkspaceDeletionConfirmations.js';
import { prepareWorkspaceDeletion, type WorkspaceDeletionPreparationOptions } from '../workspaces/management/workspaceDeletionPreparation.js';
import { createReadOnlyJournalSlotPaths } from '../workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { createWorkspaceDeletionCommand } from '../workspaces/deletion/workspaceDeletionCommand.js';
import { hasAnyJournalSlot } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { captureWorkspaceDeletionExternalSelectionFromRoot } from '../workspaces/runtime/workspaceDeletionColdAdmission.js';
import type { WorkspaceSelectorStartupSelection } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import { createApplicationWindow, loadApplicationWindow } from './applicationWindow.js';
import type { acquireDesktopWorkspaceReservation, DesktopCompositionDependencies, DesktopLifecycleHandle, StartDesktopCompositionOptions } from './desktopComposition.js';
import { reportDesktopStarted } from './desktopStartupCompletion.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';
import { assertPackagedSelectorSmokeConfiguration, packagedSelectorVerificationPhase,
  resolvePackagedSmokeSupportBundlePath } from './packagedSmoke.js';
import type { DesktopWorkspaceRecoveryOffer, DesktopWorkspaceRecoveryOwner } from './desktopWorkspaceRecoverySelection.js';
import type { DesktopWorkspaceRecoveryReadAuthority } from './desktopWorkspaceRecoverySources.js';

interface SharedDesktopSelectorCompositionOptions {
  options: StartDesktopCompositionOptions;
  dependencies: Pick<DesktopCompositionDependencies,
    'showOpenDialog' | 'showSaveDialog' | 'showErrorBox' | 'showMessageBox' | 'createWorkspaceManagementCapability'>;
  reservation: Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>>;
  maintenanceLease: InMemoryWorkspaceMaintenanceLease;
  localUpdateRuntimePaths: LocalUpdateRuntimePaths;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
  failureSink: IncidentIndexDesktopLogFailureSink;
  startedAt: number;
}

type DesktopSelectorCompositionOptions = SharedDesktopSelectorCompositionOptions & (
  | { mode?: 'selector'; selection: WorkspaceSelectorStartupSelection }
  | { mode: 'recoveryManagement'; selection: DesktopWorkspaceRecoveryOffer;
      runtimeAbsence: DesktopWorkspaceRecoveryReadAuthority }
);

/** Installation UI only. No business runtime, session, broker or database. */
export async function startDesktopSelectorComposition(input: DesktopSelectorCompositionOptions): Promise<DesktopLifecycleHandle> {
  const { options, reservation, maintenanceLease } = input;
  const selectorSmoke = input.mode !== 'recoveryManagement' && options.smokeConfiguration.phase === packagedSelectorVerificationPhase
    ? Object.freeze({ ...options.smokeConfiguration }) : undefined;
  if (selectorSmoke !== undefined) assertPackagedSelectorSmokeConfiguration(selectorSmoke, options.userDataPath);
  const smokeSupportBundlePath = selectorSmoke === undefined ? undefined : resolvePackagedSmokeSupportBundlePath(selectorSmoke);
  const observeDeletionPhase = createWorkspaceDeletionPhaseProducer(options.observeWorkspaceDeletionPhase);
  let deletionObservationStarted = false;
  const observeDeletionDetail = createWorkspaceDeletionPhaseProducer(options.observeWorkspaceDeletionDetail, () => deletionObservationStarted);
  let alive = true;
  let shutdownTask: Promise<void> | undefined;
  let mainWindow: BrowserWindow | undefined;
  let management: SelectorWorkspaceManagementComposition | undefined;
  let capability: WorkspaceManagementCapability | undefined;
  let passwordWindow: BackupPasswordWindowController | undefined;
  let logFailureCapability: ReturnType<typeof createOperationalLogFailureCapability> | undefined;
  let supportBundleCapability: ReturnType<typeof createDesktopOnlySupportBundleCapability> | undefined;
  let recoveryOwner: DesktopWorkspaceRecoveryOwner | undefined;
  let recoveryExternalSelection: Awaited<ReturnType<typeof captureWorkspaceDeletionExternalSelectionFromRoot>> | undefined;
  let recoveryDeletionRuntime: ReturnType<typeof createWorkspaceDeletionResultRuntime> | undefined;
  let ownershipFailure: { cause: unknown } | undefined;
  const recovery = input.mode === 'recoveryManagement' ? {
    selection: input.selection,
    absence: Object.freeze({ assertCurrent: input.runtimeAbsence.assertCurrent.bind(input.runtimeAbsence),
      assertOwned: input.runtimeAbsence.assertOwned.bind(input.runtimeAbsence) }),
  } : undefined;
  const assertInstallationCurrent = () => {
    if (!alive) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
    options.assertSingleInstanceOwnership();
    reservation.assertInstallationCurrent();
  };
  // Closing admission is not loss of physical ownership: cleanup still needs its proof.
  const assertRecoveryOwnedCurrent = () => {
    if (ownershipFailure !== undefined) throw ownershipFailure.cause;
    try {
      if (recovery === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      assertInstallationCurrent(); reservation.assertMainCurrent(); assertUpdateJournalAuthority(recovery.absence.assertCurrent);
    }
    catch (cause) { ownershipFailure ??= { cause }; throw ownershipFailure.cause; }
  };
  const assertRecoveryOwned = () => observeDeletionDetail('reservation', async () => {
    assertRecoveryOwnedCurrent();
    try {
      if (recovery === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      // The startup-bound absence proof also checks the captured main reservation.
      const result: unknown = await recovery.absence.assertOwned();
      assertRecoveryOwnedCurrent();
      if (result !== undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    } catch (cause) { ownershipFailure ??= { cause }; throw ownershipFailure.cause; }
  });
  const assertCurrent = recovery === undefined ? assertInstallationCurrent : assertRecoveryOwnedCurrent;
  const assertMainOwned = recovery === undefined ? () => reservation.assertMainOwned() : assertRecoveryOwned;
  const assertRecoveryAdmission = () => {
    assertRecoveryOwnedCurrent();
    if (shutdownTask !== undefined || options.recoveryStartup?.isClosing()) {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
    }
  };
  const assertRecoveryAdmissionOwned = async () => {
    assertRecoveryAdmission(); await assertRecoveryOwned(); assertRecoveryAdmission();
  };
  const assertSelected = async () => {
    if (recovery === undefined) {
      await input.selection.assertCurrent();
    } else {
      assertRecoveryAdmission();
      if (recoveryOwner === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await (recoveryExternalSelection ?? recoveryOwner).assertSelected();
      assertRecoveryAdmission();
    }
  };
  const write = <Input extends DesktopOperationalEventInput>(event: Readonly<Input>) =>
    input.operationalLogger.write(createDesktopOperationalEvent(event, input.operationalIdentity));
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(() => {
    assertCurrent();
    if (shutdownTask !== undefined) return;
    reservation.assertMainCurrent();
    options.relaunchApplication();
  });

  const shutdown = (): Promise<void> => {
    if (shutdownTask !== undefined) return shutdownTask;
    // Seal admission immediately, but keep the owner alive until admitted work
    // has settled. A command's own relaunch must not wait for itself.
    const failures: unknown[] = [];
    shutdownTask = Promise.resolve().then(async () => {
      const startedAt = Date.now();
      try { write({ eventName: 'desktop.shutdownStarted' }); } catch (error) { failures.push(error); }
      const closing = [
        Promise.resolve().then(() => capability?.shutdown()),
        Promise.resolve().then(() => management?.shutdown()),
        Promise.resolve().then(() => recoveryOwner?.waitForSettlement()),
      ];
      const results = await Promise.allSettled(closing);
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
      recoveryExternalSelection?.revoke();
      try {
        assertCurrent();
        await assertMainOwned();
        assertCurrent();
      } catch (error) { failures.push(error); }
      alive = false;
      if (failures.length === 0) {
        try { await reservation.close(); } catch (error) { failures.push(error); }
      }
      if (failures.length !== 0) {
        try { write({ eventName: 'desktop.shutdownFailed', errorCode: 'DESKTOP_SHUTDOWN_FAILED',
          durationMs: Date.now() - startedAt, retryable: false, sideEffectState: 'unknown', stage: 'shutdown' }); } catch { /* Preserve the first close failure. */ }
        throw new Error('DESKTOP_SHUTDOWN_FAILED', { cause: failures[0] });
      }
      write({ eventName: 'desktop.shutdownCompleted', durationMs: Date.now() - startedAt });
    });
    for (const close of [
      () => management?.service.closeAdmission(),
      () => recoveryOwner?.closeAdmission(),
      () => capability?.dispose(),
      () => passwordWindow?.dispose(),
      () => logFailureCapability?.dispose(),
      () => supportBundleCapability?.dispose(),
    ]) {
      try { close(); } catch (error) { failures.push(error); }
    }
    return shutdownTask;
  };

  try {
    assertCurrent();
    if (recovery !== undefined) {
      assertRecoveryAdmission();
      recoveryOwner = await recovery.selection.handoff({ assertCurrent: assertRecoveryAdmission, assertOwned: assertRecoveryAdmissionOwned });
      assertRecoveryAdmission();
    } else {
      await input.selection.assertCurrent();
    }
    await assertMainOwned();
    assertCurrent();
    const lifecycle = recovery !== undefined ? undefined : new MainOwnedSelectorWorkspaceLifecycle({
      assertSelectorCurrent: assertCurrent, reservation, maintenanceLease, runtimeRelaunch,
    });
    const assertDeletionCurrent = () => {
      assertCurrent();
      if (shutdownTask !== undefined || lifecycle === undefined) throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
      reservation.assertMainCurrent();
      if (shutdownTask !== undefined) throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    };
    const assertDeletionOwned = async () => {
      assertDeletionCurrent();
      await lifecycle!.assertNoActiveWorkspaceRuntime();
      assertDeletionCurrent();
      await reservation.assertMainOwned();
      assertDeletionCurrent();
    };
    const deletionCommand = lifecycle === undefined ? undefined : options.workspaceDeletionCommand ?? (
      options.workspaceDeletionPublisher === undefined ? createWorkspaceDeletionCommand({
        userDataRoot: options.userDataPath,
        registry: new WorkspaceRegistryStore({ installationRoot: options.userDataPath,
          filePath: join(options.userDataPath, WORKSPACE_REGISTRY_FILE_NAME) }),
        assertWritersAbsent: assertDeletionOwned }) : undefined);
    const deletionBinding = deletionCommand === undefined ? undefined : bindWorkspaceDeletionContinuation({
      command: deletionCommand, activeWorkspaceId: null,
      assertCurrent: assertDeletionCurrent,
      assertOwned: assertDeletionOwned,
      async sealActiveMarker() { throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'); },
      recordActiveRemoved() { throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'); },
    });
    const deletionPublisher = deletionBinding?.publish ?? options.workspaceDeletionPublisher;
    if (recovery !== undefined) {
      const owner = recoveryOwner;
      if (owner === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      const authority = { assertCurrent: assertRecoveryAdmission, assertOwned: assertRecoveryAdmissionOwned };
      const registry = new WorkspaceRegistryStore({ installationRoot: options.userDataPath,
        filePath: join(options.userDataPath, WORKSPACE_REGISTRY_FILE_NAME) });
      const targetRoot = deriveWorkspaceRoot(options.userDataPath, owner.target.workspaceId, 1).workspaceRoot;
      const localRestore = createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(
        createDesktopProfilePaths(targetRoot).runtimeRoot).restoreActivationJournalPath);
      let selectionFailure: { cause: unknown } | undefined;
      let recoveryLifecycle: MainOwnedSelectorWorkspaceLifecycle | undefined;
      const assertRecoveryBase = () => {
        if (selectionFailure !== undefined) throw selectionFailure.cause;
        assertRecoveryAdmission(); owner.assertCurrent();
      };
      const guard = () => { assertRecoveryBase(); recoveryExternalSelection?.assertCurrent(); };
      const assertLocalRestoreAbsent = async () => {
        guard();
        if (await hasAnyJournalSlot(localRestore)) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        guard();
      };
      const assertRecoverySelection = async () => {
        try {
          guard(); await assertLocalRestoreAbsent(); await assertSelected();
          await assertLocalRestoreAbsent(); guard();
        } catch (cause) { selectionFailure ??= { cause }; throw selectionFailure.cause; }
      };
      const command = createWorkspaceDeletionCommand({ userDataRoot: options.userDataPath, registry,
        assertWritersAbsent: assertRecoveryOwned,
        ...(options.observeWorkspaceDeletionDetail === undefined ? {} : {
          observePublicationPhase: options.observeWorkspaceDeletionDetail,
          observeTerminalPhase: options.observeWorkspaceDeletionDetail,
        }),
        ...(options.observeWorkspaceDeletionSlotIo === undefined ? {} : { observeSlotIo: options.observeWorkspaceDeletionSlotIo }),
        coldSelection: { assertReservationOwned: assertRecoveryAdmissionOwned,
          async assertStableSelection() {
            guard();
            if (recoveryExternalSelection === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
            await assertRecoverySelection();
          } },
        async beforeJournalPublication(journal, afterRegistry) {
          await assertRecoverySelection();
          recoveryExternalSelection = await owner.transferSourceSelection(authority =>
            captureWorkspaceDeletionExternalSelectionFromRoot({ userDataRoot: options.userDataPath,
              buildInfo: options.buildInfo, releaseInfo: options.releaseInfo, journal, afterRegistry,
              assertCurrent() { assertRecoveryBase(); authority.assertCurrent(); },
              async assertOwned() { await authority.assertOwned(); await assertRecoveryAdmissionOwned(); assertRecoveryBase(); },
              assertWritersAbsent: assertRecoveryOwned,
            }));
          await assertRecoverySelection();
        },
      });
      const binding = bindWorkspaceDeletionContinuation({ kind: 'recoveryManagement', command,
        persistedActiveWorkspaceId: owner.persistedActiveWorkspaceId, assertCurrent: guard,
        assertOwned: assertRecoverySelection, assertRuntimeCurrent: assertRecoveryOwnedCurrent,
        assertRuntimeAbsent: assertRecoveryOwned });
      const publish: WorkspaceDeletionPreparationOptions['publish'] = (
        current, publication, target, context, prepared, readOwned, readCurrent,
      ) => observeDeletionPhase('journalPublication', async () => {
        const assertPrepared = async () => {
          guard(); await prepared(); await assertLocalRestoreAbsent();
          // The publisher's original receipts protect pre-handoff sources.
          // Its mutation guards must also prove the transferred external choice.
          if (recoveryExternalSelection !== undefined) await assertRecoverySelection();
          guard();
        };
        await binding.publish(current, async () => {
          guard(); await publication(); await assertRecoverySelection(); guard();
        }, target, context, assertPrepared, readOwned, readCurrent);
      });
      const confirmations = createWorkspaceDeletionConfirmations({ getWindow() {
        if (mainWindow === undefined) throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
        return mainWindow;
      }, showMessageBox: input.dependencies.showMessageBox });
      management = await createWorkspaceManagementComposition({ mode: 'recoveryManagement',
        operationalIdentity: input.operationalIdentity, operationalLogger: input.operationalLogger,
        recoveryManagement: { targetWorkspaceId: owner.target.workspaceId, assertCurrent: assertRecoveryAdmission,
          assertSelected: assertRecoverySelection,
          readStatus: context => owner.readStatus({ context, maintenance: maintenanceLease,
            authority, runtimeAbsence: { assertCurrent: assertRecoveryOwnedCurrent, assertOwned: assertRecoveryOwned } }),
        },
        deletionPreparation: { maintenanceLease, prepare(request, lifetime, assertLease, operationId) {
          deletionObservationStarted = true;
          return observeDeletionPhase('preparation', async () => {
          guard();
          recoveryLifecycle = new MainOwnedSelectorWorkspaceLifecycle({ kind: 'recoveryManagement',
            persistedActiveWorkspaceId: owner.persistedActiveWorkspaceId, assertDeleteLease: assertLease,
            assertSelectorCurrent: guard, reservation,
            assertRuntimeCurrent: assertRecoveryOwnedCurrent, assertRuntimeAbsent: assertRecoveryOwned,
            assertMainOwnedAndRuntimeAbsent: assertRecoveryOwned });
          const selectedManagement = management;
          if (selectedManagement === undefined) throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
          return prepareWorkspaceDeletion({ request, lifetime, assertLease, operationId,
            installationRoot: options.userDataPath, runtimeGeneration: options.runtimeInstanceId, registry,
            runtime: { kind: 'recoveryManagement', workspaceId: owner.target.workspaceId,
              persistedActiveWorkspaceId: owner.persistedActiveWorkspaceId, lifecycle: recoveryLifecycle,
              assertCurrent: guard, assertSelected: assertRecoverySelection },
            assertMainReservation: assertRecoveryOwned, assertMainReservationCurrent: assertRecoveryOwnedCurrent,
            closeServiceAdmission: () => selectedManagement.service.closeAdmission(),
            ...confirmations, setReturnGuard() { throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID'); }, publish });
          });
        } }, deletionContinuation: binding.continuation,
      });
      recoveryDeletionRuntime = createWorkspaceDeletionResultRuntime({ kind: 'recoveryManagement',
        assertCurrent: assertRecoveryAdmission, assertMainCurrent: assertRecoveryOwnedCurrent,
        assertOwned: assertRecoveryOwned, assertRuntimeAbsent: assertRecoveryOwned,
        readRuntimeState: () => recoveryLifecycle?.readState() === 'stopped' ? 'stopped' : 'unavailable',
        maintenanceState: maintenanceLease });
    } else {
      if (lifecycle === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      management = await createWorkspaceManagementComposition({
        ...(deletionBinding === undefined ? {} : { deletionContinuation: deletionBinding.continuation }),
        ...(deletionPublisher === undefined ? {} : { deletionPreparation: {
          runtimeGeneration: options.runtimeInstanceId,
          createRuntime: () => ({ kind: 'selector' as const, lifecycle }),
          assertMainReservation: () => reservation.assertMainOwned(),
          assertMainReservationCurrent: () => reservation.assertMainCurrent(),
          ...createWorkspaceDeletionConfirmations({ getWindow() {
            if (mainWindow === undefined) throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
            return mainWindow;
          }, showMessageBox: input.dependencies.showMessageBox }),
          publish: deletionPublisher,
        } }),
        mode: 'selector', assertCurrent,
        importOwner: {
          assertCurrent() {
            assertCurrent();
            if (shutdownTask !== undefined) throw new Error('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
          },
          assertMainCurrent: () => reservation.assertMainCurrent(),
          assertMainOwned: () => reservation.assertMainOwned(),
          invalidate: () => reservation.invalidate(),
        },
        operationalIdentity: input.operationalIdentity, operationalLogger: input.operationalLogger,
        activeWorkspaceLifecycle: lifecycle, appVersion: options.appVersion,
        buildRevision: options.buildInfo.buildRevision, localUpdateRuntimePaths: input.localUpdateRuntimePaths,
        maintenanceLease, resourcesPath: options.resourcesPath, runtimeRelaunch,
        userDataRoot: options.userDataPath,
        reservationOwner: {
          assertMainOwned: reservation.assertMainOwned,
          bindCandidate: ({ generationId, prepareMainOwned }) => {
            const assertLease = maintenanceLease.captureCurrentOwner(['create', 'import']);
            return reservation.bind(generationId, () => { assertCurrent(); assertLease(); }, prepareMainOwned);
          },
        },
      });
    }
    await assertSelected();
    assertCurrent();
    registerApplicationProtocol({ mode: 'selector', webRoot: join(options.applicationPath, 'web') });
    registerElectronPermissionPolicy({ operationalIdentity: input.operationalIdentity,
      operationalLogger: input.operationalLogger, permissionSession: session.defaultSession });
    mainWindow = createApplicationWindow(options.applicationPath, !options.smokeConfiguration.enabled, {
      loadFailed: () => write({ eventName: 'applicationWindow.loadFailed', errorCode: 'APPLICATION_WINDOW_LOAD_FAILED',
        retryable: true, sideEffectState: 'none', stage: 'load' }),
      navigationBlocked: () => write({ eventName: 'applicationWindow.navigationBlocked', stage: 'will-navigate' }),
      newWindowBlocked: () => write({ eventName: 'applicationWindow.newWindowBlocked', stage: 'window-open' }),
      renderProcessGone: () => write({ eventName: 'applicationWindow.renderProcessGone', errorCode: 'RENDER_PROCESS_GONE',
        retryable: true, sideEffectState: 'unknown', stage: 'runtime' }),
    }, () => shutdownTask === undefined && !options.recoveryStartup?.isClosing());
    const window = mainWindow;
    passwordWindow = createBackupPasswordWindowController({
      createWindow: windowOptions => new BrowserWindow(windowOptions), ipcMain, parentWindow: window,
      preloadPath: join(options.applicationPath, 'dist/profileBackup/passwordWindow/backupPasswordPreload.cjs'),
    });
    logFailureCapability = createOperationalLogFailureCapability({ ipcMain, mainWindow: window, failureSink: input.failureSink });
    const currentManagement = management;
    supportBundleCapability = createDesktopOnlySupportBundleCapability({
      ipcMain, mainWindow: window,
      ...(smokeSupportBundlePath === undefined ? {} : {
        observeFailure: (error: unknown) => options.observeStartupException?.(error, 'packagedSmoke'),
      }),
      assertCurrent() {
        assertCurrent();
        if (recovery !== undefined) assertRecoveryAdmission();
        if (shutdownTask !== undefined) throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
        reservation.assertMainCurrent();
      },
      captureRequest() {
        const selected = currentManagement.captureOperationObservation();
        return Object.freeze({ assertCurrent: selected.assertCurrent,
          loadDesktopData: () => readSupportBundleDesktopData({
            system: { appVersion: input.operationalIdentity.appVersion, buildRevision: input.operationalIdentity.buildRevision,
              architecture: process.arch, platform: process.platform, electronVersion: process.versions.electron },
            // A lifecycle state alone does not prove that every candidate has exited.
            availability: { backend: 'exitUnconfirmed', database: 'notInspected',
              diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
            observation: selected.readObservation(),
          }),
        });
      },
      async confirmCreation() {
        if (smokeSupportBundlePath !== undefined) return true;
        const result = await input.dependencies.showMessageBox(window, {
          buttons: ['Peruuta', 'Jatka'], cancelId: 0, defaultId: 0, noLink: true, type: 'warning',
          title: 'Luo tukipaketti', message: 'Luodaanko Eky-tukipaketti?',
          detail: 'Tukipaketti ei ole salattu. Tallenna ja lähetä se vain luotetulle tukihenkilölle.\n\nPaketti sisältää sovellusversiot ja nykyisen yrityshallintatoiminnon saatavilla olevat turvalliset virhetiedot. Se ei sisällä yrityksen tietoja, PDF:iä, salasanoja tai lokihistoriaa. Tietokantaa ei tarkisteta.',
        });
        return result.response === 1;
      },
      async selectTargetPath(defaultFileName) {
        if (smokeSupportBundlePath !== undefined) return smokeSupportBundlePath;
        const result = await input.dependencies.showSaveDialog(window, {
          defaultPath: defaultFileName, title: 'Tallenna Eky-tukipaketti',
          filters: [{ extensions: ['json.gz'], name: 'Eky-tukipaketti, GZip-pakattu JSON' }],
        });
        return result.canceled || result.filePath === '' ? null : result.filePath;
      },
      showSafeError() {
        if (smokeSupportBundlePath !== undefined) return;
        input.dependencies.showErrorBox('Tukipakettia ei voitu luoda', 'Eky-tukipakettia ei voitu luoda turvallisesti.');
      },
      operationalIdentity: input.operationalIdentity, operationalLogger: input.operationalLogger,
      runtimeRoot: createDesktopProfilePaths(options.userDataPath).runtimeRoot,
    });
    const rejectReplacement = async (): Promise<never> => {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'replace');
    };
    capability = input.dependencies.createWorkspaceManagementCapability({
      ipcMain, mainWindow: window, passwordWindow, service: management.service,
      ...(recovery === undefined ? {} : { statusMode: 'recoveryManagement' as const,
        captureStatusPublication() {
          assertRecoveryAdmission();
          const owner = recoveryOwner;
          if (owner === undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
          return Object.freeze({ assertCurrent() { assertRecoveryAdmission(); owner.assertCurrent(); } });
        },
      }),
      ...(recoveryDeletionRuntime !== undefined ? { deletionRuntime: recoveryDeletionRuntime }
        : deletionBinding === undefined || lifecycle === undefined ? {} : { deletionRuntime: createWorkspaceDeletionResultRuntime({
        assertCurrent() {
          assertCurrent();
          if (shutdownTask !== undefined) throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
        },
        assertMainCurrent: () => reservation.assertMainCurrent(),
        assertOwned: () => reservation.assertMainOwned(),
        // The service has released the selector lifecycle's operation lease.
        // Main still owns the physical reservation and no backend was created.
        async assertRuntimeAbsent() {
          if (lifecycle.readState() !== 'stopped') throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE');
        },
        readRuntimeState() {
          const state = lifecycle.readState();
          return state === 'ready' ? 'available' : state === 'stopped' ? 'stopped' : 'unavailable';
        },
        maintenanceState: maintenanceLease, runtimeRelaunch,
      }) }),
      confirmActiveWorkspaceReplacement: rejectReplacement, selectReplacementBackupSource: rejectReplacement,
      async selectBackupSource() {
        const result = await input.dependencies.showOpenDialog(window, {
          filters: [{ extensions: ['ekybackup'], name: 'Eky-varmuuskopio' }],
          properties: ['openFile'], title: 'Tuo yritys Eky-varmuuskopiosta',
        });
        return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0] ?? null;
      },
      showSafeError() {
        input.dependencies.showErrorBox('Yritystä ei voitu käsitellä', 'Yrityksen tietoja ei voitu käsitellä turvallisesti.');
      },
    });
    assertCurrent();
    if (recovery !== undefined) assertRecoveryAdmission();
    if (!options.recoveryStartup?.isClosing()) reportDesktopStarted({ identity: input.operationalIdentity, logger: input.operationalLogger, startedAt: input.startedAt });
    if (options.smokeConfiguration.phase === packagedSelectorVerificationPhase && !options.recoveryStartup?.isClosing()) {
      await loadApplicationWindow(window, 'selector');
      await assertSelected();
      await assertMainOwned();
      assertCurrent();
    } else if (!options.recoveryStartup?.isClosing()) {
      // Normal startup returns its close owner before renderer loading settles.
      void loadApplicationWindow(window, 'selector').catch(async () => {
        if (shutdownTask !== undefined || options.recoveryStartup?.isClosing()) return;
        try {
          input.dependencies.showErrorBox('Eky ei käynnistynyt', 'Käyttöliittymää ei voitu ladata turvallisesti.');
        } catch { /* Shutdown must still run if the native error dialog fails. */ }
        try { await shutdown(); } catch { /* The shutdown owner records its failure. */ }
        options.quitApplication();
      });
    }
    return {
      applicationWindow: window, focusApplicationWindow: () => restoreWindowInputFocus(window),
      isInstallerHandoffPending: () => false, deferQuitForInstallerHandoff: () => false, shutdown,
    };
  } catch (error) {
    const failures = [error];
    try { await shutdown(); } catch (failure) { failures.push(failure); }
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      try { mainWindow.destroy(); } catch (failure) { failures.push(failure); }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', { cause: error });
    throw error;
  }
}

export type WorkspaceDeletionPhaseEvent = Readonly<{
  phase: 'preparation' | 'journalPublication' | 'reservation' |
    import('../workspaces/deletion/workspaceDeletionFinalization.js').WorkspaceDeletionTerminalPhaseEvent['phase'] |
    import('../workspaces/deletion/workspaceDeletionPublication.js').WorkspaceDeletionPublicationPhaseEvent['phase'];
  event: 'entered' | 'fulfilled' | 'rejected'; callId: number;
}>;
export type WorkspaceDeletionPhaseObserver = (event: WorkspaceDeletionPhaseEvent) => void;

// Only closed data crosses the port; the caller retains the original work promise.
export function createWorkspaceDeletionPhaseProducer(observer?: WorkspaceDeletionPhaseObserver, isAdmitted?: () => boolean) {
  let nextCallId = 0;
  return function observe<T>(phase: WorkspaceDeletionPhaseEvent['phase'], work: () => Promise<T>): Promise<T> {
    if (observer === undefined || isAdmitted?.() === false) return work();
    const callId = ++nextCallId;
    const emit = (event: WorkspaceDeletionPhaseEvent['event']) => {
      try { observer(Object.freeze({ phase, event, callId })); }
      catch { /* Observation cannot replace the original outcome. */ }
    };
    emit('entered');
    let originalPromise: Promise<T>;
    try { originalPromise = work(); }
    catch (cause) { emit('rejected'); throw cause; }
    try { void Promise.prototype.then.call(originalPromise, () => emit('fulfilled'), () => emit('rejected')); }
    catch { /* A missing finish observation is unknown, not a new work outcome. */ }
    return originalPromise;
  };
}

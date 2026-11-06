import { join } from 'node:path';
import { bindWorkspaceDeletionContinuation, createWorkspaceDeletionResultRuntime } from './workspaceDeletionContinuation.js';
import { BrowserWindow, ipcMain, session } from 'electron';

import { createOperationalLogFailureCapability } from '../diagnostics/operationalLogFailureCapability.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalEventInput, DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import type { IncidentIndexDesktopLogFailureSink } from '../observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import { createBackupPasswordWindowController, type BackupPasswordWindowController } from '../profileBackup/passwordWindow/backupPasswordWindow.js';
import { registerElectronPermissionPolicy } from '../security/electronPermissionPolicy.js';
import { createDesktopOnlySupportBundleCapability } from '../supportBundle/supportBundleCapability.js';
import { readSupportBundleDesktopData } from '../supportBundle/supportBundleDesktopData.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import type { LocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceManagementCapability } from '../workspaces/management/workspaceManagementCapability.js';
import { createWorkspaceManagementComposition, type SelectorWorkspaceManagementComposition } from '../workspaces/management/workspaceManagementComposition.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import { createWorkspaceDeletionConfirmations } from '../workspaces/management/createWorkspaceDeletionConfirmations.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import type { WorkspaceSelectorStartupSelection } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import { createApplicationWindow, loadApplicationWindow } from './applicationWindow.js';
import type { acquireDesktopWorkspaceReservation, DesktopCompositionDependencies, DesktopLifecycleHandle, StartDesktopCompositionOptions } from './desktopComposition.js';
import { reportDesktopStarted } from './desktopStartupCompletion.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';
import { packagedSelectorVerificationPhase } from './packagedSmoke.js';

interface DesktopSelectorCompositionOptions {
  options: StartDesktopCompositionOptions;
  dependencies: Pick<DesktopCompositionDependencies,
    'showOpenDialog' | 'showSaveDialog' | 'showErrorBox' | 'showMessageBox' | 'createWorkspaceManagementCapability'>;
  selection: WorkspaceSelectorStartupSelection;
  reservation: Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>>;
  maintenanceLease: InMemoryWorkspaceMaintenanceLease;
  localUpdateRuntimePaths: LocalUpdateRuntimePaths;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
  failureSink: IncidentIndexDesktopLogFailureSink;
  startedAt: number;
}

/** Installation UI only. No business runtime, session, broker or database. */
export async function startDesktopSelectorComposition(input: DesktopSelectorCompositionOptions): Promise<DesktopLifecycleHandle> {
  const { options, reservation, maintenanceLease } = input;
  let alive = true;
  let shutdownTask: Promise<void> | undefined;
  let mainWindow: BrowserWindow | undefined;
  let management: SelectorWorkspaceManagementComposition | undefined;
  let capability: WorkspaceManagementCapability | undefined;
  let passwordWindow: BackupPasswordWindowController | undefined;
  let logFailureCapability: ReturnType<typeof createOperationalLogFailureCapability> | undefined;
  let supportBundleCapability: ReturnType<typeof createDesktopOnlySupportBundleCapability> | undefined;
  const assertCurrent = () => {
    if (!alive) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
    options.assertSingleInstanceOwnership();
    reservation.assertInstallationCurrent();
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
      ];
      const results = await Promise.allSettled(closing);
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
      try {
        assertCurrent();
        await reservation.assertMainOwned();
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
    await input.selection.assertCurrent();
    await reservation.assertMainOwned();
    assertCurrent();
    const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({
      assertSelectorCurrent: assertCurrent, reservation, maintenanceLease, runtimeRelaunch,
    });
    const deletionBinding = options.workspaceDeletionCommand === undefined ? undefined : bindWorkspaceDeletionContinuation({
      command: options.workspaceDeletionCommand, activeWorkspaceId: null,
      assertCurrent() {
        assertCurrent();
        if (shutdownTask !== undefined) throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
        reservation.assertMainCurrent();
        if (shutdownTask !== undefined) throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
      },
      async assertOwned() { await lifecycle.assertNoActiveWorkspaceRuntime(); await reservation.assertMainOwned(); },
      async sealActiveMarker() { throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'); },
      recordActiveRemoved() { throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'); },
    });
    const deletionPublisher = deletionBinding?.publish ?? options.workspaceDeletionPublisher;
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
    await input.selection.assertCurrent();
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
    });
    const window = mainWindow;
    passwordWindow = createBackupPasswordWindowController({
      createWindow: windowOptions => new BrowserWindow(windowOptions), ipcMain, parentWindow: window,
      preloadPath: join(options.applicationPath, 'dist/profileBackup/passwordWindow/backupPasswordPreload.cjs'),
    });
    logFailureCapability = createOperationalLogFailureCapability({ ipcMain, mainWindow: window, failureSink: input.failureSink });
    const currentManagement = management;
    supportBundleCapability = createDesktopOnlySupportBundleCapability({
      ipcMain, mainWindow: window,
      assertCurrent() {
        assertCurrent();
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
        const result = await input.dependencies.showMessageBox(window, {
          buttons: ['Peruuta', 'Jatka'], cancelId: 0, defaultId: 0, noLink: true, type: 'warning',
          title: 'Luo tukipaketti', message: 'Luodaanko Eky-tukipaketti?',
          detail: 'Tukipaketti ei ole salattu. Tallenna ja lähetä se vain luotetulle tukihenkilölle.\n\nPaketti sisältää sovellusversiot ja nykyisen yrityshallintatoiminnon saatavilla olevat turvalliset virhetiedot. Se ei sisällä yrityksen tietoja, PDF:iä, salasanoja tai lokihistoriaa. Tietokantaa ei tarkisteta.',
        });
        return result.response === 1;
      },
      async selectTargetPath(defaultFileName) {
        const result = await input.dependencies.showSaveDialog(window, {
          defaultPath: defaultFileName, title: 'Tallenna Eky-tukipaketti',
          filters: [{ extensions: ['json.gz'], name: 'Eky-tukipaketti, GZip-pakattu JSON' }],
        });
        return result.canceled || result.filePath === '' ? null : result.filePath;
      },
      showSafeError() {
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
      ...(deletionBinding === undefined ? {} : { deletionRuntime: createWorkspaceDeletionResultRuntime({
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
    reportDesktopStarted({ identity: input.operationalIdentity, logger: input.operationalLogger, startedAt: input.startedAt });
    if (options.smokeConfiguration.phase === packagedSelectorVerificationPhase) {
      await loadApplicationWindow(window, 'selector');
      await input.selection.assertCurrent();
      await reservation.assertMainOwned();
      assertCurrent();
    } else {
      // Normal startup returns its close owner before renderer loading settles.
      void loadApplicationWindow(window, 'selector').catch(async () => {
        if (shutdownTask !== undefined) return;
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

import { join } from 'node:path';
import { BrowserWindow, ipcMain, session } from 'electron';

import { createOperationalLogFailureCapability } from '../diagnostics/operationalLogFailureCapability.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalEventInput, DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import type { IncidentIndexDesktopLogFailureSink } from '../observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import { createBackupPasswordWindowController, type BackupPasswordWindowController } from '../profileBackup/passwordWindow/backupPasswordWindow.js';
import { registerElectronPermissionPolicy } from '../security/electronPermissionPolicy.js';
import type { LocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { createWorkspaceManagementCapability, type WorkspaceManagementCapability } from '../workspaces/management/workspaceManagementCapability.js';
import { createWorkspaceManagementComposition, type SelectorWorkspaceManagementComposition } from '../workspaces/management/workspaceManagementComposition.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import type { WorkspaceSelectorStartupSelection } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import { createApplicationWindow, loadApplicationWindow } from './applicationWindow.js';
import type { acquireDesktopWorkspaceReservation, DesktopCompositionDependencies, DesktopLifecycleHandle, StartDesktopCompositionOptions } from './desktopComposition.js';
import { reportDesktopStarted } from './desktopStartupCompletion.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';

interface DesktopSelectorCompositionOptions {
  options: StartDesktopCompositionOptions;
  dependencies: Pick<DesktopCompositionDependencies, 'showOpenDialog' | 'showErrorBox'>;
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
    management = await createWorkspaceManagementComposition({
      mode: 'selector', assertCurrent,
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
    const rejectReplacement = async (): Promise<never> => {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'replace');
    };
    capability = createWorkspaceManagementCapability({
      ipcMain, mainWindow: window, passwordWindow, service: management.service,
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
    // Publish the lifecycle before renderer loading settles, as on the business
    // path. A load failure also drains owned work before requesting quit.
    void loadApplicationWindow(window, 'selector').catch(async () => {
      if (shutdownTask !== undefined) return;
      try {
        input.dependencies.showErrorBox('Eky ei käynnistynyt', 'Käyttöliittymää ei voitu ladata turvallisesti.');
      } catch { /* Shutdown must still run if the native error dialog fails. */ }
      try { await shutdown(); } catch { /* The shutdown owner records its failure. */ }
      options.quitApplication();
    });
    return {
      applicationWindow: window, focusApplicationWindow: () => restoreWindowInputFocus(window),
      isInstallerHandoffPending: () => false, deferQuitForInstallerHandoff: () => false, shutdown,
    };
  } catch (error) {
    let cleanupError: unknown;
    try { await shutdown(); } catch (failure) { cleanupError = failure; }
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      try { mainWindow.destroy(); } catch (failure) { cleanupError ??= failure; }
    }
    if (cleanupError !== undefined) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', { cause: { error, cleanupError } });
    throw error;
  }
}

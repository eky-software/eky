import { resolve } from 'node:path';

import { app, BrowserWindow, protocol, utilityProcess } from 'electron';

import {
  startDesktopComposition,
  type DesktopLifecycleHandle,
} from '../src/main/desktopComposition.js';
import { startDesktopBackend } from '../src/runtime/backendProcess.js';
import {
  runSafeDesktopStartup,
} from '../src/main/earlyStartup.js';
import {
  resolveActiveWorkspaceStartup,
  type ActiveWorkspaceStartupPhase,
} from '../src/workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { createElectronE2eBackendController } from './electronE2eBackendProcess.js';
import { readElectronE2eConfig } from './electronE2eConfig.js';
import { createElectronE2eNativeAdapters } from './electronE2eNativeAdapters.js';
import { readSafeElectronE2eWorkspaceStartupFailureCode } from './electronE2eWorkspaceStartupFailure.js';
import { createElectronE2eStartupObservation } from './electronE2eStartupObservation.js';
import { createFirstStartProofAdmission, createFirstStartProofObserver } from './workspaceFirstStartProofObservation.js';
import { WorkspaceFirstStartLoadExperiment, type FirstStartLoadExperimentMode } from './workspaceFirstStartLoadExperiment.js';

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      bypassCSP: false,
      corsEnabled: false,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: 'eky',
  },
]);

const configPath = process.env.EKY_ELECTRON_E2E_CONFIG;
if (configPath === undefined) {
  throw new Error('ELECTRON_E2E_CONFIG_MISSING');
}
const config = readElectronE2eConfig(configPath);
app.setPath('userData', config.paths.userDataPath);
const e2eAppVersion = app.getVersion();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const backendRunnerPath = resolve(
  import.meta.dirname,
  'electronE2eBackendRunner.js',
);
const startupObservation = createElectronE2eStartupObservation();
const admitFirstStartProof = createFirstStartProofAdmission();
const backendController = createElectronE2eBackendController(
  config,
  backendRunnerPath,
  {
    fork: (modulePath, args, options) => utilityProcess.fork(modulePath, args, options),
    observeStartup: (checkpoint) => startupObservation.record(checkpoint),
  },
);
const nativeAdapters = createElectronE2eNativeAdapters(config);
app.once('browser-window-created', () => {
  startupObservation.record('firstWindowCreated');
});
let lifecycle: DesktopLifecycleHandle | undefined;
let shutdownStarted = false;
let secondInstanceCount = 0;

async function runFirstStartProof(mode: FirstStartLoadExperimentMode) {
  admitFirstStartProof();
  const observation = createFirstStartProofObserver(config.paths.userDataPath, config.runtimeInstanceId);
  const experiment = new WorkspaceFirstStartLoadExperiment(mode, observation.record);
  let failed = false;
  try {
    observation.record('initialShutdownStarted');
    if (lifecycle === undefined) {
      throw new Error('WORKSPACE_FIRST_START_MIGRATION_LIFECYCLE_MISSING');
    }
    await lifecycle.shutdown();
    if (backendController.isRunning()) {
      throw new Error('WORKSPACE_FIRST_START_MIGRATION_BACKEND_RUNNING');
    }
    observation.record('initialShutdownCompleted');
    const { runWorkspaceFirstStartMigrationProof } = await import('./workspaceFirstStartMigrationProof.js');
    observation.record('proofStarted');
    const proof = await runWorkspaceFirstStartMigrationProof({
      observe: observation.record,
      loadExperiment: experiment,
      applicationPath: config.paths.applicationPath,
      appVersion: e2eAppVersion,
      resourcesPath: config.paths.resourcesPath,
      runtimeSessionSecret: config.backend.sessionSecret,
      startBackend: startDesktopBackend,
      userDataRoot: config.paths.userDataPath,
    });
    experiment.assertComplete();
    observation.record('proofCompleted');
    return { proof, loads: experiment.snapshot() };
  } catch (error) {
    failed = true;
    observation.record('proofFailed');
    throw error;
  } finally {
    try {
      experiment.dispose();
    } catch (error) {
      observation.record('loadExperimentCleanupFailed');
      if (!failed) throw error;
    } finally {
      observation.close();
    }
  }
}

function getPdfPreviewWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      /^eky:\/\/app\/invoices\/[A-Za-z0-9_-]{1,100}\/pdf$/u.test(
        window.webContents.getURL(),
      ),
  );
}

if (hasSingleInstanceLock) {
  void runSafeDesktopStartup({
    exitApplication: (code) => app.exit(code),
    loadRuntime: async () => ({ startDesktopComposition }),
    async onFailure(errorCode) {
      startupObservation.record('startupFailed');
      nativeAdapters.recordStartupFailure(errorCode);
      nativeAdapters.showErrorBox(
        'Eky ei käynnistynyt',
        'Paikallista testisovellusta ei voitu käynnistää turvallisesti.',
      );
    },
    async startRuntime() {
      startupObservation.record('compositionStarted');
      lifecycle = await startDesktopComposition({
        appVersion: e2eAppVersion,
        applicationPath: config.paths.applicationPath,
        buildInfo: {
          appVersion: e2eAppVersion,
          buildCreatedAt: '2026-01-01T00:00:00.000Z',
          buildDirty: false,
          buildRevision: 'development',
          schemaVersion: 1,
        },
        dependencies: {
          createRuntimeSession: () => config.backend.sessionSecret,
          openPath: nativeAdapters.openPath,
          showErrorBox: nativeAdapters.showErrorBox,
          showMessageBox: nativeAdapters.showMessageBox,
          showOpenDialog: nativeAdapters.showOpenDialog,
          showSaveDialog: nativeAdapters.showSaveDialog,
          resolveActiveWorkspace: async (userDataRoot) => {
            startupObservation.record('workspaceResolutionStarted');
            let activePhase: ActiveWorkspaceStartupPhase | undefined;
            try {
              const selection = await resolveActiveWorkspaceStartup(userDataRoot, {
                reportProgress(progress) {
                  activePhase =
                    progress.state === 'started' ? progress.phase : undefined;
                },
              });
              startupObservation.record('workspaceResolutionCompleted');
              return selection;
            } catch (error) {
              throw new Error(
                readSafeElectronE2eWorkspaceStartupFailureCode(
                  error,
                  activePhase,
                ),
              );
            }
          },
          async startBackend(options) {
            startupObservation.record('backendStartRequested');
            if (config.startupMode === 'backendStartFailure') {
              throw new Error('BACKEND_READINESS_TIMEOUT');
            }
            const handle = await backendController.startBackend(options);
            startupObservation.record('backendReady');
            return handle;
          },
        },
        quitApplication: () => app.quit(),
        releaseInfo: undefined,
        relaunchApplication() {
          if (config.relaunchMode !== 'playwrightManaged') {
            throw new Error('ELECTRON_E2E_RELAUNCH_MODE_INVALID');
          }
          nativeAdapters.recordWorkspaceRelaunchRequested();
          app.quit();
        },
        resourcesPath: config.paths.resourcesPath,
        runtimeInstanceId: config.runtimeInstanceId,
        reportSmokeStage: async () => undefined,
        smokeConfiguration: {
          enabled: false,
          phase: 'initial',
          root: undefined,
          userDataPath: undefined,
        },
        userDataPath: config.paths.userDataPath,
      });
      startupObservation.record('compositionCompleted');
    },
    async waitUntilReady() {
      startupObservation.record('waitingForAppReady');
      await app.whenReady();
      startupObservation.record('appReady');
    },
  });
}

app.on('activate', () => lifecycle?.focusApplicationWindow());
app.on('second-instance', () => {
  secondInstanceCount += 1;
  lifecycle?.focusApplicationWindow();
});
app.on('before-quit', (event) => {
  if (lifecycle === undefined || shutdownStarted) {
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  void lifecycle.shutdown().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());

Object.assign(globalThis, {
  __EKY_ELECTRON_E2E__: Object.freeze({
    startupObservation: () => startupObservation.snapshot(),
    backendIsRunning: () => backendController.isRunning(),
    backendStartCount: () => backendController.getStartCount(),
    closePdfPreviewWindows: () => {
      for (const window of getPdfPreviewWindows()) {
        window.close();
      }
    },
    killBackendUnexpectedly: () => backendController.killUnexpectedly(),
    nativeAdapterSnapshot: () => nativeAdapters.snapshot(),
    pdfPreviewUrls: () =>
      getPdfPreviewWindows().map((window) => window.webContents.getURL()),
    processMetrics: () => {
      const metrics = app.getAppMetrics();
      return {
        backendIsRunning: backendController.isRunning(),
        backendStartCount: backendController.getStartCount(),
        processCount: metrics.length,
        totalWorkingSetSizeKilobytes: metrics.reduce(
          (total, metric) => total + metric.memory.workingSetSize,
          0,
        ),
        windowCount: BrowserWindow.getAllWindows().length,
      };
    },
    runtimeInstanceId: config.runtimeInstanceId,
    async runWorkspaceManagementCompositionProof() {
      const { runWorkspaceManagementCompositionProof } = await import(
        './workspaceManagementCompositionProof.js'
      );
      return runWorkspaceManagementCompositionProof({
        appVersion: e2eAppVersion,
        buildRevision: 'development',
        resourcesPath: config.paths.resourcesPath,
        userDataRoot: config.paths.userDataPath,
      });
    },
    async runWorkspaceMigrationInventoryProof() {
      if (lifecycle === undefined) {
        throw new Error('WORKSPACE_MIGRATION_INVENTORY_LIFECYCLE_MISSING');
      }
      await lifecycle.shutdown();
      if (backendController.isRunning()) {
        throw new Error('WORKSPACE_MIGRATION_INVENTORY_BACKEND_RUNNING');
      }
      const { runWorkspaceMigrationInventoryProof } = await import(
        './workspaceMigrationInventoryProof.js'
      );
      return runWorkspaceMigrationInventoryProof({
        appVersion: e2eAppVersion,
        buildRevision: 'development',
        resourcesPath: config.paths.resourcesPath,
        userDataRoot: config.paths.userDataPath,
      });
    },
    async runWorkspaceFirstStartMigrationProof() {
      return (await runFirstStartProof('observe')).proof;
    },
    async runWorkspaceFirstStartLoadOrderDiagnostic() {
      return runFirstStartProof('releaseAfterProtocolRemoval');
    },
    async runWorkspaceActivationMigrationProof() {
      if (lifecycle === undefined) {
        throw new Error('WORKSPACE_ACTIVATION_MIGRATION_LIFECYCLE_MISSING');
      }
      await lifecycle.shutdown();
      if (backendController.isRunning()) {
        throw new Error('WORKSPACE_ACTIVATION_MIGRATION_BACKEND_RUNNING');
      }
      const { runWorkspaceActivationMigrationProof } = await import(
        './workspaceActivationMigrationProof.js'
      );
      return runWorkspaceActivationMigrationProof({
        applicationPath: config.paths.applicationPath,
        appVersion: e2eAppVersion,
        resourcesPath: config.paths.resourcesPath,
        runtimeSessionSecret: config.backend.sessionSecret,
        startBackend: startDesktopBackend,
        userDataRoot: config.paths.userDataPath,
      });
    },
    async runWorkspaceStartupRecoveryProof() {
      const { runWorkspaceStartupRecoveryProof } = await import(
        './workspaceStartupRecoveryProof.js'
      );
      return runWorkspaceStartupRecoveryProof({
        appVersion: e2eAppVersion,
        resourcesPath: config.paths.resourcesPath,
        userDataRoot: config.paths.userDataPath,
      });
    },
    scenarioId: config.scenarioId,
    secondInstanceCount: () => secondInstanceCount,
    userDataPath: config.paths.userDataPath,
    windowCount: () => BrowserWindow.getAllWindows().length,
  }),
});

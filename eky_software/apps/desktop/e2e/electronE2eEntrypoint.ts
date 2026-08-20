import { resolve } from 'node:path';

import { app, BrowserWindow, protocol } from 'electron';

import {
  startDesktopComposition,
  type DesktopLifecycleHandle,
} from '../src/main/desktopComposition.js';
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
const backendController = createElectronE2eBackendController(
  config,
  backendRunnerPath,
);
const nativeAdapters = createElectronE2eNativeAdapters(config);
let lifecycle: DesktopLifecycleHandle | undefined;
let shutdownStarted = false;
let secondInstanceCount = 0;

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
      nativeAdapters.recordStartupFailure(errorCode);
      nativeAdapters.showErrorBox(
        'Eky ei käynnistynyt',
        'Paikallista testisovellusta ei voitu käynnistää turvallisesti.',
      );
    },
    async startRuntime() {
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
            let activePhase: ActiveWorkspaceStartupPhase | undefined;
            try {
              return await resolveActiveWorkspaceStartup(userDataRoot, {
                reportProgress(progress) {
                  activePhase =
                    progress.state === 'started' ? progress.phase : undefined;
                },
              });
            } catch (error) {
              throw new Error(
                readSafeElectronE2eWorkspaceStartupFailureCode(
                  error,
                  activePhase,
                ),
              );
            }
          },
          startBackend:
            config.startupMode === 'backendStartFailure'
              ? async () => {
                  throw new Error('BACKEND_READINESS_TIMEOUT');
                }
              : backendController.startBackend,
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
    },
    waitUntilReady: () => app.whenReady(),
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

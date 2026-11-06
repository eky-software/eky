import {
  app,
  dialog,
  protocol,
  shell,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { DesktopLifecycleHandle, DesktopWorkspaceStartupSupportReceipt } from './desktopComposition.js';
import { createDesktopOnlySupportBundleExport, type NativeSupportBundleExport } from '../supportBundle/supportBundleCapability.js';
import { readSupportBundleDesktopData, type SupportBundleDesktopData } from '../supportBundle/supportBundleDesktopData.js';
import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { resolveDesktopPackageUserDataOverride } from './desktopPackageProfile.js';
import { runSafeDesktopStartup } from './earlyStartup.js';
import { readDesktopBuildInfo } from '../release/desktopBuildInfoReader.js';
import {
  readDesktopPackageMode,
  type DesktopRuntimePackageMode,
} from '../release/desktopPackageModeReader.js';
import { readDesktopReleaseInfo } from '../release/desktopReleaseInfoReader.js';
import { showProfileRestoreRecoveryDialog } from './profileRestoreRecoveryDialog.js';
import {
  createPackagedSmokeConfiguration,
  createPackagedSmokeProgressReporter,
  packagedSelectorVerificationSwitch,
  writePackagedSmokeResult,
} from './packagedSmoke.js';
import {
  createW6b2PackagedProofFallbackResult,
  createW6b2PackagedProofBootstrapConfiguration,
  createW6b2PackagedProofUnexpectedFailure,
  readW6b2PackagedProofConfiguration,
  W6B2_PACKAGED_PROOF_SWITCH,
  W6B2_PACKAGED_PROOF_TOKEN_ENV,
  writeW6b2PackagedProofResult,
  type W6b2PackagedProofConfiguration,
} from './w6b2PackagedProof.js';
import { terminateW6b2PackagedProofRuntime } from './w6b2PackagedProofTermination.js';
import { createStartupExceptionCapture, STARTUP_EXCEPTION_SWITCH, STARTUP_EXCEPTION_TOKEN_ENV } from './startupExceptionEvidence.js';

type StartDesktopComposition =
  typeof import('./desktopComposition.js').startDesktopComposition;

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

function readInitialPackageMode():
  | { mode: DesktopRuntimePackageMode }
  | { errorCode: 'PACKAGED_PACKAGE_MODE_INVALID' } {
  try {
    return {
      mode: readDesktopPackageMode({
        applicationPath: app.getAppPath(),
        isPackaged: app.isPackaged,
      }),
    };
  } catch {
    return { errorCode: 'PACKAGED_PACKAGE_MODE_INVALID' };
  }
}

const packageModeResult = readInitialPackageMode();
if ('mode' in packageModeResult) {
  const userDataOverride = resolveDesktopPackageUserDataOverride({
    appDataPath: app.getPath('appData'),
    packageMode: packageModeResult.mode,
  });
  if (userDataOverride !== undefined) {
    app.setPath('userData', userDataOverride);
  }
}

const smokeConfiguration = createPackagedSmokeConfiguration({
  hasSelectorVerificationSwitch: app.commandLine.hasSwitch(packagedSelectorVerificationSwitch),
  hasLegacyInvoiceSwitch: app.commandLine.hasSwitch('desktop-smoke-legacy-invoice'),
  hasRestoredProfileSwitch: app.commandLine.hasSwitch(
    'desktop-smoke-restored',
  ),
  hasSmokeSwitch: app.commandLine.hasSwitch('desktop-smoke'),
  tempPath: app.getPath('temp'),
  tokenValue: process.env.EKY_DESKTOP_SMOKE_TOKEN,
});
const smokeProgress =
  createPackagedSmokeProgressReporter(smokeConfiguration);

function readInitialW6b2PackagedProofBootstrap():
  | {
      configuration: ReturnType<
        typeof createW6b2PackagedProofBootstrapConfiguration
      >;
    }
  | { errorCode: 'W6B2_PROOF_CONFIGURATION_INVALID' } {
  try {
    return {
      configuration: createW6b2PackagedProofBootstrapConfiguration({
        hasProofSwitch: app.commandLine.hasSwitch(
          W6B2_PACKAGED_PROOF_SWITCH,
        ),
        tempPath: app.getPath('temp'),
        tokenValue: process.env[W6B2_PACKAGED_PROOF_TOKEN_ENV],
      }),
    };
  } catch {
    return { errorCode: 'W6B2_PROOF_CONFIGURATION_INVALID' };
  }
}

const w6b2ProofBootstrapResult =
  readInitialW6b2PackagedProofBootstrap();

if (
  'configuration' in w6b2ProofBootstrapResult &&
  w6b2ProofBootstrapResult.configuration.userDataPath !== undefined
) {
  app.setPath(
    'userData',
    w6b2ProofBootstrapResult.configuration.userDataPath,
  );
} else if (smokeConfiguration.userDataPath !== undefined) {
  app.setPath('userData', smokeConfiguration.userDataPath);
}

const hasSingleInstanceLock =
  'errorCode' in packageModeResult || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock && 'mode' in packageModeResult) {
  app.quit();
}

let desktopLifecycle: DesktopLifecycleHandle | undefined;
const runtimeInstanceId = randomUUID();
let observeStartupException: ReturnType<typeof createStartupExceptionCapture>;
let w6b2ProofConfiguration:
  | Readonly<W6b2PackagedProofConfiguration>
  | undefined;
let w6b2ProofQuitRequested = false;
let w6b2ProofRelaunchRequested = false;
let w6b2ProofResultWritten = false;
let w6b2ProofShutdownCompleted = false;
let startupReportingClosed = false;
let startupSupportExport: NativeSupportBundleExport | undefined;
let startupSupportReceipt: Readonly<{
  data: Readonly<SupportBundleDesktopData>;
  logger: DesktopWorkspaceStartupSupportReceipt['operationalLogger'];
  runtimeRoot: string;
}> | undefined;

function invalidateStartupReporting(): void {
  startupReportingClosed = true;
  startupSupportExport?.dispose();
}

async function startDesktopRuntime(
  startDesktopComposition: StartDesktopComposition,
): Promise<void> {
  if ('errorCode' in packageModeResult) {
    throw new Error(packageModeResult.errorCode);
  }
  if ('errorCode' in w6b2ProofBootstrapResult) {
    throw new Error(w6b2ProofBootstrapResult.errorCode);
  }
  if (
    w6b2ProofBootstrapResult.configuration.enabled &&
    smokeConfiguration.enabled
  ) {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  await smokeProgress.reportStage(
    smokeConfiguration.phase === 'restoredProfile'
      ? 'restoredStartup'
      : 'startup',
  );
  const buildInfo = await readDesktopBuildInfo({
    applicationPath: app.getAppPath(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
  });
  const releaseInfo =
    packageModeResult.mode === 'pilot'
      ? await readDesktopReleaseInfo({
          applicationPath: app.getAppPath(),
          appVersion: app.getVersion(),
          isPackaged: app.isPackaged,
        })
      : undefined;
  w6b2ProofConfiguration =
    await readW6b2PackagedProofConfiguration({
      appVersion: app.getVersion(),
      bootstrap: w6b2ProofBootstrapResult.configuration,
      resourcesPath: process.resourcesPath,
    });
  const currentProofConfiguration = w6b2ProofConfiguration;
  let receiptAdmissionOpen = true;
  const supportRuntimeRoot = join(app.getPath('userData'), 'runtime');
  const compositionOptions: Parameters<StartDesktopComposition>[0] = {
    assertSingleInstanceOwnership() {
      if (!app.hasSingleInstanceLock()) {
        throw new Error('WORKSPACE_PROCESS_RESERVATION_FAILED');
      }
    },
    appVersion: app.getVersion(),
    applicationPath: app.getAppPath(),
    buildInfo,
    releaseInfo,
    observeWorkspaceStartupFailure(receipt) {
      if (!receiptAdmissionOpen || startupReportingClosed || startupSupportReceipt !== undefined ||
          smokeConfiguration.enabled || currentProofConfiguration !== undefined) return;
      try {
        const identity = receipt.operationalIdentity;
        if (!app.hasSingleInstanceLock() || identity.runtimeInstanceId !== runtimeInstanceId ||
            identity.appVersion !== buildInfo.appVersion || identity.buildRevision !== buildInfo.buildRevision ||
            typeof receipt.operationalLogger.write !== 'function') return;
        const data = readSupportBundleDesktopData({
          system: { appVersion: buildInfo.appVersion, buildRevision: buildInfo.buildRevision,
            architecture: process.arch, platform: process.platform, electronVersion: process.versions.electron },
          availability: { backend: receipt.backendState, database: 'notInspected',
            diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
          observation: receipt.observation,
        });
        if (data.observation.status === 'available' &&
            [data.observation.firstError, data.observation.cleanupError].some(
              event => event !== null && event.runtimeInstanceId !== runtimeInstanceId)) return;
        startupSupportReceipt = Object.freeze({ data, logger: receipt.operationalLogger, runtimeRoot: supportRuntimeRoot });
      } catch { /* An invalid reporting receipt cannot replace the original startup failure. */ }
    },
    quitApplication() {
      invalidateStartupReporting();
      if (w6b2ProofConfiguration !== undefined) {
        w6b2ProofQuitRequested = true;
        return;
      }
      app.quit();
    },
    relaunchApplication() {
      invalidateStartupReporting();
      if (w6b2ProofConfiguration !== undefined) {
        w6b2ProofRelaunchRequested = true;
        return;
      }
      if (smokeConfiguration.enabled) {
        app.quit();
        return;
      }
      app.relaunch();
      app.quit();
    },
    resourcesPath: process.resourcesPath,
    runtimeInstanceId,
    reportSmokeStage: (stage) => smokeProgress.reportStage(stage),
    smokeConfiguration,
    userDataPath: app.getPath('userData'),
    ...(observeStartupException === undefined ? {} : { observeStartupException }),
    ...(currentProofConfiguration === undefined
      ? {}
      : {
          w6b2PackagedProof: {
            configuration: currentProofConfiguration,
            async interruptProcess(configuration) {
              await writeW6b2PackagedProofResult(configuration, {
                faultScenario: configuration.faultScenario,
                formatVersion: 2,
                phase: configuration.phase,
                status: 'interrupted',
              });
              w6b2ProofResultWritten = true;
              app.exit(0);
              return new Promise<never>(() => undefined);
            },
            isQuitRequested: () => w6b2ProofQuitRequested,
            isRelaunchRequested: () => w6b2ProofRelaunchRequested,
            async reportResult(result) {
              await writeW6b2PackagedProofResult(
                currentProofConfiguration,
                result,
              );
              w6b2ProofResultWritten = true;
            },
          },
        }),
  };
  try {
    desktopLifecycle = await startDesktopComposition(compositionOptions);
    startupSupportReceipt = undefined;
  }
  finally { receiptAdmissionOpen = false; }
  if (currentProofConfiguration !== undefined) {
    if (!w6b2ProofResultWritten) {
      await writeW6b2PackagedProofResult(
        currentProofConfiguration,
        createW6b2PackagedProofFallbackResult(
          currentProofConfiguration,
          {
            quitRequested: w6b2ProofQuitRequested,
            relaunchRequested: w6b2ProofRelaunchRequested,
          },
        ),
      );
      w6b2ProofResultWritten = true;
    }
    await terminateW6b2PackagedProofRuntime({
      lifecycle: desktopLifecycle,
      quitApplication() {
        w6b2ProofShutdownCompleted = true;
        app.quit();
      },
      quitRequested: w6b2ProofQuitRequested,
      relaunchRequested: w6b2ProofRelaunchRequested,
    });
  }
}

app.on('activate', () => {
  desktopLifecycle?.focusApplicationWindow();
});

app.on('second-instance', () => {
  desktopLifecycle?.focusApplicationWindow();
});

const handleBeforeQuit = createDesktopBeforeQuitHandler({
  invalidateStartupReporting,
  readLifecycle: () => desktopLifecycle,
  quitApplication: () => app.quit(),
});

app.on('before-quit', (event) => {
  if (w6b2ProofShutdownCompleted) { invalidateStartupReporting(); return; }
  void handleBeforeQuit(event);
});

app.on('window-all-closed', () => {
  if (
    !smokeConfiguration.enabled &&
    w6b2ProofConfiguration === undefined &&
    !desktopLifecycle?.isInstallerHandoffPending()
  ) {
    app.quit();
  }
});

if (hasSingleInstanceLock) {
  void runSafeDesktopStartup({
    exitApplication: (code) => { invalidateStartupReporting(); app.exit(code); },
    async loadRuntime() {
      if (app.commandLine.hasSwitch(STARTUP_EXCEPTION_SWITCH)) {
        try {
          const identity = await readDesktopBuildInfo({ applicationPath: app.getAppPath(),
            appVersion: app.getVersion(), isPackaged: app.isPackaged });
          observeStartupException = createStartupExceptionCapture({ enabled: true,
            tempPath: app.getPath('temp'), userDataPath: app.getPath('userData'),
            token: process.env[STARTUP_EXCEPTION_TOKEN_ENV], runtimeInstanceId,
            appVersion: app.getVersion(), buildRevision: identity.buildRevision });
        } catch { /* Missing evidence must not change the existing startup decision. */ }
      }
      return import('./desktopComposition.js');
    },
    observeStartupException: (error) => observeStartupException?.(error, 'earlyStartup'),
    async onFailure(errorCode) {
      if (observeStartupException !== undefined) await observeStartupException.waitForDelivery();
      if (smokeConfiguration.enabled) {
        await writePackagedSmokeResult(smokeConfiguration, {
          code: errorCode,
          stage: smokeProgress.currentStage(),
          status: 'failed',
        });
        return;
      }

      if (w6b2ProofConfiguration !== undefined) {
        await writeW6b2PackagedProofResult(
          w6b2ProofConfiguration,
          createW6b2PackagedProofUnexpectedFailure(
            w6b2ProofConfiguration,
          ),
        );
        return;
      }

      if (startupReportingClosed) return;
      if (errorCode === 'PROFILE_RESTORE_RECOVERY_REQUIRED') {
        await showProfileRestoreRecoveryDialog({
          logsRoot: join(app.getPath('userData'), 'runtime', 'logs'),
          openPath: (path) => shell.openPath(path),
          showMessageBox: (options) => dialog.showMessageBox(options),
        });
        return;
      }
      const receipt = startupSupportReceipt;
      startupSupportReceipt = undefined;
      if (receipt !== undefined) {
        const assertCurrent = () => {
          if (startupReportingClosed) throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
          try {
            if (!app.hasSingleInstanceLock()) throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
          } catch (error) { invalidateStartupReporting(); throw error; }
        };
        const exporter = createDesktopOnlySupportBundleExport({
          assertCurrent, loadDesktopData: () => receipt.data,
          operationalIdentity: { appVersion: receipt.data.system.appVersion,
            buildRevision: receipt.data.system.buildRevision, runtimeInstanceId },
          operationalLogger: receipt.logger, runtimeRoot: receipt.runtimeRoot,
          observeFailure: error => observeStartupException?.(error, 'earlyStartup'),
          async confirmCreation() {
            const result = await dialog.showMessageBox({
              buttons: ['Sulje', 'Luo tukipaketti'], cancelId: 0, defaultId: 0, noLink: true, type: 'warning',
              title: 'Eky ei käynnistynyt', message: 'Paikallista sovellusta ei voitu käynnistää turvallisesti.',
              detail: 'Voit tallentaa rajatun tukipaketin luotetulle tukihenkilölle. Paketti ei ole salattu.\n\nSe sisältää sovellusversiot ja saatavilla olevat turvalliset virhetiedot, ei yrityksen tietoja, PDF:iä, salasanoja tai lokihistoriaa. Tietokantaa ei tarkisteta.',
            });
            return result.response === 1;
          },
          async selectTargetPath(defaultFileName) {
            const result = await dialog.showSaveDialog({ defaultPath: defaultFileName,
              title: 'Tallenna Eky-tukipaketti',
              filters: [{ extensions: ['json.gz'], name: 'Eky-tukipaketti, GZip-pakattu JSON' }],
            });
            return result.canceled || result.filePath === '' ? null : result.filePath;
          },
          showSafeError() {
            dialog.showErrorBox('Tukipakettia ei voitu luoda', 'Eky-tukipakettia ei voitu luoda turvallisesti.');
          },
        });
        startupSupportExport = exporter;
        try { await exporter.create(); }
        finally { exporter.dispose(); startupSupportExport = undefined; }
        return;
      }

      dialog.showErrorBox(
        'Eky ei käynnistynyt',
        'Paikallista sovellusta ei voitu käynnistää turvallisesti.',
      );
    },
    startRuntime: startDesktopRuntime,
    waitUntilReady: () => app.whenReady(),
  });
}

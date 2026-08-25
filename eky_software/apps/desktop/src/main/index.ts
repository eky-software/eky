import {
  app,
  dialog,
  protocol,
  shell,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { DesktopLifecycleHandle } from './desktopComposition.js';
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
  writePackagedSmokeResult,
} from './packagedSmoke.js';
import {
  createW6b2PackagedProofBootstrapConfiguration,
  readW6b2PackagedProofConfiguration,
  W6B2_PACKAGED_PROOF_SWITCH,
  W6B2_PACKAGED_PROOF_TOKEN_ENV,
  writeW6b2PackagedProofResult,
  type W6b2PackagedProofConfiguration,
} from './w6b2PackagedProof.js';
import { terminateW6b2PackagedProofRuntime } from './w6b2PackagedProofTermination.js';

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
let shutdownStarted = false;
const runtimeInstanceId = randomUUID();
let w6b2ProofConfiguration:
  | Readonly<W6b2PackagedProofConfiguration>
  | undefined;
let w6b2ProofQuitRequested = false;
let w6b2ProofRelaunchRequested = false;
let w6b2ProofResultWritten = false;

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
  desktopLifecycle = await startDesktopComposition({
    appVersion: app.getVersion(),
    applicationPath: app.getAppPath(),
    buildInfo,
    releaseInfo,
    quitApplication() {
      if (w6b2ProofConfiguration !== undefined) {
        w6b2ProofQuitRequested = true;
        return;
      }
      app.quit();
    },
    relaunchApplication() {
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
    ...(currentProofConfiguration === undefined
      ? {}
      : {
          w6b2PackagedProof: {
            configuration: currentProofConfiguration,
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
  });
  if (currentProofConfiguration !== undefined) {
    if (!w6b2ProofResultWritten) {
      await writeW6b2PackagedProofResult(currentProofConfiguration, {
        formatVersion: 1,
        phase: currentProofConfiguration.phase,
        status: 'relaunching',
      });
      w6b2ProofResultWritten = true;
    }
    if (desktopLifecycle === undefined) {
      throw new Error('W6B2_PROOF_TERMINATION_INVALID');
    }
    await terminateW6b2PackagedProofRuntime({
      lifecycle: desktopLifecycle,
      quitApplication() {
        shutdownStarted = true;
        app.quit();
      },
    });
  }
}

app.on('activate', () => {
  desktopLifecycle?.focusApplicationWindow();
});

app.on('second-instance', () => {
  desktopLifecycle?.focusApplicationWindow();
});

app.on('before-quit', (event) => {
  if (desktopLifecycle === undefined || shutdownStarted) {
    return;
  }

  event.preventDefault();
  shutdownStarted = true;
  void desktopLifecycle.shutdown().finally(() => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (
    !smokeConfiguration.enabled &&
    w6b2ProofConfiguration === undefined
  ) {
    app.quit();
  }
});

if (hasSingleInstanceLock) {
  void runSafeDesktopStartup({
    exitApplication: (code) => app.exit(code),
    loadRuntime: () => import('./desktopComposition.js'),
    async onFailure(errorCode) {
      if (smokeConfiguration.enabled) {
        await writePackagedSmokeResult(smokeConfiguration, {
          code: errorCode,
          stage: smokeProgress.currentStage(),
          status: 'failed',
        });
        return;
      }

      if (w6b2ProofConfiguration !== undefined) {
        await writeW6b2PackagedProofResult(w6b2ProofConfiguration, {
          errorCode: 'W6B2_PROOF_UNEXPECTED',
          formatVersion: 1,
          phase: w6b2ProofConfiguration.phase,
          status: 'failed',
        });
        return;
      }

      if (errorCode === 'PROFILE_RESTORE_RECOVERY_REQUIRED') {
        await showProfileRestoreRecoveryDialog({
          logsRoot: join(app.getPath('userData'), 'runtime', 'logs'),
          openPath: (path) => shell.openPath(path),
          showMessageBox: (options) => dialog.showMessageBox(options),
        });
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

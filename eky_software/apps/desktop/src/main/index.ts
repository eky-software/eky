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

if (smokeConfiguration.userDataPath !== undefined) {
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

async function startDesktopRuntime(
  startDesktopComposition: StartDesktopComposition,
): Promise<void> {
  if ('errorCode' in packageModeResult) {
    throw new Error(packageModeResult.errorCode);
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
  desktopLifecycle = await startDesktopComposition({
    appVersion: app.getVersion(),
    applicationPath: app.getAppPath(),
    buildInfo,
    releaseInfo,
    quitApplication: () => app.quit(),
    relaunchApplication() {
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
  });
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
  if (!smokeConfiguration.enabled) {
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

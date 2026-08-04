import {
  app,
  dialog,
  protocol,
} from 'electron';
import { randomUUID } from 'node:crypto';

import type { DesktopLifecycleHandle } from './desktopComposition.js';
import { runSafeDesktopStartup } from './earlyStartup.js';
import { readDesktopBuildInfo } from '../release/desktopBuildInfoReader.js';
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

let desktopLifecycle: DesktopLifecycleHandle | undefined;
let shutdownStarted = false;
const runtimeInstanceId = randomUUID();

async function startDesktopRuntime(
  startDesktopComposition: StartDesktopComposition,
): Promise<void> {
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
  desktopLifecycle = await startDesktopComposition({
    appVersion: app.getVersion(),
    applicationPath: app.getAppPath(),
    buildInfo,
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

      dialog.showErrorBox(
        errorCode === 'PROFILE_RESTORE_RECOVERY_REQUIRED'
          ? 'Palautus vaatii tarkistuksen'
          : 'Eky ei käynnistynyt',
        errorCode === 'PROFILE_RESTORE_RECOVERY_REQUIRED'
          ? 'Varmuuskopion palautusta ei voitu viimeistellä tai perua turvallisesti. Eky ei avaa yritystietoja ennen tilanteen tarkistamista.'
          : 'Paikallista sovellusta ei voitu käynnistää turvallisesti.',
      );
    },
    startRuntime: startDesktopRuntime,
    waitUntilReady: () => app.whenReady(),
  });
}

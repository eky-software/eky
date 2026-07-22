import {
  app,
  dialog,
  protocol,
} from 'electron';

import {
  startDesktopComposition,
  type DesktopLifecycleHandle,
} from './desktopComposition.js';
import {
  createPackagedSmokeConfiguration,
  writePackagedSmokeResult,
} from './packagedSmoke.js';

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
  hasSmokeSwitch: app.commandLine.hasSwitch('desktop-smoke'),
  tempPath: app.getPath('temp'),
  tokenValue: process.env.EKY_DESKTOP_SMOKE_TOKEN,
});

if (smokeConfiguration.userDataPath !== undefined) {
  app.setPath('userData', smokeConfiguration.userDataPath);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

let desktopLifecycle: DesktopLifecycleHandle | undefined;
let shutdownStarted = false;

async function startDesktopRuntime(): Promise<void> {
  desktopLifecycle = await startDesktopComposition({
    applicationPath: app.getAppPath(),
    quitApplication: () => app.quit(),
    resourcesPath: process.resourcesPath,
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
  void app
    .whenReady()
    .then(startDesktopRuntime)
    .catch((error: unknown) => {
      if (smokeConfiguration.enabled) {
        const safeCode =
          error instanceof Error &&
          /^(BACKEND|DESKTOP)_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'DESKTOP_START_FAILED';

        void writePackagedSmokeResult(smokeConfiguration, {
          code: safeCode,
          status: 'failed',
        }).finally(() => {
          app.exit(1);
        });
        return;
      }

      dialog.showErrorBox(
        'Eky ei käynnistynyt',
        'Paikallista sovellusta ei voitu käynnistää turvallisesti.',
      );
      app.exit(1);
    });
}

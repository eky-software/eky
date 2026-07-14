import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  protocol,
  session,
} from 'electron';

import { registerApplicationProtocol } from './applicationProtocol.js';
import {
  createSecureWindowOptions,
  isAllowedApplicationNavigation,
} from './windowSecurity.js';
import {
  startDesktopBackend,
  type DesktopBackendHandle,
} from '../runtime/backendProcess.js';
import { createDesktopRuntimeSession } from '../runtime/runtimeSession.js';

function readSmokeToken(value: string | undefined): string | undefined {
  return value !== undefined && /^[a-f0-9]{32}$/.test(value)
    ? value
    : undefined;
}

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

const smokeToken = readSmokeToken(process.env.EKY_DESKTOP_SMOKE_TOKEN);
const smokeMode =
  smokeToken !== undefined && app.commandLine.hasSwitch('desktop-smoke');
const smokeRoot =
  smokeToken === undefined
    ? undefined
    : join(app.getPath('temp'), 'eky-desktop-smoke', smokeToken);

if (smokeMode && smokeRoot !== undefined) {
  app.setPath('userData', join(smokeRoot, 'user-data'));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

let backendHandle: DesktopBackendHandle | undefined;
let shutdownStarted = false;

async function writeSmokeResult(
  result: { code?: string; status: 'failed' | 'ok' | 'started' },
): Promise<void> {
  if (!smokeMode) {
    return;
  }

  if (smokeRoot === undefined) {
    return;
  }

  const resultDirectory = join(smokeRoot, 'result');

  await mkdir(resultDirectory, { recursive: true });
  await writeFile(
    join(resultDirectory, 'desktop-smoke-result.json'),
    `${JSON.stringify(result)}\n`,
    'utf8',
  );
}

function createMainWindow(showWhenReady = true): BrowserWindow {
  const preloadPath = join(app.getAppPath(), 'dist/preload/index.js');
  const window = new BrowserWindow(createSecureWindowOptions(preloadPath));

  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedApplicationNavigation(targetUrl)) {
      event.preventDefault();
    }
  });
  if (showWhenReady) {
    window.once('ready-to-show', () => window.show());
  }

  return window;
}

async function loadApplicationWindow(window: BrowserWindow): Promise<void> {
  try {
    await window.loadURL('eky://app/index.html');
  } catch {
    throw new Error('DESKTOP_SMOKE_RENDERER_FAILED');
  }
}

async function runPackagedSmokeCheck(
  backend: DesktopBackendHandle,
  databaseFilePath: string,
  smokePdfPath: string,
): Promise<void> {
  const healthResponse = await fetch(`http://127.0.0.1:${backend.port}/health`, {
    signal: AbortSignal.timeout(5_000),
  });

  if (!healthResponse.ok) {
    throw new Error('DESKTOP_SMOKE_HEALTH_FAILED');
  }

  await stat(databaseFilePath);
  const pdf = await readFile(smokePdfPath);

  if (pdf.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('DESKTOP_SMOKE_PDF_FAILED');
  }
}

async function startDesktopRuntime(): Promise<void> {
  const runtimeSessionSecret = createDesktopRuntimeSession();
  const backendRoot = join(process.resourcesPath, 'backend');
  const dataRoot = join(app.getPath('userData'), 'runtime');
  const databaseFilePath = join(dataRoot, 'data', 'eky.sqlite');
  const invoiceDocumentStorageRoot = join(dataRoot, 'storage', 'invoices');
  const smokePdfPath = join(dataRoot, 'smoke', 'approved-invoice-smoke.pdf');
  await writeSmokeResult({ status: 'started' });

  backendHandle = await startDesktopBackend({
    config: {
      backendRoot,
      createSmokePdf: smokeMode,
      databaseFilePath,
      invoiceDocumentStorageRoot,
      migrationsDirectory: join(backendRoot, 'dist', 'database', 'migrations'),
      runtimeSessionSecret,
      smokePdfPath,
    },
    runnerPath: join(
      process.resourcesPath,
      'desktop-runtime',
      'backendRunner.js',
    ),
  });

  backendHandle.onUnexpectedExit(() => {
    dialog.showErrorBox(
      'Eky suljettiin',
      'Paikallinen palvelu pysähtyi odottamatta. Sovellus suljetaan turvallisesti.',
    );
    app.quit();
  });

  registerApplicationProtocol({
    backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
    runtimeSessionSecret,
    webRoot: join(app.getAppPath(), 'web'),
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (smokeMode) {
    const smokeWindow = createMainWindow(false);

    await loadApplicationWindow(smokeWindow);
    await runPackagedSmokeCheck(backendHandle, databaseFilePath, smokePdfPath);
    await writeSmokeResult({ status: 'ok' });
    await backendHandle.stop();
    smokeWindow.destroy();
    app.quit();
    return;
  }

  void loadApplicationWindow(createMainWindow()).catch(() => {
    dialog.showErrorBox(
      'Eky ei käynnistynyt',
      'Käyttöliittymää ei voitu ladata turvallisesti.',
    );
    app.quit();
  });
}

app.on('before-quit', (event) => {
  if (backendHandle === undefined || shutdownStarted) {
    return;
  }

  event.preventDefault();
  shutdownStarted = true;
  void backendHandle.stop().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (!smokeMode) {
    app.quit();
  }
});

if (hasSingleInstanceLock) {
  void app
    .whenReady()
    .then(startDesktopRuntime)
    .catch((error: unknown) => {
      if (smokeMode) {
        const safeCode =
          error instanceof Error &&
          /^(BACKEND|DESKTOP)_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'DESKTOP_START_FAILED';

        void writeSmokeResult({ code: safeCode, status: 'failed' }).finally(() => {
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

import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  net,
  protocol,
  safeStorage,
  session,
  type MessageBoxOptions,
} from 'electron';

import {
  createApplicationWindow,
  loadApplicationWindow,
} from './applicationWindow.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import {
  createPackagedSmokeConfiguration,
  createPackagedSmokeSecretFileStore,
  runPackagedSmokeCheck,
  writePackagedSmokeResult,
} from './packagedSmoke.js';
import type { SmtpTestPreparationConfirmation } from './smtpTestConfirmation.js';
import {
  createInvoiceEmailConfirmationDetail,
  type InvoiceEmailPreparationConfirmation,
} from './invoiceEmailConfirmation.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';
import {
  startDesktopBackend,
  type DesktopBackendHandle,
} from '../runtime/backendProcess.js';
import { createDesktopRuntimeSession } from '../runtime/runtimeSession.js';
import { createMainSecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import {
  startSecretBrokerMain,
  type SecretBrokerMainHandle,
} from '../secrets/secretBrokerMain.js';
import { SafeStorageStringProtector } from '../secrets/safeStorageStringProtector.js';
import {
  createInvoicePdfPreviewWindowController,
  type InvoicePdfPreviewWindowController,
} from '../pdf/invoicePdfPreviewWindow.js';

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
const smokeMode = smokeConfiguration.enabled;

if (smokeConfiguration.userDataPath !== undefined) {
  app.setPath('userData', smokeConfiguration.userDataPath);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

let backendHandle: DesktopBackendHandle | undefined;
let applicationWindow: BrowserWindow | undefined;
let invoicePdfPreviewController:
  | InvoicePdfPreviewWindowController
  | undefined;
let secretBrokerHandle: SecretBrokerMainHandle | undefined;
let shutdownStarted = false;

function registerApplicationWindow(window: BrowserWindow): void {
  applicationWindow = window;
  window.once('closed', () => {
    if (applicationWindow === window) {
      applicationWindow = undefined;
    }
  });
}

async function startDesktopRuntime(): Promise<void> {
  const runtimeSessionSecret = createDesktopRuntimeSession();
  const backendRoot = join(process.resourcesPath, 'backend');
  const dataRoot = join(app.getPath('userData'), 'runtime');
  const databaseFilePath = join(dataRoot, 'data', 'eky.sqlite');
  const invoiceDocumentStorageRoot = join(dataRoot, 'storage', 'invoices');
  const secretFilePath = join(
    dataRoot,
    'secrets',
    'company-email-smtp-v1.dat',
  );
  const smokePdfPath = join(dataRoot, 'smoke', 'approved-invoice-smoke.pdf');
  const secretBrokerChannel = new MessageChannelMain();

  await writePackagedSmokeResult(smokeConfiguration, { status: 'started' });
  secretBrokerHandle = startSecretBrokerMain({
    encryptedSecretFile: createPackagedSmokeSecretFileStore(
      secretFilePath,
      smokeMode,
    ),
    protector: new SafeStorageStringProtector(safeStorage),
    transport: createMainSecretBrokerTransport(secretBrokerChannel.port1),
  });

  try {
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
        'runtime',
        'backendRunner.js',
      ),
      secretBrokerPort: secretBrokerChannel.port2,
    });
  } catch (error) {
    secretBrokerHandle.close();
    secretBrokerHandle = undefined;
    throw error;
  }

  backendHandle.onUnexpectedExit(() => {
    dialog.showErrorBox(
      'Eky suljettiin',
      'Paikallinen palvelu pysähtyi odottamatta. Sovellus suljetaan turvallisesti.',
    );
    app.quit();
  });

  registerApplicationProtocol({
    backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
    confirmInvoiceEmailPreparation,
    confirmSmtpTestPreparation,
    runtimeSessionSecret,
    webRoot: join(app.getAppPath(), 'web'),
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (smokeMode) {
    const smokeWindow = createApplicationWindow(app.getAppPath(), false);
    registerApplicationWindow(smokeWindow);

    invoicePdfPreviewController = createInvoicePdfPreviewController(smokeWindow);

    await loadApplicationWindow(smokeWindow);
    await runPackagedSmokeCheck({
      backend: backendHandle,
      databaseFilePath,
      mainWindow: smokeWindow,
      pdfPreviewController: invoicePdfPreviewController,
      runtimeSessionSecret,
      secretFilePath,
      smokePdfPath,
    });
    await writePackagedSmokeResult(smokeConfiguration, { status: 'ok' });
    await backendHandle.stop();
    secretBrokerHandle.close();
    secretBrokerHandle = undefined;
    invoicePdfPreviewController.dispose();
    invoicePdfPreviewController = undefined;
    smokeWindow.destroy();
    app.quit();
    return;
  }

  const mainWindow = createApplicationWindow(app.getAppPath());
  registerApplicationWindow(mainWindow);

  invoicePdfPreviewController = createInvoicePdfPreviewController(mainWindow);
  void loadApplicationWindow(mainWindow).catch(() => {
    dialog.showErrorBox(
      'Eky ei käynnistynyt',
      'Käyttöliittymää ei voitu ladata turvallisesti.',
    );
    app.quit();
  });
}

function createInvoicePdfPreviewController(
  mainWindow: BrowserWindow,
): InvoicePdfPreviewWindowController {
  return createInvoicePdfPreviewWindowController({
    createWindow: (options) => new BrowserWindow(options),
    ipcMain,
    mainWindow,
    restoreMainWindowFocus() {
      if (!smokeMode) {
        restoreWindowInputFocus(mainWindow);
      }
    },
    showSafeError() {
      showApplicationError(
        'Laskua ei voitu avata',
        'Laskun PDF-esikatselua ei voitu avata turvallisesti.',
      );
    },
    async verifyPdfAvailable(url) {
      const response = await net.fetch(url);
      const contentType = response.headers.get('content-type') ?? '';
      const available =
        response.ok &&
        contentType.toLowerCase().startsWith('application/pdf');

      await response.body?.cancel().catch(() => undefined);

      return available;
    },
  });
}

async function confirmInvoiceEmailPreparation(
  preparation: InvoiceEmailPreparationConfirmation,
): Promise<boolean> {
  const response = await showApplicationMessageBox({
    buttons: [preparation.resend ? 'Lähetä uudelleen' : 'Lähetä lasku', 'Peruuta'],
    cancelId: 1,
    defaultId: 1,
    detail: createInvoiceEmailConfirmationDetail(preparation),
    message: preparation.resend
      ? 'Vahvista laskun uudelleenlähetys'
      : 'Vahvista laskun lähetys',
    noLink: true,
    title: 'Eky - laskun sähköposti',
    type: 'question',
  });

  return response === 0;
}

async function confirmSmtpTestPreparation(
  preparation: SmtpTestPreparationConfirmation,
): Promise<boolean> {
  const response = await showApplicationMessageBox({
    buttons: ['Lähetä testiviesti', 'Peruuta'],
    cancelId: 1,
    defaultId: 1,
    detail: [
      `Vastaanottaja: ${preparation.testRecipient}`,
      `Otsikko: ${preparation.subject}`,
      `Liite: ${preparation.attachmentFileName}`,
    ].join('\n'),
    message: 'Vahvista DNA SMTP -testilähetys',
    noLink: true,
    title: 'Eky - sähköpostitesti',
    type: 'question',
  });

  return response === 0;
}

async function showApplicationMessageBox(
  options: MessageBoxOptions,
): Promise<number> {
  const owner = applicationWindow;

  try {
    const result =
      owner === undefined || owner.isDestroyed()
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(owner, options);

    return result.response;
  } finally {
    restoreWindowInputFocus(owner);
  }
}

function showApplicationError(title: string, message: string): void {
  const owner = applicationWindow;

  if (owner === undefined || owner.isDestroyed()) {
    dialog.showErrorBox(title, message);
    return;
  }

  void dialog
    .showMessageBox(owner, {
      buttons: ['Sulje'],
      cancelId: 0,
      defaultId: 0,
      message,
      noLink: true,
      title,
      type: 'error',
    })
    .catch(() => undefined)
    .finally(() => restoreWindowInputFocus(owner));
}

app.on('activate', () => {
  restoreWindowInputFocus(applicationWindow);
});

app.on('second-instance', () => {
  restoreWindowInputFocus(applicationWindow);
});

app.on('before-quit', (event) => {
  if (backendHandle === undefined || shutdownStarted) {
    return;
  }

  event.preventDefault();
  shutdownStarted = true;
  invoicePdfPreviewController?.dispose();
  invoicePdfPreviewController = undefined;
  void backendHandle.stop().finally(() => {
    secretBrokerHandle?.close();
    secretBrokerHandle = undefined;
    app.quit();
  });
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

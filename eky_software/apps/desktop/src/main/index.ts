import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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

import { registerApplicationProtocol } from './applicationProtocol.js';
import { createDeleteDraftSmokeFixture } from './applicationProtocolSmoke.js';
import { localRuntimeSessionHeaderName } from './protocolPolicy.js';
import type { SmtpTestPreparationConfirmation } from './smtpTestConfirmation.js';
import {
  createInvoiceEmailConfirmationDetail,
  type InvoiceEmailPreparationConfirmation,
} from './invoiceEmailConfirmation.js';
import {
  createSecureWindowOptions,
  isAllowedApplicationNavigation,
} from './windowSecurity.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';
import {
  startDesktopBackend,
  type DesktopBackendHandle,
} from '../runtime/backendProcess.js';
import { createDesktopRuntimeSession } from '../runtime/runtimeSession.js';
import { createMainSecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import {
  EncryptedSecretFile,
  type EncryptedSecretFileStore,
} from '../secrets/encryptedSecretFile.js';
import {
  startSecretBrokerMain,
  type SecretBrokerMainHandle,
} from '../secrets/secretBrokerMain.js';
import { SafeStorageStringProtector } from '../secrets/safeStorageStringProtector.js';
import { createInvoicePdfPreviewSmokeFixture } from '../pdf/invoicePdfPreviewSmoke.js';
import {
  createInvoicePdfPreviewWindowController,
  type InvoicePdfPreviewWindowController,
} from '../pdf/invoicePdfPreviewWindow.js';

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
let applicationWindow: BrowserWindow | undefined;
let invoicePdfPreviewController:
  | InvoicePdfPreviewWindowController
  | undefined;
let secretBrokerHandle: SecretBrokerMainHandle | undefined;
let shutdownStarted = false;

function createSecretFileStore(
  secretFilePath: string,
): EncryptedSecretFileStore {
  const encryptedSecretFile = new EncryptedSecretFile(secretFilePath);

  if (!smokeMode) {
    return encryptedSecretFile;
  }

  const forbiddenPlaintextMarker = Buffer.from(
    'eky-safe-storage-smoke-',
    'utf8',
  );

  return {
    confirm: (candidate) => encryptedSecretFile.confirm(candidate),
    readCandidate: () => encryptedSecretFile.readCandidate(),
    remove: () => encryptedSecretFile.remove(),
    async write(ciphertext) {
      if (Buffer.from(ciphertext).includes(forbiddenPlaintextMarker)) {
        throw new Error('DESKTOP_SMOKE_SECRET_ENCRYPTION_FAILED');
      }

      await encryptedSecretFile.write(ciphertext);
    },
  };
}

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
  const preloadPath = join(app.getAppPath(), 'dist/preload/index.cjs');
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

function registerApplicationWindow(window: BrowserWindow): void {
  applicationWindow = window;
  window.once('closed', () => {
    if (applicationWindow === window) {
      applicationWindow = undefined;
    }
  });
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
  mainWindow: BrowserWindow,
  runtimeSessionSecret: string,
  secretFilePath: string,
  smokePdfPath: string,
  pdfPreviewController: InvoicePdfPreviewWindowController,
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

  await assertPackagedDesktopBridge(pdfPreviewController);

  const deleteDraftId = await createDeleteDraftSmokeFixture({
    backendPort: backend.port,
    runtimeSessionSecret,
  });

  await assertPackagedDeleteTransport(mainWindow, deleteDraftId);

  await verifyCompanyEmailSecretHttpLifecycle(
    backend.port,
    runtimeSessionSecret,
  );

  const previewInvoiceId = await createInvoicePdfPreviewSmokeFixture({
    backendPort: backend.port,
    runtimeSessionSecret,
  });

  await pdfPreviewController.openForSmoke(previewInvoiceId);
  pdfPreviewController.close();

  for (const path of [
    secretFilePath,
    `${secretFilePath}.next`,
    `${secretFilePath}.backup`,
  ]) {
    try {
      await stat(path);
      throw new Error('DESKTOP_SMOKE_SECRET_CLEANUP_FAILED');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }

      throw error;
    }
  }
}

async function assertPackagedDeleteTransport(
  mainWindow: BrowserWindow,
  invoiceDraftId: string,
): Promise<void> {
  const result: unknown = await mainWindow.webContents.executeJavaScript(
    `fetch(${JSON.stringify(`/invoice-drafts/${invoiceDraftId}`)}, { method: 'DELETE' })
      .then(async (response) => ({
        body: await response.text(),
        status: response.status,
      }))`,
    true,
  );

  if (
    typeof result !== 'object' ||
    result === null ||
    !('body' in result) ||
    typeof result.body !== 'string' ||
    !('status' in result) ||
    result.status !== 200
  ) {
    throw new Error('DESKTOP_SMOKE_DELETE_TRANSPORT_FAILED');
  }

  let body: unknown;

  try {
    body = JSON.parse(result.body) as unknown;
  } catch {
    throw new Error('DESKTOP_SMOKE_DELETE_TRANSPORT_FAILED');
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('deleted' in body) ||
    body.deleted !== true
  ) {
    throw new Error('DESKTOP_SMOKE_DELETE_TRANSPORT_FAILED');
  }
}

async function assertPackagedDesktopBridge(
  pdfPreviewController: InvoicePdfPreviewWindowController,
): Promise<void> {
  if (!(await pdfPreviewController.hasRendererBridgeForSmoke())) {
    throw new Error('DESKTOP_SMOKE_PRELOAD_BRIDGE_FAILED');
  }
}

async function verifyCompanyEmailSecretHttpLifecycle(
  port: number,
  runtimeSessionSecret: string,
): Promise<void> {
  const secret = `eky-http-secret-smoke-${randomBytes(32).toString('base64url')}`;

  if (await requestCompanyEmailSecretStatus(port, runtimeSessionSecret, 'GET')) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (
    !(await requestCompanyEmailSecretStatus(
      port,
      runtimeSessionSecret,
      'PUT',
      secret,
    ))
  ) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (!(await requestCompanyEmailSecretStatus(port, runtimeSessionSecret, 'GET'))) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (await requestCompanyEmailSecretStatus(port, runtimeSessionSecret, 'DELETE')) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  if (await requestCompanyEmailSecretStatus(port, runtimeSessionSecret, 'GET')) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }
}

async function requestCompanyEmailSecretStatus(
  port: number,
  runtimeSessionSecret: string,
  method: 'DELETE' | 'GET' | 'PUT',
  secret?: string,
): Promise<boolean> {
  const headers = new Headers({
    accept: 'application/json',
    [localRuntimeSessionHeaderName]: runtimeSessionSecret,
  });

  if (method === 'PUT') {
    headers.set('content-type', 'application/json');
  }

  const requestOptions: RequestInit = {
    headers,
    method,
    signal: AbortSignal.timeout(5_000),
  };

  if (method === 'PUT') {
    requestOptions.body = JSON.stringify({ secret });
  }

  const response = await fetch(
    `http://127.0.0.1:${port}/company-settings/email-secret`,
    requestOptions,
  );

  if (!response.ok) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  const body: unknown = await response.json();

  if (
    typeof body !== 'object' ||
    body === null ||
    !('emailSecretStatus' in body) ||
    typeof body.emailSecretStatus !== 'object' ||
    body.emailSecretStatus === null ||
    !('configured' in body.emailSecretStatus) ||
    typeof body.emailSecretStatus.configured !== 'boolean'
  ) {
    throw new Error('DESKTOP_SMOKE_SECRET_HTTP_FAILED');
  }

  return body.emailSecretStatus.configured;
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

  await writeSmokeResult({ status: 'started' });
  secretBrokerHandle = startSecretBrokerMain({
    encryptedSecretFile: createSecretFileStore(secretFilePath),
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
    const smokeWindow = createMainWindow(false);
    registerApplicationWindow(smokeWindow);

    invoicePdfPreviewController = createInvoicePdfPreviewController(smokeWindow);

    await loadApplicationWindow(smokeWindow);
    await runPackagedSmokeCheck(
      backendHandle,
      databaseFilePath,
      smokeWindow,
      runtimeSessionSecret,
      secretFilePath,
      smokePdfPath,
      invoicePdfPreviewController,
    );
    await writeSmokeResult({ status: 'ok' });
    await backendHandle.stop();
    secretBrokerHandle.close();
    secretBrokerHandle = undefined;
    invoicePdfPreviewController.dispose();
    invoicePdfPreviewController = undefined;
    smokeWindow.destroy();
    app.quit();
    return;
  }

  const mainWindow = createMainWindow();
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

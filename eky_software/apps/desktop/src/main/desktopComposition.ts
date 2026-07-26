import { join } from 'node:path';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  net,
  safeStorage,
  session,
  shell,
} from 'electron';

import {
  createOperationalLogFolderCapability,
  type OperationalLogFolderCapability,
} from '../diagnostics/operationalLogFolderCapability.js';
import {
  createInvoicePdfPreviewWindowController,
  type InvoicePdfPreviewWindowController,
} from '../pdf/invoicePdfPreviewWindow.js';
import { startDesktopBackend } from '../runtime/backendProcess.js';
import { createDesktopRuntimeSession } from '../runtime/runtimeSession.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import { maintainDesktopIncidentIndex } from '../observability/infrastructure/desktopIncidentIndexRetention.js';
import { maintainDesktopOperationalLogs } from '../observability/infrastructure/desktopOperationalLogRetention.js';
import { DesktopIncidentIndexingOperationalLogger } from '../observability/infrastructure/jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from '../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { createMainSecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import { startSecretBrokerMain } from '../secrets/secretBrokerMain.js';
import { SafeStorageStringProtector } from '../secrets/safeStorageStringProtector.js';
import {
  createApplicationWindow,
  loadApplicationWindow,
} from './applicationWindow.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import { createInvoiceDeliveryConfirmation } from './invoiceDeliveryConfirmation.js';
import {
  createPackagedSmokeSecretFileStore,
  runPackagedSmokeCheck,
  writePackagedSmokeResult,
  type PackagedSmokeConfiguration,
} from './packagedSmoke.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';

export interface DesktopLifecycleHandle {
  applicationWindow: BrowserWindow;
  focusApplicationWindow(): void;
  shutdown(): Promise<void>;
}

interface StartDesktopCompositionOptions {
  appVersion: string;
  applicationPath: string;
  quitApplication(): void;
  resourcesPath: string;
  smokeConfiguration: PackagedSmokeConfiguration;
  userDataPath: string;
}

export async function startDesktopComposition(
  options: StartDesktopCompositionOptions,
): Promise<DesktopLifecycleHandle | undefined> {
  const smokeMode = options.smokeConfiguration.enabled;
  const runtimeSessionSecret = createDesktopRuntimeSession();
  const backendRoot = join(options.resourcesPath, 'backend');
  const dataRoot = join(options.userDataPath, 'runtime');
  const operationalLogsRoot = join(dataRoot, 'logs');
  const retention = maintainDesktopOperationalLogs({
    logsRoot: operationalLogsRoot,
  });
  maintainDesktopIncidentIndex({ logsRoot: operationalLogsRoot });
  const desktopOperationalLogger =
    new DesktopIncidentIndexingOperationalLogger(
      new JsonLineDesktopOperationalLogger({
        logsRoot: operationalLogsRoot,
      }),
      operationalLogsRoot,
    );
  const desktopStartedAt = Date.now();
  const desktopAppVersion = options.appVersion;
  desktopOperationalLogger.write(
    createDesktopOperationalEvent(
      { eventName: 'desktop.starting' },
      { appVersion: desktopAppVersion },
    ),
  );
  desktopOperationalLogger.write(
    createDesktopOperationalEvent(
      {
        deletedByteCount: retention.deletedByteCount,
        deletedFileCount: retention.deletedFileCount,
        eventName: 'operationalLog.retentionCompleted',
        ...(retention.oldestRemainingMonth === undefined
          ? {}
          : { oldestRemainingMonth: retention.oldestRemainingMonth }),
      },
      { appVersion: desktopAppVersion },
    ),
  );
  const databaseFilePath = join(dataRoot, 'data', 'eky.sqlite');
  const invoiceDocumentStorageRoot = join(dataRoot, 'storage', 'invoices');
  const secretFilePath = join(
    dataRoot,
    'secrets',
    'company-email-smtp-v1.dat',
  );
  const smokePdfPath = join(dataRoot, 'smoke', 'approved-invoice-smoke.pdf');
  const secretBrokerChannel = new MessageChannelMain();
  let applicationWindow: BrowserWindow | undefined;
  let pdfPreviewController: InvoicePdfPreviewWindowController | undefined;
  let operationalLogFolderCapability:
    | OperationalLogFolderCapability
    | undefined;
  let shutdownStarted = false;

  const deliveryConfirmation = createInvoiceDeliveryConfirmation(
    () => applicationWindow,
  );

  await writePackagedSmokeResult(options.smokeConfiguration, {
    status: 'started',
  });

  const secretBrokerHandle = startSecretBrokerMain({
    encryptedSecretFile: createPackagedSmokeSecretFileStore(
      secretFilePath,
      smokeMode,
    ),
    observer: {
      operationFailed(operation, errorCode) {
        const isReadOperation =
          operation === 'getCompanyEmailSecret' ||
          operation === 'hasCompanyEmailSecret';
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode,
              eventName: isReadOperation
                ? 'secretStorage.decryptFailed'
                : 'secretStorage.writeFailed',
              retryable: false,
              sideEffectState: 'unknown',
              stage: operation,
            },
            { appVersion: desktopAppVersion },
          ),
        );
      },
    },
    protector: new SafeStorageStringProtector(safeStorage),
    transport: createMainSecretBrokerTransport(secretBrokerChannel.port1),
  });

  let backendHandle;

  try {
    backendHandle = await startDesktopBackend({
      appVersion: desktopAppVersion,
      config: {
        appVersion: desktopAppVersion,
        backendRoot,
        createSmokePdf: smokeMode,
        databaseFilePath,
        invoiceDocumentStorageRoot,
        migrationsDirectory: join(
          backendRoot,
          'dist',
          'database',
          'migrations',
        ),
        operationalLogsRoot,
        runtimeSessionSecret,
        smokePdfPath,
      },
      operationalLogger: desktopOperationalLogger,
      runnerPath: join(
        options.resourcesPath,
        'desktop-runtime',
        'runtime',
        'backendRunner.js',
      ),
      secretBrokerPort: secretBrokerChannel.port2,
    });
  } catch (error) {
    secretBrokerHandle.close();
    throw error;
  }

  backendHandle.onUnexpectedExit(() => {
    dialog.showErrorBox(
      'Eky suljettiin',
      'Paikallinen palvelu pysähtyi odottamatta. Sovellus suljetaan turvallisesti.',
    );
    options.quitApplication();
  });

  registerApplicationProtocol({
    backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
    confirmInvoiceEmailPreparation:
      deliveryConfirmation.confirmInvoiceEmailPreparation,
    confirmSmtpTestPreparation:
      deliveryConfirmation.confirmSmtpTestPreparation,
    runtimeSessionSecret,
    webRoot: join(options.applicationPath, 'web'),
  });

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            eventName: 'electron.permissionDenied',
            stage: 'request',
          },
          { appVersion: desktopAppVersion },
        ),
      );
      callback(false);
    },
  );
  session.defaultSession.setPermissionCheckHandler(() => {
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        {
          eventName: 'electron.permissionDenied',
          stage: 'check',
        },
        { appVersion: desktopAppVersion },
      ),
    );
    return false;
  });

  applicationWindow = createApplicationWindow(
    options.applicationPath,
    !smokeMode,
    {
      loadFailed() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode: 'APPLICATION_WINDOW_LOAD_FAILED',
              eventName: 'applicationWindow.loadFailed',
              retryable: true,
              sideEffectState: 'none',
              stage: 'load',
            },
            { appVersion: desktopAppVersion },
          ),
        );
      },
      navigationBlocked() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              eventName: 'applicationWindow.navigationBlocked',
              stage: 'will-navigate',
            },
            { appVersion: desktopAppVersion },
          ),
        );
      },
      newWindowBlocked() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              eventName: 'applicationWindow.newWindowBlocked',
              stage: 'window-open',
            },
            { appVersion: desktopAppVersion },
          ),
        );
      },
      renderProcessGone() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode: 'RENDER_PROCESS_GONE',
              eventName: 'applicationWindow.renderProcessGone',
              retryable: true,
              sideEffectState: 'unknown',
              stage: 'runtime',
            },
            { appVersion: desktopAppVersion },
          ),
        );
      },
    },
  );
  const mainWindow = applicationWindow;
  operationalLogFolderCapability = createOperationalLogFolderCapability({
    ipcMain,
    mainWindow,
    openPath: (path) => shell.openPath(path),
    runtimeRoot: dataRoot,
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Lokikansiota ei voitu avata',
        'Eky-lokikansiota ei voitu avata turvallisesti.',
      );
    },
  });
  pdfPreviewController = createInvoicePdfPreviewController(
    desktopAppVersion,
    desktopOperationalLogger,
    mainWindow,
    smokeMode,
    deliveryConfirmation.showApplicationError,
  );

  const lifecycleHandle: DesktopLifecycleHandle = {
    applicationWindow: mainWindow,
    focusApplicationWindow() {
      restoreWindowInputFocus(mainWindow);
    },
    async shutdown() {
      if (shutdownStarted) {
        return;
      }

      shutdownStarted = true;
      const shutdownStartedAt = Date.now();
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          { eventName: 'desktop.shutdownStarted' },
          { appVersion: desktopAppVersion },
        ),
      );
      pdfPreviewController?.dispose();
      pdfPreviewController = undefined;
      operationalLogFolderCapability?.dispose();
      operationalLogFolderCapability = undefined;

      try {
        await backendHandle.stop();
        secretBrokerHandle.close();
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - shutdownStartedAt,
              eventName: 'desktop.shutdownCompleted',
            },
            { appVersion: desktopAppVersion },
          ),
        );
      } catch {
        secretBrokerHandle.close();
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - shutdownStartedAt,
              errorCode: 'DESKTOP_SHUTDOWN_FAILED',
              eventName: 'desktop.shutdownFailed',
              retryable: false,
              sideEffectState: 'unknown',
              stage: 'shutdown',
            },
            { appVersion: desktopAppVersion },
          ),
        );
        throw new Error('DESKTOP_SHUTDOWN_FAILED');
      }
    },
  };

  if (smokeMode) {
    const smokeStartedAt = Date.now();
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        { eventName: 'packagedSmoke.started' },
        { appVersion: desktopAppVersion },
      ),
    );
    try {
      await loadApplicationWindow(mainWindow);
      await runPackagedSmokeCheck({
        backend: backendHandle,
        databaseFilePath,
        mainWindow,
        pdfPreviewController,
        runtimeSessionSecret,
        secretFilePath,
        smokePdfPath,
      });
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - smokeStartedAt,
            eventName: 'packagedSmoke.completed',
          },
          { appVersion: desktopAppVersion },
        ),
      );
      await writePackagedSmokeResult(options.smokeConfiguration, {
        status: 'ok',
      });
      await lifecycleHandle.shutdown();
      mainWindow.destroy();
      options.quitApplication();
      return undefined;
    } catch {
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - smokeStartedAt,
            errorCode: 'PACKAGED_SMOKE_FAILED',
            eventName: 'packagedSmoke.failed',
            retryable: false,
            sideEffectState: 'unknown',
            stage: 'smoke',
          },
          { appVersion: desktopAppVersion },
        ),
      );
      throw new Error('PACKAGED_SMOKE_FAILED');
    }
  }

  desktopOperationalLogger.write(
    createDesktopOperationalEvent(
      {
        durationMs: Date.now() - desktopStartedAt,
        eventName: 'desktop.started',
      },
      { appVersion: desktopAppVersion },
    ),
  );

  void loadApplicationWindow(mainWindow).catch(() => {
    dialog.showErrorBox(
      'Eky ei käynnistynyt',
      'Käyttöliittymää ei voitu ladata turvallisesti.',
    );
    options.quitApplication();
  });

  return lifecycleHandle;
}

function createInvoicePdfPreviewController(
  appVersion: string,
  operationalLogger: DesktopOperationalLogger,
  mainWindow: BrowserWindow,
  smokeMode: boolean,
  showApplicationError: (title: string, message: string) => void,
): InvoicePdfPreviewWindowController {
  return createInvoicePdfPreviewWindowController({
    createWindow: (windowOptions) => new BrowserWindow(windowOptions),
    ipcMain,
    mainWindow,
    restoreMainWindowFocus() {
      if (!smokeMode) {
        restoreWindowInputFocus(mainWindow);
      }
    },
    showSafeError() {
      operationalLogger.write(
        createDesktopOperationalEvent(
          {
            errorCode: 'PDF_PREVIEW_OPEN_FAILED',
            eventName: 'pdfPreview.openFailed',
            retryable: true,
            sideEffectState: 'none',
            stage: 'open',
          },
          { appVersion },
        ),
      );
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

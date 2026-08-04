import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
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
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron';

import {
  createOperationalLogFolderCapability,
  type OperationalLogFolderCapability,
} from '../diagnostics/operationalLogFolderCapability.js';
import {
  createSupportBundleCapability,
  type SupportBundleCapability,
} from '../supportBundle/supportBundleCapability.js';
import { removeExpiredSupportBundleTemporaryFiles } from '../supportBundle/supportBundleFileStore.js';
import {
  createInvoicePdfPreviewWindowController,
  type InvoicePdfPreviewWindowController,
} from '../pdf/invoicePdfPreviewWindow.js';
import {
  startDesktopBackend,
  type DesktopBackendHandle,
  type StartDesktopBackendOptions,
} from '../runtime/backendProcess.js';
import { createDesktopRuntimeSession } from '../runtime/runtimeSession.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import { maintainDesktopIncidentIndex } from '../observability/infrastructure/desktopIncidentIndexRetention.js';
import { maintainDesktopOperationalLogs } from '../observability/infrastructure/desktopOperationalLogRetention.js';
import { DesktopIncidentIndexingOperationalLogger } from '../observability/infrastructure/jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from '../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { createMainSecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import { startSecretBrokerMain } from '../secrets/secretBrokerMain.js';
import { SafeStorageStringProtector } from '../secrets/safeStorageStringProtector.js';
import { createInvoicePdfArchiveRuntimePaths } from '../invoicePdfArchive/invoicePdfArchivePaths.js';
import { InvoicePdfArchiveConfigStore } from '../invoicePdfArchive/invoicePdfArchiveConfig.js';
import { InvoicePdfArchiveJournalStore } from '../invoicePdfArchive/invoicePdfArchiveJournal.js';
import { InvoicePdfArchiveService } from '../invoicePdfArchive/invoicePdfArchiveService.js';
import { InvoicePdfArchiveError } from '../invoicePdfArchive/invoicePdfArchiveTypes.js';
import { createInvoicePdfArchiveBackendLoader } from '../invoicePdfArchive/invoicePdfArchiveBackendLoader.js';
import { createInvoicePdfArchiveBrokerTransport } from '../invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js';
import { startInvoicePdfArchiveBrokerMain } from '../invoicePdfArchive/invoicePdfArchiveBrokerMain.js';
import {
  createInvoicePdfArchiveCapability,
  type InvoicePdfArchiveCapability,
} from '../invoicePdfArchive/invoicePdfArchiveCapability.js';
import { registerElectronPermissionPolicy } from '../security/electronPermissionPolicy.js';
import {
  createApplicationWindow,
  loadApplicationWindow,
} from './applicationWindow.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import { readSafeStartupFailureCode } from './earlyStartup.js';
import { createBackendRequestHeaders } from './protocolPolicy.js';
import {
  createInvoiceDeliveryConfirmation,
  type InvoiceDeliveryDialogAdapter,
} from './invoiceDeliveryConfirmation.js';
import {
  createPackagedSmokeSecretFileStore,
  runPackagedSmokeCheck,
  writePackagedSmokeResult,
  type PackagedSmokeConfiguration,
  type PackagedSmokeStage,
} from './packagedSmoke.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';
import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import { createProfileSnapshotBrokerTransport } from '../profileBackup/electronProfileSnapshotBrokerTransport.js';
import { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';

export interface DesktopLifecycleHandle {
  applicationWindow: BrowserWindow;
  focusApplicationWindow(): void;
  shutdown(): Promise<void>;
}

export interface DesktopCompositionDependencies {
  createRuntimeSession(): string;
  openPath(path: string): Promise<string>;
  showErrorBox(title: string, message: string): void;
  showMessageBox(
    owner: BrowserWindow | undefined,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
  showOpenDialog(
    owner: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  showSaveDialog(
    owner: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<SaveDialogReturnValue>;
  startBackend(
    options: StartDesktopBackendOptions,
  ): Promise<DesktopBackendHandle>;
}

export interface StartDesktopCompositionOptions {
  appVersion: string;
  applicationPath: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  dependencies?: Partial<DesktopCompositionDependencies>;
  quitApplication(): void;
  resourcesPath: string;
  runtimeInstanceId: string;
  reportSmokeStage(stage: PackagedSmokeStage): Promise<void>;
  smokeConfiguration: PackagedSmokeConfiguration;
  userDataPath: string;
}

const defaultDesktopCompositionDependencies: DesktopCompositionDependencies = {
  createRuntimeSession: createDesktopRuntimeSession,
  openPath: (path) => shell.openPath(path),
  showErrorBox(title, message) {
    dialog.showErrorBox(title, message);
  },
  showMessageBox(owner, options) {
    return owner === undefined || owner.isDestroyed()
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(owner, options);
  },
  showOpenDialog: (owner, options) => dialog.showOpenDialog(owner, options),
  showSaveDialog: (owner, options) => dialog.showSaveDialog(owner, options),
  startBackend: startDesktopBackend,
};

export async function startDesktopComposition(
  options: StartDesktopCompositionOptions,
): Promise<DesktopLifecycleHandle | undefined> {
  const dependencies = {
    ...defaultDesktopCompositionDependencies,
    ...options.dependencies,
  };
  const smokeMode = options.smokeConfiguration.enabled;
  const runtimeSessionSecret = dependencies.createRuntimeSession();
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
  const desktopOperationalIdentity = {
    appVersion: desktopAppVersion,
    buildRevision: options.buildInfo.buildRevision,
    runtimeInstanceId: options.runtimeInstanceId,
  } as const;

  try {
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        { eventName: 'desktop.starting' },
        desktopOperationalIdentity,
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
        desktopOperationalIdentity,
      ),
    );
    return await startDesktopCompositionRuntime({
      backendRoot,
      dataRoot,
      desktopAppVersion,
      desktopOperationalIdentity,
      desktopOperationalLogger,
      desktopStartedAt,
      operationalLogsRoot,
      options,
      dependencies,
      runtimeSessionSecret,
      smokeMode,
    });
  } catch (error) {
    const errorCode = readSafeStartupFailureCode(error);
    try {
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            errorCode,
            eventName: 'desktop.bootstrapFailed',
            retryable: false,
            sideEffectState: 'unknown',
            stage: 'startup',
          },
          desktopOperationalIdentity,
        ),
      );
    } catch {
      // The safe outer bootstrap boundary remains authoritative.
    }
    throw new Error(errorCode);
  }
}

interface DesktopCompositionRuntimeOptions {
  backendRoot: string;
  dataRoot: string;
  desktopAppVersion: string;
  desktopOperationalIdentity: DesktopOperationalIdentity;
  desktopOperationalLogger: DesktopOperationalLogger;
  desktopStartedAt: number;
  dependencies: DesktopCompositionDependencies;
  operationalLogsRoot: string;
  options: StartDesktopCompositionOptions;
  runtimeSessionSecret: string;
  smokeMode: boolean;
}

async function startDesktopCompositionRuntime({
  backendRoot,
  dataRoot,
  desktopAppVersion,
  desktopOperationalIdentity,
  desktopOperationalLogger,
  desktopStartedAt,
  dependencies,
  operationalLogsRoot,
  options,
  runtimeSessionSecret,
  smokeMode,
}: DesktopCompositionRuntimeOptions): Promise<
  DesktopLifecycleHandle | undefined
> {
  const databaseFilePath = join(dataRoot, 'data', 'eky.sqlite');
  const invoiceDocumentStorageRoot = join(dataRoot, 'storage', 'invoices');
  const profileSnapshotPaths = createProfileSnapshotRuntimePaths(dataRoot);
  const secretFilePath = join(
    dataRoot,
    'secrets',
    'company-email-smtp-v1.dat',
  );
  const smokePdfPath = join(dataRoot, 'smoke', 'approved-invoice-smoke.pdf');
  const smokeSupportBundlePath =
    smokeMode && options.smokeConfiguration.root !== undefined
      ? join(
          options.smokeConfiguration.root,
          'support-bundle',
          'packaged-smoke.json.gz',
        )
      : undefined;
  const secretBrokerChannel = new MessageChannelMain();
  const invoicePdfArchiveBrokerChannel = new MessageChannelMain();
  const profileSnapshotBrokerChannel = new MessageChannelMain();
  const profileSnapshotBrokerClient = new ProfileSnapshotBrokerClient(
    createProfileSnapshotBrokerTransport(profileSnapshotBrokerChannel.port1),
  );
  let applicationWindow: BrowserWindow | undefined;
  let pdfPreviewController: InvoicePdfPreviewWindowController | undefined;
  let operationalLogFolderCapability:
    | OperationalLogFolderCapability
    | undefined;
  let invoicePdfArchiveCapability:
    | InvoicePdfArchiveCapability
    | undefined;
  let supportBundleCapability: SupportBundleCapability | undefined;
  let shutdownStarted = false;

  await mkdir(profileSnapshotPaths.stagingRoot, {
    mode: 0o700,
    recursive: true,
  });

  const deliveryDialogAdapter: InvoiceDeliveryDialogAdapter = {
    showErrorBox: dependencies.showErrorBox,
    showMessageBox: dependencies.showMessageBox,
  };
  const deliveryConfirmation = createInvoiceDeliveryConfirmation(
    () => applicationWindow,
    deliveryDialogAdapter,
  );

  const secretBrokerHandle = startSecretBrokerMain({
    encryptedSecretFile: createPackagedSmokeSecretFileStore(
      secretFilePath,
      smokeMode,
    ),
    observer: {
      operationFailed(operation, errorCode) {
        const isReadOperation =
          operation === 'readCompanyEmailSecret' ||
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
            desktopOperationalIdentity,
          ),
        );
      },
    },
    protector: new SafeStorageStringProtector(safeStorage),
    transport: createMainSecretBrokerTransport(secretBrokerChannel.port1),
  });
  const invoicePdfArchivePaths =
    createInvoicePdfArchiveRuntimePaths(dataRoot);
  let backendHandle: DesktopBackendHandle | undefined;
  const invoicePdfArchiveService = new InvoicePdfArchiveService({
    configStore: new InvoicePdfArchiveConfigStore(
      invoicePdfArchivePaths.configFilePath,
    ),
    journalStore: new InvoicePdfArchiveJournalStore(
      invoicePdfArchivePaths.journalFilePath,
    ),
    observer: {
      copyFailed({ attemptCount, durationMs, errorCode }) {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              attemptCount,
              durationMs,
              errorCode,
              eventName: 'invoicePdfArchive.copyFailed',
              retryable: errorCode !== 'ARCHIVE_FILE_CONFLICT',
              sideEffectState: 'none',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      copySucceeded({ attemptCount, durationMs }) {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              attemptCount,
              durationMs,
              eventName: 'invoicePdfArchive.copySucceeded',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      taskQueued() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            { eventName: 'invoicePdfArchive.taskQueued' },
            desktopOperationalIdentity,
          ),
        );
      },
    },
    async loadDocument(task) {
      if (backendHandle === undefined) {
        throw new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', true);
      }
      return createInvoicePdfArchiveBackendLoader({
        backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
        fetchImplementation: (url, init) => net.fetch(url, init),
        runtimeSessionSecret,
      })(task);
    },
  });
  const invoicePdfArchiveBrokerHandle =
    startInvoicePdfArchiveBrokerMain({
      service: invoicePdfArchiveService,
      transport: createInvoicePdfArchiveBrokerTransport(
        invoicePdfArchiveBrokerChannel.port1,
      ),
    });

  try {
    await options.reportSmokeStage('backend');
    backendHandle = await dependencies.startBackend({
      config: {
        appVersion: desktopAppVersion,
        architecture: process.arch,
        backendRoot,
        buildCreatedAt: options.buildInfo.buildCreatedAt,
        buildDirty: options.buildInfo.buildDirty,
        buildRevision: options.buildInfo.buildRevision,
        createSmokePdf: smokeMode,
        electronVersion: process.versions.electron,
        databaseFilePath,
        invoiceDocumentStorageRoot,
        migrationsDirectory: join(
          backendRoot,
          'dist',
          'database',
          'migrations',
        ),
        operationalLogsRoot,
        platform: process.platform,
        profileSnapshotStagingRoot: profileSnapshotPaths.stagingRoot,
        runtimeInstanceId: options.runtimeInstanceId,
        runtimeSessionSecret,
        smokePdfPath,
      },
      operationalIdentity: desktopOperationalIdentity,
      operationalLogger: desktopOperationalLogger,
      invoicePdfArchiveBrokerPort:
        invoicePdfArchiveBrokerChannel.port2,
      profileSnapshotBrokerPort: profileSnapshotBrokerChannel.port2,
      runnerPath: join(
        options.resourcesPath,
        'desktop-runtime',
        'runtime',
        'backendRunner.js',
      ),
      secretBrokerPort: secretBrokerChannel.port2,
    });
    await profileSnapshotBrokerClient.getStatus();
  } catch (error) {
    await backendHandle?.stop().catch(() => undefined);
    profileSnapshotBrokerClient.close();
    invoicePdfArchiveBrokerHandle.close();
    secretBrokerHandle.close();
    throw error;
  }

  backendHandle.onUnexpectedExit(() => {
    dependencies.showErrorBox(
      'Eky suljettiin',
      'Paikallinen palvelu pysähtyi odottamatta. Sovellus suljetaan turvallisesti.',
    );
    options.quitApplication();
  });
  void invoicePdfArchiveService.retryPending(true).catch(() => undefined);

  registerApplicationProtocol({
    backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
    confirmInvoiceEmailPreparation:
      deliveryConfirmation.confirmInvoiceEmailPreparation,
    confirmSmtpTestPreparation:
      deliveryConfirmation.confirmSmtpTestPreparation,
    runtimeSessionSecret,
    webRoot: join(options.applicationPath, 'web'),
  });

  registerElectronPermissionPolicy({
    operationalIdentity: desktopOperationalIdentity,
    operationalLogger: desktopOperationalLogger,
    permissionSession: session.defaultSession,
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
            desktopOperationalIdentity,
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
            desktopOperationalIdentity,
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
            desktopOperationalIdentity,
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
            desktopOperationalIdentity,
          ),
        );
      },
    },
  );
  const mainWindow = applicationWindow;
  operationalLogFolderCapability = createOperationalLogFolderCapability({
    ipcMain,
    mainWindow,
    openPath: smokeMode
      ? async (path) =>
          path === operationalLogsRoot
            ? ''
            : 'OPERATIONAL_LOG_FOLDER_SMOKE_ROOT_INVALID'
      : dependencies.openPath,
    operationalLogger: desktopOperationalLogger,
    operationalIdentity: desktopOperationalIdentity,
    runtimeRoot: dataRoot,
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Lokikansiota ei voitu avata',
        'Eky-lokikansiota ei voitu avata turvallisesti.',
      );
    },
  });
  invoicePdfArchiveCapability = createInvoicePdfArchiveCapability({
    async confirmChange() {
      if (smokeMode) {
        return true;
      }
      const result = await dependencies.showMessageBox(mainWindow, {
        buttons: ['Peruuta', 'Vaihda kansio'],
        cancelId: 0,
        defaultId: 0,
        detail:
          'Uusi kansio koskee vain tämän jälkeen arkistoitavia laskuja ja odottavia kopioita. Aiemmin kopioituja PDF-tiedostoja ei siirretä.',
        message: 'Vaihdatko laskujen PDF-kopiokansion?',
        noLink: true,
        title: 'Vaihda PDF-kopiokansio',
        type: 'warning',
      });
      return result.response === 1;
    },
    async confirmDisable() {
      if (smokeMode) {
        return true;
      }
      const result = await dependencies.showMessageBox(mainWindow, {
        buttons: ['Peruuta', 'Poista käytöstä'],
        cancelId: 0,
        defaultId: 0,
        detail:
          'Jo tallennetut PDF-kopiot säilyvät valitussa kansiossa. Odottavat kopiot säilyvät Ekyssä ja niitä voidaan yrittää uudelleen, kun ominaisuus otetaan myöhemmin käyttöön.',
        message: 'Poistetaanko laskujen paikallinen PDF-kopiointi käytöstä?',
        noLink: true,
        title: 'Poista PDF-kopiointi käytöstä',
        type: 'warning',
      });
      return result.response === 1;
    },
    ipcMain,
    mainWindow,
    onConfigurationChanged(stage) {
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            eventName: 'invoicePdfArchive.configurationChanged',
            stage,
          },
          desktopOperationalIdentity,
        ),
      );
    },
    openPath: dependencies.openPath,
    async selectDirectory() {
      const result = await dependencies.showOpenDialog(mainWindow, {
        message: 'Valitse kansio toimitettujen laskujen PDF-kopioille',
        properties: ['openDirectory', 'createDirectory'],
        title: 'Valitse PDF-kopiokansio',
      });
      return result.canceled || result.filePaths.length !== 1
        ? null
        : result.filePaths[0] ?? null;
    },
    service: invoicePdfArchiveService,
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'PDF-kopiota ei voitu käsitellä',
        'Laskujen paikallista PDF-kopiota ei voitu käsitellä turvallisesti.',
      );
    },
  });
  supportBundleCapability = createSupportBundleCapability({
    appVersion: desktopAppVersion,
    architecture: process.arch,
    async confirmCreation() {
      if (smokeMode) {
        return true;
      }
      const result = await dependencies.showMessageBox(mainWindow, {
        buttons: ['Peruuta', 'Jatka'],
        cancelId: 0,
        defaultId: 0,
        detail:
          'Tukipaketti ei ole salattu. Tallenna ja lähetä se vain luotetulle tukihenkilölle.\n\nPaketti sisältää vain sanitoituja teknisiä tapahtumia, sovellusversiot sekä tietokannan health- ja migraatioyhteenvedon. Se ei sisällä asiakas- tai laskudataa, PDF:iä eikä salaisuuksia.',
        message: 'Luodaanko Eky-tukipaketti?',
        noLink: true,
        title: 'Luo tukipaketti',
        type: 'warning',
      });
      return result.response === 1;
    },
    ipcMain,
    loadBackendData: () =>
      loadSupportBundleBackendData(
        `http://127.0.0.1:${backendHandle.port}`,
        runtimeSessionSecret,
      ),
    mainWindow,
    operationalIdentity: desktopOperationalIdentity,
    operationalLogger: desktopOperationalLogger,
    platform: process.platform,
    runtimeRoot: dataRoot,
    async selectTargetPath(defaultFileName) {
      if (smokeSupportBundlePath !== undefined) {
        return smokeSupportBundlePath;
      }
      const result = await dependencies.showSaveDialog(mainWindow, {
        defaultPath: defaultFileName,
        filters: [
          {
            extensions: ['json.gz'],
            name: 'Eky-tukipaketti, GZip-pakattu JSON',
          },
        ],
        title: 'Tallenna Eky-tukipaketti',
      });
      return result.canceled || result.filePath === ''
        ? null
        : result.filePath;
    },
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Tukipakettia ei voitu luoda',
        'Eky-tukipakettia ei voitu luoda turvallisesti.',
      );
    },
  });
  try {
    removeExpiredSupportBundleTemporaryFiles(dataRoot);
  } catch {
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        {
          correlationId: randomUUID(),
          errorCode: 'SUPPORT_BUNDLE_RETENTION_FAILED',
          eventName: 'supportBundle.creationFailed',
          retryable: true,
          sideEffectState: 'none',
          stage: 'retention',
        },
        desktopOperationalIdentity,
      ),
    );
  }
  pdfPreviewController = createInvoicePdfPreviewController(
    desktopOperationalIdentity,
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
          desktopOperationalIdentity,
        ),
      );
      pdfPreviewController?.dispose();
      pdfPreviewController = undefined;
      operationalLogFolderCapability?.dispose();
      operationalLogFolderCapability = undefined;
      invoicePdfArchiveCapability?.dispose();
      invoicePdfArchiveCapability = undefined;
      supportBundleCapability?.dispose();
      supportBundleCapability = undefined;
      profileSnapshotBrokerClient.close();

      try {
        await backendHandle.stop();
        invoicePdfArchiveBrokerHandle.close();
        secretBrokerHandle.close();
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - shutdownStartedAt,
              eventName: 'desktop.shutdownCompleted',
            },
            desktopOperationalIdentity,
          ),
        );
      } catch {
        invoicePdfArchiveBrokerHandle.close();
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
            desktopOperationalIdentity,
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
        desktopOperationalIdentity,
      ),
    );
    try {
      await loadApplicationWindow(mainWindow);
      await runPackagedSmokeCheck({
        appVersion: desktopAppVersion,
        backend: backendHandle,
        buildRevision: options.buildInfo.buildRevision,
        databaseFilePath,
        invoicePdfArchiveDirectoryPath: join(
          requireSmokeRoot(options.smokeConfiguration.root),
          'invoice-pdf-archive',
        ),
        invoicePdfArchiveService,
        mainWindow,
        pdfPreviewController,
        runtimeSessionSecret,
        runtimeInstanceId: options.runtimeInstanceId,
        secretFilePath,
        smokePdfPath,
        supportBundlePath: requireSmokeSupportBundlePath(
          smokeSupportBundlePath,
        ),
        reportStage: options.reportSmokeStage,
      });
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - smokeStartedAt,
            eventName: 'packagedSmoke.completed',
          },
          desktopOperationalIdentity,
        ),
      );
      await options.reportSmokeStage('shutdown');
      await lifecycleHandle.shutdown();
      await writePackagedSmokeResult(options.smokeConfiguration, {
        electronVersion: process.versions.electron,
        stage: 'shutdown',
        status: 'ok',
      });
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
          desktopOperationalIdentity,
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
      desktopOperationalIdentity,
    ),
  );

  void loadApplicationWindow(mainWindow).catch(() => {
    dependencies.showErrorBox(
      'Eky ei käynnistynyt',
      'Käyttöliittymää ei voitu ladata turvallisesti.',
    );
    options.quitApplication();
  });

  return lifecycleHandle;
}

const maximumSupportBundleBackendBytes = 8 * 1024 * 1024;

async function loadSupportBundleBackendData(
  backendOrigin: string,
  runtimeSessionSecret: string,
): Promise<unknown> {
  const response = await net.fetch(
    `${backendOrigin}/diagnostics/support-bundle-data`,
    {
      headers: createBackendRequestHeaders(
        new Headers(),
        runtimeSessionSecret,
      ),
      method: 'GET',
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('SUPPORT_BUNDLE_BACKEND_REQUEST_FAILED');
  }
  const declaredLength = Number(
    response.headers.get('content-length') ?? '0',
  );
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maximumSupportBundleBackendBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('SUPPORT_BUNDLE_BACKEND_RESPONSE_TOO_LARGE');
  }

  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.byteLength > maximumSupportBundleBackendBytes) {
    throw new Error('SUPPORT_BUNDLE_BACKEND_RESPONSE_TOO_LARGE');
  }

  try {
    return JSON.parse(responseBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('SUPPORT_BUNDLE_BACKEND_RESPONSE_INVALID');
  }
}

function requireSmokeSupportBundlePath(
  value: string | undefined,
): string {
  if (value === undefined) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_PATH_MISSING');
  }
  return value;
}

function requireSmokeRoot(root: string | undefined): string {
  if (root === undefined) {
    throw new Error('DESKTOP_SMOKE_ROOT_MISSING');
  }

  return root;
}

function createInvoicePdfPreviewController(
  operationalIdentity: DesktopOperationalIdentity,
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
          operationalIdentity,
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

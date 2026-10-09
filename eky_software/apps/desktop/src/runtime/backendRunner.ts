import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  desktopBackendReadinessTimeoutMilliseconds,
  parseDesktopBackendCommand,
} from './backendMessages.js';
import type {
  DesktopBackendFailureCode,
  DesktopBackendShutdownMessage,
  DesktopBackendUpdateShutdownMessage,
} from './backendMessages.js';
import {
  acquireWorkspaceProcessReservation,
  type WorkspaceProcessReservation,
} from './workspaceProcessReservation.js';
import type { WorkspaceProcessReservationDescriptor } from './workspaceProcessReservationDescriptor.js';
import { CompanyEmailSecretBrokerClient } from '../secrets/secretBrokerClient.js';
import { createUtilitySecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import { InvoicePdfArchiveBrokerClient } from '../invoicePdfArchive/invoicePdfArchiveBrokerClient.js';
import { createInvoicePdfArchiveBrokerTransport } from '../invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js';
import { createProfileSnapshotBrokerTransport } from '../profileBackup/electronProfileSnapshotBrokerTransport.js';
import {
  startProfileSnapshotBrokerBackend,
  type ProfileMaintenanceService,
} from '../profileBackup/profileSnapshotBrokerBackend.js';

interface StartedBackendServer {
  close(): Promise<void>;
  port: number;
}

interface BackendProfileMaintenanceState extends ProfileMaintenanceService {
  tryBeginBusinessWrite(): (() => void) | undefined;
}

interface BackendProfileSnapshotMetadata {
  artifactCatalog: {
    artifactCount: number;
    artifactTotalByteSize: number;
    catalogByteSize: number;
    logicalPath: 'snapshot-catalog-v1.json';
    sha256: string;
  };
  database: {
    databaseByteSize: number;
    logicalPath: 'profile.sqlite';
    sha256: string;
    totalPages: number;
  };
}

interface BackendProfileSnapshotService {
  validateActiveProfile(): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
    migrationChainIdentity: string;
    profileId: string;
  }>;
  createProfileSnapshot(input: {
    migrationPolicy:
      | 'exactCurrentManifest'
      | 'compatibleHistoricalPrefix';
    operationId: string;
    signal: AbortSignal;
  }): Promise<BackendProfileSnapshotMetadata>;
  prepareProfileRestoreActivation(operationId: string): Promise<{
    artifactCount: number;
    artifactTotalByteSize: number;
  }>;
  validateProfileSnapshot(operationId: string): Promise<{
    activeProfileIsEmpty: boolean;
    artifactCount: number;
    artifactTotalByteSize: number;
    databaseHealth: 'healthy';
    migrationChainIdentity: string;
    profileId: string;
    profileMatchesActive: boolean;
  }>;
}

type StartServer = (options: {
  appOptions: {
    appVersion: string;
    architecture: string;
    buildCreatedAt: string;
    buildDirty: boolean;
    beforeMigrations(inspection: {
      appliedMigrationCount: number;
      migrationChainIdentity: string;
      pendingMigrationCount: number;
      profileState: 'empty' | 'existing';
    }): Promise<void>;
    companyEmailSecretReader: {
      getSecret(companyId: string): Promise<string | null>;
    };
    companyEmailSecretStore: {
      hasSecret(companyId: string): Promise<boolean>;
      removeSecret(companyId: string): Promise<void>;
      setSecret(input: { companyId: string; secret: string }): Promise<void>;
    };
    deliveredInvoiceArchiveTaskSink: {
      queueDeliveredInvoiceArchiveTask(input: {
        createdAt: string;
        deliveryEventId: string;
        documentId: string;
        expectedPdfSha256: string;
        expectedPdfSize: number;
        invoiceId: string;
        invoiceKind: 'credit' | 'standard';
        invoiceNumber: string;
        taskId: string;
      }): Promise<void>;
    };
    databaseFilePath: string;
    electronVersion: string;
    invoiceDocumentStorageRoot: string;
    migrationsDirectory: string;
    migrationStartupPolicy:
      | 'exactCurrentManifest'
      | 'restoreCompatible';
    operationalLogsRoot: string;
    platform: string;
    operationalIdentity: {
      appVersion: string;
      buildRevision: string;
      runtimeInstanceId: string;
    };
    profileMaintenanceState: BackendProfileMaintenanceState;
    profileSnapshotServiceRegistration: {
      register(service: BackendProfileSnapshotService): void;
      stagingRoot: string;
    };
  };
  hostname: string;
  port: number;
  runtimeTrust: {
    mode: 'localSession';
    sessionSecret: string;
  };
}) => Promise<StartedBackendServer>;

let backendServer: StartedBackendServer | undefined;
let secretBrokerClient: CompanyEmailSecretBrokerClient | undefined;
let invoicePdfArchiveBrokerClient: InvoicePdfArchiveBrokerClient | undefined;
let profileSnapshotBrokerHandle:
  | ReturnType<typeof startProfileSnapshotBrokerBackend>
  | undefined;
let profileSnapshotService: BackendProfileSnapshotService | undefined;
let startAttempted = false;
let preparedReservation: WorkspaceProcessReservationDescriptor | undefined;
let processReservation: WorkspaceProcessReservation | undefined;
let reservationReady = false;
let writingImportStarted = false;
let startupTask: Promise<void> | undefined;
let reportedFailure: DesktopBackendFailureCode | undefined;
const startupCancellation = new AbortController();
let backendReady = false;
let shutdownCommand:
  | DesktopBackendShutdownMessage
  | DesktopBackendUpdateShutdownMessage
  | undefined;
let shutdownFailed = false;
let migrationGateDecision:
  | {
      reject(error: Error): void;
      resolve(): void;
      timer: ReturnType<typeof setTimeout>;
    }
  | undefined;
const utilityParentPort = process.parentPort;
const migrationGateDecisionTimeoutMilliseconds = 5 * 60_000;
const readinessDeadline = performance.now() + desktopBackendReadinessTimeoutMilliseconds;
const readinessTimer = setTimeout(() => {
  failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
}, desktopBackendReadinessTimeoutMilliseconds);

function rejectMigrationGate(): void {
  const decision = migrationGateDecision;
  migrationGateDecision = undefined;
  if (decision !== undefined) {
    clearTimeout(decision.timer);
    decision.reject(new Error('MIGRATION_GATE_ABORTED'));
  }
}

function requestShutdown(
  command: DesktopBackendShutdownMessage | DesktopBackendUpdateShutdownMessage,
): void {
  if (shutdownCommand !== undefined) {
    if (command.type === 'shutdownForUpdate' && (
      shutdownCommand.type !== 'shutdownForUpdate' ||
      command.operationId !== shutdownCommand.operationId
    )) shutdownFailed = true;
    return;
  }
  shutdownCommand = command;
  startupCancellation.abort();
  clearTimeout(readinessTimer);
  // A beforeMigrations owner may stop this runtime from inside its callback.
  rejectMigrationGate();
  void shutdownBackend(command);
}

function failBackend(code: DesktopBackendFailureCode): void {
  shutdownFailed = true;
  if (reportedFailure === undefined) {
    reportedFailure = code;
    try { utilityParentPort.postMessage({ code, type: 'failed' }); } catch { /* Parent lost. */ }
  }
  requestShutdown({ type: 'shutdown' });
}

function assertStartupCurrent(): void {
  if (startupCancellation.signal.aborted) throw new Error('BACKEND_STARTUP_ABORTED');
  if (processReservation === undefined || processReservation.invalidated.aborted ||
      (!writingImportStarted && performance.now() >= readinessDeadline)) {
    throw new Error('BACKEND_PROCESS_RESERVATION_FAILED');
  }
}

async function assertReservationOwned(): Promise<void> {
  try {
    assertStartupCurrent();
    await processReservation!.assertOwned();
    assertStartupCurrent();
  } catch (error) {
    if (!startupCancellation.signal.aborted) {
      failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
    }
    throw error;
  }
}

async function prepareBackend(reservation: WorkspaceProcessReservationDescriptor): Promise<void> {
  try {
    processReservation = await acquireWorkspaceProcessReservation({
      expectedIdentity: reservation.identity,
      signal: startupCancellation.signal,
      userDataRoot: reservation.userDataRoot,
    });
    assertStartupCurrent();
    processReservation.invalidated.addEventListener('abort', () => {
      failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
    }, { once: true });
    await assertReservationOwned();
    assertStartupCurrent();
    reservationReady = true;
    utilityParentPort.postMessage({ reservation, type: 'reservationReady' });
  } catch {
    if (!startupCancellation.signal.aborted) {
      failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
    }
  }
}

function waitForMigrationGateDecision(inspection: {
  appliedMigrationCount: number;
  migrationChainIdentity: string;
  pendingMigrationCount: number;
  profileState: 'empty' | 'existing';
}): Promise<void> {
  if (startupCancellation.signal.aborted || migrationGateDecision !== undefined) {
    return Promise.reject(new Error('MIGRATION_GATE_ALREADY_PENDING'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      migrationGateDecision = undefined;
      reject(new Error('MIGRATION_GATE_DECISION_TIMEOUT'));
    }, migrationGateDecisionTimeoutMilliseconds);
    migrationGateDecision = { reject, resolve, timer };
    utilityParentPort.postMessage({ inspection, type: 'migrationGateReady' });
  });
}

async function verifySecretBroker(
  client: CompanyEmailSecretBrokerClient,
): Promise<boolean> {
  const companyId = `desktop-smoke-${randomUUID()}`;
  const secret = `eky-safe-storage-smoke-${randomBytes(32).toString('base64url')}`;

  try {
    await client.setSecret({ companyId, secret });

    if (!(await client.hasSecret(companyId))) {
      return false;
    }

    if ((await client.getSecret(companyId)) !== secret) {
      return false;
    }

    await client.removeSecret(companyId);

    return !(await client.hasSecret(companyId));
  } finally {
    await client.removeSecret(companyId).catch(() => undefined);
  }
}

async function createSmokePdf(
  backendRoot: string,
  smokePdfPath: string,
): Promise<boolean> {
  const rendererModule = (await import(
    pathToFileURL(
      join(
        backendRoot,
        'dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js',
      ),
    ).href
  )) as { renderApprovedInvoicePdf?: (invoice: unknown) => Promise<Uint8Array> };
  const sampleModule = (await import(
    pathToFileURL(
      join(
        backendRoot,
        'dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfSample.js',
      ),
    ).href
  )) as { createApprovedInvoicePdfSample?: () => unknown };

  if (
    typeof rendererModule.renderApprovedInvoicePdf !== 'function' ||
    typeof sampleModule.createApprovedInvoicePdfSample !== 'function'
  ) {
    return false;
  }

  const content = await rendererModule.renderApprovedInvoicePdf(
    sampleModule.createApprovedInvoicePdfSample(),
  );

  if (new TextDecoder().decode(content.slice(0, 4)) !== '%PDF') {
    return false;
  }

  await mkdir(dirname(smokePdfPath), { recursive: true });
  await writeFile(smokePdfPath, content);

  return true;
}

async function shutdownBackend(
  command: DesktopBackendShutdownMessage | DesktopBackendUpdateShutdownMessage,
): Promise<void> {
  // Pre-import cancellation must not wait for stuck acquisition/assertion.
  // Once import can write, only settled startup and owned closes permit exit.
  if (writingImportStarted && !backendReady) await startupTask;
  try {
    if (command.type === 'shutdownForUpdate') {
      if (!backendReady || backendServer === undefined ||
          profileSnapshotBrokerHandle === undefined) {
        throw new Error('BACKEND_UPDATE_SHUTDOWN_UNAVAILABLE');
      }
      profileSnapshotBrokerHandle.assertUpdateMaintenance(command.operationId);
    }
    await backendServer?.close();
    if (command.type === 'shutdownForUpdate') {
      profileSnapshotBrokerHandle!.assertUpdateMaintenance(command.operationId);
    }
  } catch {
    shutdownFailed = true;
  }

  // Closing the snapshot broker invalidates its fence, so it follows the
  // final assertion. Every owned close is attempted, even after a failure.
  for (const close of [
    () => secretBrokerClient?.close(),
    () => invoicePdfArchiveBrokerClient?.close(),
    () => profileSnapshotBrokerHandle?.close(),
  ]) {
    try { close(); } catch { shutdownFailed = true; }
  }
  // The OS releases the reservation at actual exit, never at a terminal message.
  process.exit(shutdownFailed ? 1 : 0);
}

utilityParentPort.on('message', (event) => {
  const command = parseDesktopBackendCommand(event.data);

  if (command?.type === 'shutdown' || command?.type === 'shutdownForUpdate') {
    requestShutdown(command);
    return;
  }

  if (shutdownCommand !== undefined) {
    return;
  }

  if (command?.type === 'prepare') {
    if (preparedReservation !== undefined || startAttempted || event.ports.length !== 0) {
      failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
      return;
    }
    preparedReservation = command.reservation;
    void prepareBackend(command.reservation);
    return;
  }

  if (
    command?.type === 'continueStartup' ||
    command?.type === 'abortStartup'
  ) {
    const decision = migrationGateDecision;
    if (decision === undefined) {
      failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
      return;
    }
    migrationGateDecision = undefined;
    clearTimeout(decision.timer);
    if (command.type === 'continueStartup') {
      decision.resolve();
    } else {
      decision.reject(new Error('MIGRATION_GATE_ABORTED'));
      failBackend('BACKEND_MIGRATION_STARTUP_GATE_FAILED');
    }
    return;
  }

  if (command?.type !== 'start' || startAttempted) {
    if (command !== undefined || !writingImportStarted ||
        (typeof event.data === 'object' && event.data !== null &&
          ('type' in event.data) &&
          (event.data.type === 'prepare' || event.data.type === 'start'))) {
      failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
    }
    return;
  }

  if (!reservationReady || command.generationId !== preparedReservation?.generationId) {
    failBackend('BACKEND_PROCESS_RESERVATION_FAILED');
    return;
  }

  startAttempted = true;

  startupTask = (async () => {
    let failureCode: DesktopBackendFailureCode = 'BACKEND_MODULE_IMPORT_FAILED';

    try {
      await assertReservationOwned();
      assertStartupCurrent();
      const brokerPort = event.ports[0];
      const archiveBrokerPort = event.ports[1];
      const profileSnapshotBrokerPort = event.ports[2];

      if (event.ports.length !== 3 || brokerPort === undefined) {
        failureCode = 'BACKEND_SECRET_BROKER_FAILED';
        throw new Error('A private backend broker port is unavailable.');
      }
      if (archiveBrokerPort === undefined) {
        failureCode = 'BACKEND_INVOICE_PDF_ARCHIVE_BROKER_FAILED';
        throw new Error('A private backend broker port is unavailable.');
      }
      if (profileSnapshotBrokerPort === undefined) {
        failureCode = 'BACKEND_PROFILE_SNAPSHOT_BROKER_FAILED';
        throw new Error('A private backend broker port is unavailable.');
      }

      secretBrokerClient = new CompanyEmailSecretBrokerClient(
        createUtilitySecretBrokerTransport(brokerPort),
      );
      failureCode = 'BACKEND_INVOICE_PDF_ARCHIVE_BROKER_FAILED';
      invoicePdfArchiveBrokerClient = new InvoicePdfArchiveBrokerClient(
        createInvoicePdfArchiveBrokerTransport(archiveBrokerPort),
      );

      failureCode = 'BACKEND_MODULE_IMPORT_FAILED';
      assertStartupCurrent();
      writingImportStarted = true;
      clearTimeout(readinessTimer);
      const serverModule = (await import(
        pathToFileURL(join(command.config.backendRoot, 'dist/http/server.js')).href
      )) as { startServer?: StartServer };
      await assertReservationOwned();
      assertStartupCurrent();

      if (typeof serverModule.startServer !== 'function') {
        throw new Error('Backend start function is unavailable.');
      }

      failureCode = 'BACKEND_PROFILE_SNAPSHOT_BROKER_FAILED';
      const maintenanceModule = (await import(
        pathToFileURL(
          join(
            command.config.backendRoot,
            'dist/runtime/profileMaintenance/profileMaintenanceState.js',
          ),
        ).href
      )) as {
        ProfileMaintenanceState?: new () => BackendProfileMaintenanceState;
      };
      await assertReservationOwned();
      assertStartupCurrent();

      if (maintenanceModule.ProfileMaintenanceState === undefined) {
        throw new Error('Profile maintenance state is unavailable.');
      }
      const profileMaintenanceState =
        new maintenanceModule.ProfileMaintenanceState();
      profileSnapshotBrokerHandle = startProfileSnapshotBrokerBackend({
        maintenance: profileMaintenanceState,
        snapshot: {
          createProfileSnapshot: (input) => {
            if (profileSnapshotService === undefined) {
              throw new Error('PROFILE_SNAPSHOT_DATABASE_FAILED');
            }
            return profileSnapshotService.createProfileSnapshot(input);
          },
          prepareProfileRestoreActivation: (operationId) => {
            if (profileSnapshotService === undefined) {
              throw new Error(
                'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED',
              );
            }
            return profileSnapshotService.prepareProfileRestoreActivation(
              operationId,
            );
          },
          validateActiveProfile: () => {
            if (profileSnapshotService === undefined) {
              throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
            }
            return profileSnapshotService.validateActiveProfile();
          },
          validateProfileSnapshot: (operationId) => {
            if (profileSnapshotService === undefined) {
              throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
            }
            return profileSnapshotService.validateProfileSnapshot(
              operationId,
            );
          },
        },
        transport: createProfileSnapshotBrokerTransport(
          profileSnapshotBrokerPort,
        ),
      });

      let smokeSecretBrokerVerified = false;

      if (command.config.verifySmokeSecretBroker) {
        failureCode = 'BACKEND_SECRET_BROKER_FAILED';
        smokeSecretBrokerVerified = await verifySecretBroker(secretBrokerClient);
        await assertReservationOwned();
        assertStartupCurrent();

        if (!smokeSecretBrokerVerified) {
          throw new Error('Secret broker smoke check failed.');
        }
      }

      failureCode = 'BACKEND_SERVER_START_FAILED';
      let migrationGateCompleted = false;
      backendServer = await serverModule.startServer({
        appOptions: {
          appVersion: command.config.appVersion,
          architecture: command.config.architecture,
          buildCreatedAt: command.config.buildCreatedAt,
          buildDirty: command.config.buildDirty,
          async beforeMigrations(inspection) {
            failureCode = 'BACKEND_MIGRATION_STARTUP_GATE_FAILED';
            await waitForMigrationGateDecision(inspection);
            await assertReservationOwned();
            assertStartupCurrent();
            migrationGateCompleted = true;
            failureCode = 'BACKEND_SERVER_START_FAILED';
          },
          companyEmailSecretReader: {
            getSecret: (companyId) => secretBrokerClient!.getSecret(companyId),
          },
          companyEmailSecretStore: {
            hasSecret: (companyId) => secretBrokerClient!.hasSecret(companyId),
            removeSecret: (companyId) =>
              secretBrokerClient!.removeSecret(companyId),
            setSecret: (input) => secretBrokerClient!.setSecret(input),
          },
          deliveredInvoiceArchiveTaskSink: {
            queueDeliveredInvoiceArchiveTask: (input) =>
              invoicePdfArchiveBrokerClient!.queueDeliveredInvoiceArchiveTask(
                input,
              ),
          },
          databaseFilePath: command.config.databaseFilePath,
          electronVersion: command.config.electronVersion,
          invoiceDocumentStorageRoot: command.config.invoiceDocumentStorageRoot,
          migrationsDirectory: command.config.migrationsDirectory,
          migrationStartupPolicy: command.config.migrationStartupPolicy,
          operationalLogsRoot: command.config.operationalLogsRoot,
          platform: command.config.platform,
          operationalIdentity: {
            appVersion: command.config.appVersion,
            buildRevision: command.config.buildRevision,
            runtimeInstanceId: command.config.runtimeInstanceId,
          },
          profileMaintenanceState,
          profileSnapshotServiceRegistration: {
            register(service) {
              profileSnapshotService = service;
            },
            stagingRoot: command.config.profileSnapshotStagingRoot,
          },
        },
        hostname: '127.0.0.1',
        port: 0,
        runtimeTrust: {
          mode: 'localSession',
          sessionSecret: command.config.runtimeSessionSecret,
        },
      });
      await assertReservationOwned();
      assertStartupCurrent();
      if (!migrationGateCompleted) {
        failureCode = 'BACKEND_MIGRATION_STARTUP_GATE_FAILED';
        throw new Error('Migration startup gate was not completed.');
      }
      let smokePdfCreated = false;

      if (command.config.createSmokePdf) {
        failureCode = 'BACKEND_SMOKE_PDF_FAILED';
        smokePdfCreated = await createSmokePdf(
          command.config.backendRoot,
          command.config.smokePdfPath,
        );
        await assertReservationOwned();
        assertStartupCurrent();

        if (!smokePdfCreated) {
          throw new Error('Smoke PDF was not created.');
        }
      }

      backendReady = true;
      utilityParentPort.postMessage({
        port: backendServer.port,
        smokePdfCreated,
        smokeSecretBrokerVerified,
        type: 'ready',
      });
    } catch {
      if (!startupCancellation.signal.aborted) {
        failBackend(failureCode);
      }
    }
  })();
});

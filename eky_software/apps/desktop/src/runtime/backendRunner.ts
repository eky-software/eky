import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDesktopBackendCommand } from './backendMessages.js';
import type { DesktopBackendFailureCode } from './backendMessages.js';
import { CompanyEmailSecretBrokerClient } from '../secrets/secretBrokerClient.js';
import { createUtilitySecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import { InvoicePdfArchiveBrokerClient } from '../invoicePdfArchive/invoicePdfArchiveBrokerClient.js';
import { createInvoicePdfArchiveBrokerTransport } from '../invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js';
import { createProfileSnapshotBrokerTransport } from '../profileBackup/electronProfileSnapshotBrokerTransport.js';
import { startProfileSnapshotBrokerBackend } from '../profileBackup/profileSnapshotBrokerBackend.js';

interface StartedBackendServer {
  close(): Promise<void>;
  port: number;
}

interface BackendProfileMaintenanceState {
  begin(operationId: string, timeoutMilliseconds: number): Promise<void>;
  end(operationId: string): void;
  forceEnd(): void;
  getStatus(): 'busy' | 'normal';
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
  }>;
  createProfileSnapshot(input: {
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
let profileSnapshotBrokerHandle: { close(): void } | undefined;
let profileSnapshotService: BackendProfileSnapshotService | undefined;
let startAttempted = false;
const utilityParentPort = process.parentPort;

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

utilityParentPort.on('message', (event) => {
  const command = parseDesktopBackendCommand(event.data);

  if (command?.type === 'shutdown') {
    void (async () => {
      await backendServer?.close();
      secretBrokerClient?.close();
      invoicePdfArchiveBrokerClient?.close();
      profileSnapshotBrokerHandle?.close();
      process.exit(0);
    })();
    return;
  }

  if (command?.type !== 'start' || startAttempted) {
    return;
  }

  startAttempted = true;

  void (async () => {
    let failureCode: DesktopBackendFailureCode = 'BACKEND_MODULE_IMPORT_FAILED';

    try {
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
      const serverModule = (await import(
        pathToFileURL(join(command.config.backendRoot, 'dist/http/server.js')).href
      )) as { startServer?: StartServer };

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

      if (command.config.createSmokePdf) {
        failureCode = 'BACKEND_SECRET_BROKER_FAILED';
        smokeSecretBrokerVerified = await verifySecretBroker(secretBrokerClient);

        if (!smokeSecretBrokerVerified) {
          throw new Error('Secret broker smoke check failed.');
        }
      }

      failureCode = 'BACKEND_SERVER_START_FAILED';
      backendServer = await serverModule.startServer({
        appOptions: {
          appVersion: command.config.appVersion,
          architecture: command.config.architecture,
          buildCreatedAt: command.config.buildCreatedAt,
          buildDirty: command.config.buildDirty,
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
      let smokePdfCreated = false;

      if (command.config.createSmokePdf) {
        failureCode = 'BACKEND_SMOKE_PDF_FAILED';
        smokePdfCreated = await createSmokePdf(
          command.config.backendRoot,
          command.config.smokePdfPath,
        );

        if (!smokePdfCreated) {
          throw new Error('Smoke PDF was not created.');
        }
      }

      utilityParentPort.postMessage({
        port: backendServer.port,
        smokePdfCreated,
        smokeSecretBrokerVerified,
        type: 'ready',
      });
    } catch {
      secretBrokerClient?.close();
      profileSnapshotBrokerHandle?.close();
      utilityParentPort.postMessage({ code: failureCode, type: 'failed' });
    }
  })();
});

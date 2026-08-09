import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { startServer, type StartedServer } from '../src/http/server.js';
import { resolveOperationalRuntimeIdentity } from '../src/observability/operationalRuntimeIdentity.js';
import {
  readE2eBackendConfig,
  type E2eBackendConfig,
} from './e2eBackendConfig.js';
import { E2eCompanyEmailSecretStore } from './e2eCompanyEmailSecretStore.js';
import { E2eFakeSmtpProvider } from './e2eFakeSmtpProvider.js';
import { createE2eInvoiceDocumentStorage } from './e2eInvoiceDocumentStorage.js';
import { createE2eOperationalLogger } from './e2eOperationalLogger.js';
import { installE2eDatabaseFault } from './installE2eDatabaseFault.js';
import { ProfileMaintenanceState } from '../src/runtime/profileMaintenance/profileMaintenanceState.js';
import type { ProfileSnapshotRuntimeService } from '../src/runtime/profileSnapshot/profileSnapshotTypes.js';

interface E2eBackendSecretReader {
  getSecret(companyId: string): Promise<string | null>;
}

interface E2eBackendSecretStore {
  hasSecret(companyId: string): Promise<boolean>;
  removeSecret(companyId: string): Promise<void>;
  setSecret(input: { companyId: string; secret: string }): Promise<void>;
}

interface E2eDeliveredInvoiceArchiveTaskSink {
  queueDeliveredInvoiceArchiveTask(input: {
    createdAt: string;
    deliveryEventId: string;
    documentId: string;
    expectedPdfSha256: string;
    expectedPdfSize: number;
    invoiceId: string;
    invoiceKind: 'credit' | 'standard';
    invoiceNumber: string;
  }): Promise<void>;
}

export interface StartE2eBackendOptions {
  companyEmailSecretReader?: E2eBackendSecretReader;
  companyEmailSecretStore?: E2eBackendSecretStore;
  deliveredInvoiceArchiveTaskSink?: E2eDeliveredInvoiceArchiveTaskSink;
  profileSnapshotStagingRoot?: string;
  runtimeInstanceId?: string;
}

export interface E2eProfileSnapshotRuntime {
  maintenance: ProfileMaintenanceState;
  service: ProfileSnapshotRuntimeService;
}

export async function startE2eBackend(
  configPath: string,
  options: StartE2eBackendOptions = {},
): Promise<{
  config: E2eBackendConfig;
  profileSnapshotRuntime?: E2eProfileSnapshotRuntime;
  server: StartedServer;
}> {
  const config = readE2eBackendConfig(configPath);
  await installE2eDatabaseFault({
    databaseFilePath: config.paths.databaseFilePath,
    faultPlan: config.faultPlan,
  });

  const operationalIdentity = resolveOperationalRuntimeIdentity({
    appVersion: '0.0.0-e2e',
    operationalIdentity: {
      appVersion: '0.0.0-e2e',
      buildRevision: 'development',
      runtimeInstanceId: options.runtimeInstanceId ?? randomUUID(),
    },
  });
  const operationalLogger = createE2eOperationalLogger({
    faultPlan: config.faultPlan,
    logsRoot: config.paths.logsRoot,
    operationalIdentity,
  });
  const fakeSmtpProvider = new E2eFakeSmtpProvider(config.faultPlan, {
    operationalIdentity,
    operationalLogger,
  });
  const emailSecretStore = new E2eCompanyEmailSecretStore();
  const companyEmailSecretReader =
    options.companyEmailSecretReader ?? emailSecretStore;
  const companyEmailSecretStore =
    options.companyEmailSecretStore ?? emailSecretStore;
  const profileSnapshotStagingRoot = options.profileSnapshotStagingRoot;
  let profileMaintenanceState: ProfileMaintenanceState | undefined;
  let profileSnapshotService: ProfileSnapshotRuntimeService | undefined;
  const profileSnapshotAppOptions = (() => {
    if (profileSnapshotStagingRoot === undefined) {
      return {};
    }
    profileMaintenanceState = new ProfileMaintenanceState();
    return {
      migrationsDirectory: fileURLToPath(
        new URL('../src/database/migrations/', import.meta.url),
      ),
      profileMaintenanceState,
      profileSnapshotServiceRegistration: {
        register(service: ProfileSnapshotRuntimeService) {
          profileSnapshotService = service;
        },
        stagingRoot: profileSnapshotStagingRoot,
      },
    };
  })();

  const server = await startServer({
    appOptions: {
      appVersion: operationalIdentity.appVersion,
      companyEmailSecretReader,
      companyEmailSecretStore,
      ...(options.deliveredInvoiceArchiveTaskSink === undefined
        ? {}
        : {
            deliveredInvoiceArchiveTaskSink:
              options.deliveredInvoiceArchiveTaskSink,
          }),
      databaseFilePath: config.paths.databaseFilePath,
      invoiceDocumentStorageRoot: config.paths.documentsRoot,
      invoicingInfrastructureAdapters: {
        invoiceDocumentStorage: createE2eInvoiceDocumentStorage(
          config.paths.documentsRoot,
          config.faultPlan,
        ),
        invoiceSmtpDeliveryProvider: fakeSmtpProvider,
        invoiceSmtpTestDeliveryProvider: fakeSmtpProvider,
      },
      operationalIdentity,
      operationalLogger,
      operationalLogsRoot: config.paths.logsRoot,
      ...profileSnapshotAppOptions,
      runtimeTrust: {
        mode: 'localSession',
        sessionSecret: config.backend.sessionSecret,
      },
    },
    hostname: config.backend.host,
    port: config.backend.port,
  });

  if (
    profileMaintenanceState !== undefined &&
    profileSnapshotService === undefined
  ) {
    await server.close();
    throw new Error('E2E profile snapshot runtime was not registered.');
  }

  return {
    config,
    ...(profileMaintenanceState === undefined ||
    profileSnapshotService === undefined
      ? {}
      : {
          profileSnapshotRuntime: {
            maintenance: profileMaintenanceState,
            service: profileSnapshotService,
          },
        }),
    server,
  };
}

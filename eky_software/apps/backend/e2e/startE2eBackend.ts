import { randomUUID } from 'node:crypto';

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

export async function startE2eBackend(
  configPath: string,
): Promise<{ config: E2eBackendConfig; server: StartedServer }> {
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
      runtimeInstanceId: randomUUID(),
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

  const server = await startServer({
    appOptions: {
      appVersion: operationalIdentity.appVersion,
      companyEmailSecretReader: emailSecretStore,
      companyEmailSecretStore: emailSecretStore,
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
      runtimeTrust: {
        mode: 'localSession',
        sessionSecret: config.backend.sessionSecret,
      },
    },
    hostname: config.backend.host,
    port: config.backend.port,
  });

  return { config, server };
}

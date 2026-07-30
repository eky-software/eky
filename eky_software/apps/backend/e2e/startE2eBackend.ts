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

interface E2eBackendSecretReader {
  getSecret(companyId: string): Promise<string | null>;
}

interface E2eBackendSecretStore {
  hasSecret(companyId: string): Promise<boolean>;
  removeSecret(companyId: string): Promise<void>;
  setSecret(input: { companyId: string; secret: string }): Promise<void>;
}

export interface StartE2eBackendOptions {
  companyEmailSecretReader?: E2eBackendSecretReader;
  companyEmailSecretStore?: E2eBackendSecretStore;
  runtimeInstanceId?: string;
}

export async function startE2eBackend(
  configPath: string,
  options: StartE2eBackendOptions = {},
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

  const server = await startServer({
    appOptions: {
      appVersion: operationalIdentity.appVersion,
      companyEmailSecretReader,
      companyEmailSecretStore,
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

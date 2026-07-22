import { Hono } from 'hono';

import {
  createRuntimeTrustMiddleware,
  resolveRuntimeTrust,
  type BackendEnvironment,
  type RuntimeTrust,
} from './runtimeTrust.js';

import { createDatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../database/localRuntimeIdentityReader.js';
import { runMigrations } from '../database/migration/runMigrations.js';
import { createCustomersComposition } from '../composition/customersComposition.js';
import { createInvoicingComposition } from '../composition/invoicingComposition.js';
import { getCompanySettings } from '../modules/companySettings/application/getCompanySettings.js';
import { getCompanyEmailSecretStatus } from '../modules/companySettings/application/getCompanyEmailSecretStatus.js';
import { removeCompanyEmailSecret } from '../modules/companySettings/application/removeCompanyEmailSecret.js';
import { setCompanyEmailSecret } from '../modules/companySettings/application/setCompanyEmailSecret.js';
import { updateCompanySettings } from '../modules/companySettings/application/updateCompanySettings.js';
import { createCompanyEmailSecretRoutes } from '../modules/companySettings/http/companyEmailSecretRoutes.js';
import { createCompanySettingsRoutes } from '../modules/companySettings/http/companySettingsRoutes.js';
import { SqliteCompanyEmailSecretAuditWriter } from '../modules/companySettings/infrastructure/sqliteCompanyEmailSecretAuditWriter.js';
import { SqliteCompanySettingsRepository } from '../modules/companySettings/infrastructure/sqliteCompanySettingsRepository.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import type { CompanyEmailSecretStore } from '../modules/companySettings/ports/companyEmailSecretStore.js';

export interface CreateAppOptions {
  companyEmailSecretReader?: CompanyEmailSecretReader;
  companyEmailSecretStore?: CompanyEmailSecretStore;
  databaseFilePath?: string;
  invoiceDocumentStorageRoot?: string;
  migrationsDirectory?: string;
  runtimeTrust?: RuntimeTrust;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<Hono<BackendEnvironment>> {
  const database = createDatabaseConnection(
    options.databaseFilePath === undefined
      ? {}
      : { databaseFilePath: options.databaseFilePath },
  );
  await runMigrations(
    database,
    options.migrationsDirectory === undefined
      ? {}
      : { migrationsDirectory: options.migrationsDirectory },
  );
  const localRuntimeIdentity = readLocalRuntimeIdentity(database);
  const app = new Hono<BackendEnvironment>();

  app.use(
    '*',
    createRuntimeTrustMiddleware(
      resolveRuntimeTrust(options.runtimeTrust),
      localRuntimeIdentity,
    ),
  );

  app.get('/health', (context) => {
    return context.json({ status: 'ok' });
  });

  const customersComposition = createCustomersComposition(database);
  const companySettingsRepository = new SqliteCompanySettingsRepository(database);
  const companyEmailSecretReader: CompanyEmailSecretReader =
    options.companyEmailSecretReader ?? {
      async getSecret() {
        return null;
      },
    };

  app.route('/', customersComposition.routes);

  if (options.companyEmailSecretStore !== undefined) {
    const companyEmailSecretAuditWriter =
      new SqliteCompanyEmailSecretAuditWriter(database);
    const companyEmailSecretStore = options.companyEmailSecretStore;

    app.route(
      '/',
      createCompanyEmailSecretRoutes({
        getCompanyEmailSecretStatus: (input) =>
          getCompanyEmailSecretStatus(input, { companyEmailSecretStore }),
        removeCompanyEmailSecret: (input) =>
          removeCompanyEmailSecret(input, {
            companyEmailSecretAuditWriter,
            companyEmailSecretStore,
          }),
        setCompanyEmailSecret: (input) =>
          setCompanyEmailSecret(input, {
            companyEmailSecretAuditWriter,
            companyEmailSecretStore,
          }),
      }),
    );
  }

  app.route(
    '/',
    createCompanySettingsRoutes({
      getCompanySettings: async (input) =>
        withCompanyEmailSecretStatus(
          await getCompanySettings(input, companySettingsRepository),
          options.companyEmailSecretStore,
        ),
      updateCompanySettings: async (input) =>
        withCompanyEmailSecretStatus(
          await updateCompanySettings(input, companySettingsRepository),
          options.companyEmailSecretStore,
        ),
    }),
  );

  app.route(
    '/',
    createInvoicingComposition({
      companyEmailSecretReader,
      companySettingsRepository,
      customerAccessReader: customersComposition.customerAccessReader,
      database,
      ...(options.invoiceDocumentStorageRoot === undefined
        ? {}
        : { invoiceDocumentStorageRoot: options.invoiceDocumentStorageRoot }),
    }),
  );

  return app;
}

async function withCompanyEmailSecretStatus<T extends { companyId: string }>(
  settings: T & { emailSecretConfigured: boolean },
  secretStore: CompanyEmailSecretStore | undefined,
): Promise<T & { emailSecretConfigured: boolean }> {
  if (secretStore === undefined) {
    return settings;
  }

  return {
    ...settings,
    emailSecretConfigured: await secretStore.hasSecret(settings.companyId),
  };
}

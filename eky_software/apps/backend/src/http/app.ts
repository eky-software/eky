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
import { createCompanySettingsComposition } from '../composition/companySettingsComposition.js';
import { createCustomersComposition } from '../composition/customersComposition.js';
import { createInvoicingComposition } from '../composition/invoicingComposition.js';
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
  const companySettingsComposition = createCompanySettingsComposition({
    database,
    ...(options.companyEmailSecretStore === undefined
      ? {}
      : { companyEmailSecretStore: options.companyEmailSecretStore }),
  });
  const companyEmailSecretReader: CompanyEmailSecretReader =
    options.companyEmailSecretReader ?? {
      async getSecret() {
        return null;
      },
    };

  app.route('/', customersComposition.routes);
  app.route('/', companySettingsComposition.routes);

  app.route(
    '/',
    createInvoicingComposition({
      companyEmailSecretReader,
      customerAccessReader: customersComposition.customerAccessReader,
      database,
      invoiceEmailSettingsReader:
        companySettingsComposition.invoiceEmailSettingsReader,
      ...(options.invoiceDocumentStorageRoot === undefined
        ? {}
        : { invoiceDocumentStorageRoot: options.invoiceDocumentStorageRoot }),
    }),
  );

  return app;
}

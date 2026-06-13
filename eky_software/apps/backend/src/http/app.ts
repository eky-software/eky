import { Hono } from 'hono';

import { createDatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../database/migration/runMigrations.js';
import { getCompanySettings } from '../modules/companySettings/application/getCompanySettings.js';
import { updateCompanySettings } from '../modules/companySettings/application/updateCompanySettings.js';
import { createCompanySettingsRoutes } from '../modules/companySettings/http/companySettingsRoutes.js';
import { SqliteCompanySettingsRepository } from '../modules/companySettings/infrastructure/sqliteCompanySettingsRepository.js';
import { createCustomer } from '../modules/customers/application/createCustomer.js';
import { listCustomers } from '../modules/customers/application/listCustomers.js';
import { updateCustomer } from '../modules/customers/application/updateCustomer.js';
import { createCustomersRoutes } from '../modules/customers/http/customersRoutes.js';
import { SqliteCustomerRepository } from '../modules/customers/infrastructure/sqliteCustomerRepository.js';
import { getInvoiceDraft } from '../modules/invoicing/application/getInvoiceDraft.js';
import { saveInvoiceDraft } from '../modules/invoicing/application/saveInvoiceDraft.js';
import { createInvoiceDraftRoutes } from '../modules/invoicing/http/invoiceDraftRoutes.js';
import { SqliteInvoiceDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';

export async function createApp(): Promise<Hono> {
  const app = new Hono();

  app.get('/health', (context) => {
    return context.json({ status: 'ok' });
  });

  const database = createDatabaseConnection();
  await runMigrations(database);

  const customerRepository = new SqliteCustomerRepository(database);
  const companySettingsRepository = new SqliteCompanySettingsRepository(database);
  const invoiceDraftRepository = new SqliteInvoiceDraftRepository(database);
  const customerAccessReader: CustomerAccessReader = {
    async belongsToCompany(customerId, companyId) {
      const customer = await customerRepository.findById(companyId, customerId);

      return customer !== undefined;
    },
  };

  app.route(
    '/',
    createCustomersRoutes({
      createCustomer: (input) => createCustomer(input, customerRepository),
      listCustomers: (input) => listCustomers(input, customerRepository),
      updateCustomer: (input) => updateCustomer(input, customerRepository),
    }),
  );

  app.route(
    '/',
    createCompanySettingsRoutes({
      getCompanySettings: (input) => getCompanySettings(input, companySettingsRepository),
      updateCompanySettings: (input) => updateCompanySettings(input, companySettingsRepository),
    }),
  );

  app.route(
    '/',
    createInvoiceDraftRoutes({
      getInvoiceDraft: (input) =>
        getInvoiceDraft(input, invoiceDraftRepository),
      saveInvoiceDraft: (input) =>
        saveInvoiceDraft(input, {
          customerAccessReader,
          invoiceDraftRepository,
        }),
    }),
  );

  return app;
}

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
import { approveInvoiceDraft } from '../modules/invoicing/application/approveInvoiceDraft.js';
import { deleteInvoiceDraft } from '../modules/invoicing/application/deleteInvoiceDraft.js';
import { generateApprovedInvoicePdfDocument } from '../modules/invoicing/application/generateApprovedInvoicePdfDocument.js';
import { getApprovedInvoice } from '../modules/invoicing/application/getApprovedInvoice.js';
import { getApprovedInvoicePdfDocument } from '../modules/invoicing/application/getApprovedInvoicePdfDocument.js';
import { getInvoiceDraft } from '../modules/invoicing/application/getInvoiceDraft.js';
import { getInvoiceNumberingSettings } from '../modules/invoicing/application/getInvoiceNumberingSettings.js';
import { getInvoicePaymentSettings } from '../modules/invoicing/application/getInvoicePaymentSettings.js';
import { listInvoiceDrafts } from '../modules/invoicing/application/listInvoiceDrafts.js';
import { listApprovedInvoices } from '../modules/invoicing/application/listApprovedInvoices.js';
import { reopenApprovedInvoiceForEditing } from '../modules/invoicing/application/reopenApprovedInvoiceForEditing.js';
import { saveInvoiceDraft } from '../modules/invoicing/application/saveInvoiceDraft.js';
import { updateInvoiceNumberingSettings } from '../modules/invoicing/application/updateInvoiceNumberingSettings.js';
import { updateInvoicePaymentSettings } from '../modules/invoicing/application/updateInvoicePaymentSettings.js';
import { updateInvoiceDraft } from '../modules/invoicing/application/updateInvoiceDraft.js';
import { createApprovedInvoiceRoutes } from '../modules/invoicing/http/approvedInvoiceRoutes.js';
import { createInvoiceDraftRoutes } from '../modules/invoicing/http/invoiceDraftRoutes.js';
import { createInvoiceNumberingSettingsRoutes } from '../modules/invoicing/http/invoiceNumberingSettingsRoutes.js';
import { createInvoicePaymentSettingsRoutes } from '../modules/invoicing/http/invoicePaymentSettingsRoutes.js';
import { LocalInvoiceDocumentStorage } from '../modules/invoicing/infrastructure/localInvoiceDocumentStorage.js';
import { renderApprovedInvoicePdf } from '../modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';
import { SqliteApprovedInvoiceReader } from '../modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.js';
import { SqliteInvoiceNumberingRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceNumberingRepository.js';
import { SqliteInvoicePaymentSettingsRepository } from '../modules/invoicing/infrastructure/sqliteInvoicePaymentSettingsRepository.js';
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
  const invoiceApprovalRepository = new SqliteInvoiceApprovalRepository(database);
  const invoiceDocumentRepository =
    new SqliteInvoiceDocumentRepository(database);
  const invoiceDocumentStorage = new LocalInvoiceDocumentStorage();
  const approvedInvoiceReader = new SqliteApprovedInvoiceReader(database);
  const invoiceNumberingRepository = new SqliteInvoiceNumberingRepository(database);
  const invoicePaymentSettingsRepository =
    new SqliteInvoicePaymentSettingsRepository(database);
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
      approveInvoiceDraft: (input) =>
        approveInvoiceDraft(input, { invoiceApprovalRepository }).then(
          async (approvedInvoice) => {
            await generateApprovedInvoicePdfDocument(
              {
                companyId: input.companyId,
                createdAt: new Date().toISOString(),
                invoiceId: approvedInvoice.invoiceId,
              },
              {
                approvedInvoiceReader,
                invoiceDocumentRepository,
                invoiceDocumentStorage,
                renderApprovedInvoicePdf,
              },
            ).catch(() => undefined);

            return approvedInvoice;
          },
        ),
      deleteInvoiceDraft: (input) =>
        deleteInvoiceDraft(input, invoiceDraftRepository),
      getInvoiceDraft: (input) =>
        getInvoiceDraft(input, invoiceDraftRepository),
      listInvoiceDrafts: (input) =>
        listInvoiceDrafts(input, invoiceDraftRepository),
      saveInvoiceDraft: (input) =>
        saveInvoiceDraft(input, {
          customerAccessReader,
          invoiceDraftRepository,
          invoicePaymentSettingsRepository,
        }),
      updateInvoiceDraft: (input) =>
        updateInvoiceDraft(input, {
          customerAccessReader,
          invoiceDraftRepository,
          invoicePaymentSettingsRepository,
        }),
    }),
  );

  app.route(
    '/',
    createApprovedInvoiceRoutes({
      generateApprovedInvoicePdfDocument: (input) =>
        generateApprovedInvoicePdfDocument(input, {
          approvedInvoiceReader,
          invoiceDocumentRepository,
          invoiceDocumentStorage,
          renderApprovedInvoicePdf,
        }),
      getApprovedInvoice: (input) =>
        getApprovedInvoice(input, approvedInvoiceReader),
      getApprovedInvoicePdfDocument: (input) =>
        getApprovedInvoicePdfDocument(input, {
          invoiceDocumentRepository,
          invoiceDocumentStorage,
        }),
      listApprovedInvoices: (input) =>
        listApprovedInvoices(input, approvedInvoiceReader),
      reopenApprovedInvoiceForEditing: (input) =>
        reopenApprovedInvoiceForEditing(input, {
          invoiceApprovalRepository,
          invoiceDocumentStorage,
        }),
    }),
  );

  app.route(
    '/',
    createInvoiceNumberingSettingsRoutes({
      getInvoiceNumberingSettings: (input) =>
        getInvoiceNumberingSettings(input, invoiceNumberingRepository),
      updateInvoiceNumberingSettings: (input) =>
        updateInvoiceNumberingSettings(input, invoiceNumberingRepository),
    }),
  );

  app.route(
    '/',
    createInvoicePaymentSettingsRoutes({
      getInvoicePaymentSettings: (input) =>
        getInvoicePaymentSettings(input, invoicePaymentSettingsRepository),
      updateInvoicePaymentSettings: (input) =>
        updateInvoicePaymentSettings(input, invoicePaymentSettingsRepository),
    }),
  );

  return app;
}

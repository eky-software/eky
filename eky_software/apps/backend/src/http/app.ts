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
import { createCustomer } from '../modules/customers/application/createCustomer.js';
import { listCustomers } from '../modules/customers/application/listCustomers.js';
import { updateCustomer } from '../modules/customers/application/updateCustomer.js';
import { createCustomersRoutes } from '../modules/customers/http/customersRoutes.js';
import { SqliteCustomerRepository } from '../modules/customers/infrastructure/sqliteCustomerRepository.js';
import { approveInvoiceDraft } from '../modules/invoicing/application/approveInvoiceDraft.js';
import { copyApprovedInvoiceToDraft } from '../modules/invoicing/application/copyApprovedInvoiceToDraft.js';
import { deleteInvoiceDraft } from '../modules/invoicing/application/deleteInvoiceDraft.js';
import { generateApprovedInvoicePdfDocument } from '../modules/invoicing/application/generateApprovedInvoicePdfDocument.js';
import { getApprovedInvoice } from '../modules/invoicing/application/getApprovedInvoice.js';
import { getApprovedInvoicePdfDocument } from '../modules/invoicing/application/getApprovedInvoicePdfDocument.js';
import { getApprovedInvoicePdfMetadata } from '../modules/invoicing/application/getApprovedInvoicePdfMetadata.js';
import { getInvoiceDraft } from '../modules/invoicing/application/getInvoiceDraft.js';
import { getInvoiceNumberingSettings } from '../modules/invoicing/application/getInvoiceNumberingSettings.js';
import { getInvoicePaymentSettings } from '../modules/invoicing/application/getInvoicePaymentSettings.js';
import { listInvoiceDrafts } from '../modules/invoicing/application/listInvoiceDrafts.js';
import { listApprovedInvoices } from '../modules/invoicing/application/listApprovedInvoices.js';
import { markApprovedInvoiceSent } from '../modules/invoicing/application/markApprovedInvoiceSent.js';
import { prepareApprovedInvoiceEmailDryRun } from '../modules/invoicing/application/prepareApprovedInvoiceEmailDryRun.js';
import { prepareApprovedInvoiceEmailSmtpTest } from '../modules/invoicing/application/prepareApprovedInvoiceEmailSmtpTest.js';
import { reopenApprovedInvoiceForEditing } from '../modules/invoicing/application/reopenApprovedInvoiceForEditing.js';
import { saveInvoiceDraft } from '../modules/invoicing/application/saveInvoiceDraft.js';
import { sendApprovedInvoiceEmailDryRun } from '../modules/invoicing/application/sendApprovedInvoiceEmailDryRun.js';
import { sendApprovedInvoiceEmailSmtpTest } from '../modules/invoicing/application/sendApprovedInvoiceEmailSmtpTest.js';
import { updateInvoiceNumberingSettings } from '../modules/invoicing/application/updateInvoiceNumberingSettings.js';
import { updateInvoicePaymentSettings } from '../modules/invoicing/application/updateInvoicePaymentSettings.js';
import { updateInvoiceDraft } from '../modules/invoicing/application/updateInvoiceDraft.js';
import { createApprovedInvoiceRoutes } from '../modules/invoicing/http/approvedInvoiceRoutes.js';
import { createInvoiceDraftRoutes } from '../modules/invoicing/http/invoiceDraftRoutes.js';
import { createInvoiceNumberingSettingsRoutes } from '../modules/invoicing/http/invoiceNumberingSettingsRoutes.js';
import { createInvoicePaymentSettingsRoutes } from '../modules/invoicing/http/invoicePaymentSettingsRoutes.js';
import { DryRunInvoiceEmailDeliveryProvider } from '../infrastructure/email/dryRunInvoiceEmailDeliveryProvider.js';
import { DnaInvoiceSmtpTestDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpTestDeliveryProvider.js';
import { DnaSmtpEmailDeliveryProvider } from '../infrastructure/email/providers/dna/dnaSmtpEmailDeliveryProvider.js';
import { LocalInvoiceDocumentStorage } from '../modules/invoicing/infrastructure/localInvoiceDocumentStorage.js';
import { renderApprovedInvoicePdf } from '../modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';
import { SqliteApprovedInvoiceReader } from '../modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.js';
import { SqliteInvoiceNumberingRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceNumberingRepository.js';
import { SqliteInvoicePaymentSettingsRepository } from '../modules/invoicing/infrastructure/sqliteInvoicePaymentSettingsRepository.js';
import { InMemoryInvoiceSmtpTestAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceSmtpTestAttemptStore.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';

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

  const customerRepository = new SqliteCustomerRepository(database);
  const companySettingsRepository = new SqliteCompanySettingsRepository(database);
  const invoiceDraftRepository = new SqliteInvoiceDraftRepository(database);
  const invoiceApprovalRepository = new SqliteInvoiceApprovalRepository(database);
  const invoiceDocumentRepository =
    new SqliteInvoiceDocumentRepository(database);
  const invoiceDeliveryEventRepository =
    new SqliteInvoiceDeliveryEventRepository(database);
  const invoiceDocumentStorage =
    options.invoiceDocumentStorageRoot === undefined
      ? new LocalInvoiceDocumentStorage()
      : new LocalInvoiceDocumentStorage(options.invoiceDocumentStorageRoot);
  const invoiceEmailDeliveryProvider = new DryRunInvoiceEmailDeliveryProvider();
  const invoiceSmtpTestAttemptStore = new InMemoryInvoiceSmtpTestAttemptStore();
  const companyEmailSecretReader: CompanyEmailSecretReader =
    options.companyEmailSecretReader ?? {
      async getSecret() {
        return null;
      },
    };
  const invoiceSmtpTestDeliveryProvider =
    new DnaInvoiceSmtpTestDeliveryProvider(
      new DnaSmtpEmailDeliveryProvider({ companyEmailSecretReader }),
    );
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
  const invoiceEmailSettingsReader: InvoiceEmailSettingsReader = {
    async getEmailSettings(companyId) {
      const settings = await companySettingsRepository.findByCompanyId(companyId);

      if (settings === null) {
        return null;
      }

      return {
        emailDeliveryProvider: settings.emailDeliveryProvider,
        emailSenderAddress: settings.emailSenderAddress,
        emailSenderName: settings.emailSenderName,
        emailTestRecipientOverride: settings.emailTestRecipientOverride,
        emailUsername: settings.emailUsername,
      };
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
      copyApprovedInvoiceToDraft: (input) =>
        copyApprovedInvoiceToDraft(input, {
          approvedInvoiceReader,
          customerAccessReader,
          invoiceDraftRepository,
        }),
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
      getApprovedInvoicePdfMetadata: (input) =>
        getApprovedInvoicePdfMetadata(input, {
          invoiceDocumentRepository,
          invoiceDocumentStorage,
        }),
      listApprovedInvoices: (input) =>
        listApprovedInvoices(input, approvedInvoiceReader),
      markApprovedInvoiceSent: (input) =>
        markApprovedInvoiceSent(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument: (pdfInput) =>
            generateApprovedInvoicePdfDocument(pdfInput, {
              approvedInvoiceReader,
              invoiceDocumentRepository,
              invoiceDocumentStorage,
              renderApprovedInvoicePdf,
            }),
          invoiceApprovalRepository,
        }),
      prepareApprovedInvoiceEmailDryRun: (input) =>
        prepareApprovedInvoiceEmailDryRun(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument: (pdfInput) =>
            generateApprovedInvoicePdfDocument(pdfInput, {
              approvedInvoiceReader,
              invoiceDocumentRepository,
              invoiceDocumentStorage,
              renderApprovedInvoicePdf,
            }),
          invoiceEmailDeliveryProvider,
        }),
      prepareApprovedInvoiceEmailSmtpTest: (input) =>
        prepareApprovedInvoiceEmailSmtpTest(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument: (pdfInput) =>
            generateApprovedInvoicePdfDocument(pdfInput, {
              approvedInvoiceReader,
              invoiceDocumentRepository,
              invoiceDocumentStorage,
              renderApprovedInvoicePdf,
            }),
          invoiceEmailSettingsReader,
          invoiceSmtpTestAttemptStore,
        }),
      sendApprovedInvoiceEmailDryRun: (input) =>
        sendApprovedInvoiceEmailDryRun(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument: (pdfInput) =>
            generateApprovedInvoicePdfDocument(pdfInput, {
              approvedInvoiceReader,
              invoiceDocumentRepository,
              invoiceDocumentStorage,
              renderApprovedInvoicePdf,
            }),
          invoiceDeliveryEventRepository,
          invoiceEmailDeliveryProvider,
        }),
      sendApprovedInvoiceEmailSmtpTest: (input) =>
        sendApprovedInvoiceEmailSmtpTest(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument: (pdfInput) =>
            generateApprovedInvoicePdfDocument(pdfInput, {
              approvedInvoiceReader,
              invoiceDocumentRepository,
              invoiceDocumentStorage,
              renderApprovedInvoicePdf,
            }),
          getApprovedInvoicePdfDocument: (pdfInput) =>
            getApprovedInvoicePdfDocument(pdfInput, {
              invoiceDocumentRepository,
              invoiceDocumentStorage,
            }),
          invoiceDeliveryEventRepository,
          invoiceEmailSettingsReader,
          invoiceSmtpTestAttemptStore,
          invoiceSmtpTestDeliveryProvider,
        }),
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

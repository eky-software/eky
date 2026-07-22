import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { DryRunInvoiceEmailDeliveryProvider } from '../infrastructure/email/dryRunInvoiceEmailDeliveryProvider.js';
import { DnaInvoiceSmtpDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpDeliveryProvider.js';
import { DnaInvoiceSmtpTestDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpTestDeliveryProvider.js';
import { DnaSmtpEmailDeliveryProvider } from '../infrastructure/email/providers/dna/dnaSmtpEmailDeliveryProvider.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import { approveInvoiceDraft } from '../modules/invoicing/application/approveInvoiceDraft.js';
import { copyApprovedInvoiceToDraft } from '../modules/invoicing/application/copyApprovedInvoiceToDraft.js';
import { deleteInvoiceDraft } from '../modules/invoicing/application/deleteInvoiceDraft.js';
import {
  generateApprovedInvoicePdfDocument,
  type GenerateApprovedInvoicePdfDocumentInput,
} from '../modules/invoicing/application/generateApprovedInvoicePdfDocument.js';
import { getApprovedInvoice } from '../modules/invoicing/application/getApprovedInvoice.js';
import {
  getApprovedInvoicePdfDocument as readApprovedInvoicePdfDocument,
  type GetApprovedInvoicePdfDocumentInput,
} from '../modules/invoicing/application/getApprovedInvoicePdfDocument.js';
import { getApprovedInvoicePdfMetadata } from '../modules/invoicing/application/getApprovedInvoicePdfMetadata.js';
import { getInvoiceDraft } from '../modules/invoicing/application/getInvoiceDraft.js';
import { getInvoiceNumberingSettings } from '../modules/invoicing/application/getInvoiceNumberingSettings.js';
import { getInvoicePaymentSettings } from '../modules/invoicing/application/getInvoicePaymentSettings.js';
import { getInvoiceVatRates } from '../modules/invoicing/application/getInvoiceVatRates.js';
import { listApprovedInvoices } from '../modules/invoicing/application/listApprovedInvoices.js';
import { listInvoiceDeliveryEvents } from '../modules/invoicing/application/listInvoiceDeliveryEvents.js';
import { listInvoiceDrafts } from '../modules/invoicing/application/listInvoiceDrafts.js';
import { markApprovedInvoiceSent } from '../modules/invoicing/application/markApprovedInvoiceSent.js';
import { prepareApprovedInvoiceEmailDryRun } from '../modules/invoicing/application/prepareApprovedInvoiceEmailDryRun.js';
import { prepareApprovedInvoiceEmailSmtp } from '../modules/invoicing/application/prepareApprovedInvoiceEmailSmtp.js';
import { prepareApprovedInvoiceEmailSmtpTest } from '../modules/invoicing/application/prepareApprovedInvoiceEmailSmtpTest.js';
import { reopenApprovedInvoiceForEditing } from '../modules/invoicing/application/reopenApprovedInvoiceForEditing.js';
import { saveInvoiceDraft } from '../modules/invoicing/application/saveInvoiceDraft.js';
import { sendApprovedInvoiceEmailDryRun } from '../modules/invoicing/application/sendApprovedInvoiceEmailDryRun.js';
import { sendApprovedInvoiceEmailSmtp } from '../modules/invoicing/application/sendApprovedInvoiceEmailSmtp.js';
import { sendApprovedInvoiceEmailSmtpTest } from '../modules/invoicing/application/sendApprovedInvoiceEmailSmtpTest.js';
import { updateInvoiceDraft } from '../modules/invoicing/application/updateInvoiceDraft.js';
import { updateInvoiceNumberingSettings } from '../modules/invoicing/application/updateInvoiceNumberingSettings.js';
import { updateInvoicePaymentSettings } from '../modules/invoicing/application/updateInvoicePaymentSettings.js';
import { updateInvoiceVatRates } from '../modules/invoicing/application/updateInvoiceVatRates.js';
import { createApprovedInvoiceRoutes } from '../modules/invoicing/http/approvedInvoiceRoutes.js';
import { createInvoiceDraftRoutes } from '../modules/invoicing/http/invoiceDraftRoutes.js';
import { createInvoiceNumberingSettingsRoutes } from '../modules/invoicing/http/invoiceNumberingSettingsRoutes.js';
import { createInvoicePaymentSettingsRoutes } from '../modules/invoicing/http/invoicePaymentSettingsRoutes.js';
import { createInvoiceVatRatesRoutes } from '../modules/invoicing/http/invoiceVatRatesRoutes.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import { LocalInvoiceDocumentStorage } from '../modules/invoicing/infrastructure/localInvoiceDocumentStorage.js';
import { renderApprovedInvoicePdf } from '../modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';
import { SqliteApprovedInvoiceReader } from '../modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.js';
import { SqliteInvoiceNumberingRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceNumberingRepository.js';
import { SqliteInvoicePaymentSettingsRepository } from '../modules/invoicing/infrastructure/sqliteInvoicePaymentSettingsRepository.js';
import { SqliteInvoiceVatRateRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceVatRateRepository.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';

interface InvoicingCompositionOptions {
  companyEmailSecretReader: CompanyEmailSecretReader;
  customerAccessReader: CustomerAccessReader;
  database: DatabaseConnection;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceDocumentStorageRoot?: string;
}

export function createInvoicingComposition(
  options: InvoicingCompositionOptions,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();
  const invoiceDraftRepository = new SqliteInvoiceDraftRepository(options.database);
  const invoiceApprovalRepository = new SqliteInvoiceApprovalRepository(
    options.database,
  );
  const invoiceDocumentRepository = new SqliteInvoiceDocumentRepository(
    options.database,
  );
  const invoiceDeliveryEventRepository =
    new SqliteInvoiceDeliveryEventRepository(options.database);
  const invoiceDocumentStorage =
    options.invoiceDocumentStorageRoot === undefined
      ? new LocalInvoiceDocumentStorage()
      : new LocalInvoiceDocumentStorage(options.invoiceDocumentStorageRoot);
  const approvedInvoiceReader = new SqliteApprovedInvoiceReader(options.database);
  const invoiceNumberingRepository = new SqliteInvoiceNumberingRepository(
    options.database,
  );
  const invoicePaymentSettingsRepository =
    new SqliteInvoicePaymentSettingsRepository(options.database);
  const invoiceVatRateRepository = new SqliteInvoiceVatRateRepository(
    options.database,
  );
  const invoiceEmailDeliveryProvider = new DryRunInvoiceEmailDeliveryProvider();
  const invoiceEmailSendAttemptStore = new InMemoryInvoiceEmailSendAttemptStore();
  const dnaSmtpEmailDeliveryProvider = new DnaSmtpEmailDeliveryProvider({
    companyEmailSecretReader: options.companyEmailSecretReader,
  });
  const invoiceSmtpTestDeliveryProvider =
    new DnaInvoiceSmtpTestDeliveryProvider(dnaSmtpEmailDeliveryProvider);
  const invoiceSmtpDeliveryProvider = new DnaInvoiceSmtpDeliveryProvider(
    dnaSmtpEmailDeliveryProvider,
  );
  const ensureApprovedInvoicePdfDocument = (
    input: GenerateApprovedInvoicePdfDocumentInput,
  ) =>
    generateApprovedInvoicePdfDocument(input, {
      approvedInvoiceReader,
      invoiceDocumentRepository,
      invoiceDocumentStorage,
      renderApprovedInvoicePdf,
    });
  const getApprovedInvoicePdfDocument = (
    input: GetApprovedInvoicePdfDocumentInput,
  ) =>
    readApprovedInvoicePdfDocument(input, {
      invoiceDocumentRepository,
      invoiceDocumentStorage,
    });

  routes.route(
    '/',
    createInvoiceDraftRoutes({
      approveInvoiceDraft: (input) =>
        approveInvoiceDraft(input, { invoiceApprovalRepository }).then(
          async (approvedInvoice) => {
            await ensureApprovedInvoicePdfDocument({
              companyId: input.companyId,
              createdAt: new Date().toISOString(),
              invoiceId: approvedInvoice.invoiceId,
            }).catch(() => undefined);

            return approvedInvoice;
          },
        ),
      deleteInvoiceDraft: (input) =>
        deleteInvoiceDraft(input, invoiceDraftRepository),
      getInvoiceDraft: (input) => getInvoiceDraft(input, invoiceDraftRepository),
      listInvoiceDrafts: (input) =>
        listInvoiceDrafts(input, invoiceDraftRepository),
      saveInvoiceDraft: (input) =>
        saveInvoiceDraft(input, {
          customerAccessReader: options.customerAccessReader,
          invoiceDraftRepository,
          invoicePaymentSettingsRepository,
        }),
      updateInvoiceDraft: (input) =>
        updateInvoiceDraft(input, {
          customerAccessReader: options.customerAccessReader,
          invoiceDraftRepository,
          invoicePaymentSettingsRepository,
        }),
    }),
  );

  routes.route(
    '/',
    createApprovedInvoiceRoutes({
      copyApprovedInvoiceToDraft: (input) =>
        copyApprovedInvoiceToDraft(input, {
          approvedInvoiceReader,
          customerAccessReader: options.customerAccessReader,
          invoiceDraftRepository,
        }),
      generateApprovedInvoicePdfDocument: ensureApprovedInvoicePdfDocument,
      getApprovedInvoice: (input) =>
        getApprovedInvoice(input, approvedInvoiceReader),
      getApprovedInvoicePdfDocument,
      getApprovedInvoicePdfMetadata: (input) =>
        getApprovedInvoicePdfMetadata(input, {
          invoiceDocumentRepository,
          invoiceDocumentStorage,
        }),
      listApprovedInvoices: (input) =>
        listApprovedInvoices(input, approvedInvoiceReader),
      listInvoiceDeliveryEvents: (input) =>
        listInvoiceDeliveryEvents(input, {
          approvedInvoiceReader,
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
        }),
      markApprovedInvoiceSent: (input) =>
        markApprovedInvoiceSent(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          invoiceManualDeliveryFinalizer: invoiceDeliveryEventRepository,
        }),
      prepareApprovedInvoiceEmailDryRun: (input) =>
        prepareApprovedInvoiceEmailDryRun(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          invoiceEmailDeliveryProvider,
        }),
      prepareApprovedInvoiceEmailSmtpTest: (input) =>
        prepareApprovedInvoiceEmailSmtpTest(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          invoiceEmailSendAttemptStore,
        }),
      prepareApprovedInvoiceEmailSmtp: (input) =>
        prepareApprovedInvoiceEmailSmtp(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          invoiceEmailSendAttemptStore,
          invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
        }),
      sendApprovedInvoiceEmailDryRun: (input) =>
        sendApprovedInvoiceEmailDryRun(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          invoiceDeliveryEventRepository,
          invoiceEmailDeliveryProvider,
        }),
      sendApprovedInvoiceEmailSmtpTest: (input) =>
        sendApprovedInvoiceEmailSmtpTest(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          getApprovedInvoicePdfDocument,
          invoiceDeliveryEventRepository,
          invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          invoiceEmailSendAttemptStore,
          invoiceSmtpTestDeliveryProvider,
        }),
      sendApprovedInvoiceEmailSmtp: (input) =>
        sendApprovedInvoiceEmailSmtp(input, {
          approvedInvoiceReader,
          ensureApprovedInvoicePdfDocument,
          getApprovedInvoicePdfDocument,
          invoiceDeliveryEventRepository,
          invoiceEmailDeliveryFinalizer: invoiceDeliveryEventRepository,
          invoiceEmailSendAttemptStore,
          invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          invoiceSmtpDeliveryProvider,
        }),
      reopenApprovedInvoiceForEditing: (input) =>
        reopenApprovedInvoiceForEditing(input, {
          invoiceApprovalRepository,
          invoiceDocumentStorage,
        }),
    }),
  );

  routes.route(
    '/',
    createInvoiceNumberingSettingsRoutes({
      getInvoiceNumberingSettings: (input) =>
        getInvoiceNumberingSettings(input, invoiceNumberingRepository),
      updateInvoiceNumberingSettings: (input) =>
        updateInvoiceNumberingSettings(input, invoiceNumberingRepository),
    }),
  );

  routes.route(
    '/',
    createInvoicePaymentSettingsRoutes({
      getInvoicePaymentSettings: (input) =>
        getInvoicePaymentSettings(input, invoicePaymentSettingsRepository),
      updateInvoicePaymentSettings: (input) =>
        updateInvoicePaymentSettings(input, invoicePaymentSettingsRepository),
    }),
  );

  routes.route(
    '/',
    createInvoiceVatRatesRoutes({
      getInvoiceVatRates: (input) =>
        getInvoiceVatRates(input, invoiceVatRateRepository),
      updateInvoiceVatRates: (input) =>
        updateInvoiceVatRates(input, invoiceVatRateRepository),
    }),
  );

  return routes;
}

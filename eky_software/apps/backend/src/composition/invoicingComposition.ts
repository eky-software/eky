import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { DryRunInvoiceEmailDeliveryProvider } from '../infrastructure/email/dryRunInvoiceEmailDeliveryProvider.js';
import { DnaInvoiceSmtpDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpDeliveryProvider.js';
import { DnaInvoiceSmtpTestDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpTestDeliveryProvider.js';
import { DnaSmtpEmailDeliveryProvider } from '../infrastructure/email/providers/dna/dnaSmtpEmailDeliveryProvider.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import { approveCreditInvoiceDraft } from '../modules/invoicing/application/approveCreditInvoiceDraft.js';
import { approveInvoiceDraft } from '../modules/invoicing/application/approveInvoiceDraft.js';
import { cancelApprovedInvoice } from '../modules/invoicing/application/cancelApprovedInvoice.js';
import { createCreditInvoiceDraft } from '../modules/invoicing/application/createCreditInvoiceDraft.js';
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
import { getCreditInvoiceDraft } from '../modules/invoicing/application/getCreditInvoiceDraft.js';
import { getInvoiceCreditContext } from '../modules/invoicing/application/getInvoiceCreditContext.js';
import { getInvoiceNumberingSettings } from '../modules/invoicing/application/getInvoiceNumberingSettings.js';
import { getInvoicePaymentSettings } from '../modules/invoicing/application/getInvoicePaymentSettings.js';
import { getInvoiceVatRates } from '../modules/invoicing/application/getInvoiceVatRates.js';
import { listApprovedInvoices } from '../modules/invoicing/application/listApprovedInvoices.js';
import { listSentInvoiceGroups } from '../modules/invoicing/application/listSentInvoiceGroups.js';
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
import { updateCreditInvoiceDraft } from '../modules/invoicing/application/updateCreditInvoiceDraft.js';
import { updateInvoiceNumberingSettings } from '../modules/invoicing/application/updateInvoiceNumberingSettings.js';
import { updateInvoicePaymentSettings } from '../modules/invoicing/application/updateInvoicePaymentSettings.js';
import { updateInvoiceVatRates } from '../modules/invoicing/application/updateInvoiceVatRates.js';
import { createApprovedInvoiceRoutes } from '../modules/invoicing/http/approvedInvoiceRoutes.js';
import { createInvoiceDraftRoutes } from '../modules/invoicing/http/invoiceDraftRoutes.js';
import { createCreditInvoiceDraftRoutes } from '../modules/invoicing/http/creditInvoiceDraftRoutes.js';
import { createInvoiceNumberingSettingsRoutes } from '../modules/invoicing/http/invoiceNumberingSettingsRoutes.js';
import { createInvoicePaymentSettingsRoutes } from '../modules/invoicing/http/invoicePaymentSettingsRoutes.js';
import { createInvoiceVatRatesRoutes } from '../modules/invoicing/http/invoiceVatRatesRoutes.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import { LocalInvoiceDocumentStorage } from '../modules/invoicing/infrastructure/localInvoiceDocumentStorage.js';
import { renderApprovedInvoicePdf } from '../modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';
import { SqliteApprovedInvoiceReader } from '../modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceCreditContextReader } from '../modules/invoicing/infrastructure/sqliteInvoiceCreditContextReader.js';
import { SqliteInvoiceApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceCorrectionRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceCorrectionRepository.js';
import { SqliteInvoiceCreditApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceCreditApprovalRepository.js';
import { SqliteInvoiceCreditDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceCreditDraftRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.js';
import { SqliteInvoiceActivityReader } from '../modules/invoicing/infrastructure/sqliteInvoiceActivityReader.js';
import { SqliteInvoiceNumberingRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceNumberingRepository.js';
import { SqliteInvoicePaymentSettingsRepository } from '../modules/invoicing/infrastructure/sqliteInvoicePaymentSettingsRepository.js';
import { SqliteInvoiceVatRateRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceVatRateRepository.js';
import { SqliteSentInvoiceGroupReader } from '../modules/invoicing/infrastructure/sqliteSentInvoiceGroupReader.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';
import type { InvoiceCustomerTaxProfileReader } from '../modules/invoicing/ports/invoiceCustomerTaxProfileReader.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';
import type { InvoiceActivityReader } from '../modules/invoicing/ports/invoiceActivityReader.js';
import { InvoiceSettingsAuditWriteError } from '../modules/invoicing/ports/invoiceSettingsAuditWriteError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from '../modules/invoicing/application/approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';

interface InvoicingCompositionOptions {
  companyEmailSecretReader: CompanyEmailSecretReader;
  customerAccessReader: CustomerAccessReader;
  invoiceCustomerTaxProfileReader: InvoiceCustomerTaxProfileReader;
  database: DatabaseConnection;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceDocumentStorageRoot?: string;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}

interface InvoicingComposition {
  invoiceActivityReader: InvoiceActivityReader;
  routes: Hono<BackendEnvironment>;
}

export function createInvoicingComposition(
  options: InvoicingCompositionOptions,
): InvoicingComposition {
  const routes = new Hono<BackendEnvironment>();
  const invoiceActivityReader = new SqliteInvoiceActivityReader(
    options.database,
  );
  const invoiceDraftRepository = new SqliteInvoiceDraftRepository(options.database);
  const invoiceApprovalRepository = new SqliteInvoiceApprovalRepository(
    options.database,
  );
  const invoiceCorrectionRepository = new SqliteInvoiceCorrectionRepository(
    options.database,
  );
  const invoiceCreditDraftRepository =
    new SqliteInvoiceCreditDraftRepository(options.database);
  const invoiceCreditApprovalRepository =
    new SqliteInvoiceCreditApprovalRepository(options.database);
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
  const invoiceCreditContextReader = new SqliteInvoiceCreditContextReader(
    options.database,
  );
  const sentInvoiceGroupReader = new SqliteSentInvoiceGroupReader(
    options.database,
  );
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
  const ensureApprovedInvoicePdfDocument = async (
    input: GenerateApprovedInvoicePdfDocumentInput,
  ) => {
    try {
      return await generateApprovedInvoicePdfDocument(input, {
        approvedInvoiceReader,
        invoiceDocumentRepository,
        invoiceDocumentStorage,
        renderApprovedInvoicePdf,
      });
    } catch (error) {
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            companyId: input.companyId,
            entityId: input.invoiceId,
            entityType: 'approvedInvoice',
            errorCode: 'INVOICE_PDF_GENERATION_FAILED',
            eventName: 'invoicePdf.generationFailed',
            retryable: true,
            sideEffectState: 'unknown',
            stage: 'generate',
          },
          options.operationalIdentity,
        ),
      );
      throw error;
    }
  };
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
          invoiceCustomerTaxProfileReader:
            options.invoiceCustomerTaxProfileReader,
          invoiceDraftRepository,
          invoicePaymentSettingsRepository,
        }),
      updateInvoiceDraft: (input) =>
        updateInvoiceDraft(input, {
          customerAccessReader: options.customerAccessReader,
          invoiceCustomerTaxProfileReader:
            options.invoiceCustomerTaxProfileReader,
          invoiceDraftRepository,
          invoicePaymentSettingsRepository,
        }),
    }),
  );

  routes.route(
    '/',
    createCreditInvoiceDraftRoutes({
      approveCreditInvoiceDraft: (input) =>
        approveCreditInvoiceDraft(input, {
          invoiceCreditApprovalRepository,
        }).then(async (approvedInvoice) => {
          await ensureApprovedInvoicePdfDocument({
            companyId: input.actorContext.companyId,
            createdAt: new Date().toISOString(),
            invoiceId: approvedInvoice.invoiceId,
          }).catch(() => undefined);

          return approvedInvoice;
        }),
      createCreditInvoiceDraft: (input) =>
        createCreditInvoiceDraft(input, {
          approvedInvoiceReader,
          invoiceCreditDraftRepository,
          invoiceDraftRepository,
        }),
      getCreditInvoiceDraft: (input) =>
        getCreditInvoiceDraft(input, {
          approvedInvoiceReader,
          invoiceCreditDraftRepository,
          invoiceDraftRepository,
        }),
      updateCreditInvoiceDraft: (input) =>
        updateCreditInvoiceDraft(input, {
          approvedInvoiceReader,
          invoiceCreditDraftRepository,
          invoiceDraftRepository,
        }),
    }),
  );

  routes.route(
    '/',
    createApprovedInvoiceRoutes({
      cancelApprovedInvoice: (input) =>
        cancelApprovedInvoice(input, { invoiceCorrectionRepository }),
      copyApprovedInvoiceToDraft: (input) =>
        copyApprovedInvoiceToDraft(input, {
          approvedInvoiceReader,
          customerAccessReader: options.customerAccessReader,
          invoiceDraftRepository,
        }),
      generateApprovedInvoicePdfDocument: ensureApprovedInvoicePdfDocument,
      getApprovedInvoice: (input) =>
        getApprovedInvoice(input, approvedInvoiceReader),
      getInvoiceCreditContext: (input) =>
        getInvoiceCreditContext(input, invoiceCreditContextReader),
      getApprovedInvoicePdfDocument,
      getApprovedInvoicePdfMetadata: (input) =>
        getApprovedInvoicePdfMetadata(input, {
          invoiceDocumentRepository,
          invoiceDocumentStorage,
        }),
      listApprovedInvoices: (input) =>
        listApprovedInvoices(input, approvedInvoiceReader),
      listSentInvoiceGroups: (input) =>
        listSentInvoiceGroups(input, sentInvoiceGroupReader),
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
      prepareApprovedInvoiceEmailSmtp: async (input) => {
        try {
          return await prepareApprovedInvoiceEmailSmtp(input, {
            approvedInvoiceReader,
            ensureApprovedInvoicePdfDocument,
            invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
            invoiceEmailSendAttemptStore,
            invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          });
        } catch (error) {
          options.operationalLogger.write(
            createBackendOperationalEvent(
              {
                companyId: input.actorContext.companyId,
                entityId: input.invoiceId,
                entityType: 'approvedInvoice',
                errorCode: 'INVOICE_DELIVERY_PREPARE_BLOCKED',
                eventName: 'invoiceDelivery.prepareBlocked',
                retryable: false,
                sideEffectState: 'none',
                stage: 'prepare',
              },
              options.operationalIdentity,
            ),
          );
          throw error;
        }
      },
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
      sendApprovedInvoiceEmailSmtp: async (input) => {
        try {
          return await sendApprovedInvoiceEmailSmtp(input, {
            approvedInvoiceReader,
            ensureApprovedInvoicePdfDocument,
            getApprovedInvoicePdfDocument,
            invoiceDeliveryEventRepository,
            invoiceEmailDeliveryFinalizer: invoiceDeliveryEventRepository,
            invoiceEmailSendAttemptStore,
            invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
            invoiceSmtpDeliveryProvider,
          });
        } catch (error) {
          const outcomeUnknown =
            error instanceof ApprovedInvoiceEmailDeliveryOutcomeUnknownError;
          options.operationalLogger.write(
            createBackendOperationalEvent(
              {
                companyId: input.actorContext.companyId,
                entityId: input.invoiceId,
                entityType: 'approvedInvoice',
                errorCode: outcomeUnknown
                  ? 'INVOICE_DELIVERY_OUTCOME_UNKNOWN'
                  : 'INVOICE_DELIVERY_PROVIDER_FAILED',
                eventName: outcomeUnknown
                  ? 'invoiceDelivery.outcomeUnknown'
                  : 'invoiceDelivery.providerFailed',
                operationId: input.attemptId,
                retryable: !outcomeUnknown,
                sideEffectState: outcomeUnknown ? 'unknown' : 'rolledBack',
                stage: 'smtp',
              },
              options.operationalIdentity,
            ),
          );
          throw error;
        }
      },
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
        logInvoiceSettingsAuditWriteFailure(
          () =>
            updateInvoiceNumberingSettings(
              input,
              invoiceNumberingRepository,
            ),
          options,
        ),
    }),
  );

  routes.route(
    '/',
    createInvoicePaymentSettingsRoutes({
      getInvoicePaymentSettings: (input) =>
        getInvoicePaymentSettings(input, invoicePaymentSettingsRepository),
      updateInvoicePaymentSettings: (input) =>
        logInvoiceSettingsAuditWriteFailure(
          () =>
            updateInvoicePaymentSettings(
              input,
              invoicePaymentSettingsRepository,
            ),
          options,
        ),
    }),
  );

  routes.route(
    '/',
    createInvoiceVatRatesRoutes({
      getInvoiceVatRates: (input) =>
        getInvoiceVatRates(input, invoiceVatRateRepository),
      updateInvoiceVatRates: (input) =>
        logInvoiceSettingsAuditWriteFailure(
          () => updateInvoiceVatRates(input, invoiceVatRateRepository),
          options,
        ),
    }),
  );

  return {
    invoiceActivityReader,
    routes,
  };
}

async function logInvoiceSettingsAuditWriteFailure<T>(
  operation: () => Promise<T>,
  options: Pick<
    InvoicingCompositionOptions,
    'operationalIdentity' | 'operationalLogger'
  >,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InvoiceSettingsAuditWriteError) {
      try {
        options.operationalLogger.write(
          createBackendOperationalEvent(
            {
              entityType: 'invoiceSettings',
              errorCode: 'INVOICE_SETTINGS_AUDIT_WRITE_FAILED',
              eventName: 'businessAudit.writeFailed',
              sideEffectState: 'rolledBack',
              stage: 'invoiceSettingsMutation',
            },
            options.operationalIdentity,
          ),
        );
      } catch {
        // Operational logging must not replace the original safe audit error.
      }
    }

    throw error;
  }
}

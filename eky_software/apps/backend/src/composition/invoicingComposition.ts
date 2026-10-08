import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { DryRunInvoiceEmailDeliveryProvider } from '../infrastructure/email/dryRunInvoiceEmailDeliveryProvider.js';
import { DnaInvoiceSmtpDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpDeliveryProvider.js';
import { DnaInvoiceSmtpTestDeliveryProvider } from '../infrastructure/email/providers/dna/dnaInvoiceSmtpTestDeliveryProvider.js';
import { DnaSmtpEmailDeliveryProvider } from '../infrastructure/email/providers/dna/dnaSmtpEmailDeliveryProvider.js';
import { createDnaSmtpOperationalDiagnostics } from '../infrastructure/email/providers/dna/dnaSmtpOperationalDiagnostics.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import { approveCreditInvoiceDraft } from '../modules/invoicing/application/approveCreditInvoiceDraft.js';
import { approveInvoiceDraft } from '../modules/invoicing/application/approveInvoiceDraft.js';
import { activateInvoiceNumberingSeries } from '../modules/invoicing/application/activateInvoiceNumberingSeries.js';
import { cancelApprovedInvoice } from '../modules/invoicing/application/cancelApprovedInvoice.js';
import { createCreditInvoiceDraft } from '../modules/invoicing/application/createCreditInvoiceDraft.js';
import { copyApprovedInvoiceToDraft } from '../modules/invoicing/application/copyApprovedInvoiceToDraft.js';
import { deleteInvoiceDraft } from '../modules/invoicing/application/deleteInvoiceDraft.js';
import {
  generateApprovedInvoicePdfDocument,
  generateInvoiceRevisionPdfDocument,
  type GenerateApprovedInvoicePdfDocumentInput,
  type GenerateInvoiceRevisionPdfDocumentInput,
} from '../modules/invoicing/application/generateApprovedInvoicePdfDocument.js';
import { InvoiceDocumentPublicationConflictError } from '../modules/invoicing/application/invoiceDocumentPublicationConflictError.js';
import { InvoiceDocumentIntegrityError } from '../modules/invoicing/application/invoiceDocumentIntegrityError.js';
import type { InvoiceScope } from '../modules/invoicing/domain/invoiceContentRevision.js';
import { getApprovedInvoice } from '../modules/invoicing/application/getApprovedInvoice.js';
import {
  getApprovedInvoicePdfDocument as readApprovedInvoicePdfDocument,
  type GetApprovedInvoicePdfDocumentInput,
} from '../modules/invoicing/application/getApprovedInvoicePdfDocument.js';
import { getApprovedInvoicePdfMetadata } from '../modules/invoicing/application/getApprovedInvoicePdfMetadata.js';
import { readPreservedLegacyInvoiceDocument } from '../modules/invoicing/application/readPreservedLegacyInvoiceDocument.js';
import { getInvoiceDraft } from '../modules/invoicing/application/getInvoiceDraft.js';
import { getInvoiceDraftDeliveryHistory } from '../modules/invoicing/application/getInvoiceDraftDeliveryHistory.js';
import { getInvoiceIssuanceReadiness } from '../modules/invoicing/application/getInvoiceIssuanceReadiness.js';
import { getCreditInvoiceDraft } from '../modules/invoicing/application/getCreditInvoiceDraft.js';
import { getInvoiceCreditContext } from '../modules/invoicing/application/getInvoiceCreditContext.js';
import { getInvoiceNumberingSettings } from '../modules/invoicing/application/getInvoiceNumberingSettings.js';
import { getInvoiceNumberingSeriesOverview } from '../modules/invoicing/application/getInvoiceNumberingSeriesOverview.js';
import { getInvoicePaymentSettings } from '../modules/invoicing/application/getInvoicePaymentSettings.js';
import { getInvoiceVatRates } from '../modules/invoicing/application/getInvoiceVatRates.js';
import { listApprovedInvoices } from '../modules/invoicing/application/listApprovedInvoices.js';
import { listSentInvoiceGroups } from '../modules/invoicing/application/listSentInvoiceGroups.js';
import { listInvoiceDeliveryEvents } from '../modules/invoicing/application/listInvoiceDeliveryEvents.js';
import { getInvoiceDeliveryEventPdf } from '../modules/invoicing/application/getInvoiceDeliveryEventPdf.js';
import { createInvoiceDeliveryHistoryRoutes } from '../modules/invoicing/http/invoiceDeliveryHistoryRoutes.js';
import { listInvoiceDrafts } from '../modules/invoicing/application/listInvoiceDrafts.js';
import { markApprovedInvoiceSent } from '../modules/invoicing/application/markApprovedInvoiceSent.js';
import { markInvoicePaid } from '../modules/invoicing/application/markInvoicePaid.js';
import { prepareApprovedInvoiceEmailDryRun } from '../modules/invoicing/application/prepareApprovedInvoiceEmailDryRun.js';
import { preparePreservedLegacyInvoiceDocument } from '../modules/invoicing/application/preparePreservedLegacyInvoiceDocument.js';
import { prepareApprovedInvoiceEmailSmtp } from '../modules/invoicing/application/prepareApprovedInvoiceEmailSmtp.js';
import { loadInvoiceEmailDeliveryDocument as loadEmailDocument } from '../modules/invoicing/application/loadInvoiceEmailDeliveryDocument.js';
import { loadCustomerInvoiceEmailDocument as loadCustomerEmailDocument, type LoadCustomerInvoiceEmailDocumentInput } from '../modules/invoicing/application/loadCustomerInvoiceEmailDocument.js';
import { readStoredInvoiceDocument } from '../modules/invoicing/application/readStoredInvoiceDocument.js';
import { InvoiceEmailDeliveryCommittedError } from '../modules/invoicing/application/invoiceEmailDeliveryCommittedError.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../modules/invoicing/domain/invoiceLegacyDeliveryReviewRequiredError.js';
import { prepareApprovedInvoiceEmailSmtpTest } from '../modules/invoicing/application/prepareApprovedInvoiceEmailSmtpTest.js';
import { previewInvoiceNumberingSeriesActivation } from '../modules/invoicing/application/previewInvoiceNumberingSeriesActivation.js';
import { reopenApprovedInvoiceForEditing } from '../modules/invoicing/application/reopenApprovedInvoiceForEditing.js';
import { revertInvoicePaidMark } from '../modules/invoicing/application/revertInvoicePaidMark.js';
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
import { createPreservedLegacyInvoiceDocumentRoutes } from '../modules/invoicing/http/preservedLegacyInvoiceDocumentRoutes.js';
import { createInvoiceDraftRoutes } from '../modules/invoicing/http/invoiceDraftRoutes.js';
import { createInvoiceDraftDeliveryHistoryRoutes } from '../modules/invoicing/http/invoiceDraftDeliveryHistoryRoutes.js';
import { createCreditInvoiceDraftRoutes } from '../modules/invoicing/http/creditInvoiceDraftRoutes.js';
import { createInvoiceNumberingSettingsRoutes } from '../modules/invoicing/http/invoiceNumberingSettingsRoutes.js';
import { createInvoiceNumberingSeriesRoutes } from '../modules/invoicing/http/invoiceNumberingSeriesRoutes.js';
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
import { SqliteInvoiceDocumentPreviewReader } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPreviewReader.js';
import { SqliteInvoiceContentRevisionReader } from '../modules/invoicing/infrastructure/sqliteInvoiceContentRevisionReader.js';
import { SqliteInvoiceLegacyRevisionPromoter } from '../modules/invoicing/infrastructure/sqliteInvoiceLegacyRevisionPromoter.js';
import { SqliteInvoiceLegacyResendReader } from '../modules/invoicing/infrastructure/sqliteInvoiceLegacyResendReader.js';
import { SqliteInvoiceDraftRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.js';
import { SqliteInvoiceDraftDeliveryHistoryReader } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftDeliveryHistoryReader.js';
import { SqliteInvoiceIssuanceReadinessReader } from '../modules/invoicing/infrastructure/sqliteInvoiceIssuanceReadinessReader.js';
import { SqliteInvoiceActivityReader } from '../modules/invoicing/infrastructure/sqliteInvoiceActivityReader.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import type { InvoiceBackupArtifactCatalogSchema } from '../modules/invoicing/infrastructure/selectInvoiceBackupArtifactCatalogSchema.js';
import { SqliteInvoiceNumberingRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceNumberingRepository.js';
import { SqliteInvoiceNumberingSeriesRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceNumberingSeriesRepository.js';
import { SqliteInvoicePaymentSettingsRepository } from '../modules/invoicing/infrastructure/sqliteInvoicePaymentSettingsRepository.js';
import { SqliteInvoicePaymentRepository } from '../modules/invoicing/infrastructure/sqliteInvoicePaymentRepository.js';
import { SqliteInvoiceVatRateRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceVatRateRepository.js';
import { SqliteSentInvoiceGroupReader } from '../modules/invoicing/infrastructure/sqliteSentInvoiceGroupReader.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../modules/invoicing/ports/deliveredInvoiceArchiveTaskSink.js';
import type { InvoiceCustomerTaxProfileReader } from '../modules/invoicing/ports/invoiceCustomerTaxProfileReader.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';
import type { InvoiceActivityReader } from '../modules/invoicing/ports/invoiceActivityReader.js';
import type { InvoiceBackupArtifactCatalog } from '../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';
import type { InvoiceDocumentStorage } from '../modules/invoicing/ports/invoiceDocumentStorage.js';
import type { InvoiceEmailDeliveryProvider } from '../modules/invoicing/ports/invoiceEmailDeliveryProvider.js';
import type { InvoiceSmtpDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import type { InvoiceSmtpTestDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import { InvoiceSettingsAuditWriteError } from '../modules/invoicing/ports/invoiceSettingsAuditWriteError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from '../modules/invoicing/application/approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';

export interface InvoicingInfrastructureAdapters {
  invoiceDocumentStorage?: InvoiceDocumentStorage;
  invoiceEmailDeliveryProvider?: InvoiceEmailDeliveryProvider;
  invoiceSmtpDeliveryProvider?: InvoiceSmtpDeliveryProvider;
  invoiceSmtpTestDeliveryProvider?: InvoiceSmtpTestDeliveryProvider;
}

interface InvoicingCompositionOptions {
  schema: InvoiceBackupArtifactCatalogSchema;
  companyEmailSecretReader: CompanyEmailSecretReader;
  customerAccessReader: CustomerAccessReader;
  deliveredInvoiceArchiveTaskSink: DeliveredInvoiceArchiveTaskSink;
  invoiceCustomerTaxProfileReader: InvoiceCustomerTaxProfileReader;
  database: DatabaseConnection;
  infrastructureAdapters?: InvoicingInfrastructureAdapters;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceDocumentStorageRoot?: string;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}

interface InvoicingComposition {
  invoiceActivityReader: InvoiceActivityReader;
  invoiceBackupArtifactCatalog: InvoiceBackupArtifactCatalog;
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
  const invoiceDraftDeliveryHistoryReader = new SqliteInvoiceDraftDeliveryHistoryReader(options.database);
  const invoiceIssuanceReadinessReader =
    new SqliteInvoiceIssuanceReadinessReader(options.database);
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
  const invoiceBackupArtifactCatalog =
    new SqliteInvoiceBackupArtifactCatalog(options.database, options.schema);
  const invoiceDeliveryEventRepository =
    new SqliteInvoiceDeliveryEventRepository(options.database);
  const invoiceDocumentStorage =
    options.infrastructureAdapters?.invoiceDocumentStorage ??
    (options.invoiceDocumentStorageRoot === undefined
      ? new LocalInvoiceDocumentStorage()
      : new LocalInvoiceDocumentStorage(options.invoiceDocumentStorageRoot));
  const approvedInvoiceReader = new SqliteApprovedInvoiceReader(options.database);
  const invoiceContentRevisionReader = new SqliteInvoiceContentRevisionReader(options.database);
  const invoiceLegacyRevisionPromoter = new SqliteInvoiceLegacyRevisionPromoter(options.database);
  const invoiceLegacyResendReader = new SqliteInvoiceLegacyResendReader(options.database);
  const invoiceCreditContextReader = new SqliteInvoiceCreditContextReader(
    options.database,
  );
  const sentInvoiceGroupReader = new SqliteSentInvoiceGroupReader(
    options.database,
  );
  const invoiceNumberingRepository = new SqliteInvoiceNumberingRepository(
    options.database,
  );
  const invoiceNumberingSeriesRepository =
    new SqliteInvoiceNumberingSeriesRepository(options.database);
  const invoicePaymentSettingsRepository =
    new SqliteInvoicePaymentSettingsRepository(options.database);
  const invoicePaymentRepository = new SqliteInvoicePaymentRepository(
    options.database,
  );
  const invoiceVatRateRepository = new SqliteInvoiceVatRateRepository(
    options.database,
  );
  const invoiceEmailDeliveryProvider =
    options.infrastructureAdapters?.invoiceEmailDeliveryProvider ??
    new DryRunInvoiceEmailDeliveryProvider();
  const invoiceEmailSendAttemptStore = new InMemoryInvoiceEmailSendAttemptStore();
  const deliveredInvoiceArchiveQueueFailureReporter = {
    reportQueueFailure() {
      options.operationalLogger.write(
        createBackendOperationalEvent(
          {
            errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
            eventName: 'invoicePdfArchive.queueFailed',
            retryable: true,
            sideEffectState: 'none',
            stage: 'queue',
          },
          options.operationalIdentity,
        ),
      );
    },
  };
  const dnaSmtpEmailDeliveryProvider = new DnaSmtpEmailDeliveryProvider({
    companyEmailSecretReader: options.companyEmailSecretReader,
    transportDiagnostics: createDnaSmtpOperationalDiagnostics({
      operationalIdentity: options.operationalIdentity,
      operationalLogger: options.operationalLogger,
    }),
  });
  const invoiceSmtpTestDeliveryProvider =
    options.infrastructureAdapters?.invoiceSmtpTestDeliveryProvider ??
    new DnaInvoiceSmtpTestDeliveryProvider(dnaSmtpEmailDeliveryProvider);
  const invoiceSmtpDeliveryProvider =
    options.infrastructureAdapters?.invoiceSmtpDeliveryProvider ??
    new DnaInvoiceSmtpDeliveryProvider(dnaSmtpEmailDeliveryProvider);
  const pdfDependencies = {
    invoiceContentRevisionReader, invoiceLegacyRevisionPromoter, invoiceDocumentRepository,
    invoiceDocumentStorage, renderApprovedInvoicePdf,
  };
  const pdfReadDependencies = {
    invoiceDocumentPreviewReader: new SqliteInvoiceDocumentPreviewReader(options.database),
    invoiceDocumentRepository,
    invoiceDocumentStorage,
  };
  const reportPdfGenerationFailure = (input: InvoiceScope, error: unknown): never => {
    const stages = error instanceof InvoiceDocumentPublicationConflictError && error.candidateCleanupFailed
      ? ['generate', 'cleanup'] : ['generate'];
    for (const stage of stages) {
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
            stage,
          },
          options.operationalIdentity,
        ),
      );
    }
    throw error;
  };
  const ensureApprovedInvoicePdfDocument = (input: GenerateApprovedInvoicePdfDocumentInput) =>
    generateApprovedInvoicePdfDocument(input, pdfDependencies)
      .catch((error: unknown) => reportPdfGenerationFailure(input, error));
  const ensureInvoiceRevisionPdfDocument = (input: GenerateInvoiceRevisionPdfDocumentInput) =>
    generateInvoiceRevisionPdfDocument(input, pdfDependencies)
      .catch((error: unknown) => reportPdfGenerationFailure(input.key, error));
  const getApprovedInvoicePdfDocument = (
    input: GetApprovedInvoicePdfDocumentInput,
  ) =>
    readApprovedInvoicePdfDocument(input, pdfReadDependencies)
      .catch((error: unknown) => reportPdfStorageFailure(input, error));
  const loadInvoiceEmailDeliveryDocument = (input: GenerateApprovedInvoicePdfDocumentInput) =>
    loadEmailDocument(input, {
      ensureApprovedInvoicePdfDocument,
      readStoredInvoiceDocument: (key) => readStoredInvoiceDocument(key, { invoiceDocumentRepository, invoiceDocumentStorage }),
    }).catch((error: unknown) => reportPdfStorageFailure(input, error));
  const loadCustomerInvoiceEmailDocument = (input: LoadCustomerInvoiceEmailDocumentInput) =>
    loadCustomerEmailDocument(input, {
      approvedInvoiceReader,
      invoiceContentRevisionReader,
      loadInvoiceEmailDeliveryDocument: (documentInput) => loadEmailDocument(documentInput, {
        ensureApprovedInvoicePdfDocument,
        readStoredInvoiceDocument: (key) => readStoredInvoiceDocument(key, { invoiceDocumentRepository, invoiceDocumentStorage }),
      }),
      readPreservedLegacyInvoiceDocument: (documentInput) => readPreservedLegacyInvoiceDocument(documentInput, {
        invoiceLegacyResendReader, invoiceDocumentStorage,
      }),
    }).catch((error: unknown) => reportPdfStorageFailure({
      companyId: input.actorContext.companyId, invoiceId: input.invoiceId,
    }, error));
  const reportPdfStorageFailure = (
    input: InvoiceScope, error: unknown, sideEffectState: 'none' | 'unknown' = 'none',
  ): never => {
    const cleanupFailed = error instanceof InvoiceDocumentPublicationConflictError && error.candidateCleanupFailed;
    if (error instanceof InvoiceDocumentIntegrityError || cleanupFailed) {
      try {
        options.operationalLogger.write(createBackendOperationalEvent({
          companyId: input.companyId,
          entityId: input.invoiceId,
          entityType: 'approvedInvoice',
          errorCode: cleanupFailed ? 'INVOICE_PDF_CLEANUP_FAILED' : 'INVOICE_PDF_INTEGRITY_FAILED',
          eventName: 'invoicePdf.storageFailed',
          retryable: false,
          sideEffectState: cleanupFailed ? 'unknown' : sideEffectState,
          stage: cleanupFailed ? 'cleanup' : 'read',
        }, options.operationalIdentity));
      } catch {
        // Diagnostic failure must not replace the original storage failure.
      }
    }
    throw error;
  };

  const reportLegacyDeliveryReview = (error: unknown): never => {
    if (error instanceof InvoiceLegacyDeliveryReviewRequiredError) {
      try {
        options.operationalLogger.write(createBackendOperationalEvent({
          eventName: 'invoiceDelivery.prepareBlocked',
          errorCode: error.code,
          retryable: false,
          sideEffectState: 'none',
          stage: 'prepare',
        }, options.operationalIdentity));
      } catch {
        // Keep the review requirement even when diagnostic delivery fails.
      }
    }
    throw error;
  };

  routes.route('/', createInvoiceDraftDeliveryHistoryRoutes({
    getInvoiceDraftDeliveryHistory: (input) => getInvoiceDraftDeliveryHistory(input, {
      invoiceDraftDeliveryHistoryReader,
    }),
    reportReadFailure: (errorCode, correlationId) => {
      options.operationalLogger.write(createBackendOperationalEvent({
        eventName: 'http.requestFailed',
        operationId: 'invoiceDraft.deliveryHistory',
        errorCode,
        stage: 'read',
        retryable: false,
        sideEffectState: 'none',
        ...(correlationId === undefined ? {} : { correlationId }),
      }, options.operationalIdentity));
    },
  }));

  routes.route(
    '/',
    createInvoiceDraftRoutes({
      approveInvoiceDraft: (input) =>
        approveInvoiceDraft(input, { invoiceApprovalRepository }).then(
          async (approvedInvoice) => {
            await ensureInvoiceRevisionPdfDocument({
              key: approvedInvoice.revisionKey,
              createdAt: new Date().toISOString(),
            }).catch(() => undefined);

            return approvedInvoice;
          },
        ),
      deleteInvoiceDraft: (input) =>
        deleteInvoiceDraft(input, invoiceDraftRepository),
      getInvoiceDraft: (input) => getInvoiceDraft(input, invoiceDraftRepository),
      getInvoiceIssuanceReadiness: (input) =>
        getInvoiceIssuanceReadiness(input, invoiceIssuanceReadinessReader),
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
          await ensureInvoiceRevisionPdfDocument({
            key: approvedInvoice.revisionKey,
            createdAt: new Date().toISOString(),
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

  routes.route('/', createPreservedLegacyInvoiceDocumentRoutes({
    readPreservedLegacyInvoiceDocument: (input) => readPreservedLegacyInvoiceDocument(input, {
      invoiceLegacyResendReader, invoiceDocumentStorage,
    }).catch((error: unknown) => reportPdfStorageFailure({
      companyId: input.actorContext.companyId, invoiceId: input.invoiceId,
    }, error)),
  }));

  routes.route('/', createInvoiceDeliveryHistoryRoutes({
    getInvoiceDeliveryEventPdf: (input) => getInvoiceDeliveryEventPdf(input, {
      invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
      invoiceDocumentStorage,
    }).catch((error: unknown) => reportPdfStorageFailure({
      companyId: input.actorContext.companyId, invoiceId: input.invoiceId,
    }, error)),
  }));

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
        getApprovedInvoicePdfMetadata(input, pdfReadDependencies)
          .catch((error: unknown) => reportPdfStorageFailure(input, error)),
      listApprovedInvoices: (input) =>
        listApprovedInvoices(input, approvedInvoiceReader),
      listSentInvoiceGroups: (input) =>
        listSentInvoiceGroups(input, sentInvoiceGroupReader),
      listInvoiceDeliveryEvents: (input) =>
        listInvoiceDeliveryEvents(input, {
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
        }),
      markApprovedInvoiceSent: (input) =>
        markApprovedInvoiceSent(input, {
          approvedInvoiceReader,
          invoiceContentRevisionReader,
          deliveredInvoiceArchiveQueueFailureReporter,
          deliveredInvoiceArchiveTaskSink:
            options.deliveredInvoiceArchiveTaskSink,
          invoiceLegacyRevisionPromoter,
          ensureInvoiceRevisionPdfDocument,
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          invoiceManualDeliveryFinalizer: invoiceDeliveryEventRepository,
        }).catch(reportLegacyDeliveryReview),
      markInvoicePaid: (input) =>
        markInvoicePaid(input, {
          clock: { now: () => new Date() },
          invoicePaymentRepository,
        }),
      prepareApprovedInvoiceEmailDryRun: (input) =>
        prepareApprovedInvoiceEmailDryRun(input, {
          preparePreservedLegacyInvoiceDocument: (documentInput) =>
            preparePreservedLegacyInvoiceDocument(documentInput, {
              invoiceLegacyResendReader, invoiceDocumentRepository, invoiceDocumentStorage,
            }).then(({ content, metadata }) => {
              content.fill(0);
              return metadata;
            }).catch((error: unknown) => reportPdfStorageFailure({
              companyId: documentInput.actorContext.companyId, invoiceId: documentInput.invoiceId,
            }, error, 'unknown')),
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          approvedInvoiceReader,
          invoiceContentRevisionReader,
          invoiceLegacyRevisionPromoter,
          ensureInvoiceRevisionPdfDocument,
          invoiceEmailDeliveryProvider,
        }).catch(reportLegacyDeliveryReview),
      prepareApprovedInvoiceEmailSmtpTest: (input) =>
        prepareApprovedInvoiceEmailSmtpTest(input, {
          approvedInvoiceReader,
          loadInvoiceEmailDeliveryDocument,
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          invoiceEmailSendAttemptStore,
        }).catch(reportLegacyDeliveryReview),
      prepareApprovedInvoiceEmailSmtp: async (input) => {
        try {
          return await prepareApprovedInvoiceEmailSmtp(input, {
            approvedInvoiceReader,
            loadCustomerInvoiceEmailDocument,
            invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
            invoiceEmailSendAttemptStore,
            invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          });
        } catch (error) {
          if (error instanceof InvoiceLegacyDeliveryReviewRequiredError) reportLegacyDeliveryReview(error);
          try { options.operationalLogger.write(
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
          ); } catch { /* Diagnostics must not replace the preparation failure. */ }
          throw error;
        }
      },
      sendApprovedInvoiceEmailDryRun: (input) =>
        sendApprovedInvoiceEmailDryRun(input, {
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          approvedInvoiceReader,
          invoiceContentRevisionReader,
          invoiceLegacyRevisionPromoter,
          ensureInvoiceRevisionPdfDocument,
          invoiceDeliveryEventRepository,
          invoiceEmailDeliveryProvider,
        }).catch(reportLegacyDeliveryReview),
      sendApprovedInvoiceEmailSmtpTest: (input) =>
        sendApprovedInvoiceEmailSmtpTest(input, {
          invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
          approvedInvoiceReader,
          loadInvoiceEmailDeliveryDocument,
          invoiceDeliveryEventRepository,
          invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
          invoiceEmailSendAttemptStore,
          invoiceSmtpTestDeliveryProvider,
        }).catch(reportLegacyDeliveryReview),
      sendApprovedInvoiceEmailSmtp: async (input) => {
        try {
          return await sendApprovedInvoiceEmailSmtp(input, {
            invoiceDeliveryEventReader: invoiceDeliveryEventRepository,
            approvedInvoiceReader,
            deliveredInvoiceArchiveQueueFailureReporter,
            deliveredInvoiceArchiveTaskSink:
              options.deliveredInvoiceArchiveTaskSink,
            loadCustomerInvoiceEmailDocument,
            invoiceDeliveryEventRepository,
            invoiceEmailDeliveryFinalizer: invoiceDeliveryEventRepository,
            invoiceEmailSendAttemptStore,
            invoiceEmailSettingsReader: options.invoiceEmailSettingsReader,
            invoiceSmtpDeliveryProvider,
          });
        } catch (error) {
          if (error instanceof InvoiceLegacyDeliveryReviewRequiredError) reportLegacyDeliveryReview(error);
          // Document failures precede the provider and retain their owning diagnosis.
          if (error instanceof InvoiceDocumentPublicationConflictError || error instanceof InvoiceDocumentIntegrityError) throw error;
          const outcomeUnknown =
            error instanceof ApprovedInvoiceEmailDeliveryOutcomeUnknownError;
          const committed = error instanceof InvoiceEmailDeliveryCommittedError;
          try { options.operationalLogger.write(
            createBackendOperationalEvent(
              {
                companyId: input.actorContext.companyId,
                entityId: input.invoiceId,
                entityType: 'approvedInvoice',
                errorCode: committed ? 'INVOICE_DELIVERY_COMMITTED_READ_FAILED' : outcomeUnknown
                  ? 'INVOICE_DELIVERY_OUTCOME_UNKNOWN'
                  : 'INVOICE_DELIVERY_PROVIDER_FAILED',
                eventName: committed ? 'invoiceDelivery.finalizationFailed' : outcomeUnknown
                  ? 'invoiceDelivery.outcomeUnknown'
                  : 'invoiceDelivery.providerFailed',
                operationId: input.attemptId,
                retryable: !committed && !outcomeUnknown,
                sideEffectState: committed ? 'committed' : outcomeUnknown ? 'unknown' : 'rolledBack',
                stage: committed ? 'read' : 'smtp',
              },
              options.operationalIdentity,
            ),
          ); } catch { /* Diagnostics must not replace the delivery outcome. */ }
          throw error;
        }
      },
      reopenApprovedInvoiceForEditing: (input) =>
        reopenApprovedInvoiceForEditing(input, {
          invoiceApprovalRepository,
        }).catch(reportLegacyDeliveryReview),
      revertInvoicePaidMark: (input) =>
        revertInvoicePaidMark(input, {
          clock: { now: () => new Date() },
          invoicePaymentRepository,
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
    createInvoiceNumberingSeriesRoutes({
      activateInvoiceNumberingSeries: (input) =>
        activateInvoiceNumberingSeries(input, {
          createEventId: randomUUID,
          createSeriesKey: () => `series-${randomUUID()}`,
          repository: invoiceNumberingSeriesRepository,
        }),
      getInvoiceNumberingSeriesOverview: (input) =>
        getInvoiceNumberingSeriesOverview(
          input,
          invoiceNumberingSeriesRepository,
        ),
      previewInvoiceNumberingSeriesActivation: (input) =>
        previewInvoiceNumberingSeriesActivation(
          input,
          invoiceNumberingSeriesRepository,
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
    invoiceBackupArtifactCatalog,
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

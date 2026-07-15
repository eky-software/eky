import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { completeInvoiceDeliveryEvent } from './completeInvoiceDeliveryEvent.js';
import {
  normalizeApprovedInvoiceEmailSendFields,
} from './approvedInvoiceEmailSendValidation.js';
import type {
  ApprovedInvoicePdfDocumentFile,
  GetApprovedInvoicePdfDocumentInput,
} from './getApprovedInvoicePdfDocument.js';
import type {
  GenerateApprovedInvoicePdfDocumentInput,
} from './generateApprovedInvoicePdfDocument.js';
import { recordInvoiceDeliveryEvent } from './recordInvoiceDeliveryEvent.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import type { InvoiceEmailSettingsReader } from '../ports/invoiceEmailSettingsReader.js';
import {
  InvoiceSmtpTestDeliveryError,
  type InvoiceSmtpTestDeliveryProvider,
} from '../ports/invoiceSmtpTestDeliveryProvider.js';

export interface SendApprovedInvoiceEmailSmtpTestInput {
  actorContext: ActorContext;
  body: string;
  cc?: string;
  invoiceId: string;
  sentAt: string;
  subject: string;
  to: string;
}

export interface SendApprovedInvoiceEmailSmtpTestResult {
  deliveredTo: string;
  deliveryEventId: string;
  provider: 'smtp';
  providerMessageId: string | null;
  testMode: true;
}

export interface SendApprovedInvoiceEmailSmtpTestDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoicePdfDocument(
    input: GetApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoicePdfDocumentFile>;
  invoiceDeliveryEventRepository: InvoiceDeliveryEventRepository;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceSmtpTestDeliveryProvider: InvoiceSmtpTestDeliveryProvider;
}

export async function sendApprovedInvoiceEmailSmtpTest(
  input: SendApprovedInvoiceEmailSmtpTestInput,
  dependencies: SendApprovedInvoiceEmailSmtpTestDependencies,
): Promise<SendApprovedInvoiceEmailSmtpTestResult> {
  requirePermission(input.actorContext, 'sendInvoices');

  const companyId = requireIdentifier(
    input.actorContext.companyId,
    'Company id',
  );
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const actorUserId = requireIdentifier(
    input.actorContext.actorId,
    'Actor user id',
  );
  const sentAt = requireIdentifier(input.sentAt, 'Email delivery timestamp');
  const emailFields = normalizeApprovedInvoiceEmailSendFields(input);
  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  const settings = await dependencies.invoiceEmailSettingsReader.getEmailSettings(
    companyId,
  );

  if (settings === null) {
    throw new ApprovedInvoiceEmailDeliveryError(
      'Invoice email settings are not configured.',
    );
  }

  const testRecipient = normalizeApprovedInvoiceEmailSendFields({
    body: emailFields.body,
    subject: emailFields.subject,
    to: settings.emailTestRecipientOverride,
  }).to;
  const document = await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: sentAt,
    invoiceId,
  });
  const pdfDocument = await dependencies.getApprovedInvoicePdfDocument({
    companyId,
    invoiceId,
  });
  const deliveryEvent = await recordInvoiceDeliveryEvent(
    {
      body: emailFields.body,
      ccEmail: '',
      companyId,
      createdAt: sentAt,
      createdBy: actorUserId,
      deliveryMethod: 'email',
      documentId: document.id,
      invoiceId,
      provider: 'smtp',
      recipientEmail: testRecipient,
      status: 'attempted',
      subject: emailFields.subject,
    },
    {
      invoiceDeliveryEventRepository:
        dependencies.invoiceDeliveryEventRepository,
    },
  );

  let providerResult: Awaited<
    ReturnType<InvoiceSmtpTestDeliveryProvider['sendTestEmail']>
  >;

  try {
    providerResult = await dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail({
      ...settings,
      body: emailFields.body,
      cc: emailFields.cc,
      companyId,
      pdfContent: pdfDocument.content,
      pdfFileName: pdfDocument.metadata.fileName,
      requestedTo: emailFields.to,
      subject: emailFields.subject,
    });
  } catch (error) {
    const providerError =
      error instanceof InvoiceSmtpTestDeliveryError
        ? error
        : new InvoiceSmtpTestDeliveryError('failed', null);

    await completeInvoiceDeliveryEvent(
      {
        companyId,
        eventId: deliveryEvent.id,
        safeErrorMessage:
          providerError.outcome === 'outcomeUnknown'
            ? 'Invoice email delivery outcome is unknown.'
            : 'Invoice SMTP test delivery failed.',
        status: providerError.outcome,
        technicalErrorCode: providerError.technicalErrorCode,
      },
      dependencies.invoiceDeliveryEventRepository,
    ).catch(() => undefined);

    if (providerError.outcome === 'outcomeUnknown') {
      throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
    }

    throw new ApprovedInvoiceEmailDeliveryError(
      'Invoice SMTP test delivery failed.',
    );
  } finally {
    pdfDocument.content.fill(0);
  }

  if (
    providerResult.provider !== 'smtp' ||
    providerResult.testMode !== true ||
    providerResult.deliveredTo !== testRecipient
  ) {
    await completeInvoiceDeliveryEvent(
      {
        companyId,
        eventId: deliveryEvent.id,
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
      },
      dependencies.invoiceDeliveryEventRepository,
    ).catch(() => undefined);

    throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
  }

  try {
    await completeInvoiceDeliveryEvent(
      {
        companyId,
        eventId: deliveryEvent.id,
        providerMessageId: providerResult.providerMessageId,
        status: 'succeeded',
      },
      dependencies.invoiceDeliveryEventRepository,
    );
  } catch {
    throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
  }

  return {
    deliveredTo: providerResult.deliveredTo,
    deliveryEventId: deliveryEvent.id,
    provider: providerResult.provider,
    providerMessageId: providerResult.providerMessageId,
    testMode: true,
  };
}

import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import {
  createApprovedInvoiceEmailAttachmentPreview,
  type ApprovedInvoiceEmailDryRunSend,
  type ApprovedInvoiceEmailDryRunProviderResult,
} from './approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  normalizeApprovedInvoiceEmailSendFields,
} from './approvedInvoiceEmailSendValidation.js';
import type {
  GenerateApprovedInvoicePdfDocumentInput,
} from './generateApprovedInvoicePdfDocument.js';
import { recordInvoiceDeliveryEvent } from './recordInvoiceDeliveryEvent.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import type { InvoiceEmailDeliveryProvider } from '../ports/invoiceEmailDeliveryProvider.js';

export interface SendApprovedInvoiceEmailDryRunInput {
  actorContext: ActorContext;
  body: string;
  cc?: string;
  invoiceId: string;
  sentAt: string;
  subject: string;
  to: string;
}

export interface SendApprovedInvoiceEmailDryRunResult {
  deliveryEventId: string;
  email: ApprovedInvoiceEmailDryRunSend;
  providerResult: ApprovedInvoiceEmailDryRunProviderResult;
}

export interface SendApprovedInvoiceEmailDryRunDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  invoiceDeliveryEventRepository: InvoiceDeliveryEventRepository;
  invoiceEmailDeliveryProvider: InvoiceEmailDeliveryProvider;
}

export async function sendApprovedInvoiceEmailDryRun(
  input: SendApprovedInvoiceEmailDryRunInput,
  dependencies: SendApprovedInvoiceEmailDryRunDependencies,
): Promise<SendApprovedInvoiceEmailDryRunResult> {
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

  requireInvoiceDeliveryEligible(invoice);

  const document = await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: sentAt,
    invoiceId,
  });
  const email: ApprovedInvoiceEmailDryRunSend = {
    attachment: createApprovedInvoiceEmailAttachmentPreview(document),
    body: emailFields.body,
    cc: emailFields.cc,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    provider: 'dryRun',
    subject: emailFields.subject,
    to: emailFields.to,
  };

  let providerResult: ApprovedInvoiceEmailDryRunProviderResult;

  try {
    providerResult =
      await dependencies.invoiceEmailDeliveryProvider.sendDryRunEmail(email);
  } catch (error) {
    if (error instanceof ApprovedInvoiceEmailDeliveryError) {
      throw error;
    }

    await recordInvoiceDeliveryEvent(
      {
        body: email.body,
        ccEmail: email.cc,
        companyId,
        createdAt: sentAt,
        createdBy: actorUserId,
        deliveryMethod: 'email',
        documentId: document.id,
        invoiceId,
        provider: 'dryRun',
        recipientEmail: email.to,
        safeErrorMessage: 'Invoice email dry-run failed.',
        status: 'failed',
        subject: email.subject,
        technicalErrorCode: getSafeTechnicalErrorCode(error),
      },
      {
        invoiceDeliveryEventRepository:
          dependencies.invoiceDeliveryEventRepository,
      },
    );

    throw new ApprovedInvoiceEmailDeliveryError(
      'Invoice email dry-run failed.',
    );
  }

  const deliveryEvent = await recordInvoiceDeliveryEvent(
    {
      body: email.body,
      ccEmail: email.cc,
      companyId,
      createdAt: sentAt,
      createdBy: actorUserId,
      deliveryMethod: 'email',
      documentId: document.id,
      invoiceId,
      provider: providerResult.provider,
      providerMessageId: providerResult.providerMessageId,
      recipientEmail: email.to,
      status: 'succeeded',
      subject: email.subject,
    },
    {
      invoiceDeliveryEventRepository:
        dependencies.invoiceDeliveryEventRepository,
    },
  );

  return {
    deliveryEventId: deliveryEvent.id,
    email,
    providerResult,
  };
}

function getSafeTechnicalErrorCode(error: unknown): string | null {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name.slice(0, 120);
  }

  return null;
}

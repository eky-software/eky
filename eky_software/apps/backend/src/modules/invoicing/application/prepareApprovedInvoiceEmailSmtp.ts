import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import { normalizeApprovedInvoiceEmailSendFields } from './approvedInvoiceEmailSendValidation.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';
import type { InvoiceEmailSettingsReader } from '../ports/invoiceEmailSettingsReader.js';

export interface PrepareApprovedInvoiceEmailSmtpInput {
  actorContext: ActorContext;
  body: string;
  cc?: string;
  invoiceId: string;
  preparedAt: string;
  subject: string;
  to: string;
}

export interface ApprovedInvoiceEmailSmtpPreparation {
  attachment: {
    fileName: string;
    sizeBytes: number;
  };
  attemptId: string;
  authorizationToken: string;
  body: string;
  cc: string;
  expiresAt: string;
  invoiceId: string;
  invoiceNumber: string;
  recipient: string;
  resend: boolean;
  sender: string;
  subject: string;
}

export interface PrepareApprovedInvoiceEmailSmtpDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  invoiceEmailSendAttemptStore: InvoiceEmailSendAttemptStore;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceDeliveryEventReader: InvoiceDeliveryEventReader;
}

export async function prepareApprovedInvoiceEmailSmtp(
  input: PrepareApprovedInvoiceEmailSmtpInput,
  dependencies: PrepareApprovedInvoiceEmailSmtpDependencies,
): Promise<ApprovedInvoiceEmailSmtpPreparation> {
  requirePermission(input.actorContext, 'sendInvoices');

  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const actorId = requireIdentifier(input.actorContext.actorId, 'Actor user id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const preparedAt = requireIdentifier(
    input.preparedAt,
    'Email delivery preparation timestamp',
  );
  const emailFields = normalizeApprovedInvoiceEmailSendFields(input);
  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  requireInvoiceDeliveryEligible(invoice);

  if (
    await dependencies.invoiceDeliveryEventReader.hasUnresolvedDeliveryEvent(
      companyId,
      invoiceId,
    )
  ) {
    throw new InvoiceDeliveryConflictError();
  }

  const settings = await dependencies.invoiceEmailSettingsReader.getEmailSettings(
    companyId,
  );

  if (settings === null || settings.emailDeliveryProvider !== 'dnaSmtp') {
    throw new ApprovedInvoiceEmailDeliveryError(
      'Invoice email settings are not configured for DNA SMTP.',
    );
  }

  const document = await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: preparedAt,
    invoiceId,
  });
  const preparedAttempt = dependencies.invoiceEmailSendAttemptStore.prepare({
    actorId,
    companyId,
    invoiceId,
    mode: 'customer',
    provider: 'dnaSmtp',
    recipient: emailFields.to,
    requestFingerprint: createInvoiceEmailSendRequestFingerprint({
      body: emailFields.body,
      cc: emailFields.cc,
      document: {
        fileName: document.fileName,
        id: document.id,
        sha256: document.sha256,
        sizeBytes: document.sizeBytes,
      },
      recipient: emailFields.to,
      sender: {
        address: settings.emailSenderAddress,
        name: settings.emailSenderName,
      },
      subject: emailFields.subject,
      to: emailFields.to,
    }),
  });

  return {
    attachment: {
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
    },
    ...preparedAttempt,
    body: emailFields.body,
    cc: emailFields.cc,
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    recipient: emailFields.to,
    resend: invoice.status === 'sent',
    sender: formatSender(settings.emailSenderName, settings.emailSenderAddress),
    subject: emailFields.subject,
  };
}

function formatSender(name: string, address: string): string {
  const normalizedName = name.trim();
  const normalizedAddress = address.trim();

  return normalizedName.length === 0
    ? normalizedAddress
    : `${normalizedName} <${normalizedAddress}>`;
}

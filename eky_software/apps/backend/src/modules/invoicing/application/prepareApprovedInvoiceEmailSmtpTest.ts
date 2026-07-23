import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import {
  normalizeApprovedInvoiceEmailSendFields,
} from './approvedInvoiceEmailSendValidation.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailSettingsReader } from '../ports/invoiceEmailSettingsReader.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';

export interface PrepareApprovedInvoiceEmailSmtpTestInput {
  actorContext: ActorContext;
  body: string;
  cc?: string;
  invoiceId: string;
  preparedAt: string;
  subject: string;
  to: string;
}

export interface ApprovedInvoiceEmailSmtpTestPreparation {
  attachment: {
    fileName: string;
    sizeBytes: number;
  };
  attemptId: string;
  authorizationToken: string;
  expiresAt: string;
  invoiceId: string;
  subject: string;
  testRecipient: string;
}

export interface PrepareApprovedInvoiceEmailSmtpTestDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceEmailSendAttemptStore: InvoiceEmailSendAttemptStore;
}

export async function prepareApprovedInvoiceEmailSmtpTest(
  input: PrepareApprovedInvoiceEmailSmtpTestInput,
  dependencies: PrepareApprovedInvoiceEmailSmtpTestDependencies,
): Promise<ApprovedInvoiceEmailSmtpTestPreparation> {
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

  const settings = await dependencies.invoiceEmailSettingsReader.getEmailSettings(
    companyId,
  );

  if (settings === null || settings.emailDeliveryProvider !== 'dnaSmtp') {
    throw new ApprovedInvoiceEmailDeliveryError(
      'Invoice email settings are not configured for DNA SMTP.',
    );
  }

  const testRecipient = normalizeApprovedInvoiceEmailSendFields({
    body: emailFields.body,
    subject: emailFields.subject,
    to: settings.emailTestRecipientOverride,
  }).to;
  const document = await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: preparedAt,
    invoiceId,
  });
  const preparedAttempt = dependencies.invoiceEmailSendAttemptStore.prepare({
    actorId,
    companyId,
    invoiceId,
    mode: 'smtpTest',
    provider: 'dnaSmtp',
    recipient: testRecipient,
    requestFingerprint: createInvoiceEmailSendRequestFingerprint({
      body: emailFields.body,
      cc: emailFields.cc,
      document: {
        fileName: document.fileName,
        id: document.id,
        sha256: document.sha256,
        sizeBytes: document.sizeBytes,
      },
      recipient: testRecipient,
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
    invoiceId,
    subject: emailFields.subject,
    testRecipient,
  };
}

import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { completeInvoiceDeliveryEvent } from './completeInvoiceDeliveryEvent.js';
import {
  normalizeApprovedInvoiceEmailSendFields,
} from './approvedInvoiceEmailSendValidation.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
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
import type {
  InvoiceEmailSendAttemptOutcome,
  InvoiceEmailSendAttemptStore,
} from '../ports/invoiceEmailSendAttemptStore.js';
import {
  InvoiceSmtpTestDeliveryError,
  type InvoiceSmtpTestDeliveryProvider,
} from '../ports/invoiceSmtpTestDeliveryProvider.js';

export interface SendApprovedInvoiceEmailSmtpTestInput {
  actorContext: ActorContext;
  attemptId: string;
  authorizationToken: string;
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
  invoiceEmailSendAttemptStore: InvoiceEmailSendAttemptStore;
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
  const attemptId = requireIdentifier(input.attemptId, 'SMTP test attempt id');
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
  dependencies.invoiceEmailSendAttemptStore.acquire({
    actorId: actorUserId,
    attemptId,
    authorizationToken: input.authorizationToken,
    companyId,
    invoiceId,
    mode: 'smtpTest',
    provider: 'dnaSmtp',
    recipient: testRecipient,
    requestFingerprint: createInvoiceEmailSendRequestFingerprint({
      body: emailFields.body,
      cc: emailFields.cc,
      recipient: testRecipient,
      subject: emailFields.subject,
      to: emailFields.to,
    }),
  });

  let attemptOutcome: InvoiceEmailSendAttemptOutcome = 'failed';

  try {
    const result = await deliverPreparedSmtpTest({
      actorUserId,
      attemptId,
      companyId,
      dependencies,
      emailFields,
      invoiceId,
      sentAt,
      settings,
      testRecipient,
    });

    attemptOutcome = 'succeeded';

    return result;
  } catch (error) {
    if (error instanceof ApprovedInvoiceEmailDeliveryOutcomeUnknownError) {
      attemptOutcome = 'outcomeUnknown';
    }

    throw error;
  } finally {
    dependencies.invoiceEmailSendAttemptStore.complete({
      attemptId,
      outcome: attemptOutcome,
    });
  }
}

interface DeliverPreparedSmtpTestInput {
  actorUserId: string;
  attemptId: string;
  companyId: string;
  dependencies: SendApprovedInvoiceEmailSmtpTestDependencies;
  emailFields: ReturnType<typeof normalizeApprovedInvoiceEmailSendFields>;
  invoiceId: string;
  sentAt: string;
  settings: NonNullable<
    Awaited<ReturnType<InvoiceEmailSettingsReader['getEmailSettings']>>
  >;
  testRecipient: string;
}

async function deliverPreparedSmtpTest(
  input: DeliverPreparedSmtpTestInput,
): Promise<SendApprovedInvoiceEmailSmtpTestResult> {
  const document = await input.dependencies.ensureApprovedInvoicePdfDocument({
    companyId: input.companyId,
    createdAt: input.sentAt,
    invoiceId: input.invoiceId,
  });
  const pdfDocument = await input.dependencies.getApprovedInvoicePdfDocument({
    companyId: input.companyId,
    invoiceId: input.invoiceId,
  });
  const deliveryEvent = await recordInvoiceDeliveryEvent(
    {
      body: input.emailFields.body,
      ccEmail: '',
      companyId: input.companyId,
      createdAt: input.sentAt,
      createdBy: input.actorUserId,
      deliveryMethod: 'email',
      documentId: document.id,
      id: input.attemptId,
      invoiceId: input.invoiceId,
      provider: 'smtp',
      recipientEmail: input.testRecipient,
      status: 'attempted',
      subject: input.emailFields.subject,
    },
    {
      invoiceDeliveryEventRepository:
        input.dependencies.invoiceDeliveryEventRepository,
    },
  );

  let providerResult: Awaited<
    ReturnType<InvoiceSmtpTestDeliveryProvider['sendTestEmail']>
  >;

  try {
    providerResult = await input.dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail({
      attemptId: deliveryEvent.id,
      ...input.settings,
      body: input.emailFields.body,
      companyId: input.companyId,
      pdfContent: pdfDocument.content,
      pdfFileName: pdfDocument.metadata.fileName,
      subject: input.emailFields.subject,
    });
  } catch (error) {
    const providerError =
      error instanceof InvoiceSmtpTestDeliveryError
        ? error
        : new InvoiceSmtpTestDeliveryError('failed', null);

    await completeInvoiceDeliveryEvent(
      {
        companyId: input.companyId,
        eventId: deliveryEvent.id,
        safeErrorMessage:
          providerError.outcome === 'outcomeUnknown'
            ? 'Invoice email delivery outcome is unknown.'
            : 'Invoice SMTP test delivery failed.',
        status: providerError.outcome,
        technicalErrorCode: providerError.technicalErrorCode,
      },
      input.dependencies.invoiceDeliveryEventRepository,
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
    providerResult.deliveredTo !== input.testRecipient
  ) {
    await completeInvoiceDeliveryEvent(
      {
        companyId: input.companyId,
        eventId: deliveryEvent.id,
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
      },
      input.dependencies.invoiceDeliveryEventRepository,
    ).catch(() => undefined);

    throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
  }

  try {
    await completeInvoiceDeliveryEvent(
      {
        companyId: input.companyId,
        eventId: deliveryEvent.id,
        providerMessageId: providerResult.providerMessageId,
        status: 'succeeded',
      },
      input.dependencies.invoiceDeliveryEventRepository,
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

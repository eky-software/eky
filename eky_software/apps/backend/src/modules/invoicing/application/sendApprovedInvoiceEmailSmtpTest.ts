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
import type { InvoiceEmailDeliveryDocument } from './loadInvoiceEmailDeliveryDocument.js';
import type {
  GenerateApprovedInvoicePdfDocumentInput,
} from './generateApprovedInvoicePdfDocument.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import { requireLegacyInvoiceDeliveryReviewed, type InvoiceLegacyDeliveryReviewReader } from './requireLegacyInvoiceDeliveryReviewed.js';
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
  invoiceDeliveryEventReader: InvoiceLegacyDeliveryReviewReader;
  approvedInvoiceReader: ApprovedInvoiceReader;
  loadInvoiceEmailDeliveryDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<InvoiceEmailDeliveryDocument>;
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

  requireInvoiceDeliveryEligible(invoice);
  await requireLegacyInvoiceDeliveryReviewed({ companyId, invoiceId }, dependencies.invoiceDeliveryEventReader);

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
  const pdfDocument = await dependencies.loadInvoiceEmailDeliveryDocument({
    actorContext: input.actorContext,
    companyId,
    createdAt: sentAt,
    invoiceId,
  });

  try {
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
        document: {
          binding: pdfDocument.metadata.binding,
          fileName: pdfDocument.metadata.fileName,
          id: pdfDocument.metadata.id,
          sha256: pdfDocument.metadata.sha256,
          sizeBytes: pdfDocument.metadata.sizeBytes,
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
  } catch (error) {
    pdfDocument.content.fill(0);
    throw error;
  }

  let attemptOutcome: InvoiceEmailSendAttemptOutcome = 'failed';

  try {
    const result = await deliverPreparedSmtpTest({
      actorUserId,
      attemptId,
      companyId,
      dependencies,
      emailFields,
      pdfDocument,
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
    pdfDocument.content.fill(0);
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
  pdfDocument: InvoiceEmailDeliveryDocument;
  sentAt: string;
  settings: NonNullable<
    Awaited<ReturnType<InvoiceEmailSettingsReader['getEmailSettings']>>
  >;
  testRecipient: string;
}

async function deliverPreparedSmtpTest(
  input: DeliverPreparedSmtpTestInput,
): Promise<SendApprovedInvoiceEmailSmtpTestResult> {
  const reserved = await input.dependencies.invoiceDeliveryEventRepository.reserveEmailDelivery(
    {
      bodyPreview: input.emailFields.body,
      ccEmail: '',
      createdAt: input.sentAt,
      createdBy: input.actorUserId,
      eventId: input.attemptId,
      mode: 'smtpTest',
      target: input.pdfDocument.target,
      recipientEmail: input.testRecipient,
      subject: input.emailFields.subject,
    },
  );
  if (reserved.outcome !== 'reserved' || reserved.reservation.mode !== 'smtpTest') {
    throw new InvoiceDeliveryConflictError();
  }
  const reservation = reserved.reservation;

  let providerResult: Awaited<
    ReturnType<InvoiceSmtpTestDeliveryProvider['sendTestEmail']>
  >;

  try {
    providerResult = await input.dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail({
      attemptId: reservation.eventId,
      ...input.settings,
      body: input.emailFields.body,
      companyId: input.companyId,
      pdfContent: input.pdfDocument.content,
      pdfFileName: input.pdfDocument.metadata.fileName,
      subject: input.emailFields.subject,
    });
  } catch (error) {
    const providerError =
      error instanceof InvoiceSmtpTestDeliveryError
        ? error
        : new InvoiceSmtpTestDeliveryError('outcomeUnknown', null);

    try {
      await completeInvoiceDeliveryEvent(
        {
          reservation,
          result: {
            safeErrorMessage:
              providerError.outcome === 'outcomeUnknown'
                ? 'Invoice email delivery outcome is unknown.'
                : 'Invoice SMTP test delivery failed.',
            status: providerError.outcome,
            technicalErrorCode: providerError.technicalErrorCode,
          },
        },
        input.dependencies.invoiceDeliveryEventRepository,
      );
    } catch { throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError(); }

    if (providerError.outcome === 'outcomeUnknown') {
      throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
    }

    throw new ApprovedInvoiceEmailDeliveryError(
      'Invoice SMTP test delivery failed.',
    );
  }

  if (
    providerResult?.provider !== 'smtp' ||
    providerResult.testMode !== true ||
    providerResult.deliveredTo !== input.testRecipient
  ) {
    await completeInvoiceDeliveryEvent(
      {
        reservation,
        result: {
          safeErrorMessage: 'Invoice email delivery outcome is unknown.',
          status: 'outcomeUnknown',
          technicalErrorCode: null,
        },
      },
      input.dependencies.invoiceDeliveryEventRepository,
    ).catch(() => undefined);

    throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
  }

  try {
    await completeInvoiceDeliveryEvent(
      {
        reservation,
        result: { providerMessageId: providerResult.providerMessageId, status: 'succeeded' },
      },
      input.dependencies.invoiceDeliveryEventRepository,
    );
  } catch {
    await completeInvoiceDeliveryEvent({
      reservation,
      result: { status: 'outcomeUnknown', safeErrorMessage: 'Invoice email delivery outcome is unknown.', technicalErrorCode: null },
    }, input.dependencies.invoiceDeliveryEventRepository).catch(() => undefined);
    throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
  }

  return {
    deliveredTo: providerResult.deliveredTo,
    deliveryEventId: reservation.eventId,
    provider: providerResult.provider,
    providerMessageId: providerResult.providerMessageId,
    testMode: true,
  };
}

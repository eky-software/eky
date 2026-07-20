import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import { normalizeApprovedInvoiceEmailSendFields } from './approvedInvoiceEmailSendValidation.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { completeInvoiceDeliveryEvent } from './completeInvoiceDeliveryEvent.js';
import type {
  ApprovedInvoicePdfDocumentFile,
  GetApprovedInvoicePdfDocumentInput,
} from './getApprovedInvoicePdfDocument.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import { recordInvoiceDeliveryEvent } from './recordInvoiceDeliveryEvent.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { normalizeDeliveryProviderMessageId } from '../domain/invoiceDeliveryEventRules.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import type { InvoiceEmailDeliveryFinalizer } from '../ports/invoiceEmailDeliveryFinalizer.js';
import type {
  InvoiceEmailSendAttemptOutcome,
  InvoiceEmailSendAttemptStore,
} from '../ports/invoiceEmailSendAttemptStore.js';
import type { InvoiceEmailSettingsReader } from '../ports/invoiceEmailSettingsReader.js';
import {
  InvoiceSmtpDeliveryError,
  type InvoiceSmtpDeliveryProvider,
} from '../ports/invoiceSmtpDeliveryProvider.js';

export interface SendApprovedInvoiceEmailSmtpInput {
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

export interface SendApprovedInvoiceEmailSmtpResult {
  deliveredCc: string;
  deliveredTo: string;
  deliveryEventId: string;
  invoice: ApprovedInvoiceView;
  provider: 'smtp';
  providerMessageId: string | null;
  resend: boolean;
  testMode: false;
}

export interface SendApprovedInvoiceEmailSmtpDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  getApprovedInvoicePdfDocument(
    input: GetApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoicePdfDocumentFile>;
  invoiceDeliveryEventRepository: InvoiceDeliveryEventRepository;
  invoiceEmailDeliveryFinalizer: InvoiceEmailDeliveryFinalizer;
  invoiceEmailSendAttemptStore: InvoiceEmailSendAttemptStore;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  invoiceSmtpDeliveryProvider: InvoiceSmtpDeliveryProvider;
}

export async function sendApprovedInvoiceEmailSmtp(
  input: SendApprovedInvoiceEmailSmtpInput,
  dependencies: SendApprovedInvoiceEmailSmtpDependencies,
): Promise<SendApprovedInvoiceEmailSmtpResult> {
  requirePermission(input.actorContext, 'sendInvoices');

  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const actorUserId = requireIdentifier(
    input.actorContext.actorId,
    'Actor user id',
  );
  const sentAt = requireIdentifier(input.sentAt, 'Email delivery timestamp');
  const attemptId = requireIdentifier(input.attemptId, 'SMTP attempt id');
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

  dependencies.invoiceEmailSendAttemptStore.acquire({
    actorId: actorUserId,
    attemptId,
    authorizationToken: input.authorizationToken,
    companyId,
    invoiceId,
    mode: 'customer',
    provider: 'dnaSmtp',
    recipient: emailFields.to,
    requestFingerprint: createInvoiceEmailSendRequestFingerprint({
      body: emailFields.body,
      cc: emailFields.cc,
      recipient: emailFields.to,
      subject: emailFields.subject,
      to: emailFields.to,
    }),
  });

  let attemptOutcome: InvoiceEmailSendAttemptOutcome = 'failed';

  try {
    const result = await deliverPreparedInvoiceEmail({
      actorUserId,
      attemptId,
      companyId,
      dependencies,
      emailFields,
      invoiceId,
      sentAt,
      settings,
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

interface DeliverPreparedInvoiceEmailInput {
  actorUserId: string;
  attemptId: string;
  companyId: string;
  dependencies: SendApprovedInvoiceEmailSmtpDependencies;
  emailFields: ReturnType<typeof normalizeApprovedInvoiceEmailSendFields>;
  invoiceId: string;
  sentAt: string;
  settings: NonNullable<
    Awaited<ReturnType<InvoiceEmailSettingsReader['getEmailSettings']>>
  >;
}

async function deliverPreparedInvoiceEmail(
  input: DeliverPreparedInvoiceEmailInput,
): Promise<SendApprovedInvoiceEmailSmtpResult> {
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
      ccEmail: input.emailFields.cc,
      companyId: input.companyId,
      createdAt: input.sentAt,
      createdBy: input.actorUserId,
      deliveryMethod: 'email',
      documentId: document.id,
      id: input.attemptId,
      invoiceId: input.invoiceId,
      provider: 'smtp',
      recipientEmail: input.emailFields.to,
      status: 'attempted',
      subject: input.emailFields.subject,
    },
    {
      invoiceDeliveryEventRepository:
        input.dependencies.invoiceDeliveryEventRepository,
    },
  );

  let providerResult: Awaited<
    ReturnType<InvoiceSmtpDeliveryProvider['sendEmail']>
  >;

  try {
    providerResult = await input.dependencies.invoiceSmtpDeliveryProvider.sendEmail({
      attemptId: deliveryEvent.id,
      ...input.settings,
      body: input.emailFields.body,
      cc: input.emailFields.cc,
      companyId: input.companyId,
      pdfContent: pdfDocument.content,
      pdfFileName: pdfDocument.metadata.fileName,
      subject: input.emailFields.subject,
      to: input.emailFields.to,
    });
  } catch (error) {
    const providerError =
      error instanceof InvoiceSmtpDeliveryError
        ? error
        : new InvoiceSmtpDeliveryError('failed', null);

    await completeInvoiceDeliveryEvent(
      {
        companyId: input.companyId,
        eventId: deliveryEvent.id,
        safeErrorMessage:
          providerError.outcome === 'outcomeUnknown'
            ? 'Invoice email delivery outcome is unknown.'
            : 'Invoice email delivery failed.',
        status: providerError.outcome,
        technicalErrorCode: providerError.technicalErrorCode,
      },
      input.dependencies.invoiceDeliveryEventRepository,
    ).catch(() => undefined);

    if (providerError.outcome === 'outcomeUnknown') {
      throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
    }

    throw new ApprovedInvoiceEmailDeliveryError('Invoice email delivery failed.');
  } finally {
    pdfDocument.content.fill(0);
  }

  if (
    providerResult.provider !== 'smtp' ||
    providerResult.testMode !== false ||
    providerResult.deliveredTo !== input.emailFields.to ||
    providerResult.deliveredCc !== input.emailFields.cc
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

  let resend: boolean;

  try {
    const completion =
      await input.dependencies.invoiceEmailDeliveryFinalizer.completeSuccessfulEmailDelivery(
        {
          companyId: input.companyId,
          eventId: deliveryEvent.id,
          invoiceId: input.invoiceId,
          providerMessageId: normalizeDeliveryProviderMessageId(
            providerResult.providerMessageId,
          ),
          sentAt: input.sentAt,
        },
      );

    resend = completion.wasResend;
  } catch {
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

  const invoice = await input.dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    input.companyId,
    input.invoiceId,
  );

  if (invoice === undefined || invoice.status !== 'sent') {
    throw new ApprovedInvoiceEmailDeliveryOutcomeUnknownError();
  }

  return {
    deliveredCc: providerResult.deliveredCc,
    deliveredTo: providerResult.deliveredTo,
    deliveryEventId: deliveryEvent.id,
    invoice,
    provider: providerResult.provider,
    providerMessageId: providerResult.providerMessageId,
    resend,
    testMode: false,
  };
}

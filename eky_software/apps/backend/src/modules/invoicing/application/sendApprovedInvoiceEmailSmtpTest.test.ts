import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { InvoiceEmailSendAttemptError } from './invoiceEmailSendAttemptError.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import {
  sendApprovedInvoiceEmailSmtpTest,
  type SendApprovedInvoiceEmailSmtpTestInput,
} from './sendApprovedInvoiceEmailSmtpTest.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type {
  CompleteInvoiceDeliveryEventInput,
  InvoiceDeliveryEventRepository,
} from '../ports/invoiceDeliveryEventRepository.js';
import type { InvoiceEmailSettingsReader } from '../ports/invoiceEmailSettingsReader.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import {
  InvoiceSmtpTestDeliveryError,
  type InvoiceSmtpTestDeliveryProvider,
  type InvoiceSmtpTestEmailInput,
} from '../ports/invoiceSmtpTestDeliveryProvider.js';

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  async getApprovedInvoiceById(): Promise<ApprovedInvoiceView> {
    return { id: 'invoice-1', invoiceNumber: '20260001' } as ApprovedInvoiceView;
  }

  async listApprovedInvoiceSummaries(): Promise<never> {
    throw new Error('Not implemented in SMTP test delivery test.');
  }
}

class FakeInvoiceDeliveryEventRepository
  implements InvoiceDeliveryEventRepository
{
  completions: CompleteInvoiceDeliveryEventInput[] = [];
  events: InvoiceDeliveryEvent[] = [];

  async completeDeliveryEvent(
    input: CompleteInvoiceDeliveryEventInput,
  ): Promise<void> {
    this.completions.push(input);
  }

  async saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
    this.events.push(event);

    return event;
  }
}

describe('sendApprovedInvoiceEmailSmtpTest', () => {
  it('records attempted before delivery and sends only to the configured test recipient', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const sendTestEmail = vi.fn(async (input: InvoiceSmtpTestEmailInput) => {
      expect(repository.events[0]?.status).toBe('attempted');
      expect(repository.completions).toEqual([]);
      expect(input).not.toHaveProperty('requestedTo');
      expect(input).not.toHaveProperty('cc');
      expect(input.attemptId).toBe(repository.events[0]?.id);
      expect(input.emailTestRecipientOverride).toBe('owner-test@example.fi');

      return {
        deliveredTo: 'owner-test@example.fi',
        provider: 'smtp' as const,
        providerMessageId: '<synthetic@example.test>',
        testMode: true as const,
      };
    });
    const dependencies = createDependencies({
      pdfContent,
      repository,
      sendTestEmail,
    });

    const result = await sendApprovedInvoiceEmailSmtpTest(
      createInput({ cc: 'copy@example.fi' }),
      dependencies,
    );

    expect(repository.events).toEqual([
      expect.objectContaining({
        ccEmail: '',
        provider: 'smtp',
        recipientEmail: 'owner-test@example.fi',
        status: 'attempted',
      }),
    ]);
    expect(repository.completions).toEqual([
      expect.objectContaining({
        companyId: 'dev-company',
        eventId: repository.events[0]?.id,
        providerMessageId: '<synthetic@example.test>',
        status: 'succeeded',
      }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        deliveredTo: 'owner-test@example.fi',
        deliveryEventId: repository.events[0]?.id,
        provider: 'smtp',
        testMode: true,
      }),
    );
    expect(pdfContent.every((value) => value === 0)).toBe(true);
  });

  it('records outcomeUnknown without retrying when final acceptance is uncertain', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const sendTestEmail = vi.fn(async () => {
      throw new InvoiceSmtpTestDeliveryError(
        'outcomeUnknown',
        'SMTP_FINAL_RESPONSE_MISSING',
      );
    });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(
        createInput(),
        createDependencies({ repository, sendTestEmail }),
      ),
    ).rejects.toBeInstanceOf(
      ApprovedInvoiceEmailDeliveryOutcomeUnknownError,
    );

    expect(sendTestEmail).toHaveBeenCalledOnce();
    expect(repository.completions).toEqual([
      expect.objectContaining({
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
        technicalErrorCode: 'SMTP_FINAL_RESPONSE_MISSING',
      }),
    ]);
  });

  it('records a safe failed result without leaking the provider error', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const sendTestEmail = vi.fn(async () => {
      throw new InvoiceSmtpTestDeliveryError(
        'failed',
        'DNA_SMTP_SECRET_NOT_CONFIGURED',
      );
    });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(
        createInput(),
        createDependencies({ repository, sendTestEmail }),
      ),
    ).rejects.toEqual(
      new ApprovedInvoiceEmailDeliveryError(
        'Invoice SMTP test delivery failed.',
      ),
    );

    expect(repository.completions[0]).toEqual(
      expect.objectContaining({
        safeErrorMessage: 'Invoice SMTP test delivery failed.',
        status: 'failed',
        technicalErrorCode: 'DNA_SMTP_SECRET_NOT_CONFIGURED',
      }),
    );
  });

  it('denies delivery before reading settings or PDF without permission', async () => {
    const dependencies = createDependencies();

    await expect(
      sendApprovedInvoiceEmailSmtpTest(
        createInput({
          actorContext: createActorContext({
            actorId: 'dev-user',
            authenticationMode: 'local',
            companyId: 'dev-company',
            permissions: [],
          }),
        }),
        dependencies,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).not.toHaveBeenCalled();
  });

  it('allows only one provider call for concurrent requests with the same attempt', async () => {
    const attemptStore = new InMemoryInvoiceEmailSendAttemptStore();
    let releaseProvider: (() => void) | undefined;
    const sendTestEmail = vi.fn(
      () =>
        new Promise<{
          deliveredTo: string;
          provider: 'smtp';
          providerMessageId: null;
          testMode: true;
        }>((resolve) => {
          releaseProvider = () =>
            resolve({
              deliveredTo: 'owner-test@example.fi',
              provider: 'smtp',
              providerMessageId: null,
              testMode: true,
            });
        }),
    );
    const input = createInput();
    const document = createDocumentMetadata();
    const settings = createEmailSettings();
    const emailFields = {
      body: input.body,
      cc: input.cc ?? '',
      document: {
        fileName: document.fileName,
        id: document.id,
        sha256: document.sha256,
        sizeBytes: document.sizeBytes,
      },
      subject: input.subject,
      recipient: 'owner-test@example.fi',
      sender: {
        address: settings.emailSenderAddress,
        name: settings.emailSenderName,
      },
      to: input.to,
    };
    const preparation = attemptStore.prepare({
      actorId: input.actorContext.actorId,
      companyId: input.actorContext.companyId,
      invoiceId: input.invoiceId,
      mode: 'smtpTest',
      provider: 'dnaSmtp',
      recipient: emailFields.recipient,
      requestFingerprint: createInvoiceEmailSendRequestFingerprint(emailFields),
    });
    const preparedInput = {
      ...input,
      attemptId: preparation.attemptId,
      authorizationToken: preparation.authorizationToken,
    };
    const dependencies = createDependencies({
      attemptStore,
      sendTestEmail,
    });
    const firstRequest = sendApprovedInvoiceEmailSmtpTest(
      preparedInput,
      dependencies,
    );

    await vi.waitFor(() => expect(sendTestEmail).toHaveBeenCalledOnce());

    await expect(
      sendApprovedInvoiceEmailSmtpTest(preparedInput, dependencies),
    ).rejects.toBeInstanceOf(InvoiceEmailSendAttemptError);
    expect(sendTestEmail).toHaveBeenCalledOnce();

    releaseProvider?.();

    await expect(firstRequest).resolves.toEqual(
      expect.objectContaining({ deliveryEventId: preparation.attemptId }),
    );
  });
});

function createDependencies(options: {
  attemptStore?: InvoiceEmailSendAttemptStore;
  pdfContent?: Buffer;
  repository?: FakeInvoiceDeliveryEventRepository;
  sendTestEmail?: InvoiceSmtpTestDeliveryProvider['sendTestEmail'];
} = {}) {
  const repository = options.repository ?? new FakeInvoiceDeliveryEventRepository();
  const pdfContent = options.pdfContent ?? Buffer.from('%PDF-1.7 synthetic');
  const sendTestEmail =
    options.sendTestEmail ??
    vi.fn(async () => ({
      deliveredTo: 'owner-test@example.fi',
      provider: 'smtp' as const,
      providerMessageId: null,
      testMode: true as const,
    }));
  const invoiceEmailSettingsReader: InvoiceEmailSettingsReader = {
    getEmailSettings: vi.fn(async () => createEmailSettings()),
  };
  const invoiceSmtpTestDeliveryProvider: InvoiceSmtpTestDeliveryProvider = {
    sendTestEmail,
  };
  const invoiceEmailSendAttemptStore: InvoiceEmailSendAttemptStore =
    options.attemptStore ?? {
      acquire: vi.fn(),
      complete: vi.fn(),
      prepare: vi.fn(() => {
        throw new Error('Not implemented in SMTP send test.');
      }),
    };

  return {
    approvedInvoiceReader: new FakeApprovedInvoiceReader(),
    ensureApprovedInvoicePdfDocument: vi.fn(async () => createDocumentMetadata()),
    getApprovedInvoicePdfDocument: vi.fn(async () => ({
      content: pdfContent,
      metadata: createDocumentMetadata(),
    })),
    invoiceDeliveryEventRepository: repository,
    invoiceEmailSettingsReader,
    invoiceEmailSendAttemptStore,
    invoiceSmtpTestDeliveryProvider,
  };
}

function createInput(
  overrides: Partial<SendApprovedInvoiceEmailSmtpTestInput> = {},
): SendApprovedInvoiceEmailSmtpTestInput {
  return {
    actorContext: createActorContext({
      actorId: 'dev-user',
      authenticationMode: 'local',
      companyId: 'dev-company',
      permissions: ['sendInvoices'],
    }),
    attemptId: 'attempt-1',
    authorizationToken: 'one-time-authorization',
    body: 'Hei, liitteenä lasku.',
    invoiceId: 'invoice-1',
    sentAt: '2026-07-16T10:00:00.000Z',
    subject: 'Lasku 20260001',
    to: 'customer@example.fi',
    ...overrides,
  };
}

function createEmailSettings() {
  return {
    emailDeliveryProvider: 'dnaSmtp' as const,
    emailSenderAddress: 'billing@example.fi',
    emailSenderName: 'Example Builder Oy',
    emailTestRecipientOverride: 'owner-test@example.fi',
    emailUsername: 'billing@example.fi',
  };
}

function createDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
    companyId: 'dev-company',
    createdAt: '2026-07-16T10:00:00.000Z',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    id: 'document-1',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 2048,
    storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
  };
}

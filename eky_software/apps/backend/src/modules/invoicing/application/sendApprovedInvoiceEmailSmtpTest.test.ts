import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { InvoiceEmailSendAttemptError } from './invoiceEmailSendAttemptError.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import {
  createInvoiceEmailDeliveryDocument,
  FakeInvoiceDeliveryEventRepository,
} from './invoiceSmtpApplication.fixture.js';
import {
  sendApprovedInvoiceEmailSmtpTest,
  type SendApprovedInvoiceEmailSmtpTestDependencies,
  type SendApprovedInvoiceEmailSmtpTestInput,
} from './sendApprovedInvoiceEmailSmtpTest.js';
import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailSettingsReader } from '../ports/invoiceEmailSettingsReader.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import {
  InvoiceSmtpTestDeliveryError,
  type InvoiceSmtpTestDeliveryProvider,
  type InvoiceSmtpTestEmailInput,
} from '../ports/invoiceSmtpTestDeliveryProvider.js';

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(
    private readonly invoice: ApprovedInvoiceView = {
      id: 'invoice-1',
      invoiceNumber: '20260001',
      status: 'approved',
    } as ApprovedInvoiceView,
  ) {}

  async getApprovedInvoiceById(): Promise<ApprovedInvoiceView> {
    return this.invoice;
  }

  async listApprovedInvoiceSummaries(): Promise<never> {
    throw new Error('Not implemented in SMTP test delivery test.');
  }
}

describe('sendApprovedInvoiceEmailSmtpTest', () => {
  it('reserves before delivery and sends only to the configured test recipient', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const expectedPdfContent = Buffer.from(pdfContent);
    const invoice = {
      id: 'invoice-1',
      invoiceNumber: '20260001',
      status: 'approved',
    } as ApprovedInvoiceView;
    const sendTestEmail = vi.fn(async (input: InvoiceSmtpTestEmailInput) => {
      expect(repository.reserveEmailDelivery).toHaveBeenCalledOnce();
      expect(repository.reservations).toHaveLength(1);
      expect(repository.completeDeliveryEvent).not.toHaveBeenCalled();
      expect(input).not.toHaveProperty('requestedTo');
      expect(input).not.toHaveProperty('to');
      expect(input).not.toHaveProperty('cc');
      expect(input.attemptId).toBe(repository.reservations[0]?.eventId);
      expect(input.emailTestRecipientOverride).toBe('owner-test@example.fi');
      expect(input.pdfContent).toBe(pdfContent);
      expect(input.pdfContent).toEqual(expectedPdfContent);
      expect(input.body).toBe(createInput().body);

      return {
        deliveredTo: 'owner-test@example.fi',
        provider: 'smtp' as const,
        providerMessageId: '<synthetic@example.test>',
        testMode: true as const,
      };
    });
    const dependencies = createDependencies({
      invoice,
      pdfContent,
      repository,
      sendTestEmail,
    });

    const result = await sendApprovedInvoiceEmailSmtpTest(
      createInput({ cc: 'copy@example.fi' }),
      dependencies,
    );

    expect(repository.reserveEmailDelivery).toHaveBeenCalledExactlyOnceWith({
      bodyPreview: createInput().body,
      ccEmail: '',
      createdAt: '2026-07-16T10:00:00.000Z',
      createdBy: 'dev-user',
      eventId: 'attempt-1',
      mode: 'smtpTest',
      recipientEmail: 'owner-test@example.fi',
      subject: 'Lasku 20260001',
      target: {
        companyId: 'dev-company',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
        kind: 'revision',
        revisionId: 'revision-1',
        sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        sizeBytes: 2048,
      },
    });
    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        status: 'succeeded',
        providerMessageId: '<synthetic@example.test>',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
    expect(dependencies.loadInvoiceEmailDeliveryDocument).toHaveBeenCalledExactlyOnceWith({
      actorContext: createInput().actorContext,
      companyId: 'dev-company',
      createdAt: '2026-07-16T10:00:00.000Z',
      invoiceId: 'invoice-1',
    });
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'succeeded',
    });
    expect(invoice.status).toBe('approved');
    expect(result).toEqual(
      expect.objectContaining({
        deliveredTo: 'owner-test@example.fi',
        deliveryEventId: repository.reservations[0]?.eventId,
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
    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
        technicalErrorCode: 'SMTP_FINAL_RESPONSE_MISSING',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
  });

  it('records a safe failed result without leaking the provider error', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const sendTestEmail = vi.fn(async () => {
      throw new InvoiceSmtpTestDeliveryError(
        'failed',
        'DNA_SMTP_SECRET_NOT_CONFIGURED',
      );
    });

    const dependencies = createDependencies({ repository, sendTestEmail });
    await expect(
      sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toEqual(
      new ApprovedInvoiceEmailDeliveryError(
        'Invoice SMTP test delivery failed.',
      ),
    );

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice SMTP test delivery failed.',
        status: 'failed',
        technicalErrorCode: 'DNA_SMTP_SECRET_NOT_CONFIGURED',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'failed',
    });
  });

  it('stops before the provider when reservation conflicts after document loading', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    repository.reserveEmailDelivery.mockResolvedValue({ outcome: 'conflict' });
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const dependencies = createDependencies({ pdfContent, repository });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(dependencies.loadInvoiceEmailDeliveryDocument).toHaveBeenCalledOnce();
    expect(dependencies.invoiceEmailSendAttemptStore.acquire).toHaveBeenCalledOnce();
    expect(repository.reserveEmailDelivery).toHaveBeenCalledOnce();
    expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
    expect(repository.completeDeliveryEvent).not.toHaveBeenCalled();
    expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'failed',
    });
    expect(pdfContent.every((value) => value === 0)).toBe(true);
  });

  it('treats an untyped provider error as unknown without leaking its message', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const dependencies = createDependencies({
      pdfContent,
      repository,
      sendTestEmail: vi.fn(async () => {
        throw new Error('synthetic private provider details');
      }),
    });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toEqual(new ApprovedInvoiceEmailDeliveryOutcomeUnknownError());

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
        technicalErrorCode: null,
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).toHaveBeenCalledOnce();
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'outcomeUnknown',
    });
    expect(pdfContent.every((value) => value === 0)).toBe(true);
  });

  it('keeps the attempt uncertain when persisting a definite provider failure fails', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    repository.completeDeliveryEvent.mockRejectedValue(new Error('synthetic completion failure'));
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const dependencies = createDependencies({
      pdfContent,
      repository,
      sendTestEmail: vi.fn(async () => {
        throw new InvoiceSmtpTestDeliveryError('failed', 'DNA_SMTP_SECRET_NOT_CONFIGURED');
      }),
    });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toEqual(new ApprovedInvoiceEmailDeliveryOutcomeUnknownError());

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice SMTP test delivery failed.',
        status: 'failed',
        technicalErrorCode: 'DNA_SMTP_SECRET_NOT_CONFIGURED',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'outcomeUnknown',
    });
    expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).toHaveBeenCalledOnce();
    expect(pdfContent.every((value) => value === 0)).toBe(true);
  });

  it.each([false, true])(
    'records uncertainty after success persistence fails even if unknown recording also fails: %s',
    async (unknownRecordingFails) => {
      const repository = new FakeInvoiceDeliveryEventRepository();
      if (unknownRecordingFails) {
        repository.completeDeliveryEvent.mockRejectedValue(new Error('synthetic completion failure'));
      } else {
        repository.completeDeliveryEvent.mockRejectedValueOnce(new Error('synthetic success completion failure'));
      }
      const pdfContent = Buffer.from('%PDF-1.7 synthetic');
      const dependencies = createDependencies({ pdfContent, repository });

      await expect(
        sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
      ).rejects.toEqual(new ApprovedInvoiceEmailDeliveryOutcomeUnknownError());

      expect(repository.completeDeliveryEvent.mock.calls).toEqual([
        [{
          reservation: repository.reservations[0],
          result: { status: 'succeeded', providerMessageId: null },
        }],
        [{
          reservation: repository.reservations[0],
          result: {
            status: 'outcomeUnknown',
            safeErrorMessage: 'Invoice email delivery outcome is unknown.',
            technicalErrorCode: null,
          },
        }],
      ]);
      for (const [completion] of repository.completeDeliveryEvent.mock.calls) {
        expect(completion.reservation).toBe(repository.reservations[0]);
      }
      expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
        attemptId: 'attempt-1', outcome: 'outcomeUnknown',
      });
      expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).toHaveBeenCalledOnce();
      expect(pdfContent.every((value) => value === 0)).toBe(true);
    },
  );

  it('treats a mismatching provider recipient as unknown', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const dependencies = createDependencies({
      pdfContent,
      repository,
      sendTestEmail: vi.fn(async () => ({
        deliveredTo: 'other-recipient@example.fi',
        provider: 'smtp' as const,
        providerMessageId: null,
        testMode: true as const,
      })),
    });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toEqual(new ApprovedInvoiceEmailDeliveryOutcomeUnknownError());

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        status: 'outcomeUnknown',
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        technicalErrorCode: null,
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).toHaveBeenCalledOnce();
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'outcomeUnknown',
    });
    expect(pdfContent.every((value) => value === 0)).toBe(true);
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
    expect(dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
    expect(dependencies.invoiceDeliveryEventRepository.reserveEmailDelivery).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailSendAttemptStore.acquire).not.toHaveBeenCalled();
    expect(dependencies.invoiceSmtpTestDeliveryProvider.sendTestEmail).not.toHaveBeenCalled();
  });

  it('rejects a cancelled invoice before settings, PDF, attempt, event, or provider', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const dependencies = createDependencies({
      invoice: {
        id: 'invoice-1',
        invoiceNumber: '20260001',
        status: 'cancelled',
      } as ApprovedInvoiceView,
      repository,
    });

    await expect(
      sendApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(dependencies.loadInvoiceEmailDeliveryDocument).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailSendAttemptStore.acquire).not.toHaveBeenCalled();
    expect(repository.reserveEmailDelivery).not.toHaveBeenCalled();
    expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
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
        binding: document.binding,
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
    const repository = new FakeInvoiceDeliveryEventRepository();
    const dependencies = createDependencies({
      attemptStore,
      repository,
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
    expect(repository.reserveEmailDelivery).toHaveBeenCalledOnce();
    expect(repository.completeDeliveryEvent).toHaveBeenCalledOnce();
  });
});

function createDependencies(options: {
  attemptStore?: InvoiceEmailSendAttemptStore;
  invoice?: ApprovedInvoiceView;
  pdfContent?: Buffer;
  repository?: FakeInvoiceDeliveryEventRepository;
  sendTestEmail?: InvoiceSmtpTestDeliveryProvider['sendTestEmail'];
} = {}) {
  const repository = options.repository ?? new FakeInvoiceDeliveryEventRepository();
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
    approvedInvoiceReader: new FakeApprovedInvoiceReader(options.invoice),
    loadInvoiceEmailDeliveryDocument: vi.fn<SendApprovedInvoiceEmailSmtpTestDependencies['loadInvoiceEmailDeliveryDocument']>(async () =>
      createInvoiceEmailDeliveryDocument(
        createDocumentMetadata(),
        options.pdfContent ?? Buffer.from('%PDF-1.7 synthetic'),
      ),
    ),
    invoiceDeliveryEventReader: { requiresLegacyDeliveryReview: vi.fn(async () => false) },
    invoiceDeliveryEventRepository: repository,
    invoiceEmailSettingsReader,
    invoiceEmailSendAttemptStore,
    invoiceSmtpTestDeliveryProvider,
  } satisfies SendApprovedInvoiceEmailSmtpTestDependencies;
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

function createDocumentMetadata(): RevisionInvoiceDocumentMetadata {
  return {
    binding: { kind: 'revision', revisionId: 'revision-1' },
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

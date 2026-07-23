import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceEmailSendAttemptError } from './invoiceEmailSendAttemptError.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import {
  sendApprovedInvoiceEmailSmtp,
  type SendApprovedInvoiceEmailSmtpInput,
} from './sendApprovedInvoiceEmailSmtp.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type {
  CompleteInvoiceDeliveryEventInput,
  InvoiceDeliveryEventRepository,
} from '../ports/invoiceDeliveryEventRepository.js';
import type { InvoiceEmailDeliveryFinalizer } from '../ports/invoiceEmailDeliveryFinalizer.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';
import type { InvoiceSmtpDeliveryProvider } from '../ports/invoiceSmtpDeliveryProvider.js';
import { InvoiceSmtpDeliveryError } from '../ports/invoiceSmtpDeliveryProvider.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';

class FakeDeliveryEventRepository implements InvoiceDeliveryEventRepository {
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

describe('sendApprovedInvoiceEmailSmtp', () => {
  it('records attempted before SMTP and finalizes success and sent status atomically', async () => {
    const repository = new FakeDeliveryEventRepository();
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    let currentStatus: 'approved' | 'sent' = 'approved';
    const sendEmail = vi.fn(async () => {
      expect(repository.events[0]?.status).toBe('attempted');
      expect(currentStatus).toBe('approved');

      return {
        deliveredCc: 'copy@example.fi',
        deliveredTo: 'customer@example.fi',
        provider: 'smtp' as const,
        providerMessageId: '<message@example.fi>',
        testMode: false as const,
      };
    });
    const completeSuccessfulEmailDelivery = vi.fn(async () => {
      expect(sendEmail).toHaveBeenCalledOnce();
      currentStatus = 'sent';
      return {
        invoiceStatus: 'sent' as const,
        updatedAt: '2026-07-17T22:00:00.000Z',
        wasResend: false,
      };
    });

    const result = await sendApprovedInvoiceEmailSmtp(
      createInput(),
      createDependencies({
        completeSuccessfulEmailDelivery,
        getStatus: () => currentStatus,
        pdfContent,
        repository,
        sendEmail,
      }),
    );

    expect(repository.events[0]).toEqual(
      expect.objectContaining({
        ccEmail: 'copy@example.fi',
        recipientEmail: 'customer@example.fi',
        status: 'attempted',
      }),
    );
    expect(completeSuccessfulEmailDelivery).toHaveBeenCalledWith({
      companyId: 'company-1',
      eventId: 'attempt-1',
      invoiceId: 'invoice-1',
      providerMessageId: '<message@example.fi>',
      sentAt: '2026-07-17T22:00:00.000Z',
    });
    expect(result.invoice.status).toBe('sent');
    expect(result.resend).toBe(false);
    expect(pdfContent.every((value) => value === 0)).toBe(true);
  });

  it('records a definite failure without finalizing or changing invoice status', async () => {
    const repository = new FakeDeliveryEventRepository();
    const completeSuccessfulEmailDelivery = vi.fn();

    await expect(
      sendApprovedInvoiceEmailSmtp(
        createInput(),
        createDependencies({
          completeSuccessfulEmailDelivery,
          repository,
          sendEmail: vi.fn(async () => {
            throw new InvoiceSmtpDeliveryError(
              'failed',
              'DNA_SMTP_AUTH_REJECTED',
            );
          }),
        }),
      ),
    ).rejects.toEqual(
      new ApprovedInvoiceEmailDeliveryError('Invoice email delivery failed.'),
    );

    expect(repository.completions).toEqual([
      expect.objectContaining({
        status: 'failed',
        technicalErrorCode: 'DNA_SMTP_AUTH_REJECTED',
      }),
    ]);
    expect(completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
  });

  it('records outcomeUnknown and never marks the invoice sent', async () => {
    const repository = new FakeDeliveryEventRepository();
    const completeSuccessfulEmailDelivery = vi.fn();

    await expect(
      sendApprovedInvoiceEmailSmtp(
        createInput(),
        createDependencies({
          completeSuccessfulEmailDelivery,
          repository,
          sendEmail: vi.fn(async () => {
            throw new InvoiceSmtpDeliveryError(
              'outcomeUnknown',
              'SMTP_FINAL_RESPONSE_MISSING',
            );
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(
      ApprovedInvoiceEmailDeliveryOutcomeUnknownError,
    );

    expect(repository.completions).toEqual([
      expect.objectContaining({ status: 'outcomeUnknown' }),
    ]);
    expect(completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
  });

  it('treats a mismatching provider result as unknown and never marks the invoice sent', async () => {
    const repository = new FakeDeliveryEventRepository();
    const completeSuccessfulEmailDelivery = vi.fn();

    await expect(
      sendApprovedInvoiceEmailSmtp(
        createInput(),
        createDependencies({
          completeSuccessfulEmailDelivery,
          repository,
          sendEmail: vi.fn(async () => ({
            deliveredCc: 'copy@example.fi',
            deliveredTo: 'other-recipient@example.fi',
            provider: 'smtp' as const,
            providerMessageId: '<message@example.fi>',
            testMode: false as const,
          })),
        }),
      ),
    ).rejects.toBeInstanceOf(
      ApprovedInvoiceEmailDeliveryOutcomeUnknownError,
    );

    expect(repository.completions).toEqual([
      expect.objectContaining({ status: 'outcomeUnknown' }),
    ]);
    expect(completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
  });

  it('resends an already sent invoice without creating a new invoice identity', async () => {
    const completeSuccessfulEmailDelivery = vi.fn(async () => ({
      invoiceStatus: 'sent' as const,
      updatedAt: '2026-07-17T21:00:00.000Z',
      wasResend: true,
    }));

    const result = await sendApprovedInvoiceEmailSmtp(
      createInput(),
      createDependencies({
        completeSuccessfulEmailDelivery,
        getStatus: () => 'sent',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({
          id: 'invoice-1',
          invoiceNumber: '20260001',
          status: 'sent',
        }),
        resend: true,
      }),
    );
  });

  it('returns committed success without re-reading the invoice after finalization', async () => {
    const getApprovedInvoiceById = vi.fn(async () => createInvoice('approved'));
    const dependencies = createDependencies({
      completeSuccessfulEmailDelivery: vi.fn(async () => ({
        invoiceStatus: 'sent' as const,
        updatedAt: '2026-07-17T22:00:00.000Z',
        wasResend: false,
      })),
    });
    dependencies.approvedInvoiceReader.getApprovedInvoiceById =
      getApprovedInvoiceById;

    await expect(
      sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
    ).resolves.toMatchObject({
      invoice: {
        id: 'invoice-1',
        status: 'sent',
        updatedAt: '2026-07-17T22:00:00.000Z',
      },
    });

    expect(getApprovedInvoiceById).toHaveBeenCalledOnce();
  });

  it('rejects a cancelled invoice before settings, PDF, attempt, event, provider, or finalizer', async () => {
    const repository = new FakeDeliveryEventRepository();
    const dependencies = createDependencies({
      getStatus: () => 'cancelled',
      repository,
    });

    await expect(
      sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(dependencies.getApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailSendAttemptStore.acquire).not.toHaveBeenCalled();
    expect(repository.events).toEqual([]);
    expect(dependencies.invoiceSmtpDeliveryProvider.sendEmail).not.toHaveBeenCalled();
    expect(
      dependencies.invoiceEmailDeliveryFinalizer.completeSuccessfulEmailDelivery,
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      changedDocument: createDocumentMetadata({ sha256: '1'.repeat(64) }),
      changedSettings: createEmailSettings(),
      label: 'PDF document',
    },
    {
      changedDocument: createDocumentMetadata(),
      changedSettings: createEmailSettings({ emailSenderName: 'Changed Oy' }),
      label: 'sender',
    },
  ])(
    'rejects the one-time authorization when the confirmed $label changes',
    async ({ changedDocument, changedSettings }) => {
      const attemptStore = new InMemoryInvoiceEmailSendAttemptStore();
      const input = createInput();
      const originalDocument = createDocumentMetadata();
      const originalSettings = createEmailSettings();
      const preparation = attemptStore.prepare({
        actorId: input.actorContext.actorId,
        companyId: input.actorContext.companyId,
        invoiceId: input.invoiceId,
        mode: 'customer',
        provider: 'dnaSmtp',
        recipient: input.to,
        requestFingerprint: createInvoiceEmailSendRequestFingerprint({
          body: input.body,
          cc: input.cc ?? '',
          document: {
            fileName: originalDocument.fileName,
            id: originalDocument.id,
            sha256: originalDocument.sha256,
            sizeBytes: originalDocument.sizeBytes,
          },
          recipient: input.to,
          sender: {
            address: originalSettings.emailSenderAddress,
            name: originalSettings.emailSenderName,
          },
          subject: input.subject,
          to: input.to,
        }),
      });
      const sendEmail = vi.fn();
      const repository = new FakeDeliveryEventRepository();

      await expect(
        sendApprovedInvoiceEmailSmtp(
          {
            ...input,
            attemptId: preparation.attemptId,
            authorizationToken: preparation.authorizationToken,
          },
          createDependencies({
            attemptStore,
            documentMetadata: changedDocument,
            emailSettings: changedSettings,
            repository,
            sendEmail,
          }),
        ),
      ).rejects.toBeInstanceOf(InvoiceEmailSendAttemptError);

      expect(sendEmail).not.toHaveBeenCalled();
      expect(repository.events).toEqual([]);
    },
  );
});

function createDependencies(options: {
  completeSuccessfulEmailDelivery?: InvoiceEmailDeliveryFinalizer['completeSuccessfulEmailDelivery'];
  attemptStore?: InvoiceEmailSendAttemptStore;
  documentMetadata?: ApprovedInvoiceDocumentMetadata;
  emailSettings?: ReturnType<typeof createEmailSettings>;
  getStatus?: () => ApprovedInvoiceView['status'];
  pdfContent?: Buffer;
  repository?: FakeDeliveryEventRepository;
  sendEmail?: InvoiceSmtpDeliveryProvider['sendEmail'];
} = {}) {
  const repository = options.repository ?? new FakeDeliveryEventRepository();
  const documentMetadata =
    options.documentMetadata ?? createDocumentMetadata();
  const getStatus = options.getStatus ?? (() => 'approved' as const);
  const sendEmail =
    options.sendEmail ??
    vi.fn(async () => ({
      deliveredCc: 'copy@example.fi',
      deliveredTo: 'customer@example.fi',
      provider: 'smtp' as const,
      providerMessageId: null,
      testMode: false as const,
    }));

  return {
    approvedInvoiceReader: {
      getApprovedInvoiceById: vi.fn(async () => createInvoice(getStatus())),
      listApprovedInvoiceSummaries: vi.fn(),
    },
    ensureApprovedInvoicePdfDocument: vi.fn(async () => documentMetadata),
    getApprovedInvoicePdfDocument: vi.fn(async () => ({
      content: options.pdfContent ?? Buffer.from('%PDF-1.7 synthetic'),
      metadata: documentMetadata,
    })),
    invoiceDeliveryEventRepository: repository,
    invoiceEmailDeliveryFinalizer: {
      completeSuccessfulEmailDelivery:
        options.completeSuccessfulEmailDelivery ??
        vi.fn(async () => ({
          invoiceStatus: 'sent' as const,
          updatedAt: '2026-07-17T22:00:00.000Z',
          wasResend: false,
        })),
    },
    invoiceEmailSendAttemptStore: options.attemptStore ?? {
        acquire: vi.fn(),
        complete: vi.fn(),
        prepare: vi.fn(),
      },
    invoiceEmailSettingsReader: {
      getEmailSettings: vi.fn(async () =>
        options.emailSettings ?? createEmailSettings(),
      ),
    },
    invoiceSmtpDeliveryProvider: { sendEmail },
  };
}

function createInput(
  overrides: Partial<SendApprovedInvoiceEmailSmtpInput> = {},
): SendApprovedInvoiceEmailSmtpInput {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: ['sendInvoices'],
    }),
    attemptId: 'attempt-1',
    authorizationToken: 'one-time-authorization',
    body: 'Hei, liitteenä lasku.',
    cc: 'copy@example.fi',
    invoiceId: 'invoice-1',
    sentAt: '2026-07-17T22:00:00.000Z',
    subject: 'Lasku 20260001',
    to: 'customer@example.fi',
    ...overrides,
  };
}

function createInvoice(
  status: ApprovedInvoiceView['status'],
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    invoiceNumber: '20260001',
    status,
  } as ApprovedInvoiceView;
}

function createEmailSettings(
  overrides: Partial<{
    emailDeliveryProvider: 'dnaSmtp';
    emailSenderAddress: string;
    emailSenderName: string;
    emailTestRecipientOverride: string;
    emailUsername: string;
  }> = {},
) {
  return {
    emailDeliveryProvider: 'dnaSmtp' as const,
    emailSenderAddress: 'billing@example.fi',
    emailSenderName: 'Example Oy',
    emailTestRecipientOverride: 'owner-test@example.fi',
    emailUsername: 'billing@example.fi',
    ...overrides,
  };
}

function createDocumentMetadata(
  overrides: Partial<ApprovedInvoiceDocumentMetadata> = {},
): ApprovedInvoiceDocumentMetadata {
  return {
    companyId: 'company-1',
    createdAt: '2026-07-17T22:00:00.000Z',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    id: 'document-1',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    sha256: '0'.repeat(64),
    sizeBytes: 2048,
    storagePath: 'company-1/invoice-1/lasku.pdf',
    ...overrides,
  };
}

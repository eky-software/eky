import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
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
import type { InvoiceSmtpDeliveryProvider } from '../ports/invoiceSmtpDeliveryProvider.js';
import { InvoiceSmtpDeliveryError } from '../ports/invoiceSmtpDeliveryProvider.js';

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
      return { invoiceStatus: 'sent' as const, wasResend: false };
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
});

function createDependencies(options: {
  completeSuccessfulEmailDelivery?: InvoiceEmailDeliveryFinalizer['completeSuccessfulEmailDelivery'];
  getStatus?: () => 'approved' | 'sent';
  pdfContent?: Buffer;
  repository?: FakeDeliveryEventRepository;
  sendEmail?: InvoiceSmtpDeliveryProvider['sendEmail'];
} = {}) {
  const repository = options.repository ?? new FakeDeliveryEventRepository();
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
    ensureApprovedInvoicePdfDocument: vi.fn(async () =>
      createDocumentMetadata(),
    ),
    getApprovedInvoicePdfDocument: vi.fn(async () => ({
      content: options.pdfContent ?? Buffer.from('%PDF-1.7 synthetic'),
      metadata: createDocumentMetadata(),
    })),
    invoiceDeliveryEventRepository: repository,
    invoiceEmailDeliveryFinalizer: {
      completeSuccessfulEmailDelivery:
        options.completeSuccessfulEmailDelivery ??
        vi.fn(async () => ({
          invoiceStatus: 'sent' as const,
          wasResend: false,
        })),
    },
    invoiceEmailSendAttemptStore: {
      acquire: vi.fn(),
      complete: vi.fn(),
      prepare: vi.fn(),
    },
    invoiceEmailSettingsReader: {
      getEmailSettings: vi.fn(async () => createEmailSettings()),
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

function createInvoice(status: 'approved' | 'sent'): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    invoiceNumber: '20260001',
    status,
  } as ApprovedInvoiceView;
}

function createEmailSettings() {
  return {
    emailDeliveryProvider: 'dnaSmtp' as const,
    emailSenderAddress: 'billing@example.fi',
    emailSenderName: 'Example Oy',
    emailTestRecipientOverride: 'owner-test@example.fi',
    emailUsername: 'billing@example.fi',
  };
}

function createDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
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
  };
}

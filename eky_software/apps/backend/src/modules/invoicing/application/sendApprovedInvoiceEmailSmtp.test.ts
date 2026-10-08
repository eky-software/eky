import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceEmailDeliveryOutcomeUnknownError } from './approvedInvoiceEmailDeliveryOutcomeUnknownError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { InvoiceEmailDeliveryCommittedError } from './invoiceEmailDeliveryCommittedError.js';
import { InvoiceEmailSendAttemptError } from './invoiceEmailSendAttemptError.js';
import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import {
  createInvoiceEmailDeliveryDocument,
  FakeInvoiceDeliveryEventRepository,
} from './invoiceSmtpApplication.fixture.js';
import {
  sendApprovedInvoiceEmailSmtp,
  type SendApprovedInvoiceEmailSmtpDependencies,
  type SendApprovedInvoiceEmailSmtpInput,
} from './sendApprovedInvoiceEmailSmtp.js';
import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailDeliveryFinalizer } from '../ports/invoiceEmailDeliveryFinalizer.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';
import type { InvoiceSmtpDeliveryProvider } from '../ports/invoiceSmtpDeliveryProvider.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../ports/deliveredInvoiceArchiveTaskSink.js';
import { InvoiceSmtpDeliveryError } from '../ports/invoiceSmtpDeliveryProvider.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';

describe('sendApprovedInvoiceEmailSmtp', () => {
  it('reserves before SMTP and delegates customer success to the finalizer', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const expectedPdfContent = Buffer.from(pdfContent);
    let currentStatus: 'approved' | 'sent' = 'approved';
    const sendEmail = vi.fn<InvoiceSmtpDeliveryProvider['sendEmail']>(async (input) => {
      expect(repository.reserveEmailDelivery).toHaveBeenCalledOnce();
      expect(repository.reservations).toHaveLength(1);
      expect(repository.completeDeliveryEvent).not.toHaveBeenCalled();
      expect(currentStatus).toBe('approved');
      expect(input.pdfContent).toBe(pdfContent);
      expect(input.pdfContent).toEqual(expectedPdfContent);
      expect(input).toMatchObject({
        attemptId: 'attempt-1',
        body: createInput().body,
        cc: 'copy@example.fi',
        companyId: 'company-1',
        pdfFileName: 'lasku-20260001.pdf',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
      });

      return {
        deliveredCc: 'copy@example.fi',
        deliveredTo: 'customer@example.fi',
        provider: 'smtp' as const,
        providerMessageId: '<message@example.fi>',
        testMode: false as const,
      };
    });
    const completeSuccessfulEmailDelivery = vi.fn<InvoiceEmailDeliveryFinalizer['completeSuccessfulEmailDelivery']>(async (input) => {
      expect(sendEmail).toHaveBeenCalledOnce();
      expect(input.reservation).toBe(repository.reservations[0]);
      currentStatus = 'sent';
      return { outcome: 'completed' };
    });

    const dependencies = createDependencies({
      completeSuccessfulEmailDelivery,
      getStatus: () => currentStatus,
      pdfContent,
      repository,
      sendEmail,
    });
    const result = await sendApprovedInvoiceEmailSmtp(
      createInput(),
      dependencies,
    );

    expect(repository.reserveEmailDelivery).toHaveBeenCalledWith({
      bodyPreview: createInput().body,
      ccEmail: 'copy@example.fi',
      createdAt: '2026-07-17T22:00:00.000Z',
      createdBy: 'user-1',
      eventId: 'attempt-1',
      mode: 'customer',
      recipientEmail: 'customer@example.fi',
      subject: 'Lasku 20260001',
      target: {
        companyId: 'company-1',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
        kind: 'revision',
        revisionId: 'revision-1',
        sha256: '0'.repeat(64),
        sizeBytes: 2048,
      },
    });
    expect(completeSuccessfulEmailDelivery).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: { status: 'succeeded', providerMessageId: '<message@example.fi>' },
    });
    expect(repository.completeDeliveryEvent).not.toHaveBeenCalled();
    expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
    expect(dependencies.loadCustomerInvoiceEmailDocument).toHaveBeenCalledExactlyOnceWith({
      actorContext: createInput().actorContext,
      documentTarget: createInput().documentTarget,
      createdAt: '2026-07-17T22:00:00.000Z',
      invoiceId: 'invoice-1',
    });
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1',
      outcome: 'succeeded',
    });
    expect(result.invoice.status).toBe('sent');
    expect(result.resend).toBe(false);
    expect(pdfContent.every((value) => value === 0)).toBe(true);
    expect(
      dependencies.deliveredInvoiceArchiveTaskSink
        .queueDeliveredInvoiceArchiveTask,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: '2026-07-17T22:00:00.000Z',
        deliveryEventId: 'attempt-1',
        documentId: 'document-1',
        invoiceId: 'invoice-1',
        invoiceKind: 'standard',
        invoiceNumber: '20260001',
      }),
    );
  });

  it('records a definite failure without finalizing or changing invoice status', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const completeSuccessfulEmailDelivery = vi.fn();
    const dependencies = createDependencies({
      completeSuccessfulEmailDelivery,
      repository,
      sendEmail: vi.fn(async () => {
        throw new InvoiceSmtpDeliveryError('failed', 'DNA_SMTP_AUTH_REJECTED');
      }),
    });

    await expect(
      sendApprovedInvoiceEmailSmtp(
        createInput(),
        dependencies,
      ),
    ).rejects.toEqual(
      new ApprovedInvoiceEmailDeliveryError('Invoice email delivery failed.'),
    );

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice email delivery failed.',
        status: 'failed',
        technicalErrorCode: 'DNA_SMTP_AUTH_REJECTED',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1',
      outcome: 'failed',
    });
    expect(completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
  });

  it('keeps a successful SMTP delivery successful when local archival fails', async () => {
    const dependencies = createDependencies({
      queueDeliveredInvoiceArchiveTask: vi.fn(async () => {
        throw new Error('local archive unavailable');
      }),
    });
    const result = await sendApprovedInvoiceEmailSmtp(
      createInput(),
      dependencies,
    );

    expect(result.invoice.status).toBe('sent');
    expect(
      dependencies.deliveredInvoiceArchiveQueueFailureReporter
        .reportQueueFailure,
    ).toHaveBeenCalledOnce();
  });

  it('records outcomeUnknown and never marks the invoice sent', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
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

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
        technicalErrorCode: 'SMTP_FINAL_RESPONSE_MISSING',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
  });

  it('treats a mismatching provider result as unknown and never marks the invoice sent', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
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

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice email delivery outcome is unknown.',
        status: 'outcomeUnknown',
        technicalErrorCode: null,
      },
    });
    expect(completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
  });

  it('resends an already sent invoice without creating a new invoice identity', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    repository.invoiceStatusAtReservation = 'sent';
    const completeSuccessfulEmailDelivery = vi.fn(async () => ({
      outcome: 'completed' as const,
    }));

    const result = await sendApprovedInvoiceEmailSmtp(
      createInput(),
      createDependencies({
        completeSuccessfulEmailDelivery,
        getStatus: () => 'sent',
        repository,
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

  it.each([
    { outcome: 'completed', reservationStatus: 'approved', resend: false },
    { outcome: 'completed', reservationStatus: 'sent', resend: true },
    { outcome: 'alreadyCompleted', reservationStatus: 'approved', resend: false },
    { outcome: 'alreadyCompleted', reservationStatus: 'sent', resend: true },
  ] as const)(
    'rereads after $outcome and derives resend from reserved $reservationStatus status',
    async ({ outcome, reservationStatus, resend }) => {
      const currentInvoice = {
        ...createInvoice('sent'),
        updatedAt: '2026-07-17T22:01:00.000Z',
      };
      const completeSuccessfulEmailDelivery = vi.fn<InvoiceEmailDeliveryFinalizer['completeSuccessfulEmailDelivery']>(
        async () => ({ outcome }),
      );
      const getApprovedInvoiceById = vi.fn<ApprovedInvoiceReader['getApprovedInvoiceById']>()
        .mockResolvedValueOnce(createInvoice('approved'))
        .mockImplementationOnce(async () => {
          expect(completeSuccessfulEmailDelivery).toHaveBeenCalledOnce();
          return currentInvoice;
        });
      const repository = new FakeInvoiceDeliveryEventRepository();
      repository.invoiceStatusAtReservation = reservationStatus;
      const dependencies = createDependencies({
        completeSuccessfulEmailDelivery,
        repository,
      });
      dependencies.approvedInvoiceReader.getApprovedInvoiceById =
        getApprovedInvoiceById;

      const result = await sendApprovedInvoiceEmailSmtp(createInput(), dependencies);
      expect(result.invoice).toBe(currentInvoice);
      expect(result.resend).toBe(resend);
      expect(completeSuccessfulEmailDelivery.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
      expect(getApprovedInvoiceById.mock.calls).toEqual([
        ['company-1', 'invoice-1'],
        ['company-1', 'invoice-1'],
      ]);
    },
  );

  it('stops before the provider when reservation conflicts after document loading', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    repository.reserveEmailDelivery.mockResolvedValue({ outcome: 'conflict' });
    const pdfContent = Buffer.from('%PDF-1.7 synthetic');
    const dependencies = createDependencies({ pdfContent, repository });

    await expect(
      sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
    ).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);

    expect(dependencies.loadCustomerInvoiceEmailDocument).toHaveBeenCalledOnce();
    expect(dependencies.invoiceEmailSendAttemptStore.acquire).toHaveBeenCalledOnce();
    expect(repository.reserveEmailDelivery).toHaveBeenCalledOnce();
    expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
    expect(repository.completeDeliveryEvent).not.toHaveBeenCalled();
    expect(dependencies.invoiceSmtpDeliveryProvider.sendEmail).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailDeliveryFinalizer.completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
    expect(dependencies.deliveredInvoiceArchiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
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
      sendEmail: vi.fn(async () => {
        throw new Error('synthetic private provider details');
      }),
    });

    await expect(
      sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
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
    expect(dependencies.invoiceSmtpDeliveryProvider.sendEmail).toHaveBeenCalledOnce();
    expect(dependencies.invoiceEmailDeliveryFinalizer.completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
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
      sendEmail: vi.fn(async () => {
        throw new InvoiceSmtpDeliveryError('failed', 'DNA_SMTP_AUTH_REJECTED');
      }),
    });

    await expect(
      sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
    ).rejects.toEqual(new ApprovedInvoiceEmailDeliveryOutcomeUnknownError());

    expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
      reservation: repository.reservations[0],
      result: {
        safeErrorMessage: 'Invoice email delivery failed.',
        status: 'failed',
        technicalErrorCode: 'DNA_SMTP_AUTH_REJECTED',
      },
    });
    expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
    expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt-1', outcome: 'outcomeUnknown',
    });
    expect(dependencies.invoiceSmtpDeliveryProvider.sendEmail).toHaveBeenCalledOnce();
    expect(dependencies.invoiceEmailDeliveryFinalizer.completeSuccessfulEmailDelivery).not.toHaveBeenCalled();
    expect(pdfContent.every((value) => value === 0)).toBe(true);
  });

  it.each([false, true])(
    'keeps finalizer failure uncertain even when unknown recording also fails: %s',
    async (unknownRecordingFails) => {
      const repository = new FakeInvoiceDeliveryEventRepository();
      if (unknownRecordingFails) {
        repository.completeDeliveryEvent.mockRejectedValue(new Error('synthetic completion failure'));
      }
      const pdfContent = Buffer.from('%PDF-1.7 synthetic');
      const completeSuccessfulEmailDelivery = vi.fn<InvoiceEmailDeliveryFinalizer['completeSuccessfulEmailDelivery']>(async () => {
        throw new Error('synthetic finalizer failure');
      });
      const dependencies = createDependencies({ completeSuccessfulEmailDelivery, pdfContent, repository });

      await expect(
        sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
      ).rejects.toEqual(new ApprovedInvoiceEmailDeliveryOutcomeUnknownError());

      expect(completeSuccessfulEmailDelivery).toHaveBeenCalledExactlyOnceWith({
        reservation: repository.reservations[0],
        result: { status: 'succeeded', providerMessageId: null },
      });
      expect(completeSuccessfulEmailDelivery.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
      expect(repository.completeDeliveryEvent).toHaveBeenCalledExactlyOnceWith({
        reservation: repository.reservations[0],
        result: {
          status: 'outcomeUnknown',
          safeErrorMessage: 'Invoice email delivery outcome is unknown.',
          technicalErrorCode: null,
        },
      });
      expect(repository.completeDeliveryEvent.mock.calls[0]?.[0].reservation).toBe(repository.reservations[0]);
      expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
        attemptId: 'attempt-1', outcome: 'outcomeUnknown',
      });
      expect(dependencies.invoiceSmtpDeliveryProvider.sendEmail).toHaveBeenCalledOnce();
      expect(dependencies.approvedInvoiceReader.getApprovedInvoiceById).toHaveBeenCalledOnce();
      expect(dependencies.deliveredInvoiceArchiveTaskSink.queueDeliveredInvoiceArchiveTask).not.toHaveBeenCalled();
      expect(pdfContent.every((value) => value === 0)).toBe(true);
    },
  );

  it.each(['missing', 'throws'] as const)(
    'keeps the attempt succeeded when the postcommit read %s',
    async (failure) => {
      const repository = new FakeInvoiceDeliveryEventRepository();
      const pdfContent = Buffer.from('%PDF-1.7 synthetic');
      const dependencies = createDependencies({ pdfContent, repository });
      dependencies.approvedInvoiceReader.getApprovedInvoiceById
        .mockResolvedValueOnce(createInvoice('approved'))
        .mockImplementationOnce(async () => {
          expect(dependencies.invoiceEmailDeliveryFinalizer.completeSuccessfulEmailDelivery).toHaveBeenCalledOnce();
          if (failure === 'throws') throw new Error('synthetic private read details');
          return undefined;
        });

      const delivery = sendApprovedInvoiceEmailSmtp(createInput(), dependencies);
      await expect(delivery).rejects.toBeInstanceOf(InvoiceEmailDeliveryCommittedError);
      await expect(delivery).rejects.toMatchObject({
        message: 'Invoice email delivery succeeded, but the current invoice could not be read.',
      });

      expect(dependencies.invoiceEmailSendAttemptStore.complete).toHaveBeenCalledExactlyOnceWith({
        attemptId: 'attempt-1', outcome: 'succeeded',
      });
      expect(repository.completeDeliveryEvent).not.toHaveBeenCalled();
      expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
      expect(dependencies.invoiceSmtpDeliveryProvider.sendEmail).toHaveBeenCalledOnce();
      expect(dependencies.approvedInvoiceReader.getApprovedInvoiceById).toHaveBeenCalledTimes(2);
      expect(pdfContent.every((value) => value === 0)).toBe(true);
    },
  );

  it('rejects a cancelled invoice before settings, PDF, attempt, event, provider, or finalizer', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const dependencies = createDependencies({
      getStatus: () => 'cancelled',
      repository,
    });

    await expect(
      sendApprovedInvoiceEmailSmtp(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(dependencies.loadCustomerInvoiceEmailDocument).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailSendAttemptStore.acquire).not.toHaveBeenCalled();
    expect(repository.reserveEmailDelivery).not.toHaveBeenCalled();
    expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
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
      changedDocument: createDocumentMetadata({ binding: { kind: 'revision', revisionId: 'revision-2' } }),
      changedSettings: createEmailSettings(),
      label: 'content revision with unchanged document bytes',
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
            binding: originalDocument.binding,
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
      const repository = new FakeInvoiceDeliveryEventRepository();

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
      expect(repository.reserveEmailDelivery).not.toHaveBeenCalled();
      expect(repository.saveDeliveryEvent).not.toHaveBeenCalled();
    },
  );
});

function createDependencies(options: {
  completeSuccessfulEmailDelivery?: InvoiceEmailDeliveryFinalizer['completeSuccessfulEmailDelivery'];
  attemptStore?: InvoiceEmailSendAttemptStore;
  documentMetadata?: RevisionInvoiceDocumentMetadata;
  emailSettings?: ReturnType<typeof createEmailSettings>;
  getStatus?: () => ApprovedInvoiceView['status'];
  pdfContent?: Buffer;
  repository?: FakeInvoiceDeliveryEventRepository;
  queueDeliveredInvoiceArchiveTask?: DeliveredInvoiceArchiveTaskSink['queueDeliveredInvoiceArchiveTask'];
  sendEmail?: InvoiceSmtpDeliveryProvider['sendEmail'];
} = {}) {
  const repository = options.repository ?? new FakeInvoiceDeliveryEventRepository();
  const documentMetadata =
    options.documentMetadata ?? createDocumentMetadata();
  let currentStatus: ApprovedInvoiceView['status'] = 'approved';
  const getStatus = options.getStatus ?? (() => currentStatus);
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
      getApprovedInvoiceById: vi.fn<ApprovedInvoiceReader['getApprovedInvoiceById']>(async () => createInvoice(getStatus())),
      listApprovedInvoiceSummaries: vi.fn(),
    },
    deliveredInvoiceArchiveQueueFailureReporter: {
      reportQueueFailure: vi.fn(),
    },
    deliveredInvoiceArchiveTaskSink: {
      queueDeliveredInvoiceArchiveTask:
        options.queueDeliveredInvoiceArchiveTask ??
        vi.fn(async () => undefined),
    },
    loadCustomerInvoiceEmailDocument: vi.fn<SendApprovedInvoiceEmailSmtpDependencies['loadCustomerInvoiceEmailDocument']>(async () =>
      createInvoiceEmailDeliveryDocument(
        documentMetadata,
        options.pdfContent ?? Buffer.from('%PDF-1.7 synthetic'),
      ),
    ),
    invoiceDeliveryEventReader: { requiresLegacyDeliveryReview: vi.fn(async () => false) },
    invoiceDeliveryEventRepository: repository,
    invoiceEmailDeliveryFinalizer: {
      completeSuccessfulEmailDelivery:
        options.completeSuccessfulEmailDelivery ??
        vi.fn(async () => {
          currentStatus = 'sent';
          return { outcome: 'completed' as const };
        }),
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
  } satisfies SendApprovedInvoiceEmailSmtpDependencies;
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
    documentTarget: { kind: 'revision', documentId: 'document-1' },
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
    invoiceKind: 'standard',
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
  overrides: Partial<RevisionInvoiceDocumentMetadata> = {},
): RevisionInvoiceDocumentMetadata {
  return {
    binding: { kind: 'revision', revisionId: 'revision-1' },
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

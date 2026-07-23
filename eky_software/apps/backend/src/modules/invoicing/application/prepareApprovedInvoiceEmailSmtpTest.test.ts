import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceEmailDeliveryError } from './approvedInvoiceEmailDeliveryError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { prepareApprovedInvoiceEmailSmtpTest } from './prepareApprovedInvoiceEmailSmtpTest.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';

class FakeApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(
    private readonly invoice: ApprovedInvoiceView = {
      id: 'invoice-1',
      status: 'approved',
    } as ApprovedInvoiceView,
  ) {}

  async getApprovedInvoiceById(): Promise<ApprovedInvoiceView> {
    return this.invoice;
  }

  async listApprovedInvoiceSummaries(): Promise<never> {
    throw new Error('Not implemented in SMTP preparation test.');
  }
}

describe('prepareApprovedInvoiceEmailSmtpTest', () => {
  it('binds a short-lived attempt to the trusted test recipient and PDF', async () => {
    const attemptStore: InvoiceEmailSendAttemptStore = {
      acquire: vi.fn(),
      complete: vi.fn(),
      prepare: vi.fn(() => ({
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        expiresAt: '2026-07-16T10:01:00.000Z',
      })),
    };
    const dependencies = createDependencies({ attemptStore });

    await expect(
      prepareApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).resolves.toEqual({
      attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
      expiresAt: '2026-07-16T10:01:00.000Z',
      invoiceId: 'invoice-1',
      subject: 'Lasku 20260001',
      testRecipient: 'owner-test@example.fi',
    });
    expect(attemptStore.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        mode: 'smtpTest',
        provider: 'dnaSmtp',
        recipient: 'owner-test@example.fi',
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('rejects a non-DNA profile before creating an authorization', async () => {
    const attemptStore: InvoiceEmailSendAttemptStore = {
      acquire: vi.fn(),
      complete: vi.fn(),
      prepare: vi.fn(() => {
        throw new Error('Must not prepare.');
      }),
    };

    await expect(
      prepareApprovedInvoiceEmailSmtpTest(
        createInput(),
        createDependencies({ attemptStore, provider: 'dryRun' }),
      ),
    ).rejects.toBeInstanceOf(ApprovedInvoiceEmailDeliveryError);
    expect(attemptStore.prepare).not.toHaveBeenCalled();
  });

  it('rejects a cancelled invoice before settings, PDF, or authorization', async () => {
    const dependencies = createDependencies({
      invoice: {
        id: 'invoice-1',
        status: 'cancelled',
      } as ApprovedInvoiceView,
    });

    await expect(
      prepareApprovedInvoiceEmailSmtpTest(createInput(), dependencies),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
    expect(dependencies.invoiceEmailSendAttemptStore.prepare).not.toHaveBeenCalled();
  });

  it('denies preparation before reading invoice or settings', async () => {
    const dependencies = createDependencies();

    await expect(
      prepareApprovedInvoiceEmailSmtpTest(
        createInput({
          actorContext: createActorContext({
            actorId: 'user-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          }),
        }),
        dependencies,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(dependencies.invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(dependencies.ensureApprovedInvoicePdfDocument).not.toHaveBeenCalled();
  });
});

function createDependencies(options: {
  attemptStore?: InvoiceEmailSendAttemptStore;
  invoice?: ApprovedInvoiceView;
  provider?: 'dnaSmtp' | 'dryRun';
} = {}) {
  return {
    approvedInvoiceReader: new FakeApprovedInvoiceReader(options.invoice),
    ensureApprovedInvoicePdfDocument: vi.fn(async () => ({
      companyId: 'company-1',
      createdAt: '2026-07-16T10:00:00.000Z',
      documentType: 'approved_invoice_pdf' as const,
      fileName: 'invoice.pdf',
      id: 'document-1',
      invoiceId: 'invoice-1',
      mimeType: 'application/pdf' as const,
      sha256: '0'.repeat(64),
      sizeBytes: 2048,
      storagePath: 'company-1/invoice-1/invoice.pdf',
    })),
    invoiceEmailSettingsReader: {
      getEmailSettings: vi.fn(async () => ({
        emailDeliveryProvider: options.provider ?? 'dnaSmtp',
        emailSenderAddress: 'billing@example.fi',
        emailSenderName: 'Example Oy',
        emailTestRecipientOverride: 'owner-test@example.fi',
        emailUsername: 'billing@example.fi',
      })),
    },
    invoiceEmailSendAttemptStore:
      options.attemptStore ??
      ({
        acquire: vi.fn(),
        complete: vi.fn(),
        prepare: vi.fn(() => ({
          attemptId: 'attempt-1',
          authorizationToken: 'one-time-authorization',
          expiresAt: '2026-07-16T10:01:00.000Z',
        })),
      } satisfies InvoiceEmailSendAttemptStore),
  };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: ['sendInvoices'],
    }),
    body: 'Hei, liitteenä lasku.',
    cc: 'copy@example.fi',
    invoiceId: 'invoice-1',
    preparedAt: '2026-07-16T10:00:00.000Z',
    subject: 'Lasku 20260001',
    to: 'customer@example.fi',
    ...overrides,
  };
}

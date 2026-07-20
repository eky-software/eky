import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { prepareApprovedInvoiceEmailSmtp } from './prepareApprovedInvoiceEmailSmtp.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceEmailSendAttemptStore } from '../ports/invoiceEmailSendAttemptStore.js';

describe('prepareApprovedInvoiceEmailSmtp', () => {
  it.each([
    ['approved', false],
    ['sent', true],
  ] as const)(
    'prepares an exact one-time customer delivery for a %s invoice',
    async (status, resend) => {
      const attemptStore: InvoiceEmailSendAttemptStore = {
        acquire: vi.fn(),
        complete: vi.fn(),
        prepare: vi.fn(() => ({
          attemptId: 'attempt-1',
          authorizationToken: 'one-time-authorization',
          expiresAt: '2026-07-17T22:01:00.000Z',
        })),
      };

      await expect(
        prepareApprovedInvoiceEmailSmtp(createInput(), {
          approvedInvoiceReader: {
            getApprovedInvoiceById: vi.fn(async () =>
              createInvoice(status),
            ),
            listApprovedInvoiceSummaries: vi.fn(),
          },
          ensureApprovedInvoicePdfDocument: vi.fn(async () => ({
            companyId: 'company-1',
            createdAt: '2026-07-17T22:00:00.000Z',
            documentType: 'approved_invoice_pdf' as const,
            fileName: 'lasku-20260001.pdf',
            id: 'document-1',
            invoiceId: 'invoice-1',
            mimeType: 'application/pdf' as const,
            sha256: '0'.repeat(64),
            sizeBytes: 2048,
            storagePath: 'company-1/invoice-1/lasku.pdf',
          })),
          invoiceEmailSendAttemptStore: attemptStore,
          invoiceEmailSettingsReader: {
            getEmailSettings: vi.fn(async () => createEmailSettings()),
          },
          invoiceDeliveryEventReader: createDeliveryEventReader(false),
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          attemptId: 'attempt-1',
          body: 'Hei, liitteenä lasku.',
          cc: 'copy@example.fi',
          invoiceNumber: '20260001',
          recipient: 'customer@example.fi',
          resend,
          sender: 'Example Oy <billing@example.fi>',
          subject: 'Lasku 20260001',
        }),
      );
      expect(attemptStore.prepare).toHaveBeenCalledWith({
        actorId: 'user-1',
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        mode: 'customer',
        provider: 'dnaSmtp',
        recipient: 'customer@example.fi',
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    },
  );

  it('blocks preparation when a persistent delivery event is unresolved', async () => {
      const attemptStore: InvoiceEmailSendAttemptStore = {
        acquire: vi.fn(),
        complete: vi.fn(),
        prepare: vi.fn(),
      };

      await expect(
        prepareApprovedInvoiceEmailSmtp(createInput(), {
          approvedInvoiceReader: {
            getApprovedInvoiceById: vi.fn(async () => createInvoice('approved')),
            listApprovedInvoiceSummaries: vi.fn(),
          },
          ensureApprovedInvoicePdfDocument: vi.fn(),
          invoiceDeliveryEventReader: createDeliveryEventReader(true),
          invoiceEmailSendAttemptStore: attemptStore,
          invoiceEmailSettingsReader: {
            getEmailSettings: vi.fn(async () => createEmailSettings()),
          },
        }),
      ).rejects.toEqual(new InvoiceDeliveryConflictError());

      expect(attemptStore.prepare).not.toHaveBeenCalled();
  });
});

function createDeliveryEventReader(hasUnresolvedEvent: boolean) {
  return {
    hasUnresolvedDeliveryEvent: vi.fn(async () => hasUnresolvedEvent),
    listDeliveryEvents: vi.fn(async () => []),
  };
}

function createInput() {
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
    preparedAt: '2026-07-17T22:00:00.000Z',
    subject: 'Lasku 20260001',
    to: 'customer@example.fi',
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

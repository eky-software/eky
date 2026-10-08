import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { prepareApprovedInvoiceEmailSmtp } from './prepareApprovedInvoiceEmailSmtp.js';
import { createEmailDocument } from './loadInvoiceEmailDeliveryDocument.fixture.js';
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
          loadCustomerInvoiceEmailDocument: vi.fn(async () => createEmailDocument()),
          invoiceEmailSendAttemptStore: attemptStore,
          invoiceEmailSettingsReader: {
            getEmailSettings: vi.fn(async () => createEmailSettings()),
          },
          invoiceDeliveryEventReader: createDeliveryEventReader(false),
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          attemptId: 'attempt-1',
          documentTarget: { kind: 'revision', documentId: 'document-1' },
          attachment: expect.objectContaining({ documentId: 'document-1' }),
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
          loadCustomerInvoiceEmailDocument: vi.fn(),
          invoiceDeliveryEventReader: createDeliveryEventReader(true),
          invoiceEmailSendAttemptStore: attemptStore,
          invoiceEmailSettingsReader: {
            getEmailSettings: vi.fn(async () => createEmailSettings()),
          },
        }),
      ).rejects.toEqual(new InvoiceDeliveryConflictError());

      expect(attemptStore.prepare).not.toHaveBeenCalled();
  });

  it('rejects a cancelled invoice before delivery state, settings, PDF, or authorization', async () => {
    const invoiceDeliveryEventReader = createDeliveryEventReader(false);
    const loadCustomerInvoiceEmailDocument = vi.fn();
    const invoiceEmailSendAttemptStore: InvoiceEmailSendAttemptStore = {
      acquire: vi.fn(),
      complete: vi.fn(),
      prepare: vi.fn(),
    };
    const invoiceEmailSettingsReader = {
      getEmailSettings: vi.fn(async () => createEmailSettings()),
    };

    await expect(
      prepareApprovedInvoiceEmailSmtp(createInput(), {
        approvedInvoiceReader: {
          getApprovedInvoiceById: vi.fn(async () =>
            createInvoice('cancelled'),
          ),
          listApprovedInvoiceSummaries: vi.fn(),
        },
        loadCustomerInvoiceEmailDocument,
        invoiceDeliveryEventReader,
        invoiceEmailSendAttemptStore,
        invoiceEmailSettingsReader,
      }),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);

    expect(
      invoiceDeliveryEventReader.hasUnresolvedDeliveryEvent,
    ).not.toHaveBeenCalled();
    expect(invoiceEmailSettingsReader.getEmailSettings).not.toHaveBeenCalled();
    expect(loadCustomerInvoiceEmailDocument).not.toHaveBeenCalled();
    expect(invoiceEmailSendAttemptStore.prepare).not.toHaveBeenCalled();
  });
});

function createDeliveryEventReader(hasUnresolvedEvent: boolean) {
  return {
    requiresLegacyDeliveryReview: vi.fn(async () => false),
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
    documentTarget: { kind: 'revision' as const, documentId: 'document-1' },
    invoiceId: 'invoice-1',
    preparedAt: '2026-07-17T22:00:00.000Z',
    subject: 'Lasku 20260001',
    to: 'customer@example.fi',
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

function createEmailSettings() {
  return {
    emailDeliveryProvider: 'dnaSmtp' as const,
    emailSenderAddress: 'billing@example.fi',
    emailSenderName: 'Example Oy',
    emailTestRecipientOverride: 'owner-test@example.fi',
    emailUsername: 'billing@example.fi',
  };
}

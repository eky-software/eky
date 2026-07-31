import type { ActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import type { InvoicePaymentRepository } from '../ports/invoicePaymentRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { markInvoicePaid } from './markInvoicePaid.js';

const actorContext: ActorContext = {
  actorId: 'local-owner',
  authenticationMode: 'local',
  companyId: 'company-1',
  permissions: ['manageInvoicePayments'],
};
const fixedNow = new Date('2026-07-31T10:00:00.000Z');

describe('markInvoicePaid', () => {
  it('passes only trusted identity, date and backend time to persistence', async () => {
    const repository = createRepository();
    vi.mocked(repository.markInvoicePaid).mockResolvedValue({
      outcome: 'markedPaid',
      payment: paidSummary(),
    });

    await expect(
      markInvoicePaid(
        {
          actorContext,
          invoiceId: 'invoice-1',
          paidOn: '2026-07-31',
        },
        {
          clock: { now: () => fixedNow },
          invoicePaymentRepository: repository,
        },
      ),
    ).resolves.toEqual(paidSummary());

    expect(repository.markInvoicePaid).toHaveBeenCalledWith({
      actorUserId: 'local-owner',
      companyId: 'company-1',
      eventId: expect.any(String),
      invoiceId: 'invoice-1',
      paidOn: '2026-07-31',
      recordedAt: '2026-07-31T10:00:00.000Z',
    });
  });

  it('rejects missing permission before persistence', async () => {
    const repository = createRepository();

    await expect(
      markInvoicePaid(
        {
          actorContext: { ...actorContext, permissions: [] },
          invoiceId: 'invoice-1',
          paidOn: '2026-07-31',
        },
        {
          clock: { now: () => fixedNow },
          invoicePaymentRepository: repository,
        },
      ),
    ).rejects.toThrow('Permission denied.');

    expect(repository.markInvoicePaid).not.toHaveBeenCalled();
  });

  it('rejects an invalid or future Helsinki date before persistence', async () => {
    const repository = createRepository();

    await expect(
      markInvoicePaid(
        {
          actorContext,
          invoiceId: 'invoice-1',
          paidOn: '2026-08-01',
        },
        {
          clock: { now: () => fixedNow },
          invoicePaymentRepository: repository,
        },
      ),
    ).rejects.toMatchObject({ code: 'invoice_payment_date_invalid' });
    await expect(
      markInvoicePaid(
        {
          actorContext,
          invoiceId: 'invoice-1',
          paidOn: '2026-02-30',
        },
        {
          clock: { now: () => fixedNow },
          invoicePaymentRepository: repository,
        },
      ),
    ).rejects.toThrow();

    expect(repository.markInvoicePaid).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'notPayable'] as const)(
    'maps %s to a safe payment conflict',
    async (outcome) => {
      const repository = createRepository();
      vi.mocked(repository.markInvoicePaid).mockResolvedValue({ outcome });

      await expect(
        markInvoicePaid(
          {
            actorContext,
            invoiceId: 'invoice-1',
            paidOn: '2026-07-31',
          },
          {
            clock: { now: () => fixedNow },
            invoicePaymentRepository: repository,
          },
        ),
      ).rejects.toMatchObject({ code: 'invoice_payment_conflict' });
    },
  );

  it('maps company-scoped not found to the generic invoice error', async () => {
    const repository = createRepository();
    vi.mocked(repository.markInvoicePaid).mockResolvedValue({
      outcome: 'notFound',
    });

    await expect(
      markInvoicePaid(
        {
          actorContext,
          invoiceId: 'invoice-1',
          paidOn: '2026-07-31',
        },
        {
          clock: { now: () => fixedNow },
          invoicePaymentRepository: repository,
        },
      ),
    ).rejects.toBeInstanceOf(ApprovedInvoiceNotFoundError);
  });
});

function createRepository(): InvoicePaymentRepository {
  return {
    markInvoicePaid: vi.fn(),
    revertInvoicePaidMark: vi.fn(),
  };
}

function paidSummary() {
  return {
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    paidAmountCents: 12_550,
    paidOn: '2026-07-31',
    paymentSource: 'manual' as const,
    paymentState: 'paid' as const,
  };
}

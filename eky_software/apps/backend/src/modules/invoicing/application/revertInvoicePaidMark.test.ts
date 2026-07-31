import type { ActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import type { InvoicePaymentRepository } from '../ports/invoicePaymentRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { revertInvoicePaidMark } from './revertInvoicePaidMark.js';

const actorContext: ActorContext = {
  actorId: 'local-owner',
  authenticationMode: 'local',
  companyId: 'company-1',
  permissions: ['manageInvoicePayments'],
};

describe('revertInvoicePaidMark', () => {
  it('uses trusted actor and backend time', async () => {
    const repository = createRepository();
    vi.mocked(repository.revertInvoicePaidMark).mockResolvedValue({
      outcome: 'reverted',
      payment: unpaidSummary(),
    });

    await expect(
      revertInvoicePaidMark(
        { actorContext, invoiceId: 'invoice-1' },
        {
          clock: { now: () => new Date('2026-07-31T10:00:00.000Z') },
          invoicePaymentRepository: repository,
        },
      ),
    ).resolves.toEqual(unpaidSummary());

    expect(repository.revertInvoicePaidMark).toHaveBeenCalledWith({
      actorUserId: 'local-owner',
      companyId: 'company-1',
      eventId: expect.any(String),
      invoiceId: 'invoice-1',
      recordedAt: '2026-07-31T10:00:00.000Z',
    });
  });

  it('rejects missing permission before persistence', async () => {
    const repository = createRepository();

    await expect(
      revertInvoicePaidMark(
        {
          actorContext: { ...actorContext, permissions: [] },
          invoiceId: 'invoice-1',
        },
        {
          clock: { now: () => new Date('2026-07-31T10:00:00.000Z') },
          invoicePaymentRepository: repository,
        },
      ),
    ).rejects.toThrow('Permission denied.');

    expect(repository.revertInvoicePaidMark).not.toHaveBeenCalled();
  });

  it('maps conflict to a safe application error', async () => {
    const repository = createRepository();
    vi.mocked(repository.revertInvoicePaidMark).mockResolvedValue({
      outcome: 'conflict',
    });

    await expect(
      revertInvoicePaidMark(
        { actorContext, invoiceId: 'invoice-1' },
        {
          clock: { now: () => new Date('2026-07-31T10:00:00.000Z') },
          invoicePaymentRepository: repository,
        },
      ),
    ).rejects.toMatchObject({ code: 'invoice_payment_conflict' });
  });

  it('maps not found to the generic invoice error', async () => {
    const repository = createRepository();
    vi.mocked(repository.revertInvoicePaidMark).mockResolvedValue({
      outcome: 'notFound',
    });

    await expect(
      revertInvoicePaidMark(
        { actorContext, invoiceId: 'invoice-1' },
        {
          clock: { now: () => new Date('2026-07-31T10:00:00.000Z') },
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

function unpaidSummary() {
  return {
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    paidAmountCents: null,
    paidOn: null,
    paymentSource: null,
    paymentState: 'unpaid' as const,
  };
}

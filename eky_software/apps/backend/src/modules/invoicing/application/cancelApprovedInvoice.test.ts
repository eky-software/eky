import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceCorrectionRepository } from '../ports/invoiceCorrectionRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  cancelApprovedInvoice,
  type CancelApprovedInvoiceInput,
} from './cancelApprovedInvoice.js';
import { InvoiceCancellationConflictError } from './invoiceCancellationConflictError.js';
import { InvoiceCancellationConfirmationError } from './invoiceCancellationConfirmationError.js';

describe('cancelApprovedInvoice', () => {
  it('uses trusted actor context and normalized user input', async () => {
    const cancelInvoice = vi.fn<InvoiceCorrectionRepository['cancelApprovedInvoice']>(
      async (input) => ({
        outcome: 'cancelled',
        invoice: {
          cancellationReason: input.cancellationReason,
          cancelledAt: input.cancelledAt,
          cancelledBy: input.actorUserId,
          invoiceId: input.invoiceId,
          invoiceKind: 'standard',
          invoiceNumber: input.confirmationInvoiceNumber,
          status: 'cancelled',
        },
      }),
    );

    await expect(
      cancelApprovedInvoice(
        createInput({
          cancellationReason: '  Lasku laadittiin vahingossa.  ',
          confirmationInvoiceNumber: ' 20260001 ',
        }),
        {
          invoiceCorrectionRepository: { cancelApprovedInvoice: cancelInvoice },
        },
      ),
    ).resolves.toEqual({
      cancellationReason: 'Lasku laadittiin vahingossa.',
      cancelledAt: '2026-07-23T10:00:00.000Z',
      cancelledBy: 'user-1',
      invoiceId: 'invoice-1',
      invoiceKind: 'standard',
      invoiceNumber: '20260001',
      status: 'cancelled',
    });

    expect(cancelInvoice).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      auditEventId: expectUuid(),
      cancellationReason: 'Lasku laadittiin vahingossa.',
      cancelledAt: '2026-07-23T10:00:00.000Z',
      companyId: 'company-1',
      confirmationInvoiceNumber: '20260001',
      invoiceId: 'invoice-1',
    });
  });

  it('rejects missing permission before invoking persistence', async () => {
    const cancelInvoice = vi.fn();

    await expect(
      cancelApprovedInvoice(
        createInput({
          actorContext: createActorContext({
            actorId: 'user-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          }),
        }),
        {
          invoiceCorrectionRepository: {
            cancelApprovedInvoice: cancelInvoice,
          },
        },
      ),
    ).rejects.toThrow('Permission denied');

    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'Cancellation reason is required.'],
    ['x'.repeat(501), 'Cancellation reason must be 500 characters or less.'],
    ['invalid\u0000reason', 'Cancellation reason is invalid.'],
  ])('rejects an invalid cancellation reason', async (reason, message) => {
    const cancelInvoice = vi.fn();

    await expect(
      cancelApprovedInvoice(createInput({ cancellationReason: reason }), {
        invoiceCorrectionRepository: {
          cancelApprovedInvoice: cancelInvoice,
        },
      }),
    ).rejects.toEqual(new InvoiceDraftValidationError(message));

    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it.each([
    ['notFound', ApprovedInvoiceNotFoundError],
    ['confirmationMismatch', InvoiceCancellationConfirmationError],
    ['deliveryConflict', InvoiceCancellationConflictError],
    ['notCancellable', InvoiceCancellationConflictError],
  ] as const)(
    'maps the %s persistence outcome to a safe application error',
    async (outcome, ErrorType) => {
      await expect(
        cancelApprovedInvoice(createInput(), {
          invoiceCorrectionRepository: {
            cancelApprovedInvoice: vi.fn(async () => ({ outcome })),
          },
        }),
      ).rejects.toBeInstanceOf(ErrorType);
    },
  );
});

function createInput(
  overrides: Partial<CancelApprovedInvoiceInput> = {},
): CancelApprovedInvoiceInput {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: ['manageInvoiceCorrections'],
    }),
    cancellationReason: 'Lasku laadittiin vahingossa.',
    cancelledAt: '2026-07-23T10:00:00.000Z',
    confirmationInvoiceNumber: '20260001',
    invoiceId: 'invoice-1',
    ...overrides,
  };
}

function expectUuid() {
  return expect.stringMatching(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
}

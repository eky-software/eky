import { EkyApiError } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoicePaymentErrorMessage,
  markInvoicePaidWithClient,
  revertInvoicePaidMarkWithClient,
} from './useInvoicePayment.js';
import { uiText } from '../../../i18n/fi.js';

describe('invoice payment client boundary', () => {
  it('sends only the trusted invoice id and user-entered payment date', async () => {
    const client = {
      markInvoicePaid: vi.fn(async () => createPaymentSummary('paid')),
      revertInvoicePaidMark: vi.fn(async () => createPaymentSummary('unpaid')),
    };

    await markInvoicePaidWithClient(client, 'invoice-1', '2026-07-31');
    await revertInvoicePaidMarkWithClient(client, 'invoice-1');

    expect(client.markInvoicePaid).toHaveBeenCalledWith('invoice-1', {
      paidOn: '2026-07-31',
    });
    expect(client.revertInvoicePaidMark).toHaveBeenCalledWith('invoice-1');
  });
});

describe('getInvoicePaymentErrorMessage', () => {
  it.each([
    [400, uiText.invoicing.invoicePaymentDateError],
    [403, uiText.invoicing.invoicePaymentPermissionError],
    [404, uiText.invoicing.approvedInvoiceNotFound],
    [409, uiText.invoicing.invoicePaymentConflictError],
  ])('maps status %s to a safe Finnish message', (status, expected) => {
    expect(
      getInvoicePaymentErrorMessage(
        new EkyApiError('Technical message', { status }),
      ),
    ).toBe(expected);
  });

  it('does not expose response data or a stack', () => {
    const message = getInvoicePaymentErrorMessage(
      new EkyApiError('SQL stack', {
        responseBody: { paidOn: 'private', stack: 'secret' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.invoicePaymentUpdateError);
    expect(message).not.toContain('private');
    expect(message).not.toContain('stack');
  });
});

function createPaymentSummary(
  state: 'paid' | 'unpaid',
): import('@eky/api-client').InvoicePaymentSummary {
  return {
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    paidAmountCents: state === 'paid' ? 12550 : null,
    paidOn: state === 'paid' ? '2026-07-31' : null,
    paymentSource: state === 'paid' ? 'manual' : null,
    paymentState: state,
  };
}

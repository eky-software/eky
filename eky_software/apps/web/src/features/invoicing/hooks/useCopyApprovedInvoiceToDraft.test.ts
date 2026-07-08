import { describe, expect, it, vi } from 'vitest';
import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
} from '@eky/api-client';

import {
  copyApprovedInvoiceToDraftWithClient,
  getCopyApprovedInvoiceErrorMessage,
} from './useCopyApprovedInvoiceToDraft.js';
import { uiText } from '../../../i18n/fi.js';

describe('copyApprovedInvoiceToDraftWithClient', () => {
  it('delegates copying to the api-client', async () => {
    const draft = createInvoiceDraft();
    const apiClient = {
      copyApprovedInvoiceToDraft: vi.fn(async () => draft),
    } as Pick<EkyApiClient, 'copyApprovedInvoiceToDraft'>;

    await expect(
      copyApprovedInvoiceToDraftWithClient(apiClient, 'invoice-1'),
    ).resolves.toBe(draft);
    expect(apiClient.copyApprovedInvoiceToDraft).toHaveBeenCalledWith(
      'invoice-1',
    );
  });
});

describe('getCopyApprovedInvoiceErrorMessage', () => {
  it('returns a safe Finnish not-found message', () => {
    const message = getCopyApprovedInvoiceErrorMessage(
      new EkyApiError('Approved invoice was not found.', {
        responseBody: { stack: 'hidden' },
        status: 404,
      }),
    );

    expect(message).toBe(uiText.invoicing.approvedInvoiceNotFound);
    expect(message).not.toContain('stack');
  });

  it('returns a generic safe message for unexpected errors', () => {
    const message = getCopyApprovedInvoiceErrorMessage(
      new Error('SQLITE_CONSTRAINT_CHECK stack trace'),
    );

    expect(message).toBe(uiText.invoicing.copyApprovedInvoiceError);
    expect(message).not.toContain('SQLITE');
  });
});

function createInvoiceDraft(): InvoiceDraft {
  return {
    billingRecipientCustomerId: null,
    companyId: 'dev-company',
    createdAt: '2026-07-08T10:00:00.000Z',
    customerId: 'customer-1',
    deliveryAddressText: '',
    dueDate: '2026-07-22',
    id: 'draft-copy-1',
    invoiceDate: '2026-07-08',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        netCents: 10000,
        position: 1,
        priceInputMode: 'net',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: '',
    orderNumber: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    reminderPeriodDays: 8,
    status: 'draft',
    subject: 'Copied invoice',
    totals: {
      grossTotalCents: 12550,
      netTotalCents: 10000,
      vatBreakdown: [
        {
          grossCents: 12550,
          netCents: 10000,
          vatCents: 2550,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2550,
    },
    updatedAt: '2026-07-08T10:00:00.000Z',
  };
}

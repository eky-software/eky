import { EkyApiError } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoiceDraftErrorMessage,
  loadInvoiceDraftSummaries,
} from './useInvoiceDrafts.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadInvoiceDraftSummaries', () => {
  it('uses the api-client listInvoiceDrafts endpoint', async () => {
    const drafts = [
      {
        creditedInvoiceId: null,
        customerId: 'customer-1',
        dueDate: '2026-06-30',
        grossTotalCents: 12_331,
        id: 'draft-1',
        invoiceKind: 'standard' as const,
        invoiceDate: '2026-06-16',
        netTotalCents: 9825,
        paymentTermDays: 14,
        latePaymentInterestBasisPoints: 950,
        priceInputMode: 'net' as const,
        status: 'draft' as const,
        subject: 'Työlasku',
        updatedAt: '2026-06-16T12:00:00.000Z',
        vatTotalCents: 2506,
      },
    ];
    const apiClient = {
      listInvoiceDrafts: vi.fn(async () => drafts),
    };

    await expect(loadInvoiceDraftSummaries(apiClient)).resolves.toBe(drafts);

    expect(apiClient.listInvoiceDrafts).toHaveBeenCalledWith();
  });
});

describe('getInvoiceDraftErrorMessage', () => {
  it('translates a known safe API error into Finnish', () => {
    const error = new EkyApiError('Invalid invoice draft response.', {
      responseBody: { internal: 'not rendered' },
      status: 200,
    });

    expect(getInvoiceDraftErrorMessage(error)).toBe(
      uiText.apiErrors['Invalid invoice draft response.'],
    );
  });

  it('uses a generic Finnish message for an unknown API error', () => {
    const error = new EkyApiError('Unexpected internal service detail.', {
      responseBody: { internal: 'not rendered' },
      status: 500,
    });

    expect(getInvoiceDraftErrorMessage(error)).toBe(uiText.invoicing.loadError);
  });

  it('uses a generic Finnish message for an unexpected error', () => {
    expect(getInvoiceDraftErrorMessage(new Error('Technical stack detail.'))).toBe(
      uiText.invoicing.loadError,
    );
  });
});

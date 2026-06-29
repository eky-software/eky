import { EkyApiError, type InvoiceDraft } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getOpenInvoiceDraftErrorMessage,
  loadInvoiceDraft,
} from './useInvoiceDraftEditor.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadInvoiceDraft', () => {
  it('calls getInvoiceDraft with the selected draft id', async () => {
    const draft = createInvoiceDraft();
    const apiClient = {
      getInvoiceDraft: vi.fn(async () => draft),
    };

    await expect(loadInvoiceDraft('draft-1', apiClient)).resolves.toBe(draft);

    expect(apiClient.getInvoiceDraft).toHaveBeenCalledWith('draft-1');
  });
});

describe('getOpenInvoiceDraftErrorMessage', () => {
  it('returns a translated safe API error message', () => {
    expect(
      getOpenInvoiceDraftErrorMessage(
        new EkyApiError('Invalid invoice draft response.', {
          responseBody: {
            stack: 'secret stack',
          },
          status: 500,
        }),
      ),
    ).toBe(uiText.apiErrors['Invalid invoice draft response.']);
  });

  it('does not expose unknown API error details', () => {
    const message = getOpenInvoiceDraftErrorMessage(
      new EkyApiError('SQLITE_SECRET_STACK', {
        responseBody: {
          responseBody: 'raw body',
          stack: 'secret stack',
        },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.openDraftError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });

  it('returns a generic safe open error for non-API errors', () => {
    expect(getOpenInvoiceDraftErrorMessage(new Error('stack trace'))).toBe(
      uiText.invoicing.openDraftError,
    );
  });
});

function createInvoiceDraft(): InvoiceDraft {
  return {
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerId: 'customer-1',
    dueDate: '2026-06-30',
    id: 'draft-1',
    invoiceDate: '2026-06-16',
    lines: [],
    note: '',
    orderNumber: '',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    status: 'draft',
    subject: 'Työlasku',
    totals: {
      grossTotalCents: 0,
      netTotalCents: 0,
      vatBreakdown: [],
      vatTotalCents: 0,
    },
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}

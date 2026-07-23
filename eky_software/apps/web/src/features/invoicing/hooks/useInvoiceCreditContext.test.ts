import { EkyApiError, type InvoiceCreditContext } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import { getInvoiceCreditContextErrorMessage } from './useInvoiceCreditContext.js';
import { uiText } from '../../../i18n/fi.js';

describe('invoice credit context', () => {
  it('loads the context through the api client', async () => {
    const context = createCreditContext();
    const apiClient = {
      getInvoiceCreditContext: vi.fn(async (_invoiceId: string) => context),
    };

    await expect(
      apiClient.getInvoiceCreditContext('invoice-1'),
    ).resolves.toEqual(context);
    expect(apiClient.getInvoiceCreditContext).toHaveBeenCalledWith('invoice-1');
  });

  it('does not expose an API response body in the error message', () => {
    const error = new EkyApiError('technical failure', {
      responseBody: { stack: 'secret stack' },
      status: 500,
    });

    const message = getInvoiceCreditContextErrorMessage(error);

    expect(message).toBe(uiText.invoicing.creditContextLoadError);
    expect(message).not.toContain('stack');
  });
});

function createCreditContext(): InvoiceCreditContext {
  return {
    sourceInvoiceId: 'invoice-1',
    creditInvoices: [],
    creditStatus: 'none',
    remainingCreditableGrossCents: 12_550,
    activeCreditDraftId: null,
  };
}

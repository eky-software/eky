import { EkyApiError } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getReopenApprovedInvoiceErrorMessage,
  reopenApprovedInvoiceWithClient,
} from './useReopenApprovedInvoiceForEditing.js';
import { uiText } from '../../../i18n/fi.js';

describe('reopenApprovedInvoiceWithClient', () => {
  it('reopens an approved invoice with api-client', async () => {
    const reopenedInvoice = {
      invoiceDraftId: 'draft-1',
      invoiceId: 'invoice-1',
    };
    const apiClient = {
      reopenApprovedInvoiceForEditing: vi.fn(async () => reopenedInvoice),
    };

    await expect(
      reopenApprovedInvoiceWithClient(apiClient, 'invoice-1'),
    ).resolves.toBe(reopenedInvoice);
    expect(apiClient.reopenApprovedInvoiceForEditing).toHaveBeenCalledWith(
      'invoice-1',
    );
  });
});

describe('getReopenApprovedInvoiceErrorMessage', () => {
  it('maps not found to a safe Finnish message', () => {
    const error = new EkyApiError('Approved invoice was not found.', {
      status: 404,
    });

    expect(getReopenApprovedInvoiceErrorMessage(error)).toBe(
      uiText.invoicing.approvedInvoiceNotFound,
    );
  });

  it('does not expose technical response body or stack text', () => {
    const error = new EkyApiError('Unexpected backend stack trace', {
      responseBody: { stack: 'secret stack' },
      status: 500,
    });

    const message = getReopenApprovedInvoiceErrorMessage(error);

    expect(message).toBe(uiText.invoicing.reopenApprovedInvoiceError);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});

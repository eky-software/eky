import { EkyApiError, type ApprovedInvoiceSummary } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getApprovedInvoiceListErrorMessage,
  loadApprovedInvoiceSummaries,
} from './useApprovedInvoices.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadApprovedInvoiceSummaries', () => {
  it('loads approved invoice summaries with api-client', async () => {
    const invoices = [createApprovedInvoiceSummary()];
    const apiClient = {
      listApprovedInvoices: vi.fn(async () => invoices),
    };

    await expect(loadApprovedInvoiceSummaries(apiClient)).resolves.toBe(
      invoices,
    );
    expect(apiClient.listApprovedInvoices).toHaveBeenCalledWith();
  });
});

describe('getApprovedInvoiceListErrorMessage', () => {
  it('returns a safe Finnish error for invalid API responses', () => {
    const error = new EkyApiError('Invalid approved invoice response.', {
      responseBody: { stack: 'secret' },
    });

    const message = getApprovedInvoiceListErrorMessage(error);

    expect(message).toBe(uiText.apiErrors['Invalid approved invoice response.']);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });
});

function createApprovedInvoiceSummary(): ApprovedInvoiceSummary {
  return {
    id: 'invoice-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  };
}

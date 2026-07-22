import {
  EkyApiError,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceSummary,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getApprovedInvoiceListErrorMessage,
  loadApprovedInvoicePage,
} from './useApprovedInvoicePage.js';
import { createDefaultApprovedInvoiceListControls } from '../approved/approvedInvoiceListFilters.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadApprovedInvoicePage', () => {
  it('loads an explicitly scoped page with api-client', async () => {
    const invoicePage = createApprovedInvoicePage();
    const apiClient = {
      listApprovedInvoices: vi.fn(async () => invoicePage),
    };
    const controls = createDefaultApprovedInvoiceListControls(
      new Date(2026, 6, 22),
    );

    await expect(
      loadApprovedInvoicePage(apiClient, 'approved', controls, 7),
    ).resolves.toBe(invoicePage);
    expect(apiClient.listApprovedInvoices).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sort: 'invoiceDateDesc',
      status: 'approved',
    });
  });

  it('rejects a response containing another invoice status', async () => {
    const invoicePage = createApprovedInvoicePage({
      invoices: [createApprovedInvoiceSummary({ status: 'sent' })],
    });
    const apiClient = {
      listApprovedInvoices: vi.fn(async () => invoicePage),
    };

    await expect(
      loadApprovedInvoicePage(
        apiClient,
        'approved',
        createDefaultApprovedInvoiceListControls(),
        1,
      ),
    ).rejects.toThrow();
  });
});

describe('getApprovedInvoiceListErrorMessage', () => {
  it('returns a safe Finnish error for invalid API responses', () => {
    const error = new EkyApiError('Invalid approved invoice response.', {
      responseBody: { stack: 'secret' },
    });

    const message = getApprovedInvoiceListErrorMessage(error, 'approved');

    expect(message).toBe(uiText.apiErrors['Invalid approved invoice response.']);
    expect(message).not.toContain('responseBody');
    expect(message).not.toContain('stack');
  });

  it('uses the sent-list fallback for an unknown failure', () => {
    expect(getApprovedInvoiceListErrorMessage(new Error('secret'), 'sent')).toBe(
      uiText.invoicing.sentInvoiceListLoadError,
    );
  });
});

function createApprovedInvoicePage(
  overrides: Partial<ApprovedInvoiceListPage> = {},
): ApprovedInvoiceListPage {
  return {
    invoices: [createApprovedInvoiceSummary()],
    page: 1,
    pageSize: 20,
    totalCount: 1,
    totalPages: 1,
    ...overrides,
  };
}

function createApprovedInvoiceSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    id: 'invoice-1',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    updatedAt: '2026-06-13T10:00:00.000Z',
    ...overrides,
  };
}

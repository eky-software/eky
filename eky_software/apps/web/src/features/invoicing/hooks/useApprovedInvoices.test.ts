import {
  EkyApiError,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceSummary,
  type SentInvoiceGroupListPage,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getApprovedInvoiceListErrorMessage,
  loadApprovedInvoicePage,
  loadSentInvoiceGroupPage,
} from './useApprovedInvoicePage.js';
import { createDefaultApprovedInvoiceListControls } from '../approved/approvedInvoiceListFilters.js';
import { uiText } from '../../../i18n/fi.js';

describe('loadApprovedInvoicePage', () => {
  it('loads an explicitly scoped page with api-client', async () => {
    const invoicePage = createApprovedInvoicePage();
    const apiClient = {
      listApprovedInvoices: vi.fn(async () => invoicePage),
      listSentInvoiceGroups: vi.fn(),
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
      listSentInvoiceGroups: vi.fn(),
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

  it('loads sent invoices as server-grouped root pages', async () => {
    const rootInvoice = createApprovedInvoiceSummary({ status: 'sent' });
    const groupPage: SentInvoiceGroupListPage = {
      groups: [
        {
          rootInvoice,
          creditInvoices: [],
          creditStatus: 'none',
          remainingCreditableGrossCents: rootInvoice.grossTotalCents,
        },
      ],
      page: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    };
    const apiClient = {
      listApprovedInvoices: vi.fn(),
      listSentInvoiceGroups: vi.fn(async () => groupPage),
    };

    await expect(
      loadSentInvoiceGroupPage(
        apiClient,
        createDefaultApprovedInvoiceListControls(),
        1,
        'uncredited',
      ),
    ).resolves.toEqual(groupPage);
    expect(apiClient.listSentInvoiceGroups).toHaveBeenCalledWith({
      creditState: 'uncredited',
      page: 1,
      pageSize: 20,
      paymentState: 'all',
      sort: 'invoiceDateDesc',
    });
  });

  it('loads paid invoices with an explicit payment-state filter', async () => {
    const rootInvoice = createApprovedInvoiceSummary({
      paidAmountCents: 12_550,
      paidOn: '2026-07-31',
      paymentSource: 'manual',
      paymentState: 'paid',
      status: 'sent',
    });
    const page: SentInvoiceGroupListPage = {
      groups: [
        {
          creditInvoices: [],
          creditStatus: 'none',
          remainingCreditableGrossCents: 12_550,
          rootInvoice,
        },
      ],
      page: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    };
    const apiClient = {
      listApprovedInvoices: vi.fn(),
      listSentInvoiceGroups: vi.fn(async () => page),
    };

    await expect(
      loadSentInvoiceGroupPage(
        apiClient,
        createDefaultApprovedInvoiceListControls(),
        1,
        'uncredited',
        'paid',
      ),
    ).resolves.toEqual(page);
    expect(apiClient.listSentInvoiceGroups).toHaveBeenCalledWith({
      creditState: 'uncredited',
      page: 1,
      pageSize: 20,
      paymentState: 'paid',
      sort: 'invoiceDateDesc',
    });
  });

  it('rejects a sent group that does not match the requested credit section', async () => {
    const rootInvoice = createApprovedInvoiceSummary({ status: 'sent' });
    const mismatchPage: SentInvoiceGroupListPage = {
      groups: [
        {
          rootInvoice,
          creditInvoices: [],
          creditStatus: 'none',
          remainingCreditableGrossCents: rootInvoice.grossTotalCents,
        },
      ],
      page: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    };
    const apiClient = {
      listApprovedInvoices: vi.fn(),
      listSentInvoiceGroups: vi.fn(async () => mismatchPage),
    };

    await expect(
      loadSentInvoiceGroupPage(
        apiClient,
        createDefaultApprovedInvoiceListControls(),
        1,
        'credited',
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

  it('uses the cancelled-list fallback for an unknown failure', () => {
    expect(
      getApprovedInvoiceListErrorMessage(new Error('secret'), 'cancelled'),
    ).toBe(uiText.invoicing.cancelledInvoiceListLoadError);
  });

  it('uses the credited-list fallback for an unknown failure', () => {
    expect(
      getApprovedInvoiceListErrorMessage(
        new Error('secret'),
        'sent',
        'credited',
      ),
    ).toBe(uiText.invoicing.creditedInvoiceListLoadError);
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
    creditedInvoiceId: null,
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    id: 'invoice-1',
    invoiceKind: 'standard',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    cancelledAt: null,
    updatedAt: '2026-06-13T10:00:00.000Z',
    paymentState:
      overrides.invoiceKind === 'credit' ? 'notApplicable' : 'unpaid',
    paidOn: null,
    paidAmountCents: null,
    paymentSource: null,
    ...overrides,
  };
}

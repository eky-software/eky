import type {
  ApprovedInvoiceListPage,
  ApprovedInvoiceSummary,
  SentInvoiceGroupListPage,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import { loadCustomerInvoiceOverview } from './useCustomerInvoices.js';
import { createDefaultCustomerInvoiceListState } from '../customerInvoiceListState.js';

describe('loadCustomerInvoiceOverview', () => {
  it('uses one customer sort and page size across server-backed categories', async () => {
    const listApprovedInvoices = vi.fn(async () =>
      createApprovedInvoicePage(),
    );
    const listSentInvoiceGroups = vi.fn(async () =>
      createSentInvoiceGroupPage(),
    );
    const apiClient = {
      listApprovedInvoices,
      listInvoiceDrafts: vi.fn(async () => []),
      listSentInvoiceGroups,
    };
    const listState = {
      ...createDefaultCustomerInvoiceListState(),
      pageSize: 20 as const,
      pages: {
        approved: 2,
        cancelled: 3,
        credited: 4,
        drafts: 5,
        paid: 6,
        sent: 7,
      },
      sort: 'dueDateAsc' as const,
    };

    await loadCustomerInvoiceOverview(apiClient, 'customer-1', listState);

    expect(listApprovedInvoices).toHaveBeenNthCalledWith(1, {
      customerId: 'customer-1',
      page: 2,
      pageSize: 20,
      sort: 'dueDateAsc',
      status: 'approved',
    });
    expect(listApprovedInvoices).toHaveBeenNthCalledWith(2, {
      customerId: 'customer-1',
      page: 3,
      pageSize: 20,
      sort: 'dueDateAsc',
      status: 'cancelled',
    });
    expect(listSentInvoiceGroups).toHaveBeenNthCalledWith(1, {
      creditState: 'uncredited',
      customerId: 'customer-1',
      page: 7,
      pageSize: 20,
      paymentState: 'unpaid',
      sort: 'dueDateAsc',
    });
    expect(listSentInvoiceGroups).toHaveBeenNthCalledWith(2, {
      creditState: 'uncredited',
      customerId: 'customer-1',
      page: 6,
      pageSize: 20,
      paymentState: 'paid',
      sort: 'dueDateAsc',
    });
    expect(listSentInvoiceGroups).toHaveBeenNthCalledWith(3, {
      creditState: 'credited',
      customerId: 'customer-1',
      page: 4,
      pageSize: 20,
      paymentState: 'all',
      sort: 'dueDateAsc',
    });
  });

  it('keeps fulfilled categories visible when another category fails', async () => {
    const approvedPage = createApprovedInvoicePage({
      invoices: [createApprovedInvoice()],
      totalCount: 1,
      totalPages: 1,
    });
    const apiClient = {
      listApprovedInvoices: vi.fn(async (query: { status: string }) =>
        query.status === 'approved'
          ? approvedPage
          : createApprovedInvoicePage(),
      ),
      listInvoiceDrafts: vi.fn(async () => []),
      listSentInvoiceGroups: vi.fn(
        async (query: { paymentState?: string }) => {
          if (query.paymentState === 'paid') {
            throw new Error('technical paid-list failure');
          }

          return createSentInvoiceGroupPage();
        },
      ),
    };

    const result = await loadCustomerInvoiceOverview(
      apiClient,
      'customer-1',
      createDefaultCustomerInvoiceListState(),
    );

    expect(result.approvedPage.items).toHaveLength(1);
    expect(result.paidPage.items).toEqual([]);
    expect(result.errorMessage).toBe(
      'Asiakkaan laskuja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
    );
    expect(result.errorMessage).not.toContain('technical');
  });
});

function createApprovedInvoicePage(
  overrides: Partial<ApprovedInvoiceListPage> = {},
): ApprovedInvoiceListPage {
  return {
    invoices: [],
    page: 1,
    pageSize: 5,
    totalCount: 0,
    totalPages: 0,
    ...overrides,
  };
}

function createSentInvoiceGroupPage(): SentInvoiceGroupListPage {
  return {
    groups: [],
    page: 1,
    pageSize: 5,
    totalCount: 0,
    totalPages: 0,
  };
}

function createApprovedInvoice(): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-08-01T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Esimerkki Oy',
    cancelledAt: null,
    creditedInvoiceId: null,
    customerId: 'customer-1',
    customerNameSnapshot: 'Esimerkki Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-08-15',
    grossTotalCents: 12_400,
    id: 'invoice-1',
    invoiceDate: '2026-08-01',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    paidAmountCents: null,
    paidOn: null,
    paymentSource: null,
    paymentState: 'unpaid',
    referenceNumber: '20260013',
    status: 'approved',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

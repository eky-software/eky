import type {
  ApprovedInvoiceListPage,
  ApprovedInvoiceSummary,
  SentInvoiceGroupListPage,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  loadBillingRecipientInvoiceOverview,
} from './useBillingRecipientInvoices.js';
import { createDefaultCustomerInvoiceListState } from '../customerInvoiceListState.js';

describe('loadBillingRecipientInvoiceOverview', () => {
  it('loads server-backed invoice categories by billing recipient without drafts', async () => {
    const listApprovedInvoices = vi.fn(async () =>
      createApprovedInvoicePage(),
    );
    const listSentInvoiceGroups = vi.fn(async () =>
      createSentInvoiceGroupPage(),
    );
    const apiClient = {
      listApprovedInvoices,
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

    await loadBillingRecipientInvoiceOverview(
      apiClient,
      'property-manager-1',
      listState,
    );

    expect(listApprovedInvoices).toHaveBeenNthCalledWith(1, {
      billingRecipientCustomerId: 'property-manager-1',
      page: 2,
      pageSize: 20,
      sort: 'dueDateAsc',
      status: 'approved',
    });
    expect(listApprovedInvoices).toHaveBeenNthCalledWith(2, {
      billingRecipientCustomerId: 'property-manager-1',
      page: 3,
      pageSize: 20,
      sort: 'dueDateAsc',
      status: 'cancelled',
    });
    expect(listSentInvoiceGroups).toHaveBeenNthCalledWith(1, {
      billingRecipientCustomerId: 'property-manager-1',
      creditState: 'uncredited',
      page: 7,
      pageSize: 20,
      paymentState: 'unpaid',
      sort: 'dueDateAsc',
    });
    expect(listSentInvoiceGroups).toHaveBeenNthCalledWith(2, {
      billingRecipientCustomerId: 'property-manager-1',
      creditState: 'uncredited',
      page: 6,
      pageSize: 20,
      paymentState: 'paid',
      sort: 'dueDateAsc',
    });
    expect(listSentInvoiceGroups).toHaveBeenNthCalledWith(3, {
      billingRecipientCustomerId: 'property-manager-1',
      creditState: 'credited',
      page: 4,
      pageSize: 20,
      paymentState: 'all',
      sort: 'dueDateAsc',
    });
    expect(apiClient).not.toHaveProperty('listInvoiceDrafts');
  });

  it('keeps fulfilled recipient categories visible behind a safe local error', async () => {
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
      listSentInvoiceGroups: vi.fn(
        async (query: { paymentState?: string }) => {
          if (query.paymentState === 'paid') {
            throw new Error('technical recipient-list failure');
          }

          return createSentInvoiceGroupPage();
        },
      ),
    };

    const result = await loadBillingRecipientInvoiceOverview(
      apiClient,
      'property-manager-1',
      createDefaultCustomerInvoiceListState(),
    );

    expect(result.approvedPage.items).toHaveLength(1);
    expect(result.paidPage.items).toEqual([]);
    expect(result.errorMessage).toBe(
      'Vastaanottajana saatuja taloyhtiölaskuja ei voitu ladata. Yritä hetken kuluttua uudelleen.',
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
    billingRecipientNameSnapshot: 'Selkeä Isännöinti Oy',
    cancelledAt: null,
    creditedInvoiceId: null,
    customerId: 'housing-company-1',
    customerNameSnapshot: 'Asunto Oy Esimerkkipiha',
    customerNumberSnapshot: '2002',
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
    subject: 'Ikkunatyö',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

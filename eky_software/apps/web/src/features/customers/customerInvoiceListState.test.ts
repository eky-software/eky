import { describe, expect, it } from 'vitest';

import {
  createDefaultCustomerInvoiceListState,
  isCustomerInvoiceListPageSize,
  isCustomerInvoiceListSort,
  reduceCustomerInvoiceListState,
} from './customerInvoiceListState.js';

describe('customer invoice list state', () => {
  it('defaults to five rows and newest invoices first', () => {
    expect(createDefaultCustomerInvoiceListState()).toEqual({
      pageSize: 5,
      pages: {
        approved: 1,
        cancelled: 1,
        credited: 1,
        drafts: 1,
        paid: 1,
        sent: 1,
      },
      sort: 'invoiceDateDesc',
    });
  });

  it('keeps category pages independent', () => {
    const state = reduceCustomerInvoiceListState(
      createDefaultCustomerInvoiceListState(),
      {
        page: 3,
        pageKey: 'paid',
        type: 'goToPage',
      },
    );

    expect(state.pages.paid).toBe(3);
    expect(state.pages.sent).toBe(1);
    expect(state.pages.drafts).toBe(1);
  });

  it('resets every category to page one when sort or page size changes', () => {
    const pagedState = reduceCustomerInvoiceListState(
      createDefaultCustomerInvoiceListState(),
      {
        page: 4,
        pageKey: 'approved',
        type: 'goToPage',
      },
    );
    const sortedState = reduceCustomerInvoiceListState(pagedState, {
      sort: 'dueDateAsc',
      type: 'setSort',
    });
    const repagedState = reduceCustomerInvoiceListState(
      reduceCustomerInvoiceListState(sortedState, {
        page: 2,
        pageKey: 'drafts',
        type: 'goToPage',
      }),
      {
        pageSize: 20,
        type: 'setPageSize',
      },
    );

    expect(Object.values(sortedState.pages)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(sortedState.sort).toBe('dueDateAsc');
    expect(Object.values(repagedState.pages)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(repagedState.pageSize).toBe(20);
  });

  it('accepts only customer-card sort and page-size options', () => {
    expect(isCustomerInvoiceListSort('invoiceDateAsc')).toBe(true);
    expect(isCustomerInvoiceListSort('customerNameAsc')).toBe(false);
    expect(isCustomerInvoiceListPageSize(50)).toBe(true);
    expect(isCustomerInvoiceListPageSize(100)).toBe(false);
  });
});

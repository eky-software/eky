import type {
  ApprovedInvoiceListPageSize,
  ApprovedInvoiceListSort,
} from '@eky/api-client';

export type CustomerInvoiceListSort = Exclude<
  ApprovedInvoiceListSort,
  'customerNameAsc'
>;
export type CustomerInvoiceListPageSize = Extract<
  ApprovedInvoiceListPageSize,
  5 | 20 | 50
>;
export type CustomerInvoicePageKey =
  | 'approved'
  | 'cancelled'
  | 'credited'
  | 'drafts'
  | 'paid'
  | 'sent';

export interface CustomerInvoicePages {
  approved: number;
  cancelled: number;
  credited: number;
  drafts: number;
  paid: number;
  sent: number;
}

export interface CustomerInvoiceListState {
  pageSize: CustomerInvoiceListPageSize;
  pages: CustomerInvoicePages;
  sort: CustomerInvoiceListSort;
}

export type CustomerInvoiceListAction =
  | {
      page: number;
      pageKey: CustomerInvoicePageKey;
      type: 'goToPage';
    }
  | {
      pageSize: CustomerInvoiceListPageSize;
      type: 'setPageSize';
    }
  | {
      sort: CustomerInvoiceListSort;
      type: 'setSort';
    }
  | {
      type: 'resetPages';
    };

export const customerInvoicePageSizes: readonly CustomerInvoiceListPageSize[] =
  [5, 20, 50];

export function createDefaultCustomerInvoiceListState(): CustomerInvoiceListState {
  return {
    pageSize: 5,
    pages: createInitialPages(),
    sort: 'invoiceDateDesc',
  };
}

export function reduceCustomerInvoiceListState(
  state: CustomerInvoiceListState,
  action: CustomerInvoiceListAction,
): CustomerInvoiceListState {
  switch (action.type) {
    case 'goToPage':
      if (!Number.isSafeInteger(action.page) || action.page < 1) {
        return state;
      }

      return {
        ...state,
        pages: {
          ...state.pages,
          [action.pageKey]: action.page,
        },
      };
    case 'setPageSize':
      if (state.pageSize === action.pageSize) {
        return state;
      }

      return {
        ...state,
        pageSize: action.pageSize,
        pages: createInitialPages(),
      };
    case 'setSort':
      if (state.sort === action.sort) {
        return state;
      }

      return {
        ...state,
        pages: createInitialPages(),
        sort: action.sort,
      };
    case 'resetPages':
      return arePagesInitial(state.pages)
        ? state
        : {
            ...state,
            pages: createInitialPages(),
          };
  }
}

export function isCustomerInvoiceListPageSize(
  value: number,
): value is CustomerInvoiceListPageSize {
  return value === 5 || value === 20 || value === 50;
}

export function isCustomerInvoiceListSort(
  value: string,
): value is CustomerInvoiceListSort {
  return (
    value === 'invoiceDateDesc' ||
    value === 'invoiceDateAsc' ||
    value === 'dueDateAsc'
  );
}

function createInitialPages(): CustomerInvoicePages {
  return {
    approved: 1,
    cancelled: 1,
    credited: 1,
    drafts: 1,
    paid: 1,
    sent: 1,
  };
}

function arePagesInitial(pages: CustomerInvoicePages): boolean {
  return Object.values(pages).every((page) => page === 1);
}

import {
  EkyApiError,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceListPageSize,
  type ApprovedInvoiceListSort,
  type ApprovedInvoiceSummary,
  type EkyApiClient,
  type InvoiceDraftSummary,
  type SentInvoiceGroup,
  type SentInvoiceGroupListPage,
} from '@eky/api-client';
import { useEffect, useReducer, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';
import { createCustomerInvoiceDraftPage } from '../customerInvoiceDraftList.js';
import {
  createDefaultCustomerInvoiceListState,
  reduceCustomerInvoiceListState,
  type CustomerInvoiceListState,
  type CustomerInvoiceListPageSize,
  type CustomerInvoiceListSort,
  type CustomerInvoicePageKey,
} from '../customerInvoiceListState.js';

type CustomerInvoiceListClient = Pick<
  EkyApiClient,
  'listApprovedInvoices' | 'listInvoiceDrafts' | 'listSentInvoiceGroups'
>;

export interface CustomerInvoicePage<T> {
  items: T[];
  page: number;
  totalCount: number;
  totalPages: number;
}

export interface CustomerInvoiceOverviewState {
  approved: CustomerInvoicePage<ApprovedInvoiceSummary>;
  cancelled: CustomerInvoicePage<ApprovedInvoiceSummary>;
  credited: CustomerInvoicePage<SentInvoiceGroup>;
  drafts: CustomerInvoicePage<InvoiceDraftSummary>;
  errorMessage: string | null;
  isLoading: boolean;
  pageSize: CustomerInvoiceListPageSize;
  paid: CustomerInvoicePage<SentInvoiceGroup>;
  sent: CustomerInvoicePage<SentInvoiceGroup>;
  sort: CustomerInvoiceListSort;
  goToPage(key: CustomerInvoicePageKey, page: number): void;
  setPageSize(pageSize: CustomerInvoiceListPageSize): void;
  setSort(sort: CustomerInvoiceListSort): void;
}

interface LoadedCustomerInvoices {
  approvedPage: CustomerInvoicePage<ApprovedInvoiceSummary>;
  cancelledPage: CustomerInvoicePage<ApprovedInvoiceSummary>;
  creditedPage: CustomerInvoicePage<SentInvoiceGroup>;
  drafts: InvoiceDraftSummary[];
  errorMessage: string | null;
  paidPage: CustomerInvoicePage<SentInvoiceGroup>;
  sentPage: CustomerInvoicePage<SentInvoiceGroup>;
}

export function useCustomerInvoices(
  apiClient: CustomerInvoiceListClient,
  customerId: string | null,
): CustomerInvoiceOverviewState {
  const [listState, dispatchListState] = useReducer(
    reduceCustomerInvoiceListState,
    undefined,
    createDefaultCustomerInvoiceListState,
  );
  const [drafts, setDrafts] = useState<InvoiceDraftSummary[]>([]);
  const [approvedPage, setApprovedPage] = useState(
    createEmptyPage<ApprovedInvoiceSummary>,
  );
  const [sentPage, setSentPage] = useState(
    createEmptyPage<SentInvoiceGroup>,
  );
  const [paidPage, setPaidPage] = useState(
    createEmptyPage<SentInvoiceGroup>,
  );
  const [creditedPage, setCreditedPage] = useState(
    createEmptyPage<SentInvoiceGroup>,
  );
  const [cancelledPage, setCancelledPage] = useState(
    createEmptyPage<ApprovedInvoiceSummary>,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    dispatchListState({ type: 'resetPages' });
  }, [customerId]);

  useEffect(() => {
    if (customerId === null) {
      requestSequence.current += 1;
      setDrafts([]);
      setApprovedPage(createEmptyPage());
      setSentPage(createEmptyPage());
      setPaidPage(createEmptyPage());
      setCreditedPage(createEmptyPage());
      setCancelledPage(createEmptyPage());
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    const activeCustomerId = customerId;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    async function loadInvoices(): Promise<void> {
      try {
        const loaded = await loadCustomerInvoiceOverview(
          apiClient,
          activeCustomerId,
          listState,
        );

        if (requestSequence.current !== requestId) {
          return;
        }

        setDrafts(loaded.drafts);
        setApprovedPage(loaded.approvedPage);
        setSentPage(loaded.sentPage);
        setPaidPage(loaded.paidPage);
        setCreditedPage(loaded.creditedPage);
        setCancelledPage(loaded.cancelledPage);
        setErrorMessage(loaded.errorMessage);
      } finally {
        if (requestSequence.current === requestId) {
          setIsLoading(false);
        }
      }
    }

    void loadInvoices();

    return () => {
      requestSequence.current += 1;
    };
  }, [apiClient, customerId, listState]);

  const draftPage = createCustomerInvoiceDraftPage(
    drafts,
    listState.pages.drafts,
    listState.pageSize,
    listState.sort,
  );

  return {
    approved: approvedPage,
    cancelled: cancelledPage,
    credited: creditedPage,
    drafts: draftPage,
    errorMessage,
    isLoading,
    pageSize: listState.pageSize,
    paid: paidPage,
    sent: sentPage,
    sort: listState.sort,
    goToPage(key, page) {
      dispatchListState({
        page,
        pageKey: key,
        type: 'goToPage',
      });
    },
    setPageSize(pageSize) {
      dispatchListState({ pageSize, type: 'setPageSize' });
    },
    setSort(sort) {
      dispatchListState({ sort, type: 'setSort' });
    },
  };
}

export async function loadCustomerInvoiceOverview(
  apiClient: CustomerInvoiceListClient,
  customerId: string,
  listState: CustomerInvoiceListState,
): Promise<LoadedCustomerInvoices> {
  const [
    loadedDrafts,
    loadedApprovedPage,
    loadedSentPage,
    loadedPaidPage,
    loadedCreditedPage,
    loadedCancelledPage,
  ] = await Promise.allSettled([
    apiClient.listInvoiceDrafts({ customerId }),
    apiClient.listApprovedInvoices(
      createApprovedQuery(
        customerId,
        'approved',
        listState.pages.approved,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listSentInvoiceGroups(
      createSentQuery(
        customerId,
        'uncredited',
        'unpaid',
        listState.pages.sent,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listSentInvoiceGroups(
      createSentQuery(
        customerId,
        'uncredited',
        'paid',
        listState.pages.paid,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listSentInvoiceGroups(
      createSentQuery(
        customerId,
        'credited',
        'all',
        listState.pages.credited,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listApprovedInvoices(
      createApprovedQuery(
        customerId,
        'cancelled',
        listState.pages.cancelled,
        listState.pageSize,
        listState.sort,
      ),
    ),
  ]);
  const failedResult = [
    loadedDrafts,
    loadedApprovedPage,
    loadedSentPage,
    loadedPaidPage,
    loadedCreditedPage,
    loadedCancelledPage,
  ].find((result) => result.status === 'rejected');

  return {
    approvedPage: mapSettledPage(
      loadedApprovedPage,
      toApprovedCustomerInvoicePage,
    ),
    cancelledPage: mapSettledPage(
      loadedCancelledPage,
      toApprovedCustomerInvoicePage,
    ),
    creditedPage: mapSettledPage(
      loadedCreditedPage,
      toSentCustomerInvoicePage,
    ),
    drafts: getSettledValue(loadedDrafts, []),
    errorMessage:
      failedResult?.status === 'rejected'
        ? getCustomerInvoiceErrorMessage(failedResult.reason)
        : null,
    paidPage: mapSettledPage(loadedPaidPage, toSentCustomerInvoicePage),
    sentPage: mapSettledPage(loadedSentPage, toSentCustomerInvoicePage),
  };
}

function createApprovedQuery(
  customerId: string,
  status: 'approved' | 'cancelled',
  page: number,
  pageSize: ApprovedInvoiceListPageSize,
  sort: ApprovedInvoiceListSort,
) {
  return {
    customerId,
    page,
    pageSize,
    sort,
    status,
  };
}

function createSentQuery(
  customerId: string,
  creditState: 'credited' | 'uncredited',
  paymentState: 'all' | 'paid' | 'unpaid',
  page: number,
  pageSize: ApprovedInvoiceListPageSize,
  sort: ApprovedInvoiceListSort,
) {
  return {
    creditState,
    customerId,
    page,
    pageSize,
    paymentState,
    sort,
  };
}

function getSettledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function mapSettledPage<TInput, TOutput>(
  result: PromiseSettledResult<TInput>,
  map: (value: TInput) => CustomerInvoicePage<TOutput>,
): CustomerInvoicePage<TOutput> {
  return result.status === 'fulfilled'
    ? map(result.value)
    : createEmptyPage();
}

function createEmptyPage<T>(): CustomerInvoicePage<T> {
  return {
    items: [],
    page: 1,
    totalCount: 0,
    totalPages: 0,
  };
}

function toApprovedCustomerInvoicePage(
  page: ApprovedInvoiceListPage,
): CustomerInvoicePage<ApprovedInvoiceSummary> {
  return {
    items: page.invoices,
    page: page.page,
    totalCount: page.totalCount,
    totalPages: page.totalPages,
  };
}

function toSentCustomerInvoicePage(
  page: SentInvoiceGroupListPage,
): CustomerInvoicePage<SentInvoiceGroup> {
  return {
    items: page.groups,
    page: page.page,
    totalCount: page.totalCount,
    totalPages: page.totalPages,
  };
}

function getCustomerInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    if (translatedMessage !== error.message) {
      return translatedMessage;
    }
  }

  return uiText.customers.invoiceLoadError;
}

import {
  EkyApiError,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceListPageSize,
  type ApprovedInvoiceListSort,
  type ApprovedInvoiceSummary,
  type EkyApiClient,
  type SentInvoiceGroup,
  type SentInvoiceGroupListPage,
} from '@eky/api-client';
import { useEffect, useReducer, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';
import {
  createDefaultCustomerInvoiceListState,
  reduceCustomerInvoiceListState,
  type CustomerInvoiceListState,
  type CustomerInvoiceListPageSize,
  type CustomerInvoiceListSort,
} from '../customerInvoiceListState.js';
import type { CustomerInvoicePage } from './useCustomerInvoices.js';

type BillingRecipientInvoiceListClient = Pick<
  EkyApiClient,
  'listApprovedInvoices' | 'listSentInvoiceGroups'
>;

export type BillingRecipientInvoicePageKey =
  | 'approved'
  | 'cancelled'
  | 'credited'
  | 'paid'
  | 'sent';

export interface BillingRecipientInvoiceOverviewState {
  approved: CustomerInvoicePage<ApprovedInvoiceSummary>;
  cancelled: CustomerInvoicePage<ApprovedInvoiceSummary>;
  credited: CustomerInvoicePage<SentInvoiceGroup>;
  errorMessage: string | null;
  isLoading: boolean;
  pageSize: CustomerInvoiceListPageSize;
  paid: CustomerInvoicePage<SentInvoiceGroup>;
  sent: CustomerInvoicePage<SentInvoiceGroup>;
  sort: CustomerInvoiceListSort;
  goToPage(key: BillingRecipientInvoicePageKey, page: number): void;
  setPageSize(pageSize: CustomerInvoiceListPageSize): void;
  setSort(sort: CustomerInvoiceListSort): void;
}

interface LoadedBillingRecipientInvoices {
  approvedPage: CustomerInvoicePage<ApprovedInvoiceSummary>;
  cancelledPage: CustomerInvoicePage<ApprovedInvoiceSummary>;
  creditedPage: CustomerInvoicePage<SentInvoiceGroup>;
  errorMessage: string | null;
  paidPage: CustomerInvoicePage<SentInvoiceGroup>;
  sentPage: CustomerInvoicePage<SentInvoiceGroup>;
}

export function useBillingRecipientInvoices(
  apiClient: BillingRecipientInvoiceListClient,
  billingRecipientCustomerId: string | null,
): BillingRecipientInvoiceOverviewState {
  const [listState, dispatchListState] = useReducer(
    reduceCustomerInvoiceListState,
    undefined,
    createDefaultCustomerInvoiceListState,
  );
  const [loadedInvoices, setLoadedInvoices] = useState(
    createEmptyBillingRecipientInvoices,
  );
  const [isLoading, setIsLoading] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    dispatchListState({ type: 'resetPages' });
  }, [billingRecipientCustomerId]);

  useEffect(() => {
    if (billingRecipientCustomerId === null) {
      requestSequence.current += 1;
      setLoadedInvoices(createEmptyBillingRecipientInvoices());
      setIsLoading(false);
      return;
    }

    const activeBillingRecipientCustomerId = billingRecipientCustomerId;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);

    async function loadInvoices(): Promise<void> {
      try {
        const loaded = await loadBillingRecipientInvoiceOverview(
          apiClient,
          activeBillingRecipientCustomerId,
          listState,
        );

        if (requestSequence.current === requestId) {
          setLoadedInvoices(loaded);
        }
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
  }, [apiClient, billingRecipientCustomerId, listState]);

  return {
    approved: loadedInvoices.approvedPage,
    cancelled: loadedInvoices.cancelledPage,
    credited: loadedInvoices.creditedPage,
    errorMessage: loadedInvoices.errorMessage,
    isLoading,
    pageSize: listState.pageSize,
    paid: loadedInvoices.paidPage,
    sent: loadedInvoices.sentPage,
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

export async function loadBillingRecipientInvoiceOverview(
  apiClient: BillingRecipientInvoiceListClient,
  billingRecipientCustomerId: string,
  listState: CustomerInvoiceListState,
): Promise<LoadedBillingRecipientInvoices> {
  const [
    loadedApprovedPage,
    loadedSentPage,
    loadedPaidPage,
    loadedCreditedPage,
    loadedCancelledPage,
  ] = await Promise.allSettled([
    apiClient.listApprovedInvoices(
      createApprovedQuery(
        billingRecipientCustomerId,
        'approved',
        listState.pages.approved,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listSentInvoiceGroups(
      createSentQuery(
        billingRecipientCustomerId,
        'uncredited',
        'unpaid',
        listState.pages.sent,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listSentInvoiceGroups(
      createSentQuery(
        billingRecipientCustomerId,
        'uncredited',
        'paid',
        listState.pages.paid,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listSentInvoiceGroups(
      createSentQuery(
        billingRecipientCustomerId,
        'credited',
        'all',
        listState.pages.credited,
        listState.pageSize,
        listState.sort,
      ),
    ),
    apiClient.listApprovedInvoices(
      createApprovedQuery(
        billingRecipientCustomerId,
        'cancelled',
        listState.pages.cancelled,
        listState.pageSize,
        listState.sort,
      ),
    ),
  ]);
  const failedResult = [
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
    errorMessage:
      failedResult?.status === 'rejected'
        ? getBillingRecipientInvoiceErrorMessage(failedResult.reason)
        : null,
    paidPage: mapSettledPage(loadedPaidPage, toSentCustomerInvoicePage),
    sentPage: mapSettledPage(loadedSentPage, toSentCustomerInvoicePage),
  };
}

function createApprovedQuery(
  billingRecipientCustomerId: string,
  status: 'approved' | 'cancelled',
  page: number,
  pageSize: ApprovedInvoiceListPageSize,
  sort: ApprovedInvoiceListSort,
) {
  return {
    billingRecipientCustomerId,
    page,
    pageSize,
    sort,
    status,
  };
}

function createSentQuery(
  billingRecipientCustomerId: string,
  creditState: 'credited' | 'uncredited',
  paymentState: 'all' | 'paid' | 'unpaid',
  page: number,
  pageSize: ApprovedInvoiceListPageSize,
  sort: ApprovedInvoiceListSort,
) {
  return {
    billingRecipientCustomerId,
    creditState,
    page,
    pageSize,
    paymentState,
    sort,
  };
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

function createEmptyBillingRecipientInvoices(): LoadedBillingRecipientInvoices {
  return {
    approvedPage: createEmptyPage(),
    cancelledPage: createEmptyPage(),
    creditedPage: createEmptyPage(),
    errorMessage: null,
    paidPage: createEmptyPage(),
    sentPage: createEmptyPage(),
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

function getBillingRecipientInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    if (translatedMessage !== error.message) {
      return translatedMessage;
    }
  }

  return uiText.customers.billingRecipientInvoiceLoadError;
}

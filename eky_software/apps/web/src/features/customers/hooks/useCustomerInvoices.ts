import {
  EkyApiError,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceSummary,
  type EkyApiClient,
  type InvoiceDraftSummary,
  type SentInvoiceGroup,
  type SentInvoiceGroupListPage,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const PAGE_SIZE = 20 as const;

type CustomerInvoiceListClient = Pick<
  EkyApiClient,
  'listApprovedInvoices' | 'listInvoiceDrafts' | 'listSentInvoiceGroups'
>;

export type CustomerInvoicePageKey =
  | 'approved'
  | 'cancelled'
  | 'credited'
  | 'drafts'
  | 'sent';

interface CustomerInvoicePages {
  approved: number;
  cancelled: number;
  credited: number;
  drafts: number;
  sent: number;
}

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
  sent: CustomerInvoicePage<SentInvoiceGroup>;
  goToPage(key: CustomerInvoicePageKey, page: number): void;
}

const initialPages: CustomerInvoicePages = {
  approved: 1,
  cancelled: 1,
  credited: 1,
  drafts: 1,
  sent: 1,
};

export function useCustomerInvoices(
  apiClient: CustomerInvoiceListClient,
  customerId: string | null,
): CustomerInvoiceOverviewState {
  const [pages, setPages] = useState<CustomerInvoicePages>(initialPages);
  const [drafts, setDrafts] = useState<InvoiceDraftSummary[]>([]);
  const [approvedPage, setApprovedPage] = useState(
    createEmptyPage<ApprovedInvoiceSummary>,
  );
  const [sentPage, setSentPage] = useState(
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
    setPages(initialPages);
  }, [customerId]);

  useEffect(() => {
    if (customerId === null) {
      requestSequence.current += 1;
      setDrafts([]);
      setApprovedPage(createEmptyPage());
      setSentPage(createEmptyPage());
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
        const [
          loadedDrafts,
          loadedApprovedPage,
          loadedSentPage,
          loadedCreditedPage,
          loadedCancelledPage,
        ] = await Promise.all([
          apiClient.listInvoiceDrafts({ customerId: activeCustomerId }),
          apiClient.listApprovedInvoices(
            createApprovedQuery(
              activeCustomerId,
              'approved',
              pages.approved,
            ),
          ),
          apiClient.listSentInvoiceGroups(
            createSentQuery(
              activeCustomerId,
              'uncredited',
              pages.sent,
            ),
          ),
          apiClient.listSentInvoiceGroups(
            createSentQuery(
              activeCustomerId,
              'credited',
              pages.credited,
            ),
          ),
          apiClient.listApprovedInvoices(
            createApprovedQuery(
              activeCustomerId,
              'cancelled',
              pages.cancelled,
            ),
          ),
        ]);

        if (requestSequence.current !== requestId) {
          return;
        }

        setDrafts(loadedDrafts);
        setApprovedPage(toApprovedCustomerInvoicePage(loadedApprovedPage));
        setSentPage(toSentCustomerInvoicePage(loadedSentPage));
        setCreditedPage(toSentCustomerInvoicePage(loadedCreditedPage));
        setCancelledPage(toApprovedCustomerInvoicePage(loadedCancelledPage));
      } catch (error) {
        if (requestSequence.current !== requestId) {
          return;
        }

        setDrafts([]);
        setApprovedPage(createEmptyPage());
        setSentPage(createEmptyPage());
        setCreditedPage(createEmptyPage());
        setCancelledPage(createEmptyPage());
        setErrorMessage(getCustomerInvoiceErrorMessage(error));
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
  }, [apiClient, customerId, pages]);

  const sortedDrafts = [...drafts].sort((first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  );
  const draftTotalPages = Math.ceil(sortedDrafts.length / PAGE_SIZE);
  const firstDraftIndex = (pages.drafts - 1) * PAGE_SIZE;

  return {
    approved: approvedPage,
    cancelled: cancelledPage,
    credited: creditedPage,
    drafts: {
      items: sortedDrafts.slice(
        firstDraftIndex,
        firstDraftIndex + PAGE_SIZE,
      ),
      page: pages.drafts,
      totalCount: sortedDrafts.length,
      totalPages: draftTotalPages,
    },
    errorMessage,
    isLoading,
    sent: sentPage,
    goToPage(key, page) {
      if (!Number.isSafeInteger(page) || page < 1) {
        return;
      }

      setPages((current) => ({
        ...current,
        [key]: page,
      }));
    },
  };
}

function createApprovedQuery(
  customerId: string,
  status: 'approved' | 'cancelled',
  page: number,
) {
  return {
    customerId,
    page,
    pageSize: PAGE_SIZE,
    sort: 'invoiceDateDesc' as const,
    status,
  };
}

function createSentQuery(
  customerId: string,
  creditState: 'credited' | 'uncredited',
  page: number,
) {
  return {
    creditState,
    customerId,
    page,
    pageSize: PAGE_SIZE,
    sort: 'invoiceDateDesc' as const,
  };
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

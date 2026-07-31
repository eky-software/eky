import {
  EkyApiError,
  type ApprovedInvoiceListPage,
  type ApprovedInvoiceListPageSize,
  type ApprovedInvoiceListSort,
  type ApprovedInvoiceSummary,
  type ApprovedInvoiceViewStatus,
  type EkyApiClient,
  type SentInvoiceCreditStateFilter,
  type SentInvoiceGroup,
  type SentInvoiceGroupListPage,
  type SentInvoicePaymentStateFilter,
} from '@eky/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createApprovedInvoiceListQuery,
  createDefaultApprovedInvoiceListControls,
  getCurrentFiscalYearStartYear,
  type ApprovedInvoiceListControls,
  type ApprovedInvoicePeriodMode,
} from '../approved/approvedInvoiceListFilters.js';
import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ApprovedInvoicePageClient = Pick<
  EkyApiClient,
  'listApprovedInvoices' | 'listSentInvoiceGroups'
>;

export interface ApprovedInvoicePageState {
  controls: ApprovedInvoiceListControls;
  errorMessage: string | null;
  invoiceGroups: SentInvoiceGroup[];
  invoices: ApprovedInvoiceSummary[];
  isFiscalYearFilterAvailable: boolean;
  isLoading: boolean;
  totalCount: number;
  totalPages: number;
  goToPage(page: number): void;
  refresh(): Promise<void>;
  setFiscalYearStartYear(year: number): void;
  setMonth(month: string): void;
  setPageSize(pageSize: ApprovedInvoiceListPageSize): void;
  setPeriodMode(periodMode: ApprovedInvoicePeriodMode): void;
  setSort(sort: ApprovedInvoiceListSort): void;
}

export function useApprovedInvoicePage(
  apiClient: ApprovedInvoicePageClient,
  status: ApprovedInvoiceViewStatus,
  fiscalYearStartMonth: number | null,
  creditState: SentInvoiceCreditStateFilter = 'all',
  paymentState: SentInvoicePaymentStateFilter = 'all',
): ApprovedInvoicePageState {
  const [controls, setControls] = useState(
    createDefaultApprovedInvoiceListControls,
  );
  const [invoices, setInvoices] = useState<ApprovedInvoiceSummary[]>([]);
  const [invoiceGroups, setInvoiceGroups] = useState<SentInvoiceGroup[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (fiscalYearStartMonth === null) {
      return;
    }

    const currentFiscalYearStartYear = getCurrentFiscalYearStartYear(
      new Date(),
      fiscalYearStartMonth,
    );

    setControls((current) =>
      current.fiscalYearStartYear === currentFiscalYearStartYear
        ? current
        : {
            ...current,
            fiscalYearStartYear: currentFiscalYearStartYear,
          },
    );
  }, [fiscalYearStartMonth]);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const groupPage =
        status === 'sent'
          ? await loadSentInvoiceGroupPage(
              apiClient,
              controls,
              fiscalYearStartMonth,
              creditState,
              paymentState,
            )
          : null;
      const page =
        groupPage === null
          ? await loadApprovedInvoicePage(
              apiClient,
              status,
              controls,
              fiscalYearStartMonth,
            )
          : {
              invoices: groupPage.groups.map((group) => group.rootInvoice),
              page: groupPage.page,
              pageSize: groupPage.pageSize,
              totalCount: groupPage.totalCount,
              totalPages: groupPage.totalPages,
            };

      if (requestId !== requestSequence.current) {
        return;
      }

      const lastAvailablePage = Math.max(1, page.totalPages);

      if (controls.page > lastAvailablePage) {
        setControls((current) => ({
          ...current,
          page: lastAvailablePage,
        }));
        return;
      }

      setInvoices(page.invoices);
      setInvoiceGroups(groupPage?.groups ?? []);
      setTotalCount(page.totalCount);
      setTotalPages(page.totalPages);
    } catch (error) {
      if (requestId !== requestSequence.current) {
        return;
      }

      setInvoices([]);
      setInvoiceGroups([]);
      setTotalCount(0);
      setTotalPages(0);
      setErrorMessage(
        getApprovedInvoiceListErrorMessage(
          error,
          status,
          creditState,
          paymentState,
        ),
      );
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  }, [
    apiClient,
    controls,
    creditState,
    fiscalYearStartMonth,
    paymentState,
    status,
  ]);

  useEffect(() => {
    void refresh();

    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  const updateControls = useCallback(
    (update: Partial<ApprovedInvoiceListControls>): void => {
      setControls((current) => ({ ...current, ...update, page: 1 }));
    },
    [],
  );

  return {
    controls,
    errorMessage,
    invoiceGroups,
    invoices,
    isFiscalYearFilterAvailable: fiscalYearStartMonth !== null,
    isLoading,
    totalCount,
    totalPages,
    goToPage(page) {
      if (Number.isSafeInteger(page) && page >= 1) {
        setControls((current) => ({ ...current, page }));
      }
    },
    refresh,
    setFiscalYearStartYear(fiscalYearStartYear) {
      updateControls({ fiscalYearStartYear });
    },
    setMonth(month) {
      updateControls({ month });
    },
    setPageSize(pageSize) {
      updateControls({ pageSize });
    },
    setPeriodMode(periodMode) {
      updateControls({ periodMode });
    },
    setSort(sort) {
      updateControls({ sort });
    },
  };
}

export async function loadSentInvoiceGroupPage(
  apiClient: ApprovedInvoicePageClient,
  controls: ApprovedInvoiceListControls,
  fiscalYearStartMonth: number | null,
  creditState: SentInvoiceCreditStateFilter = 'all',
  paymentState: SentInvoicePaymentStateFilter = 'all',
): Promise<SentInvoiceGroupListPage> {
  const { status: _status, ...query } = createApprovedInvoiceListQuery(
    'sent',
    controls,
    fiscalYearStartMonth,
  );
  const page = await apiClient.listSentInvoiceGroups({
    ...query,
    creditState,
    paymentState,
  });

  if (
    page.page !== query.page ||
    page.pageSize !== query.pageSize ||
    page.groups.some(
      (group) =>
        group.rootInvoice.status !== 'sent' ||
        group.rootInvoice.invoiceKind !== 'standard' ||
        (creditState === 'uncredited' && group.creditStatus !== 'none') ||
        (creditState === 'credited' && group.creditStatus === 'none') ||
        (paymentState === 'paid' &&
          group.rootInvoice.paymentState !== 'paid') ||
        (paymentState === 'unpaid' &&
          group.rootInvoice.paymentState !== 'unpaid'),
    )
  ) {
    throw new Error('Sent invoice group page does not match its request.');
  }

  return page;
}

export async function loadApprovedInvoicePage(
  apiClient: ApprovedInvoicePageClient,
  status: ApprovedInvoiceViewStatus,
  controls: ApprovedInvoiceListControls,
  fiscalYearStartMonth: number | null,
): Promise<ApprovedInvoiceListPage> {
  const query = createApprovedInvoiceListQuery(
    status,
    controls,
    fiscalYearStartMonth,
  );
  const page = await apiClient.listApprovedInvoices(query);

  if (
    page.page !== query.page ||
    page.pageSize !== query.pageSize ||
    page.invoices.some((invoice) => invoice.status !== status)
  ) {
    throw new Error('Approved invoice page does not match its request.');
  }

  return page;
}

export function getApprovedInvoiceListErrorMessage(
  error: unknown,
  status: ApprovedInvoiceViewStatus,
  creditState: SentInvoiceCreditStateFilter = 'all',
  paymentState: SentInvoicePaymentStateFilter = 'all',
): string {
  const fallbackMessage =
    status === 'sent'
      ? creditState === 'credited'
        ? uiText.invoicing.creditedInvoiceListLoadError
        : paymentState === 'paid'
          ? uiText.invoicing.paidInvoiceListLoadError
        : uiText.invoicing.sentInvoiceListLoadError
      : status === 'cancelled'
        ? uiText.invoicing.cancelledInvoiceListLoadError
        : uiText.invoicing.approvedInvoiceListLoadError;

  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? fallbackMessage
      : translatedMessage;
  }

  return fallbackMessage;
}

import type { EkyApiClient } from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import {
  useApprovedInvoicePage,
  type ApprovedInvoicePageState,
} from './useApprovedInvoicePage.js';

type ApprovedInvoiceListClient = Pick<
  EkyApiClient,
  | 'getInvoiceNumberingSettings'
  | 'listApprovedInvoices'
  | 'listSentInvoiceGroups'
>;

export interface ApprovedInvoiceListState {
  approved: ApprovedInvoicePageState;
  cancelled: ApprovedInvoicePageState;
  credited: ApprovedInvoicePageState;
  paid: ApprovedInvoicePageState;
  sent: ApprovedInvoicePageState;
  refreshApprovedInvoices(): Promise<void>;
}

export function useApprovedInvoices(
  apiClient: ApprovedInvoiceListClient,
): ApprovedInvoiceListState {
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState<
    number | null
  >(null);

  useEffect(() => {
    let isCurrent = true;

    void apiClient
      .getInvoiceNumberingSettings()
      .then((settings) => {
        if (isCurrent) {
          setFiscalYearStartMonth(settings.fiscalYearStartMonth);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setFiscalYearStartMonth(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [apiClient]);

  const approved = useApprovedInvoicePage(
    apiClient,
    'approved',
    fiscalYearStartMonth,
  );
  const sent = useApprovedInvoicePage(
    apiClient,
    'sent',
    fiscalYearStartMonth,
    'uncredited',
    'unpaid',
  );
  const paid = useApprovedInvoicePage(
    apiClient,
    'sent',
    fiscalYearStartMonth,
    'uncredited',
    'paid',
  );
  const credited = useApprovedInvoicePage(
    apiClient,
    'sent',
    fiscalYearStartMonth,
    'credited',
    'all',
  );
  const cancelled = useApprovedInvoicePage(
    apiClient,
    'cancelled',
    fiscalYearStartMonth,
  );
  const refreshApprovedInvoices = useCallback(async (): Promise<void> => {
    await Promise.all([
      approved.refresh(),
      sent.refresh(),
      paid.refresh(),
      cancelled.refresh(),
      credited.refresh(),
    ]);
  }, [
    approved.refresh,
    cancelled.refresh,
    credited.refresh,
    paid.refresh,
    sent.refresh,
  ]);

  return {
    approved,
    cancelled,
    credited,
    paid,
    sent,
    refreshApprovedInvoices,
  };
}

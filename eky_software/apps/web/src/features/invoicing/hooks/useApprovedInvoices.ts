import {
  EkyApiError,
  type ApprovedInvoiceSummary,
  type EkyApiClient,
} from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ApprovedInvoiceListClient = Pick<EkyApiClient, 'listApprovedInvoices'>;

export interface ApprovedInvoiceListState {
  approvedInvoices: ApprovedInvoiceSummary[];
  errorMessage: string | null;
  isLoading: boolean;
  refreshApprovedInvoices(): Promise<void>;
}

export function useApprovedInvoices(
  apiClient: ApprovedInvoiceListClient,
): ApprovedInvoiceListState {
  const [approvedInvoices, setApprovedInvoices] = useState<
    ApprovedInvoiceSummary[]
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshApprovedInvoices = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedInvoices = await loadApprovedInvoiceSummaries(apiClient);

      setApprovedInvoices(loadedInvoices);
    } catch (error) {
      setErrorMessage(getApprovedInvoiceListErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void refreshApprovedInvoices();
  }, [refreshApprovedInvoices]);

  return {
    approvedInvoices,
    errorMessage,
    isLoading,
    refreshApprovedInvoices,
  };
}

export function loadApprovedInvoiceSummaries(
  apiClient: ApprovedInvoiceListClient,
): Promise<ApprovedInvoiceSummary[]> {
  return apiClient.listApprovedInvoices();
}

export function getApprovedInvoiceListErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.approvedInvoiceListLoadError
      : translatedMessage;
  }

  return uiText.invoicing.approvedInvoiceListLoadError;
}

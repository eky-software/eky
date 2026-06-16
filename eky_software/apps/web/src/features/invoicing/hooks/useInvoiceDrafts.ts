import {
  createEkyApiClient,
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraftSummary,
} from '@eky/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type InvoiceDraftListClient = Pick<EkyApiClient, 'listInvoiceDrafts'>;

export interface InvoiceDraftListState {
  drafts: InvoiceDraftSummary[];
  errorMessage: string | null;
  isLoading: boolean;
  refreshDrafts(): Promise<void>;
}

export function useInvoiceDrafts(): InvoiceDraftListState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [drafts, setDrafts] = useState<InvoiceDraftSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshDrafts = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedDrafts = await loadInvoiceDraftSummaries(apiClient);

      setDrafts(loadedDrafts);
    } catch (error) {
      setErrorMessage(getInvoiceDraftErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  return {
    drafts,
    errorMessage,
    isLoading,
    refreshDrafts,
  };
}

export function loadInvoiceDraftSummaries(
  apiClient: InvoiceDraftListClient,
): Promise<InvoiceDraftSummary[]> {
  return apiClient.listInvoiceDrafts();
}

export function getInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.loadError
      : translatedMessage;
  }

  return uiText.invoicing.loadError;
}

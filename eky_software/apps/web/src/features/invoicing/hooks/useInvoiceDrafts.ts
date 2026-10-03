import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraftSummary,
} from '@eky/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoiceDraftListClient = Pick<EkyApiClient, 'listInvoiceDrafts'>;

export interface InvoiceDraftListState {
  drafts: InvoiceDraftSummary[];
  errorMessage: string | null;
  isLoading: boolean;
  refreshDrafts(): Promise<void>;
}

export function useInvoiceDrafts(
  apiClient: InvoiceDraftListClient,
): InvoiceDraftListState {
  const [drafts, setDrafts] = useState<InvoiceDraftSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const generation = useRef(0);
  const isMounted = useRef(false);

  const refreshDrafts = useCallback(async (): Promise<void> => {
    if (!isMounted.current) {
      return;
    }
    const requestGeneration = ++generation.current;
    const isCurrent = (): boolean =>
      isMounted.current && requestGeneration === generation.current;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedDrafts = await loadInvoiceDraftSummaries(apiClient);

      if (isCurrent()) {
        setDrafts(loadedDrafts);
      }
    } catch (error) {
      if (isCurrent()) {
        setErrorMessage(getInvoiceDraftErrorMessage(error));
      }
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, [apiClient]);

  useEffect(() => {
    isMounted.current = true;
    void refreshDrafts();
    return () => {
      isMounted.current = false;
      ++generation.current;
    };
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

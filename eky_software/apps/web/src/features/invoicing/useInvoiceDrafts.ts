import {
  createEkyApiClient,
  EkyApiError,
  type InvoiceDraftSummary,
} from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

export interface InvoiceDraftListState {
  drafts: InvoiceDraftSummary[];
  errorMessage: string | null;
  isLoading: boolean;
}

export function useInvoiceDrafts(): InvoiceDraftListState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [drafts, setDrafts] = useState<InvoiceDraftSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadDrafts(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedDrafts = await apiClient.listInvoiceDrafts();

        if (isActive) {
          setDrafts(loadedDrafts);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getInvoiceDraftErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadDrafts();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  return {
    drafts,
    errorMessage,
    isLoading,
  };
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

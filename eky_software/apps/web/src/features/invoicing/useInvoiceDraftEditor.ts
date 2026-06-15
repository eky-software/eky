import {
  createEkyApiClient,
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type InvoiceDraftEditorClient = Pick<EkyApiClient, 'getInvoiceDraft'>;

export interface InvoiceDraftEditorState {
  draft: InvoiceDraft | null;
  errorMessage: string | null;
  isLoading: boolean;
  clearDraft(): void;
  openDraft(id: string): Promise<InvoiceDraft | null>;
}

export function useInvoiceDraftEditor(): InvoiceDraftEditorState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function clearDraft(): void {
    setDraft(null);
    setErrorMessage(null);
  }

  async function openDraft(id: string): Promise<InvoiceDraft | null> {
    setIsLoading(true);
    setErrorMessage(null);
    setDraft(null);

    try {
      const loadedDraft = await loadInvoiceDraft(id, apiClient);

      setDraft(loadedDraft);

      return loadedDraft;
    } catch (error) {
      setErrorMessage(getOpenInvoiceDraftErrorMessage(error));

      return null;
    } finally {
      setIsLoading(false);
    }
  }

  return {
    clearDraft,
    draft,
    errorMessage,
    isLoading,
    openDraft,
  };
}

export function loadInvoiceDraft(
  id: string,
  apiClient: InvoiceDraftEditorClient,
): Promise<InvoiceDraft> {
  return apiClient.getInvoiceDraft(id);
}

export function getOpenInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.openDraftError
      : translatedMessage;
  }

  return uiText.invoicing.openDraftError;
}

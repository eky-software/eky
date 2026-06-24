import {
  createEkyApiClient,
  EkyApiError,
  type EkyApiClient,
} from '@eky/api-client';
import { useCallback, useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type DeleteInvoiceDraftClient = Pick<EkyApiClient, 'deleteInvoiceDraft'>;

export interface DeleteInvoiceDraftState {
  deletingDraftId: string | null;
  errorMessage: string | null;
  clearError(): void;
  deleteDraft(id: string): Promise<boolean>;
}

export function useDeleteInvoiceDraft(): DeleteInvoiceDraftState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearError = useCallback((): void => {
    setErrorMessage(null);
  }, []);

  const deleteDraft = useCallback(async (id: string): Promise<boolean> => {
    setDeletingDraftId(id);
    setErrorMessage(null);

    try {
      await deleteInvoiceDraftWithClient(apiClient, id);
      return true;
    } catch (error) {
      setErrorMessage(getDeleteInvoiceDraftErrorMessage(error));
      return false;
    } finally {
      setDeletingDraftId(null);
    }
  }, [apiClient]);

  return {
    deletingDraftId,
    errorMessage,
    clearError,
    deleteDraft,
  };
}

export function deleteInvoiceDraftWithClient(
  apiClient: DeleteInvoiceDraftClient,
  id: string,
): Promise<void> {
  return apiClient.deleteInvoiceDraft(id);
}

export async function deleteInvoiceDraftAndRefresh(
  id: string,
  deleteDraft: (draftId: string) => Promise<boolean>,
  refreshDrafts: () => Promise<void>,
): Promise<boolean> {
  const wasDeleted = await deleteDraft(id);

  if (!wasDeleted) {
    return false;
  }

  await refreshDrafts();
  return true;
}

export function getDeleteInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.deleteDraftError
      : translatedMessage;
  }

  return uiText.invoicing.deleteDraftError;
}

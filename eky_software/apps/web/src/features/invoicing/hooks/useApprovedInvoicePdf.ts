import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceDocumentMetadata,
  type EkyApiClient,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type ApprovedInvoicePdfClient = Pick<
  EkyApiClient,
  'createApprovedInvoicePdf' | 'getApprovedInvoicePdfUrl'
>;

export interface ApprovedInvoicePdfState {
  errorMessage: string | null;
  isCreating: boolean;
  clearError(): void;
  createPdf(id: string): Promise<ApprovedInvoiceDocumentMetadata | null>;
  getPdfUrl(id: string): string;
}

export function useApprovedInvoicePdf(): ApprovedInvoicePdfState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function createPdf(
    id: string,
  ): Promise<ApprovedInvoiceDocumentMetadata | null> {
    setIsCreating(true);
    setErrorMessage(null);

    try {
      return await createApprovedInvoicePdfWithClient(apiClient, id);
    } catch (error) {
      setErrorMessage(getApprovedInvoicePdfErrorMessage(error));

      return null;
    } finally {
      setIsCreating(false);
    }
  }

  return {
    clearError,
    createPdf,
    errorMessage,
    getPdfUrl: (id) => apiClient.getApprovedInvoicePdfUrl(id),
    isCreating,
  };
}

export function createApprovedInvoicePdfWithClient(
  apiClient: ApprovedInvoicePdfClient,
  id: string,
): Promise<ApprovedInvoiceDocumentMetadata> {
  return apiClient.createApprovedInvoicePdf(id);
}

export function getApprovedInvoicePdfErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.approvedInvoicePdfError
      : translatedMessage;
  }

  return uiText.invoicing.approvedInvoicePdfError;
}

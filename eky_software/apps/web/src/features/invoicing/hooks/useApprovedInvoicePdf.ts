import {
  EkyApiError,
  type ApprovedInvoiceDocumentMetadata,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ApprovedInvoicePdfClient = Pick<
  EkyApiClient,
  | 'createApprovedInvoicePdf'
  | 'getApprovedInvoicePdfMetadata'
  | 'getApprovedInvoicePdfUrl'
>;

export interface ApprovedInvoicePdfState {
  document: ApprovedInvoiceDocumentMetadata | null;
  errorMessage: string | null;
  isChecking: boolean;
  isCreating: boolean;
  clearError(): void;
  clearPdf(): void;
  createPdf(id: string): Promise<ApprovedInvoiceDocumentMetadata | null>;
  getPdfUrl(id: string): string;
  loadPdfMetadata(id: string): Promise<ApprovedInvoiceDocumentMetadata | null>;
}

export function useApprovedInvoicePdf(
  apiClient: ApprovedInvoicePdfClient,
): ApprovedInvoicePdfState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [document, setDocument] =
    useState<ApprovedInvoiceDocumentMetadata | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  function clearPdf(): void {
    setDocument(null);
    setErrorMessage(null);
  }

  async function loadPdfMetadata(
    id: string,
  ): Promise<ApprovedInvoiceDocumentMetadata | null> {
    setIsChecking(true);
    setErrorMessage(null);
    setDocument(null);

    try {
      const metadata = await getApprovedInvoicePdfMetadataWithClient(
        apiClient,
        id,
      );
      setDocument(metadata);

      return metadata;
    } catch (error) {
      if (error instanceof EkyApiError && error.status === 404) {
        return null;
      }

      setErrorMessage(getApprovedInvoicePdfErrorMessage(error));

      return null;
    } finally {
      setIsChecking(false);
    }
  }

  async function createPdf(
    id: string,
  ): Promise<ApprovedInvoiceDocumentMetadata | null> {
    setIsCreating(true);
    setErrorMessage(null);

    try {
      const metadata = await createApprovedInvoicePdfWithClient(apiClient, id);
      setDocument(metadata);

      return metadata;
    } catch (error) {
      setErrorMessage(getApprovedInvoicePdfErrorMessage(error));

      return null;
    } finally {
      setIsCreating(false);
    }
  }

  return {
    clearError,
    clearPdf,
    createPdf,
    document,
    errorMessage,
    getPdfUrl: (id) => apiClient.getApprovedInvoicePdfUrl(id),
    isChecking,
    isCreating,
    loadPdfMetadata,
  };
}

export function createApprovedInvoicePdfWithClient(
  apiClient: ApprovedInvoicePdfClient,
  id: string,
): Promise<ApprovedInvoiceDocumentMetadata> {
  return apiClient.createApprovedInvoicePdf(id);
}

export function getApprovedInvoicePdfMetadataWithClient(
  apiClient: ApprovedInvoicePdfClient,
  id: string,
): Promise<ApprovedInvoiceDocumentMetadata> {
  return apiClient.getApprovedInvoicePdfMetadata(id);
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

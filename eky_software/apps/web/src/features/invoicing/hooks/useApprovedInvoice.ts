import {
  EkyApiError,
  type ApprovedInvoiceView,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ApprovedInvoiceClient = Pick<EkyApiClient, 'getApprovedInvoice'>;

export interface ApprovedInvoiceState {
  approvedInvoice: ApprovedInvoiceView | null;
  errorMessage: string | null;
  isLoading: boolean;
  clearApprovedInvoice(): void;
  openApprovedInvoice(id: string): Promise<ApprovedInvoiceView | null>;
  replaceApprovedInvoice(invoice: ApprovedInvoiceView): void;
}

export function useApprovedInvoice(
  apiClient: ApprovedInvoiceClient,
): ApprovedInvoiceState {
  const [approvedInvoice, setApprovedInvoice] =
    useState<ApprovedInvoiceView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function clearApprovedInvoice(): void {
    setApprovedInvoice(null);
    setErrorMessage(null);
  }

  async function openApprovedInvoice(
    id: string,
  ): Promise<ApprovedInvoiceView | null> {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const invoice = await getApprovedInvoiceWithClient(apiClient, id);

      setApprovedInvoice(invoice);

      return invoice;
    } catch (error) {
      setApprovedInvoice(null);
      setErrorMessage(getApprovedInvoiceErrorMessage(error));

      return null;
    } finally {
      setIsLoading(false);
    }
  }

  function replaceApprovedInvoice(invoice: ApprovedInvoiceView): void {
    setApprovedInvoice(invoice);
    setErrorMessage(null);
  }

  return {
    approvedInvoice,
    clearApprovedInvoice,
    errorMessage,
    isLoading,
    openApprovedInvoice,
    replaceApprovedInvoice,
  };
}

export function getApprovedInvoiceWithClient(
  apiClient: ApprovedInvoiceClient,
  id: string,
): Promise<ApprovedInvoiceView> {
  return apiClient.getApprovedInvoice(id);
}

export function getApprovedInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    if (error.status === 404) {
      return uiText.invoicing.approvedInvoiceNotFound;
    }

    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.approvedInvoiceLoadError
      : translatedMessage;
  }

  return uiText.invoicing.approvedInvoiceLoadError;
}

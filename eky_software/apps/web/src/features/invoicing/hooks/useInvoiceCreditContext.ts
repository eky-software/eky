import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceCreditContext,
} from '@eky/api-client';
import { useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoiceCreditContextClient = Pick<
  EkyApiClient,
  'getInvoiceCreditContext'
>;

export interface InvoiceCreditContextState {
  creditContext: InvoiceCreditContext | null;
  errorMessage: string | null;
  isLoading: boolean;
  clearCreditContext(): void;
  loadCreditContext(invoiceId: string): Promise<InvoiceCreditContext | null>;
}

export function useInvoiceCreditContext(
  apiClient: InvoiceCreditContextClient,
): InvoiceCreditContextState {
  const [creditContext, setCreditContext] =
    useState<InvoiceCreditContext | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function clearCreditContext(): void {
    setCreditContext(null);
    setErrorMessage(null);
    setIsLoading(false);
  }

  async function loadCreditContext(
    invoiceId: string,
  ): Promise<InvoiceCreditContext | null> {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const context = await apiClient.getInvoiceCreditContext(invoiceId);
      setCreditContext(context);
      return context;
    } catch (error) {
      setCreditContext(null);
      setErrorMessage(getInvoiceCreditContextErrorMessage(error));
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  return {
    creditContext,
    errorMessage,
    isLoading,
    clearCreditContext,
    loadCreditContext,
  };
}

export function getInvoiceCreditContextErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.creditContextLoadError
      : translatedMessage;
  }

  return uiText.invoicing.creditContextLoadError;
}

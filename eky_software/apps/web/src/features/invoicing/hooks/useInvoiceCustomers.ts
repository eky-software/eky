import {
  EkyApiError,
  type Customer,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

export interface InvoiceCustomerListState {
  customers: Customer[];
  errorMessage: string | null;
  isLoading: boolean;
}

type InvoiceCustomerClient = Pick<EkyApiClient, 'listCustomers'>;

export function useInvoiceCustomers(
  apiClient: InvoiceCustomerClient,
): InvoiceCustomerListState {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadCustomers(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedCustomers = await loadInvoiceCustomers(apiClient);

        if (isActive) {
          setCustomers(loadedCustomers);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getInvoiceCustomerErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadCustomers();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  return {
    customers,
    errorMessage,
    isLoading,
  };
}

export function loadInvoiceCustomers(
  apiClient: InvoiceCustomerClient,
): Promise<Customer[]> {
  return apiClient.listCustomers();
}

export function getInvoiceCustomerErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.customerLoadError
      : translatedMessage;
  }

  return uiText.invoicing.customerLoadError;
}

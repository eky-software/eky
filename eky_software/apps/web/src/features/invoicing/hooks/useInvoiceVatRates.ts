import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceVatRatesView,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

export interface InvoiceVatRatesState {
  errorMessage: string | null;
  isLoading: boolean;
  settings: InvoiceVatRatesView | null;
}

export function useInvoiceVatRates(
  apiClient: Pick<EkyApiClient, 'getInvoiceVatRates'>,
): InvoiceVatRatesState {
  const [settings, setSettings] = useState<InvoiceVatRatesView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    void apiClient.getInvoiceVatRates()
      .then((loadedSettings) => {
        if (isActive) setSettings(loadedSettings);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        if (error instanceof EkyApiError) {
          const translated = getFinnishApiErrorMessage(error.message);
          setErrorMessage(
            translated === error.message
              ? uiText.invoicing.invoiceVatRatesLoadError
              : translated,
          );
        } else {
          setErrorMessage(uiText.invoicing.invoiceVatRatesLoadError);
        }
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  return { errorMessage, isLoading, settings };
}

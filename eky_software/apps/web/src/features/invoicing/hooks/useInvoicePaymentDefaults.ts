import {
  createEkyApiClient,
  EkyApiError,
  type EkyApiClient,
  type InvoicePaymentSettingsView,
} from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type InvoicePaymentDefaultsClient = Pick<
  EkyApiClient,
  'getInvoicePaymentSettings'
>;

export interface InvoicePaymentDefaultsState {
  errorMessage: string | null;
  isLoading: boolean;
  settings: InvoicePaymentSettingsView | null;
}

export function useInvoicePaymentDefaults(): InvoicePaymentDefaultsState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [settings, setSettings] =
    useState<InvoicePaymentSettingsView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadSettings(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedSettings = await loadInvoicePaymentDefaults(apiClient);

        if (isActive) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getInvoicePaymentDefaultsErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  return {
    errorMessage,
    isLoading,
    settings,
  };
}

export function loadInvoicePaymentDefaults(
  apiClient: InvoicePaymentDefaultsClient,
): Promise<InvoicePaymentSettingsView> {
  return apiClient.getInvoicePaymentSettings();
}

export function getInvoicePaymentDefaultsErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.invoicePaymentSettingsLoadError
      : translatedMessage;
  }

  return uiText.invoicing.invoicePaymentSettingsLoadError;
}

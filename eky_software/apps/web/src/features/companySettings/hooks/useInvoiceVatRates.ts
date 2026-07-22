import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceVatRatesView,
  type UpdateInvoiceVatRatesRequest,
} from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoiceVatRatesClient = Pick<
  EkyApiClient,
  'getInvoiceVatRates' | 'updateInvoiceVatRates'
>;

export function useInvoiceVatRates(apiClient: InvoiceVatRatesClient) {
  const [settings, setSettings] = useState<InvoiceVatRatesView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    void apiClient.getInvoiceVatRates()
      .then((loadedSettings) => {
        if (isActive) setSettings(loadedSettings);
      })
      .catch((error: unknown) => {
        if (isActive) setErrorMessage(getErrorMessage(error, false));
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  const save = useCallback(async (input: UpdateInvoiceVatRatesRequest) => {
    if (isSaving) return null;
    setIsSaving(true);
    setSaveErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedSettings = await apiClient.updateInvoiceVatRates(input);
      setSettings(updatedSettings);
      setSuccessMessage(uiText.companySettings.invoiceVatRatesSaveSuccess);
      return updatedSettings;
    } catch (error) {
      setSaveErrorMessage(getErrorMessage(error, true));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [apiClient, isSaving]);

  return {
    errorMessage,
    isLoading,
    isSaving,
    save,
    saveErrorMessage,
    settings,
    successMessage,
  };
}

function getErrorMessage(error: unknown, isSave: boolean): string {
  if (error instanceof EkyApiError) {
    const translated = getFinnishApiErrorMessage(error.message);
    if (translated !== error.message) return translated;
  }

  return isSave
    ? uiText.companySettings.invoiceVatRatesSaveError
    : uiText.companySettings.invoiceVatRatesLoadError;
}

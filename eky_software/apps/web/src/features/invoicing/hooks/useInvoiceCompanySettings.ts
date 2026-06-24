import {
  createEkyApiClient,
  EkyApiError,
  type CompanySettings,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type InvoiceCompanySettingsClient = Pick<
  EkyApiClient,
  'getCompanySettings'
>;

export interface InvoiceCompanySettingsState {
  companySettings: CompanySettings | null;
  errorMessage: string | null;
  isLoading: boolean;
}

export function useInvoiceCompanySettings(): InvoiceCompanySettingsState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [companySettings, setCompanySettings] =
    useState<CompanySettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadSettings(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedSettings = await loadInvoiceCompanySettings(apiClient);

        if (isActive) {
          setCompanySettings(loadedSettings);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getInvoiceCompanySettingsErrorMessage(error));
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
    companySettings,
    errorMessage,
    isLoading,
  };
}

export function loadInvoiceCompanySettings(
  apiClient: InvoiceCompanySettingsClient,
): Promise<CompanySettings> {
  return apiClient.getCompanySettings();
}

export function getInvoiceCompanySettingsErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.companySettingsLoadError
      : translatedMessage;
  }

  return uiText.invoicing.companySettingsLoadError;
}

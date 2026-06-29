import {
  EkyApiError,
  type EkyApiClient,
  type InvoicePaymentSettingsView,
  type UpdateInvoicePaymentSettingsRequest,
} from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoicePaymentSettingsClient = Pick<
  EkyApiClient,
  'getInvoicePaymentSettings' | 'updateInvoicePaymentSettings'
>;

export interface InvoicePaymentSettingsState {
  errorMessage: string | null;
  isLoading: boolean;
  isSaving: boolean;
  saveErrorMessage: string | null;
  settings: InvoicePaymentSettingsView | null;
  successMessage: string | null;
  save(input: UpdateInvoicePaymentSettingsRequest): Promise<InvoicePaymentSettingsView | null>;
}

export function useInvoicePaymentSettings(
  apiClient: InvoicePaymentSettingsClient,
): InvoicePaymentSettingsState {
  const [settings, setSettings] = useState<InvoicePaymentSettingsView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadSettings(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedSettings = await loadInvoicePaymentSettings(apiClient);

        if (isActive) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getInvoicePaymentSettingsErrorMessage(error));
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

  const save = useCallback(
    async (
      input: UpdateInvoicePaymentSettingsRequest,
    ): Promise<InvoicePaymentSettingsView | null> => {
      if (isSaving) {
        return null;
      }

      setIsSaving(true);
      setSaveErrorMessage(null);
      setSuccessMessage(null);

      try {
        const updatedSettings = await saveInvoicePaymentSettings(apiClient, input);

        setSettings(updatedSettings);
        setSuccessMessage(uiText.companySettings.invoicePaymentSaveSuccess);

        return updatedSettings;
      } catch (error) {
        setSaveErrorMessage(getInvoicePaymentSettingsSaveErrorMessage(error));

        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [apiClient, isSaving],
  );

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

export function loadInvoicePaymentSettings(
  apiClient: Pick<InvoicePaymentSettingsClient, 'getInvoicePaymentSettings'>,
): Promise<InvoicePaymentSettingsView> {
  return apiClient.getInvoicePaymentSettings();
}

export function saveInvoicePaymentSettings(
  apiClient: Pick<InvoicePaymentSettingsClient, 'updateInvoicePaymentSettings'>,
  input: UpdateInvoicePaymentSettingsRequest,
): Promise<InvoicePaymentSettingsView> {
  return apiClient.updateInvoicePaymentSettings(input);
}

export function getInvoicePaymentSettingsErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.companySettings.invoicePaymentLoadError
      : translatedMessage;
  }

  return uiText.companySettings.invoicePaymentLoadError;
}

export function getInvoicePaymentSettingsSaveErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.companySettings.invoicePaymentSaveError
      : translatedMessage;
  }

  return uiText.companySettings.invoicePaymentSaveError;
}

import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceNumberingSettingsView,
  type UpdateInvoiceNumberingSettingsRequest,
} from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoiceNumberingSettingsClient = Pick<
  EkyApiClient,
  'getInvoiceNumberingSettings' | 'updateInvoiceNumberingSettings'
>;

export interface InvoiceNumberingSettingsState {
  errorMessage: string | null;
  isLoading: boolean;
  isSaving: boolean;
  saveErrorMessage: string | null;
  settings: InvoiceNumberingSettingsView | null;
  successMessage: string | null;
  save(input: UpdateInvoiceNumberingSettingsRequest): Promise<InvoiceNumberingSettingsView | null>;
}

export function useInvoiceNumberingSettings(
  apiClient: InvoiceNumberingSettingsClient,
): InvoiceNumberingSettingsState {
  const [settings, setSettings] = useState<InvoiceNumberingSettingsView | null>(null);
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
        const loadedSettings = await loadInvoiceNumberingSettings(apiClient);

        if (isActive) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getInvoiceNumberingSettingsErrorMessage(error));
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
      input: UpdateInvoiceNumberingSettingsRequest,
    ): Promise<InvoiceNumberingSettingsView | null> => {
      if (isSaving) {
        return null;
      }

      setIsSaving(true);
      setSaveErrorMessage(null);
      setSuccessMessage(null);

      try {
        const updatedSettings = await saveInvoiceNumberingSettings(apiClient, input);

        setSettings(updatedSettings);
        setSuccessMessage(uiText.companySettings.invoiceNumberingSaveSuccess);

        return updatedSettings;
      } catch (error) {
        setSaveErrorMessage(getInvoiceNumberingSettingsSaveErrorMessage(error));

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

export function loadInvoiceNumberingSettings(
  apiClient: Pick<InvoiceNumberingSettingsClient, 'getInvoiceNumberingSettings'>,
): Promise<InvoiceNumberingSettingsView> {
  return apiClient.getInvoiceNumberingSettings();
}

export function saveInvoiceNumberingSettings(
  apiClient: Pick<InvoiceNumberingSettingsClient, 'updateInvoiceNumberingSettings'>,
  input: UpdateInvoiceNumberingSettingsRequest,
): Promise<InvoiceNumberingSettingsView> {
  return apiClient.updateInvoiceNumberingSettings(input);
}

export function getInvoiceNumberingSettingsErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.companySettings.invoiceNumberingLoadError
      : translatedMessage;
  }

  return uiText.companySettings.invoiceNumberingLoadError;
}

export function getInvoiceNumberingSettingsSaveErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.companySettings.invoiceNumberingSaveError
      : translatedMessage;
  }

  return uiText.companySettings.invoiceNumberingSaveError;
}

import {
  EkyApiError,
  type CompanyEmailSecretStatus,
  type EkyApiClient,
} from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type CompanyEmailSecretClient = Pick<
  EkyApiClient,
  | 'getCompanyEmailSecretStatus'
  | 'removeCompanyEmailSecret'
  | 'setCompanyEmailSecret'
>;

export interface CompanyEmailSecretState {
  configured: boolean;
  errorMessage: string | null;
  isAvailable: boolean;
  isLoading: boolean;
  isSaving: boolean;
  remove(): Promise<boolean>;
  save(secret: string): Promise<boolean>;
  successMessage: string | null;
}

export function useCompanyEmailSecret(
  apiClient: CompanyEmailSecretClient,
): CompanyEmailSecretState {
  const [status, setStatus] = useState<CompanyEmailSecretStatus>({
    configured: false,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    void loadCompanyEmailSecretStatus(apiClient)
      .then((loadedStatus) => {
        if (isActive) {
          setStatus(loadedStatus);
          setIsAvailable(true);
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setErrorMessage(getCompanyEmailSecretLoadErrorMessage(error));
          setIsAvailable(!isUnavailableInCurrentRuntime(error));
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  const save = useCallback(
    async (secret: string): Promise<boolean> => {
      if (isSaving || !isAvailable) {
        return false;
      }

      setIsSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      try {
        const updatedStatus = await saveCompanyEmailSecret(apiClient, secret);

        setStatus(updatedStatus);
        setSuccessMessage(uiText.companySettings.emailSecretSaveSuccess);

        return true;
      } catch (error) {
        setErrorMessage(getCompanyEmailSecretSaveErrorMessage(error));

        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [apiClient, isAvailable, isSaving],
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (isSaving || !isAvailable) {
      return false;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedStatus = await removeCompanyEmailSecret(apiClient);

      setStatus(updatedStatus);
      setSuccessMessage(uiText.companySettings.emailSecretRemoveSuccess);

      return true;
    } catch (error) {
      setErrorMessage(getCompanyEmailSecretRemoveErrorMessage(error));

      return false;
    } finally {
      setIsSaving(false);
    }
  }, [apiClient, isAvailable, isSaving]);

  return {
    configured: status.configured,
    errorMessage,
    isAvailable,
    isLoading,
    isSaving,
    remove,
    save,
    successMessage,
  };
}

export function loadCompanyEmailSecretStatus(
  apiClient: Pick<CompanyEmailSecretClient, 'getCompanyEmailSecretStatus'>,
): Promise<CompanyEmailSecretStatus> {
  return apiClient.getCompanyEmailSecretStatus();
}

export function saveCompanyEmailSecret(
  apiClient: Pick<CompanyEmailSecretClient, 'setCompanyEmailSecret'>,
  secret: string,
): Promise<CompanyEmailSecretStatus> {
  return apiClient.setCompanyEmailSecret({ secret });
}

export function removeCompanyEmailSecret(
  apiClient: Pick<CompanyEmailSecretClient, 'removeCompanyEmailSecret'>,
): Promise<CompanyEmailSecretStatus> {
  return apiClient.removeCompanyEmailSecret();
}

export function getCompanyEmailSecretLoadErrorMessage(error: unknown): string {
  if (isUnavailableInCurrentRuntime(error)) {
    return uiText.companySettings.emailSecretDesktopOnly;
  }

  return getSafeCompanyEmailSecretErrorMessage(
    error,
    uiText.companySettings.emailSecretLoadError,
  );
}

export function getCompanyEmailSecretSaveErrorMessage(error: unknown): string {
  return getSafeCompanyEmailSecretErrorMessage(
    error,
    uiText.companySettings.emailSecretSaveError,
  );
}

export function getCompanyEmailSecretRemoveErrorMessage(error: unknown): string {
  return getSafeCompanyEmailSecretErrorMessage(
    error,
    uiText.companySettings.emailSecretRemoveError,
  );
}

function isUnavailableInCurrentRuntime(error: unknown): boolean {
  return error instanceof EkyApiError && error.status === 404;
}

function getSafeCompanyEmailSecretErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? fallbackMessage
      : translatedMessage;
  }

  return fallbackMessage;
}

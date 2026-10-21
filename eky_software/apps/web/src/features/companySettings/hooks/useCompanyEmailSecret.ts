import {
  EkyApiError,
  getCompanyEmailSecretErrorCode,
  type CompanyEmailSecretStatus,
  type EkyApiClient,
} from '@eky/api-client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type CompanyEmailSecretClient = Pick<
  EkyApiClient,
  | 'getCompanyEmailSecretStatus'
  | 'removeCompanyEmailSecret'
  | 'setCompanyEmailSecret'
>;

export interface CompanyEmailSecretState {
  configured: boolean | null;
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
  const [status, setStatus] = useState<CompanyEmailSecretStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const sessionRef = useRef<{
    client: CompanyEmailSecretClient;
    available: boolean;
    pending: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    sessionRef.current = { client: apiClient, available: false, pending: false };
    setStatus(null);
    setIsAvailable(false);
    setIsLoading(true);
    setIsSaving(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    return () => { sessionRef.current = null; };
  }, [apiClient]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.client !== apiClient) return;
    let isActive = true;
    const isCurrent = () => isActive && sessionRef.current === session;

    void loadCompanyEmailSecretStatus(apiClient)
      .then((loadedStatus) => {
        if (isCurrent()) {
          session.available = true;
          setStatus(loadedStatus);
          setIsAvailable(true);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent()) {
          session.available = false;
          setStatus(null);
          setErrorMessage(getCompanyEmailSecretLoadErrorMessage(error));
          setIsAvailable(false);
        }
      })
      .finally(() => {
        if (isCurrent()) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  const changeSecret = useCallback(
    async (operation: 'save' | 'remove', secret?: string): Promise<boolean> => {
      const session = sessionRef.current;
      if (session === null || session.client !== apiClient || session.pending || !session.available) {
        return false;
      }
      session.pending = true;
      const isCurrent = () => sessionRef.current === session;
      setIsSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      try {
        const updatedStatus = operation === 'save'
          ? await saveCompanyEmailSecret(apiClient, secret!)
          : await removeCompanyEmailSecret(apiClient);
        if (!isCurrent()) return false;
        setStatus(updatedStatus);
        setSuccessMessage(operation === 'save'
          ? uiText.companySettings.emailSecretSaveSuccess
          : uiText.companySettings.emailSecretRemoveSuccess);

        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        if (!isKnownUnaffectedSecretFailure(error)) {
          session.available = false;
          setIsAvailable(false);
          setStatus(null);
          setErrorMessage(getCompanyEmailSecretErrorCode(error) === 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE'
            ? uiText.companySettings.emailSecretAuditIncomplete
            : uiText.companySettings.emailSecretOutcomeUnknown);
        } else {
          setErrorMessage(operation === 'save'
            ? getCompanyEmailSecretSaveErrorMessage(error)
            : getCompanyEmailSecretRemoveErrorMessage(error));
        }
        return false;
      } finally {
        if (isCurrent()) {
          session.pending = false;
          setIsSaving(false);
        }
      }
    },
    [apiClient],
  );

  const save = useCallback((secret: string) => changeSecret('save', secret), [changeSecret]);
  const remove = useCallback(() => changeSecret('remove'), [changeSecret]);

  return {
    configured: status?.configured ?? null,
    errorMessage,
    isAvailable,
    isLoading,
    isSaving,
    remove,
    save,
    successMessage,
  };
}

function isKnownUnaffectedSecretFailure(error: unknown): boolean {
  return getCompanyEmailSecretErrorCode(error) === 'COMPANY_EMAIL_SECRET_OPERATION_FAILED' ||
    (error instanceof EkyApiError && (error.status === 400 || error.status === 403 || error.status === 413));
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
  const code = getCompanyEmailSecretErrorCode(error);
  if (code === 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN') return uiText.companySettings.emailSecretOutcomeUnknown;
  if (code === 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE') return uiText.companySettings.emailSecretAuditIncomplete;

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

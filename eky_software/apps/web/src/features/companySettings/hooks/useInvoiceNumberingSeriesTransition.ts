import {
  EkyApiError,
  type ActivateInvoiceNumberingSeriesRequest,
  type EkyApiClient,
  type InvoiceNumberingSeriesActivationPreviewQuery,
  type InvoiceNumberingSeriesActivationPreviewView,
  type InvoiceNumberingSeriesOverviewView,
} from '@eky/api-client';
import { useCallback, useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoiceNumberingSeriesClient = Pick<
  EkyApiClient,
  | 'activateInvoiceNumberingSeries'
  | 'getInvoiceNumberingSeriesOverview'
  | 'previewInvoiceNumberingSeriesActivation'
>;

export interface InvoiceNumberingSeriesTransitionState {
  activate(
    input: ActivateInvoiceNumberingSeriesRequest,
  ): Promise<InvoiceNumberingSeriesOverviewView | null>;
  activationErrorMessage: string | null;
  errorMessage: string | null;
  isActivating: boolean;
  isLoading: boolean;
  isPreviewLoading: boolean;
  overview: InvoiceNumberingSeriesOverviewView | null;
  preview(
    query: InvoiceNumberingSeriesActivationPreviewQuery,
  ): Promise<InvoiceNumberingSeriesActivationPreviewView | null>;
  previewErrorMessage: string | null;
  successMessage: string | null;
}

export function useInvoiceNumberingSeriesTransition(
  apiClient: InvoiceNumberingSeriesClient,
): InvoiceNumberingSeriesTransitionState {
  const [overview, setOverview] =
    useState<InvoiceNumberingSeriesOverviewView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewErrorMessage, setPreviewErrorMessage] =
    useState<string | null>(null);
  const [activationErrorMessage, setActivationErrorMessage] =
    useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadOverview(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedOverview =
          await apiClient.getInvoiceNumberingSeriesOverview();

        if (isActive) {
          setOverview(loadedOverview);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(toSafeSeriesErrorMessage(error, 'load'));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadOverview();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  const preview = useCallback(
    async (
      query: InvoiceNumberingSeriesActivationPreviewQuery,
    ): Promise<InvoiceNumberingSeriesActivationPreviewView | null> => {
      if (isPreviewLoading || isActivating) {
        return null;
      }

      setIsPreviewLoading(true);
      setPreviewErrorMessage(null);
      setActivationErrorMessage(null);
      setSuccessMessage(null);

      try {
        return await apiClient.previewInvoiceNumberingSeriesActivation(query);
      } catch (error) {
        setPreviewErrorMessage(toSafeSeriesErrorMessage(error, 'preview'));
        return null;
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [apiClient, isActivating, isPreviewLoading],
  );

  const activate = useCallback(
    async (
      input: ActivateInvoiceNumberingSeriesRequest,
    ): Promise<InvoiceNumberingSeriesOverviewView | null> => {
      if (isActivating || isPreviewLoading) {
        return null;
      }

      setIsActivating(true);
      setActivationErrorMessage(null);
      setSuccessMessage(null);

      try {
        const activatedOverview =
          await apiClient.activateInvoiceNumberingSeries(input);

        setOverview(activatedOverview);
        setSuccessMessage(
          uiText.companySettings.invoiceNumberingSeriesActivationSuccess,
        );

        return activatedOverview;
      } catch (error) {
        setActivationErrorMessage(toSafeSeriesErrorMessage(error, 'activate'));
        return null;
      } finally {
        setIsActivating(false);
      }
    },
    [apiClient, isActivating, isPreviewLoading],
  );

  return {
    activate,
    activationErrorMessage,
    errorMessage,
    isActivating,
    isLoading,
    isPreviewLoading,
    overview,
    preview,
    previewErrorMessage,
    successMessage,
  };
}

export function toSafeSeriesErrorMessage(
  error: unknown,
  operation: 'activate' | 'load' | 'preview',
): string {
  if (error instanceof EkyApiError) {
    if (error.status === 409) {
      return uiText.companySettings.invoiceNumberingSeriesConflictError;
    }

    const translated = getFinnishApiErrorMessage(error.message);

    if (translated !== error.message) {
      return translated;
    }
  }

  if (operation === 'preview') {
    return uiText.companySettings.invoiceNumberingSeriesPreviewError;
  }

  if (operation === 'activate') {
    return uiText.companySettings.invoiceNumberingSeriesActivationError;
  }

  return uiText.companySettings.invoiceNumberingSeriesLoadError;
}

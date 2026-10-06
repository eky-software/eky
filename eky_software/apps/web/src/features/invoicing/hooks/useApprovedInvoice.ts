import {
  EkyApiError,
  type ApprovedInvoiceView,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ApprovedInvoiceClient = Pick<EkyApiClient, 'getApprovedInvoice'>;

export interface ApprovedInvoiceState {
  approvedInvoice: ApprovedInvoiceView | null;
  errorMessage: string | null;
  isLoading: boolean;
  clearApprovedInvoice(): void;
  openApprovedInvoice(id: string): Promise<ApprovedInvoiceView | null>;
  replaceApprovedInvoice(invoice: ApprovedInvoiceView): void;
}

export function useApprovedInvoice(
  apiClient: ApprovedInvoiceClient,
): ApprovedInvoiceState {
  const [approvedInvoice, setApprovedInvoice] =
    useState<ApprovedInvoiceView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++generation.current; };
  }, []);

  function clearApprovedInvoice(): void {
    ++generation.current;
    setApprovedInvoice(null);
    setErrorMessage(null);
    setIsLoading(false);
  }

  async function openApprovedInvoice(
    id: string,
  ): Promise<ApprovedInvoiceView | null> {
    if (!mounted.current) return null;
    const requestGeneration = ++generation.current;
    const isCurrent = (): boolean =>
      mounted.current && requestGeneration === generation.current;
    setApprovedInvoice(null);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const invoice = await getApprovedInvoiceWithClient(apiClient, id);
      if (!isCurrent()) return null;
      setApprovedInvoice(invoice);

      return invoice;
    } catch (error) {
      if (isCurrent()) {
        setApprovedInvoice(null);
        setErrorMessage(getApprovedInvoiceErrorMessage(error));
      }

      return null;
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }

  function replaceApprovedInvoice(invoice: ApprovedInvoiceView): void {
    ++generation.current;
    setApprovedInvoice(invoice);
    setErrorMessage(null);
    setIsLoading(false);
  }

  return {
    approvedInvoice,
    clearApprovedInvoice,
    errorMessage,
    isLoading,
    openApprovedInvoice,
    replaceApprovedInvoice,
  };
}

export function getApprovedInvoiceWithClient(
  apiClient: ApprovedInvoiceClient,
  id: string,
): Promise<ApprovedInvoiceView> {
  return apiClient.getApprovedInvoice(id);
}

export function getApprovedInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    if (error.status === 404) {
      return uiText.invoicing.approvedInvoiceNotFound;
    }

    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.approvedInvoiceLoadError
      : translatedMessage;
  }

  return uiText.invoicing.approvedInvoiceLoadError;
}

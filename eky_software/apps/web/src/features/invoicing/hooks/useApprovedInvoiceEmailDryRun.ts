import {
  EkyApiError,
  type ApprovedInvoiceEmailPreview,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { getInvoiceLegacyDeliveryReviewErrorMessage } from './invoiceLegacyDeliveryReviewError.js';
import { uiText } from '../../../i18n/fi.js';

type ApprovedInvoiceEmailDryRunClient = Pick<
  EkyApiClient,
  'prepareApprovedInvoiceEmailDryRun'
>;

export interface ApprovedInvoiceEmailDryRunState {
  email: ApprovedInvoiceEmailPreview | null;
  errorMessage: string | null;
  isPreparing: boolean;
  clearEmail(): void;
  clearError(): void;
  prepareEmail(id: string): Promise<ApprovedInvoiceEmailPreview | null>;
}

export function useApprovedInvoiceEmailDryRun(
  apiClient: ApprovedInvoiceEmailDryRunClient,
): ApprovedInvoiceEmailDryRunState {
  const [email, setEmail] = useState<ApprovedInvoiceEmailPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const generation = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      ++generation.current;
    };
  }, []);

  function clearEmail(): void {
    ++generation.current;
    setEmail(null);
    setErrorMessage(null);
    setIsPreparing(false);
  }

  function clearError(): void {
    setErrorMessage(null);
  }

  async function prepareEmail(
    id: string,
  ): Promise<ApprovedInvoiceEmailPreview | null> {
    if (!isMounted.current) return null;
    const requestGeneration = ++generation.current;
    const isCurrent = (): boolean =>
      isMounted.current && requestGeneration === generation.current;
    setEmail(null);
    setIsPreparing(true);
    setErrorMessage(null);

    try {
      const preparedEmail = await prepareApprovedInvoiceEmailDryRunWithClient(
        apiClient,
        id,
      );
      if (!isCurrent()) return null;
      setEmail(preparedEmail);

      return preparedEmail;
    } catch (error) {
      if (isCurrent()) {
        setErrorMessage(getApprovedInvoiceEmailDryRunErrorMessage(error));
      }

      return null;
    } finally {
      if (isCurrent()) setIsPreparing(false);
    }
  }

  return {
    clearEmail,
    clearError,
    email,
    errorMessage,
    isPreparing,
    prepareEmail,
  };
}

export function prepareApprovedInvoiceEmailDryRunWithClient(
  client: ApprovedInvoiceEmailDryRunClient,
  id: string,
): Promise<ApprovedInvoiceEmailPreview> {
  return client.prepareApprovedInvoiceEmailDryRun(id);
}

export function getApprovedInvoiceEmailDryRunErrorMessage(
  error: unknown,
): string {
  const legacyReviewMessage = getInvoiceLegacyDeliveryReviewErrorMessage(error);

  if (legacyReviewMessage !== null) {
    return legacyReviewMessage;
  }

  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  return uiText.invoicing.invoiceEmailPrepareError;
}

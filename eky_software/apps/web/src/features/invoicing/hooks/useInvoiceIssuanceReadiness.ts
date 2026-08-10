import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceIssuanceReadiness,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type InvoiceIssuanceReadinessClient = Pick<
  EkyApiClient,
  'getInvoiceIssuanceReadiness'
>;

export function useInvoiceIssuanceReadiness(
  apiClient: InvoiceIssuanceReadinessClient,
) {
  const [readiness, setReadiness] =
    useState<InvoiceIssuanceReadiness | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  function clearReadiness(): void {
    setReadiness(null);
    setErrorMessage(null);
  }

  async function checkReadiness(
    invoiceDraftId: string,
  ): Promise<InvoiceIssuanceReadiness | null> {
    setIsChecking(true);
    setErrorMessage(null);

    try {
      const result = await getInvoiceIssuanceReadinessWithClient(
        apiClient,
        invoiceDraftId,
      );
      setReadiness(result);
      return result;
    } catch (error) {
      setReadiness(null);
      setErrorMessage(
        error instanceof EkyApiError && error.status === 404
          ? uiText.invoicing.approveDraftNotFound
          : uiText.invoicing.invoiceIssuanceReadinessError,
      );
      return null;
    } finally {
      setIsChecking(false);
    }
  }

  return {
    checkReadiness,
    clearReadiness,
    errorMessage,
    isChecking,
    readiness,
  };
}

export function getInvoiceIssuanceReadinessWithClient(
  apiClient: InvoiceIssuanceReadinessClient,
  invoiceDraftId: string,
): Promise<InvoiceIssuanceReadiness> {
  return apiClient.getInvoiceIssuanceReadiness(invoiceDraftId);
}

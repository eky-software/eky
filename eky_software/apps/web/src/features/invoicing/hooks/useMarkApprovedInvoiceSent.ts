import {
  EkyApiError,
  type ApprovedInvoiceView,
  type EkyApiClient,
  type InvoiceManualDeliveryMethod,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type MarkApprovedInvoiceSentClient = Pick<
  EkyApiClient,
  'markApprovedInvoiceSent'
>;

export interface MarkApprovedInvoiceSentState {
  errorMessage: string | null;
  isMarkingSent: boolean;
  clearError(): void;
  markApprovedInvoiceSent(
    id: string,
    deliveryMethod: InvoiceManualDeliveryMethod,
  ): Promise<ApprovedInvoiceView | null>;
}

export function useMarkApprovedInvoiceSent(
  apiClient: MarkApprovedInvoiceSentClient,
): MarkApprovedInvoiceSentState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMarkingSent, setIsMarkingSent] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function markSent(
    id: string,
    deliveryMethod: InvoiceManualDeliveryMethod,
  ): Promise<ApprovedInvoiceView | null> {
    setIsMarkingSent(true);
    setErrorMessage(null);

    try {
      return await markApprovedInvoiceSentWithClient(
        apiClient,
        id,
        deliveryMethod,
      );
    } catch (error) {
      setErrorMessage(getMarkApprovedInvoiceSentErrorMessage(error));
      return null;
    } finally {
      setIsMarkingSent(false);
    }
  }

  return {
    clearError,
    errorMessage,
    isMarkingSent,
    markApprovedInvoiceSent: markSent,
  };
}

export function markApprovedInvoiceSentWithClient(
  client: MarkApprovedInvoiceSentClient,
  id: string,
  deliveryMethod: InvoiceManualDeliveryMethod,
): Promise<ApprovedInvoiceView> {
  return client.markApprovedInvoiceSent(id, deliveryMethod);
}

export function getMarkApprovedInvoiceSentErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return error.status === 404
      ? uiText.invoicing.approvedInvoiceNotFound
      : uiText.invoicing.markApprovedInvoiceSentError;
  }

  return uiText.invoicing.markApprovedInvoiceSentError;
}

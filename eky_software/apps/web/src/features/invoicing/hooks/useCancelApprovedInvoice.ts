import {
  EkyApiError,
  type CancelApprovedInvoiceInput,
  type CancelledApprovedInvoice,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type CancelApprovedInvoiceClient = Pick<EkyApiClient, 'cancelApprovedInvoice'>;

export interface CancelApprovedInvoiceState {
  errorMessage: string | null;
  isCancelling: boolean;
  cancelApprovedInvoice(
    id: string,
    input: CancelApprovedInvoiceInput,
  ): Promise<CancelledApprovedInvoice | null>;
  clearError(): void;
}

export function useCancelApprovedInvoice(
  apiClient: CancelApprovedInvoiceClient,
): CancelApprovedInvoiceState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function cancelInvoice(
    id: string,
    input: CancelApprovedInvoiceInput,
  ): Promise<CancelledApprovedInvoice | null> {
    setIsCancelling(true);
    setErrorMessage(null);

    try {
      return await cancelApprovedInvoiceWithClient(apiClient, id, input);
    } catch (error) {
      setErrorMessage(getCancelApprovedInvoiceErrorMessage(error));
      return null;
    } finally {
      setIsCancelling(false);
    }
  }

  return {
    cancelApprovedInvoice: cancelInvoice,
    clearError,
    errorMessage,
    isCancelling,
  };
}

export function cancelApprovedInvoiceWithClient(
  client: CancelApprovedInvoiceClient,
  id: string,
  input: CancelApprovedInvoiceInput,
): Promise<CancelledApprovedInvoice> {
  return client.cancelApprovedInvoice(id, input);
}

export function getCancelApprovedInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    if (error.status === 404) {
      return uiText.invoicing.approvedInvoiceNotFound;
    }

    if (error.status === 400) {
      return uiText.invoicing.cancelApprovedInvoiceValidationError;
    }

    if (error.status === 409) {
      return uiText.invoicing.cancelApprovedInvoiceConflictError;
    }
  }

  return uiText.invoicing.cancelApprovedInvoiceError;
}

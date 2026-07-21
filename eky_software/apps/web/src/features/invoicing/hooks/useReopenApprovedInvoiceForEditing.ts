import {
  EkyApiError,
  type EkyApiClient,
  type ReopenedApprovedInvoice,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type ReopenApprovedInvoiceClient = Pick<
  EkyApiClient,
  'reopenApprovedInvoiceForEditing'
>;

export interface ReopenApprovedInvoiceState {
  errorMessage: string | null;
  isReopening: boolean;
  clearError(): void;
  reopenApprovedInvoice(id: string): Promise<ReopenedApprovedInvoice | null>;
}

export function useReopenApprovedInvoiceForEditing(
  apiClient: ReopenApprovedInvoiceClient,
): ReopenApprovedInvoiceState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function reopenApprovedInvoice(
    id: string,
  ): Promise<ReopenedApprovedInvoice | null> {
    setIsReopening(true);
    setErrorMessage(null);

    try {
      return await reopenApprovedInvoiceWithClient(apiClient, id);
    } catch (error) {
      setErrorMessage(getReopenApprovedInvoiceErrorMessage(error));
      return null;
    } finally {
      setIsReopening(false);
    }
  }

  return {
    clearError,
    errorMessage,
    isReopening,
    reopenApprovedInvoice,
  };
}

export function reopenApprovedInvoiceWithClient(
  client: ReopenApprovedInvoiceClient,
  id: string,
): Promise<ReopenedApprovedInvoice> {
  return client.reopenApprovedInvoiceForEditing(id);
}

export function getReopenApprovedInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return error.status === 404
      ? uiText.invoicing.approvedInvoiceNotFound
      : uiText.invoicing.reopenApprovedInvoiceError;
  }

  return uiText.invoicing.reopenApprovedInvoiceError;
}

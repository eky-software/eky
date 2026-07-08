import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceView,
  type EkyApiClient,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type MarkApprovedInvoiceSentClient = Pick<
  EkyApiClient,
  'markApprovedInvoiceSent'
>;

export interface MarkApprovedInvoiceSentState {
  errorMessage: string | null;
  isMarkingSent: boolean;
  clearError(): void;
  markApprovedInvoiceSent(id: string): Promise<ApprovedInvoiceView | null>;
}

export function useMarkApprovedInvoiceSent(): MarkApprovedInvoiceSentState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMarkingSent, setIsMarkingSent] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function markSent(id: string): Promise<ApprovedInvoiceView | null> {
    setIsMarkingSent(true);
    setErrorMessage(null);

    try {
      return await markApprovedInvoiceSentWithClient(apiClient, id);
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
): Promise<ApprovedInvoiceView> {
  return client.markApprovedInvoiceSent(id);
}

export function getMarkApprovedInvoiceSentErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return error.status === 404
      ? uiText.invoicing.approvedInvoiceNotFound
      : uiText.invoicing.markApprovedInvoiceSentError;
  }

  return uiText.invoicing.markApprovedInvoiceSentError;
}

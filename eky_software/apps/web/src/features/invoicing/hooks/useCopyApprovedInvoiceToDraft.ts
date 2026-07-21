import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type CopyApprovedInvoiceClient = Pick<EkyApiClient, 'copyApprovedInvoiceToDraft'>;

export interface CopyApprovedInvoiceState {
  copiedInvoiceId: string | null;
  errorMessage: string | null;
  isCopying: boolean;
  clearError(): void;
  copyApprovedInvoiceToDraft(id: string): Promise<InvoiceDraft | null>;
}

export function useCopyApprovedInvoiceToDraft(
  apiClient: CopyApprovedInvoiceClient,
): CopyApprovedInvoiceState {
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCopying, setIsCopying] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function copyInvoice(id: string): Promise<InvoiceDraft | null> {
    setCopiedInvoiceId(id);
    setErrorMessage(null);
    setIsCopying(true);

    try {
      return await copyApprovedInvoiceToDraftWithClient(apiClient, id);
    } catch (error) {
      setErrorMessage(getCopyApprovedInvoiceErrorMessage(error));

      return null;
    } finally {
      setCopiedInvoiceId(null);
      setIsCopying(false);
    }
  }

  return {
    clearError,
    copiedInvoiceId,
    copyApprovedInvoiceToDraft: copyInvoice,
    errorMessage,
    isCopying,
  };
}

export function copyApprovedInvoiceToDraftWithClient(
  client: CopyApprovedInvoiceClient,
  id: string,
): Promise<InvoiceDraft> {
  return client.copyApprovedInvoiceToDraft(id);
}

export function getCopyApprovedInvoiceErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  return uiText.invoicing.copyApprovedInvoiceError;
}

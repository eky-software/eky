import {
  EkyApiError,
  type ApprovedInvoiceResult,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ApproveInvoiceDraftClient = Pick<EkyApiClient, 'approveInvoiceDraft'>;

export interface ApproveInvoiceDraftState {
  approvedInvoice: ApprovedInvoiceResult | null;
  errorMessage: string | null;
  isApproving: boolean;
  approveDraft(id: string): Promise<ApprovedInvoiceResult | null>;
  clearApprovalResult(): void;
}

export function useApproveInvoiceDraft(
  apiClient: ApproveInvoiceDraftClient,
): ApproveInvoiceDraftState {
  const [approvedInvoice, setApprovedInvoice] =
    useState<ApprovedInvoiceResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  function clearApprovalResult(): void {
    setApprovedInvoice(null);
    setErrorMessage(null);
  }

  async function approveDraft(id: string): Promise<ApprovedInvoiceResult | null> {
    setIsApproving(true);
    setErrorMessage(null);

    try {
      const result = await approveInvoiceDraftWithClient(apiClient, id);

      setApprovedInvoice(result);

      return result;
    } catch (error) {
      setApprovedInvoice(null);
      setErrorMessage(getApproveInvoiceDraftErrorMessage(error));

      return null;
    } finally {
      setIsApproving(false);
    }
  }

  return {
    approveDraft,
    approvedInvoice,
    clearApprovalResult,
    errorMessage,
    isApproving,
  };
}

export function approveInvoiceDraftWithClient(
  apiClient: ApproveInvoiceDraftClient,
  id: string,
): Promise<ApprovedInvoiceResult> {
  return apiClient.approveInvoiceDraft(id);
}

export function getApproveInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    if (error.status === 404) {
      return uiText.invoicing.approveDraftNotFound;
    }

    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.approveDraftError
      : translatedMessage;
  }

  return uiText.invoicing.approveDraftError;
}

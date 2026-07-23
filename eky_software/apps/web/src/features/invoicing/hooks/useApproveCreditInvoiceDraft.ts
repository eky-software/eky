import {
  EkyApiError,
  type ApprovedCreditInvoiceResult,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type ApproveCreditInvoiceDraftClient = Pick<
  EkyApiClient,
  'approveCreditInvoiceDraft'
>;

export interface ApproveCreditInvoiceDraftState {
  errorMessage: string | null;
  isApproving: boolean;
  approveDraft(id: string): Promise<ApprovedCreditInvoiceResult | null>;
  clearError(): void;
}

export function useApproveCreditInvoiceDraft(
  apiClient: ApproveCreditInvoiceDraftClient,
): ApproveCreditInvoiceDraftState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  function clearError(): void {
    setErrorMessage(null);
  }

  async function approveDraft(
    id: string,
  ): Promise<ApprovedCreditInvoiceResult | null> {
    setErrorMessage(null);
    setIsApproving(true);

    try {
      return await approveCreditInvoiceDraftWithClient(apiClient, id);
    } catch (error) {
      setErrorMessage(getApproveCreditInvoiceDraftErrorMessage(error));
      return null;
    } finally {
      setIsApproving(false);
    }
  }

  return {
    approveDraft,
    clearError,
    errorMessage,
    isApproving,
  };
}

export function approveCreditInvoiceDraftWithClient(
  apiClient: ApproveCreditInvoiceDraftClient,
  id: string,
): Promise<ApprovedCreditInvoiceResult> {
  return apiClient.approveCreditInvoiceDraft(id);
}

export function getApproveCreditInvoiceDraftErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError) {
    if (error.status === 404) {
      return uiText.invoicing.creditDraftNotFound;
    }

    if (error.status === 409) {
      return uiText.invoicing.creditDraftApprovalConflict;
    }
  }

  return uiText.invoicing.creditDraftApprovalError;
}

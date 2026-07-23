import {
  EkyApiError,
  type CreditInvoiceDraft,
  type EkyApiClient,
  type UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type CreditInvoiceDraftClient = Pick<
  EkyApiClient,
  | 'createCreditInvoiceDraft'
  | 'getCreditInvoiceDraft'
  | 'updateCreditInvoiceDraft'
>;

export interface CreditInvoiceDraftState {
  draft: CreditInvoiceDraft | null;
  errorMessage: string | null;
  isLoading: boolean;
  isSaving: boolean;
  successMessage: string | null;
  clearDraft(): void;
  createDraft(invoiceId: string): Promise<CreditInvoiceDraft | null>;
  openDraft(invoiceDraftId: string): Promise<CreditInvoiceDraft | null>;
  saveDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): Promise<CreditInvoiceDraft | null>;
}

export function useCreditInvoiceDraft(
  apiClient: CreditInvoiceDraftClient,
): CreditInvoiceDraftState {
  const [draft, setDraft] = useState<CreditInvoiceDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function clearDraft(): void {
    setDraft(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function runLoad(
    operation: () => Promise<CreditInvoiceDraft>,
  ): Promise<CreditInvoiceDraft | null> {
    setDraft(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const loadedDraft = await operation();
      setDraft(loadedDraft);
      return loadedDraft;
    } catch (error) {
      setErrorMessage(getCreditInvoiceDraftErrorMessage(error));
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function saveDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): Promise<CreditInvoiceDraft | null> {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSaving(true);

    try {
      const savedDraft = await apiClient.updateCreditInvoiceDraft(
        invoiceDraftId,
        input,
      );
      setDraft(savedDraft);
      setSuccessMessage(uiText.invoicing.creditDraftSaveSuccess);
      return savedDraft;
    } catch (error) {
      setErrorMessage(getCreditInvoiceDraftErrorMessage(error));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    clearDraft,
    createDraft: (invoiceId) =>
      runLoad(() => apiClient.createCreditInvoiceDraft(invoiceId)),
    draft,
    errorMessage,
    isLoading,
    isSaving,
    openDraft: (invoiceDraftId) =>
      runLoad(() => apiClient.getCreditInvoiceDraft(invoiceDraftId)),
    saveDraft,
    successMessage,
  };
}

export function getCreditInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    if (error.status === 404) {
      return uiText.invoicing.creditDraftNotFound;
    }

    if (error.status === 400) {
      return uiText.invoicing.creditDraftValidationError;
    }

    if (error.status === 409) {
      return uiText.invoicing.creditDraftConflictError;
    }
  }

  return uiText.invoicing.creditDraftError;
}


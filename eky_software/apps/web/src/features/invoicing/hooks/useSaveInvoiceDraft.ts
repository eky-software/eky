import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '@eky/api-client';
import { useState } from 'react';

import { toInvoiceDraftInput } from '../form/invoiceDraftFormMapping.js';
import {
  type InvoiceDraftFormErrors,
  type InvoiceDraftFormValidationContext,
  validateInvoiceDraftForm,
} from '../form/invoiceDraftFormValidation.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type InvoiceDraftSaveClient = Pick<
  EkyApiClient,
  'createInvoiceDraft' | 'updateInvoiceDraft'
>;

export type InvoiceDraftSaveMode =
  | { type: 'create' }
  | { draftId: string; type: 'edit' };

export type PreparedInvoiceDraftSave =
  | {
      errors: InvoiceDraftFormErrors;
      input?: undefined;
      isValid: false;
    }
  | {
      errors: InvoiceDraftFormErrors;
      input: InvoiceDraftInput;
      isValid: true;
    };

export interface SaveInvoiceDraftState {
  errorMessage: string | null;
  isSaving: boolean;
  savedDraft: InvoiceDraft | null;
  clearSaveResult(): void;
  saveInvoiceDraft(input: InvoiceDraftInput): Promise<InvoiceDraft | null>;
}

export function prepareInvoiceDraftSaveInput(
  form: NewInvoiceFormState,
  validationContext: InvoiceDraftFormValidationContext = {},
): PreparedInvoiceDraftSave {
  const validationResult = validateInvoiceDraftForm(form, validationContext);

  if (!validationResult.isValid) {
    return {
      errors: validationResult.errors,
      isValid: false,
    };
  }

  return {
    errors: validationResult.errors,
    input: toInvoiceDraftInput(form),
    isValid: true,
  };
}

export function useSaveInvoiceDraft(
  apiClient: InvoiceDraftSaveClient,
  mode: InvoiceDraftSaveMode,
): SaveInvoiceDraftState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedDraft, setSavedDraft] = useState<InvoiceDraft | null>(null);

  function clearSaveResult(): void {
    setErrorMessage(null);
    setSavedDraft(null);
  }

  async function saveInvoiceDraft(
    input: InvoiceDraftInput,
  ): Promise<InvoiceDraft | null> {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const draft = await saveInvoiceDraftInput(input, apiClient, mode);

      setSavedDraft(draft);

      return draft;
    } catch (error) {
      setSavedDraft(null);
      setErrorMessage(getSaveInvoiceDraftErrorMessage(error));

      return null;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    clearSaveResult,
    errorMessage,
    isSaving,
    saveInvoiceDraft,
    savedDraft,
  };
}

export function saveInvoiceDraftInput(
  input: InvoiceDraftInput,
  apiClient: InvoiceDraftSaveClient,
  mode: InvoiceDraftSaveMode,
): Promise<InvoiceDraft> {
  if (mode.type === 'edit') {
    return apiClient.updateInvoiceDraft(mode.draftId, input);
  }

  return apiClient.createInvoiceDraft(input);
}

export function getSaveInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.saveDraftError
      : translatedMessage;
  }

  return uiText.invoicing.saveDraftError;
}

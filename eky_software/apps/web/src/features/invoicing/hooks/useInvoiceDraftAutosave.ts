import { useEffect } from 'react';

import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import {
  prepareInvoiceDraftSaveInput,
  type SaveInvoiceDraftState,
} from './useSaveInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

export const invoiceDraftAutosaveDelayMs = 1800;

export type InvoiceDraftAutosaveStatus =
  | 'disabled'
  | 'error'
  | 'saved'
  | 'saving'
  | 'waitingForValidForm';

export interface InvoiceDraftAutosaveState {
  message: string | null;
  status: InvoiceDraftAutosaveStatus;
}

export interface UseInvoiceDraftAutosaveOptions {
  form: NewInvoiceFormState;
  saveState: SaveInvoiceDraftState;
  reverseChargeCustomerEligible?: boolean;
}

export function useInvoiceDraftAutosave({
  form,
  saveState,
  reverseChargeCustomerEligible,
}: UseInvoiceDraftAutosaveOptions): InvoiceDraftAutosaveState {
  const {
    revision,
    lastAttemptedRevision,
    isCreateOutcomeUnknown,
    isSaved,
    isSaving,
    saveInvoiceDraft,
  } = saveState;

  useEffect(() => {
    const prepared = prepareInvoiceDraftSaveInput(
      form,
      reverseChargeCustomerEligible === undefined
        ? {} : { reverseChargeCustomerEligible },
    );
    if (
      !prepared.isValid || revision === 0 || isCreateOutcomeUnknown ||
      isSaved || isSaving || lastAttemptedRevision === revision
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveInvoiceDraft(prepared.input, revision, 'auto');
    }, invoiceDraftAutosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    form, reverseChargeCustomerEligible, revision, lastAttemptedRevision,
    isCreateOutcomeUnknown, isSaved, isSaving, saveInvoiceDraft,
  ]);

  const prepared = prepareInvoiceDraftSaveInput(
    form,
    reverseChargeCustomerEligible === undefined
      ? {} : { reverseChargeCustomerEligible },
  );
  const status = getInvoiceDraftAutosaveStatus(saveState, prepared.isValid);
  return { status, message: getInvoiceDraftAutosaveMessage(status) };
}

export function getInvoiceDraftAutosaveStatus(
  state: Pick<SaveInvoiceDraftState,
    'isCreateOutcomeUnknown' | 'isSaving' | 'isSaved' | 'errorMessage' | 'revision'>,
  isValid: boolean,
): InvoiceDraftAutosaveStatus {
  if (state.isCreateOutcomeUnknown || state.errorMessage !== null) {
    return 'error';
  }
  if (state.isSaving) {
    return 'saving';
  }
  if (state.isSaved) {
    return 'saved';
  }
  if (state.revision === 0) {
    return 'disabled';
  }
  return isValid ? 'saving' : 'waitingForValidForm';
}

function getInvoiceDraftAutosaveMessage(
  status: InvoiceDraftAutosaveStatus,
): string | null {
  switch (status) {
    case 'saved':
      return uiText.invoicing.autosaveSaved;
    case 'saving':
      return uiText.invoicing.autosaveSaving;
    case 'waitingForValidForm':
      return uiText.invoicing.autosaveWaitingForValidForm;
    // The shared writer presents the single safe error, including an unknown create.
    case 'error':
    case 'disabled':
      return null;
  }
}

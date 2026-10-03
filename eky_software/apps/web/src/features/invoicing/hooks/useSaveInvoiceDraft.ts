import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '@eky/api-client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { toInvoiceDraftInput } from '../form/invoiceDraftFormMapping.js';
import {
  type InvoiceDraftFormErrors,
  type InvoiceDraftFormValidationContext,
  validateInvoiceDraftForm,
} from '../form/invoiceDraftFormValidation.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';
import {
  InvoiceDraftSaveSession,
  type InvoiceDraftSaveMode,
  type InvoiceDraftSaveSnapshot,
  type InvoiceDraftSaveSource,
} from '../state/invoiceDraftSaveSession.js';

export type { InvoiceDraftSaveMode } from '../state/invoiceDraftSaveSession.js';

type InvoiceDraftSaveClient = Pick<
  EkyApiClient,
  'createInvoiceDraft' | 'updateInvoiceDraft'
>;

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

export interface SaveInvoiceDraftState extends InvoiceDraftSaveSnapshot {
  isSaved: boolean;
  isCurrentRevisionSaved(): boolean;
  markEdited(): void;
  clearSaveResult(): void;
  saveInvoiceDraft(
    input: InvoiceDraftInput,
    revision: number,
    source?: InvoiceDraftSaveSource,
  ): Promise<void>;
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
  onSaved: (draft: InvoiceDraft, isCurrentRevision: boolean) => void,
): SaveInvoiceDraftState {
  const [session] = useState(() => new InvoiceDraftSaveSession(mode));
  const [snapshot, setSnapshot] = useState(() => session.getSnapshot());
  const onSavedRef = useRef(onSaved);

  useLayoutEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useLayoutEffect(() => {
    session.setActive(true);
    return () => session.setActive(false);
  }, [session]);

  function clearSaveResult(): void {
    session.clearError();
    setSnapshot(session.getSnapshot());
  }

  function markEdited(): void {
    session.markEdited();
    setSnapshot(session.getSnapshot());
  }

  const saveInvoiceDraft = useCallback(async (
    input: InvoiceDraftInput,
    revision: number,
    source: InvoiceDraftSaveSource = 'manual',
  ): Promise<void> => {
    const request = session.begin(revision, source);
    if (request === null) {
      return;
    }
    setSnapshot(session.getSnapshot());

    let draft: InvoiceDraft;
    try {
      draft = await saveInvoiceDraftInput(input, apiClient, request.mode);
    } catch (error) {
      const isDefiniteRejection = isInvoiceDraftValidationRejection(error);
      const message = request.mode.type === 'create' && !isDefiniteRejection
        ? uiText.invoicing.createDraftOutcomeUnknown
        : getSaveInvoiceDraftErrorMessage(error);
      if (session.fail(request, message, isDefiniteRejection)) {
        setSnapshot(session.getSnapshot());
      }
      return;
    }

    const result = session.succeed(request, draft);
    if (result !== null) {
      setSnapshot(session.getSnapshot());
      onSavedRef.current(draft, result.isCurrentRevision);
    }
  }, [apiClient, session]);

  return {
    ...snapshot,
    clearSaveResult,
    isSaved: !snapshot.isSaving && !snapshot.isCreateOutcomeUnknown &&
      snapshot.revision === snapshot.savedRevision,
    isCurrentRevisionSaved: () => session.isSaved(),
    markEdited,
    saveInvoiceDraft,
  };
}

export function isInvoiceDraftValidationRejection(error: unknown): boolean {
  if (!(error instanceof EkyApiError) || error.status !== 400) {
    return false;
  }
  const body = error.responseBody;
  // This route's structured 400 rejection precedes persistence. A status alone
  // (for example unreadable JSON) does not establish a rejected write.
  return (
    typeof body === 'object' && body !== null && !Array.isArray(body) &&
    'error' in body && typeof body.error === 'string' &&
    body.error.length > 0 && body.error === error.message
  );
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

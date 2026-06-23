import {
  createEkyApiClient,
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '@eky/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { NewInvoiceFormMode } from '../components/NewInvoiceForm.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import {
  prepareInvoiceDraftSaveInput,
  type PreparedInvoiceDraftSave,
} from './useSaveInvoiceDraft.js';
import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

export const invoiceDraftAutosaveDelayMs = 1800;

type InvoiceDraftAutosaveClient = Pick<EkyApiClient, 'updateInvoiceDraft'>;

export type InvoiceDraftAutosaveStatus =
  | 'disabled'
  | 'error'
  | 'idle'
  | 'saved'
  | 'saving'
  | 'waitingForValidForm';

export type PreparedInvoiceDraftAutosave =
  | {
      isEnabled: false;
      reason: 'create-mode';
    }
  | {
      isEnabled: true;
      isValid: false;
      reason: 'invalid-form';
    }
  | {
      draftId: string;
      input: InvoiceDraftInput;
      isEnabled: true;
      isValid: true;
    };

export interface InvoiceDraftAutosaveState {
  errorMessage: string | null;
  message: string | null;
  status: InvoiceDraftAutosaveStatus;
}

export interface UseInvoiceDraftAutosaveOptions {
  form: NewInvoiceFormState;
  formRevision: number;
  manualSavedDraft: InvoiceDraft | null;
  mode: NewInvoiceFormMode;
  onDraftAutosaved(savedDraft: InvoiceDraft): void;
}

export function useInvoiceDraftAutosave({
  form,
  formRevision,
  manualSavedDraft,
  mode,
  onDraftAutosaved,
}: UseInvoiceDraftAutosaveOptions): InvoiceDraftAutosaveState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [status, setStatus] =
    useState<InvoiceDraftAutosaveStatus>('disabled');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const currentDraftIdRef = useRef<string | null>(null);
  const latestRequestIdRef = useRef(0);
  const formRevisionRef = useRef(formRevision);
  const onDraftAutosavedRef = useRef(onDraftAutosaved);

  useEffect(() => {
    formRevisionRef.current = formRevision;
  }, [formRevision]);

  useEffect(() => {
    onDraftAutosavedRef.current = onDraftAutosaved;
  }, [onDraftAutosaved]);

  useEffect(() => {
    if (manualSavedDraft === null) {
      return;
    }

    const plan = prepareInvoiceDraftAutosave(mode, form);

    if (!plan.isEnabled || !plan.isValid) {
      return;
    }

    currentDraftIdRef.current = plan.draftId;
    lastSavedSignatureRef.current = createInvoiceDraftAutosaveSignature(
      plan.input,
    );
    setErrorMessage(null);
    setStatus('saved');
  }, [form, manualSavedDraft, mode]);

  useEffect(() => {
    const plan = prepareInvoiceDraftAutosave(mode, form);

    if (!plan.isEnabled) {
      currentDraftIdRef.current = null;
      lastSavedSignatureRef.current = null;
      setErrorMessage(null);
      setStatus('disabled');
      return;
    }

    if (!plan.isValid) {
      setErrorMessage(null);
      setStatus('waitingForValidForm');
      return;
    }

    const signature = createInvoiceDraftAutosaveSignature(plan.input);

    if (currentDraftIdRef.current !== plan.draftId) {
      currentDraftIdRef.current = plan.draftId;
      lastSavedSignatureRef.current = signature;
      setErrorMessage(null);
      setStatus('saved');
      return;
    }

    if (signature === lastSavedSignatureRef.current) {
      setErrorMessage(null);
      setStatus('saved');
      return;
    }

    setErrorMessage(null);
    setStatus('saving');

    const timeoutId = window.setTimeout(() => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      const startedFormRevision = formRevisionRef.current;

      void autosaveInvoiceDraftInput(
        plan.draftId,
        plan.input,
        apiClient,
      )
        .then((savedDraft) => {
          if (
            !shouldApplyAutosaveResult({
              currentFormRevision: formRevisionRef.current,
              latestRequestId: latestRequestIdRef.current,
              requestId,
              startedFormRevision,
            })
          ) {
            return;
          }

          lastSavedSignatureRef.current = signature;
          setErrorMessage(null);
          setStatus('saved');
          onDraftAutosavedRef.current(savedDraft);
        })
        .catch((error: unknown) => {
          if (
            !shouldApplyAutosaveResult({
              currentFormRevision: formRevisionRef.current,
              latestRequestId: latestRequestIdRef.current,
              requestId,
              startedFormRevision,
            })
          ) {
            return;
          }

          setErrorMessage(getInvoiceDraftAutosaveErrorMessage(error));
          setStatus('error');
        });
    }, invoiceDraftAutosaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [apiClient, form, formRevision, mode]);

  return {
    errorMessage,
    message: getInvoiceDraftAutosaveMessage(status, errorMessage),
    status,
  };
}

export function prepareInvoiceDraftAutosave(
  mode: NewInvoiceFormMode,
  form: NewInvoiceFormState,
): PreparedInvoiceDraftAutosave {
  if (mode.type !== 'edit') {
    return {
      isEnabled: false,
      reason: 'create-mode',
    };
  }

  const preparedInput: PreparedInvoiceDraftSave =
    prepareInvoiceDraftSaveInput(form);

  if (!preparedInput.isValid) {
    return {
      isEnabled: true,
      isValid: false,
      reason: 'invalid-form',
    };
  }

  return {
    draftId: mode.draft.id,
    input: preparedInput.input,
    isEnabled: true,
    isValid: true,
  };
}

export function autosaveInvoiceDraftInput(
  draftId: string,
  input: InvoiceDraftInput,
  apiClient: InvoiceDraftAutosaveClient,
): Promise<InvoiceDraft> {
  return apiClient.updateInvoiceDraft(draftId, input);
}

export function createInvoiceDraftAutosaveSignature(
  input: InvoiceDraftInput,
): string {
  return JSON.stringify(input);
}

export function shouldApplyAutosaveResult({
  currentFormRevision,
  latestRequestId,
  requestId,
  startedFormRevision,
}: {
  currentFormRevision: number;
  latestRequestId: number;
  requestId: number;
  startedFormRevision: number;
}): boolean {
  return requestId === latestRequestId && startedFormRevision === currentFormRevision;
}

export function getInvoiceDraftAutosaveErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.autosaveError
      : translatedMessage;
  }

  return uiText.invoicing.autosaveError;
}

function getInvoiceDraftAutosaveMessage(
  status: InvoiceDraftAutosaveStatus,
  errorMessage: string | null,
): string | null {
  switch (status) {
    case 'error':
      return errorMessage ?? uiText.invoicing.autosaveError;
    case 'saved':
      return uiText.invoicing.autosaveSaved;
    case 'saving':
      return uiText.invoicing.autosaveSaving;
    case 'waitingForValidForm':
      return uiText.invoicing.autosaveWaitingForValidForm;
    case 'disabled':
    case 'idle':
      return null;
  }
}

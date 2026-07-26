import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import type { NewInvoiceFormMode } from '../components/NewInvoiceForm.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import {
  prepareInvoiceDraftSaveInput,
  type PreparedInvoiceDraftSave,
} from './useSaveInvoiceDraft.js';
import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

export const invoiceDraftAutosaveDelayMs = 1800;

type InvoiceDraftAutosaveCreateClient = Pick<
  EkyApiClient,
  'createInvoiceDraft' | 'updateInvoiceDraft'
>;

export type InvoiceDraftAutosaveStatus =
  | 'disabled'
  | 'error'
  | 'idle'
  | 'saved'
  | 'saving'
  | 'waitingForValidForm';

export type PreparedInvoiceDraftAutosave =
  | {
      isEnabled: true;
      isValid: false;
      reason: 'invalid-form';
    }
  | {
      input: InvoiceDraftInput;
      isEnabled: true;
      isValid: true;
      target: InvoiceDraftAutosaveTarget;
    };

export type InvoiceDraftAutosaveTarget =
  | { type: 'create' }
  | { draftId: string; type: 'edit' };

export interface InvoiceDraftAutosaveState {
  errorMessage: string | null;
  message: string | null;
  status: InvoiceDraftAutosaveStatus;
}

export interface UseInvoiceDraftAutosaveOptions {
  apiClient: InvoiceDraftAutosaveCreateClient;
  form: NewInvoiceFormState;
  formRevision: number;
  manualSavedDraft: InvoiceDraft | null;
  mode: NewInvoiceFormMode;
  onDraftAutosaved(savedDraft: InvoiceDraft): void;
  reverseChargeCustomerEligible?: boolean;
}

export function useInvoiceDraftAutosave({
  apiClient,
  form,
  formRevision,
  manualSavedDraft,
  mode,
  onDraftAutosaved,
  reverseChargeCustomerEligible,
}: UseInvoiceDraftAutosaveOptions): InvoiceDraftAutosaveState {
  const [status, setStatus] =
    useState<InvoiceDraftAutosaveStatus>('disabled');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const currentTargetKeyRef = useRef<string | null>(null);
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

    const plan = prepareInvoiceDraftAutosave(
      mode,
      form,
      reverseChargeCustomerEligible,
    );

    if (!plan.isValid) {
      return;
    }

    currentTargetKeyRef.current = createInvoiceDraftAutosaveTargetKey(
      plan.target,
    );
    lastSavedSignatureRef.current = createInvoiceDraftAutosaveSignature(
      plan.input,
    );
    setErrorMessage(null);
    setStatus('saved');
  }, [form, manualSavedDraft, mode, reverseChargeCustomerEligible]);

  useEffect(() => {
    const plan = prepareInvoiceDraftAutosave(
      mode,
      form,
      reverseChargeCustomerEligible,
    );

    if (!plan.isValid) {
      setErrorMessage(null);
      setStatus('waitingForValidForm');
      return;
    }

    const signature = createInvoiceDraftAutosaveSignature(plan.input);
    const targetKey = createInvoiceDraftAutosaveTargetKey(plan.target);

    if (currentTargetKeyRef.current !== targetKey) {
      currentTargetKeyRef.current = targetKey;

      if (plan.target.type === 'edit') {
        lastSavedSignatureRef.current = signature;
        setErrorMessage(null);
        setStatus('saved');
        return;
      }

      lastSavedSignatureRef.current = null;
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
        plan.target,
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
  }, [
    apiClient,
    form,
    formRevision,
    mode,
    reverseChargeCustomerEligible,
  ]);

  return {
    errorMessage,
    message: getInvoiceDraftAutosaveMessage(status, errorMessage),
    status,
  };
}

export function prepareInvoiceDraftAutosave(
  mode: NewInvoiceFormMode,
  form: NewInvoiceFormState,
  reverseChargeCustomerEligible?: boolean,
): PreparedInvoiceDraftAutosave {
  const preparedInput: PreparedInvoiceDraftSave =
    prepareInvoiceDraftSaveInput(
      form,
      reverseChargeCustomerEligible === undefined
        ? {}
        : { reverseChargeCustomerEligible },
    );

  if (!preparedInput.isValid) {
    return {
      isEnabled: true,
      isValid: false,
      reason: 'invalid-form',
    };
  }

  return {
    input: preparedInput.input,
    isEnabled: true,
    isValid: true,
    target:
      mode.type === 'edit'
        ? {
            draftId: mode.draft.id,
            type: 'edit',
          }
        : { type: 'create' },
  };
}

export function autosaveInvoiceDraftInput(
  target: InvoiceDraftAutosaveTarget,
  input: InvoiceDraftInput,
  apiClient: InvoiceDraftAutosaveCreateClient,
): Promise<InvoiceDraft> {
  if (target.type === 'edit') {
    return apiClient.updateInvoiceDraft(target.draftId, input);
  }

  return apiClient.createInvoiceDraft(input);
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

function createInvoiceDraftAutosaveTargetKey(
  target: InvoiceDraftAutosaveTarget,
): string {
  return target.type === 'edit' ? `edit:${target.draftId}` : 'create';
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

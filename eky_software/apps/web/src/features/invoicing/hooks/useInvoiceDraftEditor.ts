import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDraft,
} from '@eky/api-client';
import { useEffect, useReducer, useRef } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';
import {
  initialInvoiceDraftEditorState,
  reduceInvoiceDraftEditor,
  type InvoiceDraftEditorSnapshot,
} from '../state/invoiceDraftEditorState.js';

type InvoiceDraftEditorClient = Pick<EkyApiClient, 'getInvoiceDraft'>;

export interface InvoiceDraftEditorState extends InvoiceDraftEditorSnapshot {
  clearDraft(): void;
  openDraft(id: string): Promise<InvoiceDraft | null>;
  openLoadedDraft(draft: InvoiceDraft): void;
  replaceDraft(draft: InvoiceDraft): void;
}

export function useInvoiceDraftEditor(
  apiClient: InvoiceDraftEditorClient,
): InvoiceDraftEditorState {
  const [state, dispatch] = useReducer(
    reduceInvoiceDraftEditor,
    initialInvoiceDraftEditorState,
  );
  const generation = useRef(0);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      // Effect replay keeps the same request; a real unmount rejects its result.
      isMounted.current = false;
    };
  }, []);

  function clearDraft(): void {
    dispatch({ type: 'clear', sessionRevision: ++generation.current });
  }

  function openLoadedDraft(draft: InvoiceDraft): void {
    dispatch({
      type: 'openLoaded',
      sessionRevision: ++generation.current,
      draft,
    });
  }

  async function openDraft(id: string): Promise<InvoiceDraft | null> {
    const sessionRevision = ++generation.current;
    dispatch({ type: 'open', sessionRevision });

    try {
      const loadedDraft = await loadInvoiceDraft(id, apiClient);

      if (!isMounted.current || sessionRevision !== generation.current) {
        return null;
      }

      dispatch({ type: 'loaded', sessionRevision, draft: loadedDraft });

      return loadedDraft;
    } catch (error) {
      if (isMounted.current && sessionRevision === generation.current) {
        dispatch({
          type: 'failed',
          sessionRevision,
          errorMessage: getOpenInvoiceDraftErrorMessage(error),
        });
      }

      return null;
    }
  }

  return {
    ...state,
    clearDraft,
    openDraft,
    openLoadedDraft,
    replaceDraft: (draft) => dispatch({ type: 'saved', draft }),
  };
}

export function loadInvoiceDraft(
  id: string,
  apiClient: InvoiceDraftEditorClient,
): Promise<InvoiceDraft> {
  return apiClient.getInvoiceDraft(id);
}

export function getOpenInvoiceDraftErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.invoicing.openDraftError
      : translatedMessage;
  }

  return uiText.invoicing.openDraftError;
}

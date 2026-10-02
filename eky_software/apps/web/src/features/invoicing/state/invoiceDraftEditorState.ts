import type { InvoiceDraft } from '@eky/api-client';

export interface InvoiceDraftEditorSnapshot {
  draft: InvoiceDraft | null;
  errorMessage: string | null;
  isLoading: boolean;
  sessionRevision: number;
}

export type InvoiceDraftEditorAction =
  | { type: 'clear'; sessionRevision: number }
  | { type: 'open'; sessionRevision: number }
  | { type: 'openLoaded'; sessionRevision: number; draft: InvoiceDraft }
  | { type: 'loaded'; sessionRevision: number; draft: InvoiceDraft }
  | { type: 'failed'; sessionRevision: number; errorMessage: string }
  | { type: 'saved'; draft: InvoiceDraft };

export const initialInvoiceDraftEditorState: InvoiceDraftEditorSnapshot = {
  draft: null,
  errorMessage: null,
  isLoading: false,
  sessionRevision: 0,
};

export function reduceInvoiceDraftEditor(
  state: InvoiceDraftEditorSnapshot,
  action: InvoiceDraftEditorAction,
): InvoiceDraftEditorSnapshot {
  switch (action.type) {
    case 'clear':
    case 'open':
    case 'openLoaded':
      return {
        draft: action.type === 'openLoaded' ? action.draft : null,
        errorMessage: null,
        isLoading: action.type === 'open',
        sessionRevision: action.sessionRevision,
      };
    case 'loaded':
    case 'failed':
      if (action.sessionRevision !== state.sessionRevision) {
        return state;
      }

      return {
        ...state,
        draft: action.type === 'loaded' ? action.draft : null,
        errorMessage: action.type === 'failed' ? action.errorMessage : null,
        isLoading: false,
      };
    case 'saved':
      // Saving the same editing session must not remount its form.
      return { ...state, draft: action.draft };
  }
}

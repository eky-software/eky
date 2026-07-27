import {
  EkyApiError,
  type DiagnosticEventItem,
  type EkyApiClient,
  type RuntimeDiagnosticSummary,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type DiagnosticsClient = Pick<
  EkyApiClient,
  'getDiagnosticSummary' | 'listDiagnosticEvents'
>;

export interface DiagnosticsState {
  errorMessage: string | null;
  events: DiagnosticEventItem[];
  isLoading: boolean;
  summary: RuntimeDiagnosticSummary | null;
}

export function useDiagnostics(
  apiClient: DiagnosticsClient,
): DiagnosticsState {
  const [state, setState] = useState<DiagnosticsState>({
    errorMessage: null,
    events: [],
    isLoading: true,
    summary: null,
  });

  useEffect(() => {
    let isCurrent = true;
    setState({
      errorMessage: null,
      events: [],
      isLoading: true,
      summary: null,
    });

    void Promise.all([
      apiClient.getDiagnosticSummary(),
      apiClient.listDiagnosticEvents(),
    ])
      .then(([summary, events]) => {
        if (isCurrent) {
          setState({
            errorMessage: null,
            events,
            isLoading: false,
            summary,
          });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setState({
            errorMessage: getDiagnosticsErrorMessage(error),
            events: [],
            isLoading: false,
            summary: null,
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [apiClient]);

  return state;
}

export function getDiagnosticsErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translated = getFinnishApiErrorMessage(error.message);
    return translated === error.message
      ? uiText.diagnostics.loadError
      : translated;
  }
  return uiText.diagnostics.loadError;
}

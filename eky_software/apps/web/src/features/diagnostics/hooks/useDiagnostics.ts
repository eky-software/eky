import {
  EkyApiError,
  type DiagnosticEventItem,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type DiagnosticsClient = Pick<EkyApiClient, 'listDiagnosticEvents'>;

export interface DiagnosticsState {
  errorMessage: string | null;
  events: DiagnosticEventItem[];
  isLoading: boolean;
}

export function useDiagnostics(
  apiClient: DiagnosticsClient,
): DiagnosticsState {
  const [state, setState] = useState<DiagnosticsState>({
    errorMessage: null,
    events: [],
    isLoading: true,
  });

  useEffect(() => {
    let isCurrent = true;
    setState({ errorMessage: null, events: [], isLoading: true });

    void apiClient
      .listDiagnosticEvents()
      .then((events) => {
        if (isCurrent) {
          setState({ errorMessage: null, events, isLoading: false });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setState({
            errorMessage: getDiagnosticsErrorMessage(error),
            events: [],
            isLoading: false,
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


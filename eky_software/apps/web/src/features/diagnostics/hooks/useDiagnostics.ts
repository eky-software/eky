import {
  EkyApiError,
  type DiagnosticEventItem,
  type DiagnosticReadState,
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
  isSummaryLoading: boolean;
  readState: DiagnosticReadState | null;
  summary: RuntimeDiagnosticSummary | null;
  summaryErrorMessage: string | null;
}

export function useDiagnostics(
  apiClient: DiagnosticsClient,
): DiagnosticsState {
  const [state, setState] = useState<DiagnosticsState>({
    errorMessage: null,
    events: [],
    isLoading: true,
    isSummaryLoading: true,
    readState: null,
    summary: null,
    summaryErrorMessage: null,
  });

  useEffect(() => {
    let isCurrent = true;
    setState({
      errorMessage: null,
      events: [],
      isLoading: true,
      isSummaryLoading: true,
      readState: null,
      summary: null,
      summaryErrorMessage: null,
    });

    void readSummary();
    void readEvents();

    async function readSummary() {
      try {
        const summary = await apiClient.getDiagnosticSummary();
        if (isCurrent) setState(current => ({ ...current, summary, isSummaryLoading: false }));
      } catch (error) {
        if (isCurrent) setState(current => ({ ...current, isSummaryLoading: false,
          summaryErrorMessage: getDiagnosticsErrorMessage(error) }));
      }
    }

    async function readEvents() {
      try {
        const result = await apiClient.listDiagnosticEvents();
        if (isCurrent) setState(current => ({ ...current, events: result.diagnosticEvents,
          readState: result.readState, isLoading: false }));
      } catch (error) {
        if (isCurrent) setState(current => ({ ...current, isLoading: false,
          errorMessage: getDiagnosticsErrorMessage(error) }));
      }
    }

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

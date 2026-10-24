import {
  EkyApiError,
  type DiagnosticEventItem,
  type DiagnosticReadState,
  type DiagnosticEventListQuery,
  type DiagnosticEventReadResult,
  type EkyApiClient,
  type RuntimeDiagnosticSummary,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type DiagnosticsClient = Pick<
  EkyApiClient,
  'getDiagnosticSummary' | 'listDiagnosticEvents'
>;
const maximumContinuationRequests = 4096;

export interface DiagnosticsState {
  errorMessage: string | null;
  events: DiagnosticEventItem[];
  isLoading: boolean;
  isSummaryLoading: boolean;
  readState: DiagnosticReadState | null;
  summary: RuntimeDiagnosticSummary | null;
  summaryErrorMessage: string | null;
  page: Extract<DiagnosticEventReadResult, { state: 'ready' }> | null;
  isStale: boolean;
  canRetry: boolean;
  loadOlder(): void;
  loadNewer(): void;
  loadNewest(): void;
  retry(): void;
}

export function useDiagnostics(
  apiClient: DiagnosticsClient,
): DiagnosticsState {
  const [state, setState] = useState<Omit<DiagnosticsState, 'loadOlder' | 'loadNewer' | 'loadNewest' | 'retry'>>({
    errorMessage: null,
    events: [],
    isLoading: true,
    isSummaryLoading: true,
    readState: null,
    summary: null,
    summaryErrorMessage: null,
    page: null,
    isStale: false,
    canRetry: false,
  });
  const load = useRef<((query: DiagnosticEventListQuery) => void) | null>(null);
  const lastQuery = useRef<DiagnosticEventListQuery>({});

  useEffect(() => {
    let isCurrent = true;
    let active: AbortController | null = null;
    setState({
      errorMessage: null,
      events: [],
      isLoading: true,
      isSummaryLoading: true,
      readState: null,
      summary: null,
      summaryErrorMessage: null,
      page: null,
      isStale: false,
      canRetry: false,
    });

    load.current = query => { if (active === null && isCurrent) void readEvents(query); };
    // StrictMode cancels its first setup before this microtask can start I/O.
    queueMicrotask(() => {
      if (!isCurrent) return;
      void readSummary();
      void readEvents({});
    });

    async function readSummary() {
      try {
        const summary = await apiClient.getDiagnosticSummary();
        if (isCurrent) setState(current => ({ ...current, summary, isSummaryLoading: false }));
      } catch (error) {
        if (isCurrent) setState(current => ({ ...current, isSummaryLoading: false,
          summaryErrorMessage: getDiagnosticsErrorMessage(error) }));
      }
    }

    async function readEvents(query: DiagnosticEventListQuery) {
      const controller = new AbortController();
      active = controller;
      lastQuery.current = query;
      setState(current => ({ ...current, isLoading: true, errorMessage: null, canRetry: false }));
      try {
        let result = await apiClient.listDiagnosticEvents(query, controller.signal);
        for (let step = 0; result.state === 'scanning'; step++) {
          if (!isCurrent || controller.signal.aborted) return;
          if (step >= maximumContinuationRequests) throw new Error('Diagnostic continuation limit reached.');
          result = await apiClient.listDiagnosticEvents({ cursor: result.cursor }, controller.signal);
        }
        if (!isCurrent || controller.signal.aborted) return;
        if (result.state === 'ready') {
          setState(current => ({ ...current, events: result.diagnosticEvents, page: result,
            readState: result.readState, isLoading: false, isStale: false }));
        } else {
          setState(current => ({ ...current, isLoading: false, canRetry: true,
            readState: current.page === null ? result.readState : current.readState,
            errorMessage: result.state === 'limited' ? uiText.diagnostics.browseLimited : uiText.diagnostics.loadError }));
        }
      } catch (error) {
        if (isCurrent && !controller.signal.aborted) {
          const stale = error instanceof EkyApiError && error.status === 409;
          setState(current => ({ ...current, isLoading: false, isStale: current.isStale || stale,
            canRetry: !stale, errorMessage: stale ? uiText.diagnostics.browseStale : getDiagnosticsErrorMessage(error) }));
        }
      } finally {
        if (active === controller) active = null;
      }
    }

    return () => {
      isCurrent = false;
      active?.abort();
      load.current = null;
    };
  }, [apiClient]);

  const navigate = (direction: 'older' | 'newer') => {
    const target = state.page?.[direction];
    if (!state.isStale && target?.state === 'available') load.current?.({ cursor: target.cursor });
  };
  return { ...state, loadOlder: () => navigate('older'), loadNewer: () => navigate('newer'),
    loadNewest: () => load.current?.({}), retry: () => { if (state.canRetry) load.current?.(lastQuery.current); } };
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

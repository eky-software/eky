import type { EkyApiClient, InvoiceDraftDeliveryHistory } from '@eky/api-client';
import { useEffect, useState } from 'react';
import { uiText } from '../../../i18n/fi.js';

export type InvoiceDraftDeliveryHistoryClient = Pick<EkyApiClient, 'getInvoiceDraftDeliveryHistory'>;

interface HistoryState {
  draftId: string;
  history: InvoiceDraftDeliveryHistory | null;
  errorMessage: string | null;
  isLoading: boolean;
}

export function useInvoiceDraftDeliveryHistory(
  apiClient: InvoiceDraftDeliveryHistoryClient,
  draftId: string,
): HistoryState {
  const [state, setState] = useState<HistoryState>(() => loading(draftId));
  useEffect(() => {
    let current = true;
    setState(loading(draftId));
    async function load(): Promise<void> {
      try {
        const history = await apiClient.getInvoiceDraftDeliveryHistory(draftId);
        if (current) setState({ draftId, history, errorMessage: null, isLoading: false });
      } catch {
        if (current) setState({
          draftId, history: null, isLoading: false,
          errorMessage: uiText.invoicing.invoiceDeliveryHistoryError,
        });
      }
    }
    void load();
    return () => { current = false; };
  }, [apiClient, draftId]);

  return state.draftId === draftId ? state : loading(draftId);
}

function loading(draftId: string): HistoryState {
  return { draftId, history: null, errorMessage: null, isLoading: true };
}

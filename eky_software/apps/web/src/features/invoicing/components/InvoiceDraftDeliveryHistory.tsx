import {
  useInvoiceDraftDeliveryHistory,
  type InvoiceDraftDeliveryHistoryClient,
} from '../hooks/useInvoiceDraftDeliveryHistory.js';
import type { OpenInvoiceDeliveryEventPdf } from '../approved/openInvoiceDeliveryEventPdf.js';
import { InvoiceDeliveryHistory } from './InvoiceDeliveryHistory.js';

interface InvoiceDraftDeliveryHistoryProps {
  apiClient: InvoiceDraftDeliveryHistoryClient;
  draftId: string;
  onOpenPdf: OpenInvoiceDeliveryEventPdf;
}

export function InvoiceDraftDeliveryHistory({
  apiClient, draftId, onOpenPdf,
}: InvoiceDraftDeliveryHistoryProps): React.JSX.Element | null {
  const state = useInvoiceDraftDeliveryHistory(apiClient, draftId);
  if (state.history !== null && state.history.invoiceId === null) return null;
  return <InvoiceDeliveryHistory
    invoiceId={state.history?.invoiceId ?? null}
    events={state.history?.events ?? []}
    errorMessage={state.errorMessage}
    isLoading={state.isLoading}
    onOpenPdf={onOpenPdf}
  />;
}

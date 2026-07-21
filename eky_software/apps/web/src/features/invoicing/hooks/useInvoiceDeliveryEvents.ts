import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDeliveryEventSummary,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type InvoiceDeliveryEventsClient = Pick<
  EkyApiClient,
  'listInvoiceDeliveryEvents'
>;

export interface InvoiceDeliveryEventListState {
  errorMessage: string | null;
  events: InvoiceDeliveryEventSummary[];
  isLoading: boolean;
  clearEvents(): void;
  loadEvents(invoiceId: string): Promise<void>;
}

export function useInvoiceDeliveryEvents(
  apiClient: InvoiceDeliveryEventsClient,
): InvoiceDeliveryEventListState {
  const [events, setEvents] = useState<InvoiceDeliveryEventSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function clearEvents(): void {
    setEvents([]);
    setErrorMessage(null);
    setIsLoading(false);
  }

  async function loadEvents(invoiceId: string): Promise<void> {
    setErrorMessage(null);
    setIsLoading(true);

    try {
      setEvents(await listInvoiceDeliveryEventsWithClient(apiClient, invoiceId));
    } catch (error) {
      setEvents([]);
      setErrorMessage(getInvoiceDeliveryEventsErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return { clearEvents, errorMessage, events, isLoading, loadEvents };
}

export function listInvoiceDeliveryEventsWithClient(
  client: InvoiceDeliveryEventsClient,
  invoiceId: string,
): Promise<InvoiceDeliveryEventSummary[]> {
  return client.listInvoiceDeliveryEvents(invoiceId);
}

export function getInvoiceDeliveryEventsErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  return uiText.invoicing.invoiceDeliveryHistoryError;
}

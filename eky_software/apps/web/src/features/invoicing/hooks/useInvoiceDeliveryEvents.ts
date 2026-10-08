import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceDeliveryEventSummary,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type InvoiceDeliveryEventsClient = Pick<
  EkyApiClient,
  'listInvoiceDeliveryEvents'
>;

export interface InvoiceDeliveryEventListState {
  invoiceId: string | null;
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
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++generation.current; };
  }, []);

  function clearEvents(): void {
    ++generation.current;
    setInvoiceId(null);
    setEvents([]);
    setErrorMessage(null);
    setIsLoading(false);
  }

  async function loadEvents(invoiceId: string): Promise<void> {
    if (!mounted.current) return;
    const requestGeneration = ++generation.current;
    const isCurrent = (): boolean =>
      mounted.current && requestGeneration === generation.current;
    setInvoiceId(invoiceId);
    setEvents([]);
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const result = await listInvoiceDeliveryEventsWithClient(apiClient, invoiceId);
      if (isCurrent()) setEvents(result);
    } catch (error) {
      if (isCurrent()) {
        setEvents([]);
        setErrorMessage(getInvoiceDeliveryEventsErrorMessage(error));
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }

  return { clearEvents, errorMessage, events, invoiceId, isLoading, loadEvents };
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

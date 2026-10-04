import {
  EkyApiError,
  type EkyApiClient,
  type InvoiceIssuanceReadiness,
} from '@eky/api-client';
import { useLayoutEffect, useState } from 'react';

import {
  InvoiceReadinessSession,
  type InvoiceReadinessContext,
} from '../state/invoiceReadinessSession.js';

import { uiText } from '../../../i18n/fi.js';

type InvoiceIssuanceReadinessClient = Pick<
  EkyApiClient,
  'getInvoiceIssuanceReadiness'
>;

export function useInvoiceIssuanceReadiness(
  apiClient: InvoiceIssuanceReadinessClient,
  context: InvoiceReadinessContext,
) {
  const [session] = useState(() => new InvoiceReadinessSession(context));
  const [snapshot, setSnapshot] = useState(() => session.getSnapshot());
  const { draftId, formRevision, isSaved } = context;

  useLayoutEffect(() => {
    session.updateContext({ draftId, formRevision, isSaved });
    session.setActive(true);
    setSnapshot(session.getSnapshot());
    return () => session.setActive(false);
  }, [apiClient, draftId, formRevision, isSaved, session]);

  function clearReadiness(): void {
    session.clear();
    setSnapshot(session.getSnapshot());
  }

  async function checkReadiness(): Promise<void> {
    const request = session.begin();
    if (request === null) {
      return;
    }
    setSnapshot(session.getSnapshot());

    try {
      const result = await getInvoiceIssuanceReadinessWithClient(
        apiClient,
        request.draftId,
      );
      if (session.succeed(request, result)) {
        setSnapshot(session.getSnapshot());
      }
    } catch (error) {
      const message =
        error instanceof EkyApiError && error.status === 404
          ? uiText.invoicing.approveDraftNotFound
          : uiText.invoicing.invoiceIssuanceReadinessError;
      if (session.fail(request, message)) {
        setSnapshot(session.getSnapshot());
      }
    }
  }

  return {
    ...snapshot,
    canConfirmApproval: () => session.canConfirm(),
    checkReadiness,
    clearReadiness,
  };
}

export function getInvoiceIssuanceReadinessWithClient(
  apiClient: InvoiceIssuanceReadinessClient,
  invoiceDraftId: string,
): Promise<InvoiceIssuanceReadiness> {
  return apiClient.getInvoiceIssuanceReadiness(invoiceDraftId);
}

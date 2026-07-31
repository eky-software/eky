import {
  EkyApiError,
  type EkyApiClient,
  type InvoicePaymentSummary,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type InvoicePaymentClient = Pick<
  EkyApiClient,
  'markInvoicePaid' | 'revertInvoicePaidMark'
>;

export function markInvoicePaidWithClient(
  apiClient: InvoicePaymentClient,
  invoiceId: string,
  paidOn: string,
): Promise<InvoicePaymentSummary> {
  return apiClient.markInvoicePaid(invoiceId, { paidOn });
}

export function revertInvoicePaidMarkWithClient(
  apiClient: InvoicePaymentClient,
  invoiceId: string,
): Promise<InvoicePaymentSummary> {
  return apiClient.revertInvoicePaidMark(invoiceId);
}

export interface InvoicePaymentMutationState {
  errorMessage: string | null;
  isUpdating: boolean;
  successMessage: string | null;
  clearStatus(): void;
  markPaid(
    invoiceId: string,
    paidOn: string,
  ): Promise<InvoicePaymentSummary | null>;
  revertPaidMark(invoiceId: string): Promise<InvoicePaymentSummary | null>;
}

export function useInvoicePayment(
  apiClient: InvoicePaymentClient,
): InvoicePaymentMutationState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function clearStatus(): void {
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function run(
    operation: () => Promise<InvoicePaymentSummary>,
    success: string,
  ): Promise<InvoicePaymentSummary | null> {
    setIsUpdating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payment = await operation();
      setSuccessMessage(success);
      return payment;
    } catch (error) {
      setErrorMessage(getInvoicePaymentErrorMessage(error));
      return null;
    } finally {
      setIsUpdating(false);
    }
  }

  return {
    clearStatus,
    errorMessage,
    isUpdating,
    markPaid(invoiceId, paidOn) {
      return run(
        () => markInvoicePaidWithClient(apiClient, invoiceId, paidOn),
        uiText.invoicing.invoicePaymentMarkedSuccess,
      );
    },
    revertPaidMark(invoiceId) {
      return run(
        () => revertInvoicePaidMarkWithClient(apiClient, invoiceId),
        uiText.invoicing.invoicePaymentRevertedSuccess,
      );
    },
    successMessage,
  };
}

export function getInvoicePaymentErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    if (error.status === 400) {
      return uiText.invoicing.invoicePaymentDateError;
    }
    if (error.status === 403) {
      return uiText.invoicing.invoicePaymentPermissionError;
    }
    if (error.status === 404) {
      return uiText.invoicing.approvedInvoiceNotFound;
    }
    if (error.status === 409) {
      return uiText.invoicing.invoicePaymentConflictError;
    }
  }

  return uiText.invoicing.invoicePaymentUpdateError;
}

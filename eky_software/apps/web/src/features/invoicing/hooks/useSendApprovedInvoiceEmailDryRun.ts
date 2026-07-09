import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceEmailDryRunSendInput,
  type ApprovedInvoiceEmailDryRunSendResult,
  type EkyApiClient,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type SendApprovedInvoiceEmailDryRunClient = Pick<
  EkyApiClient,
  'sendApprovedInvoiceEmailDryRun'
>;

export interface SendApprovedInvoiceEmailDryRunState {
  errorMessage: string | null;
  isSending: boolean;
  successMessage: string | null;
  clearStatus(): void;
  sendEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): Promise<ApprovedInvoiceEmailDryRunSendResult | null>;
}

export function useSendApprovedInvoiceEmailDryRun(): SendApprovedInvoiceEmailDryRunState {
  const apiClient = useMemo(
    () => createEkyApiClient({ baseUrl: apiBaseUrl }),
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  function clearStatus(): void {
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function sendEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): Promise<ApprovedInvoiceEmailDryRunSendResult | null> {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSending(true);

    try {
      const result = await sendApprovedInvoiceEmailDryRunWithClient(
        apiClient,
        id,
        input,
      );
      setSuccessMessage(uiText.invoicing.invoiceEmailDryRunSendSuccess);

      return result;
    } catch (error) {
      setErrorMessage(getSendApprovedInvoiceEmailDryRunErrorMessage(error));

      return null;
    } finally {
      setIsSending(false);
    }
  }

  return {
    clearStatus,
    errorMessage,
    isSending,
    sendEmailDryRun,
    successMessage,
  };
}

export function sendApprovedInvoiceEmailDryRunWithClient(
  client: SendApprovedInvoiceEmailDryRunClient,
  id: string,
  input: ApprovedInvoiceEmailDryRunSendInput,
): Promise<ApprovedInvoiceEmailDryRunSendResult> {
  return client.sendApprovedInvoiceEmailDryRun(id, input);
}

export function getSendApprovedInvoiceEmailDryRunErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  if (error instanceof EkyApiError && error.status === 400) {
    return uiText.invoicing.invoiceEmailDryRunValidationError;
  }

  return uiText.invoicing.invoiceEmailDryRunSendError;
}

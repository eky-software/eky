import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceEmailSmtpTestSendInput,
  type ApprovedInvoiceEmailSmtpTestSendResult,
  type EkyApiClient,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type SendApprovedInvoiceEmailSmtpTestClient = Pick<
  EkyApiClient,
  'sendApprovedInvoiceEmailSmtpTest'
>;

export interface SendApprovedInvoiceEmailSmtpTestState {
  errorMessage: string | null;
  isSending: boolean;
  successMessage: string | null;
  clearStatus(): void;
  sendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestSendInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestSendResult | null>;
}

export function useSendApprovedInvoiceEmailSmtpTest(): SendApprovedInvoiceEmailSmtpTestState {
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

  async function sendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestSendInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestSendResult | null> {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSending(true);

    try {
      const result = await sendApprovedInvoiceEmailSmtpTestWithClient(
        apiClient,
        id,
        input,
      );
      setSuccessMessage(
        `${uiText.invoicing.invoiceEmailSmtpTestSuccess} ${result.deliveredTo}`,
      );

      return result;
    } catch (error) {
      setErrorMessage(getSendApprovedInvoiceEmailSmtpTestErrorMessage(error));

      return null;
    } finally {
      setIsSending(false);
    }
  }

  return {
    clearStatus,
    errorMessage,
    isSending,
    sendEmailSmtpTest,
    successMessage,
  };
}

export function sendApprovedInvoiceEmailSmtpTestWithClient(
  client: SendApprovedInvoiceEmailSmtpTestClient,
  id: string,
  input: ApprovedInvoiceEmailSmtpTestSendInput,
): Promise<ApprovedInvoiceEmailSmtpTestSendResult> {
  return client.sendApprovedInvoiceEmailSmtpTest(id, input);
}

export function getSendApprovedInvoiceEmailSmtpTestErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  if (error instanceof EkyApiError && error.status === 400) {
    return uiText.invoicing.invoiceEmailDryRunValidationError;
  }

  if (
    error instanceof EkyApiError &&
    error.message === 'Invoice email delivery outcome is unknown.'
  ) {
    return uiText.invoicing.invoiceEmailSmtpTestOutcomeUnknown;
  }

  return uiText.invoicing.invoiceEmailSmtpTestError;
}

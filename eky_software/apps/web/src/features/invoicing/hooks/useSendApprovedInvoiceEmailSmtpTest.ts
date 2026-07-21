import {
  EkyApiError,
  type ApprovedInvoiceEmailSmtpTestPrepareInput,
  type ApprovedInvoiceEmailSmtpTestSendResult,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type SendApprovedInvoiceEmailSmtpTestClient = Pick<
  EkyApiClient,
  | 'prepareApprovedInvoiceEmailSmtpTest'
  | 'sendApprovedInvoiceEmailSmtpTest'
>;

export interface SendApprovedInvoiceEmailSmtpTestState {
  errorMessage: string | null;
  isSending: boolean;
  successMessage: string | null;
  clearStatus(): void;
  sendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): Promise<ApprovedInvoiceEmailSmtpTestSendResult | null>;
}

export function useSendApprovedInvoiceEmailSmtpTest(
  apiClient: SendApprovedInvoiceEmailSmtpTestClient,
): SendApprovedInvoiceEmailSmtpTestState {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  function clearStatus(): void {
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function sendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
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
  input: ApprovedInvoiceEmailSmtpTestPrepareInput,
): Promise<ApprovedInvoiceEmailSmtpTestSendResult> {
  return client.prepareApprovedInvoiceEmailSmtpTest(id, input).then(
    (preparation) =>
      client.sendApprovedInvoiceEmailSmtpTest(id, {
        ...input,
        attemptId: preparation.attemptId,
        authorizationToken: preparation.authorizationToken,
      }),
  );
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

  if (error instanceof EkyApiError && [409, 429].includes(error.status ?? 0)) {
    return uiText.invoicing.invoiceEmailSmtpTestConflict;
  }

  if (
    error instanceof EkyApiError &&
    error.message === 'Invoice email delivery outcome is unknown.'
  ) {
    return uiText.invoicing.invoiceEmailSmtpTestOutcomeUnknown;
  }

  return uiText.invoicing.invoiceEmailSmtpTestError;
}

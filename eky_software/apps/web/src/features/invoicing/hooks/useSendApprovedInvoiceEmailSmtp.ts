import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceEmailSmtpPrepareInput,
  type ApprovedInvoiceEmailSmtpSendResult,
  type EkyApiClient,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

type SendApprovedInvoiceEmailSmtpClient = Pick<
  EkyApiClient,
  'prepareApprovedInvoiceEmailSmtp' | 'sendApprovedInvoiceEmailSmtp'
>;

export interface SendApprovedInvoiceEmailSmtpState {
  errorMessage: string | null;
  isSending: boolean;
  successMessage: string | null;
  clearStatus(): void;
  sendEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): Promise<ApprovedInvoiceEmailSmtpSendResult | null>;
}

export function useSendApprovedInvoiceEmailSmtp(): SendApprovedInvoiceEmailSmtpState {
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

  async function sendEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): Promise<ApprovedInvoiceEmailSmtpSendResult | null> {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSending(true);

    try {
      const result = await sendApprovedInvoiceEmailSmtpWithClient(
        apiClient,
        id,
        input,
      );
      setSuccessMessage(
        result.resend
          ? uiText.invoicing.invoiceEmailSmtpResendSuccess
          : uiText.invoicing.invoiceEmailSmtpSendSuccess,
      );

      return result;
    } catch (error) {
      setErrorMessage(getSendApprovedInvoiceEmailSmtpErrorMessage(error));

      return null;
    } finally {
      setIsSending(false);
    }
  }

  return {
    clearStatus,
    errorMessage,
    isSending,
    sendEmailSmtp,
    successMessage,
  };
}

export function sendApprovedInvoiceEmailSmtpWithClient(
  client: SendApprovedInvoiceEmailSmtpClient,
  id: string,
  input: ApprovedInvoiceEmailSmtpPrepareInput,
): Promise<ApprovedInvoiceEmailSmtpSendResult> {
  return client.prepareApprovedInvoiceEmailSmtp(id, input).then(
    (preparation) =>
      client.sendApprovedInvoiceEmailSmtp(id, {
        ...input,
        attemptId: preparation.attemptId,
        authorizationToken: preparation.authorizationToken,
      }),
  );
}

export function getSendApprovedInvoiceEmailSmtpErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof EkyApiError &&
    error.status === 409 &&
    error.message === 'Sähköpostilähetys peruutettiin.'
  ) {
    return uiText.invoicing.invoiceEmailSmtpCancelled;
  }

  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  if (error instanceof EkyApiError && error.status === 400) {
    return uiText.invoicing.invoiceEmailDryRunValidationError;
  }

  if (
    error instanceof EkyApiError &&
    error.status === 409 &&
    error.message === 'Invoice has an unresolved delivery attempt.'
  ) {
    return uiText.invoicing.invoiceEmailSmtpPersistentConflict;
  }

  if (error instanceof EkyApiError && [409, 429].includes(error.status ?? 0)) {
    return uiText.invoicing.invoiceEmailSmtpConflict;
  }

  if (
    error instanceof EkyApiError &&
    error.message === 'Invoice email delivery outcome is unknown.'
  ) {
    return uiText.invoicing.invoiceEmailSmtpOutcomeUnknown;
  }

  return uiText.invoicing.invoiceEmailSmtpError;
}

import {
  EkyApiError,
  type ApprovedInvoiceEmailPreview,
  type EkyApiClient,
} from '@eky/api-client';
import { useState } from 'react';

import { uiText } from '../../../i18n/fi.js';

type ApprovedInvoiceEmailDryRunClient = Pick<
  EkyApiClient,
  'prepareApprovedInvoiceEmailDryRun'
>;

export interface ApprovedInvoiceEmailDryRunState {
  email: ApprovedInvoiceEmailPreview | null;
  errorMessage: string | null;
  isPreparing: boolean;
  clearEmail(): void;
  clearError(): void;
  prepareEmail(id: string): Promise<ApprovedInvoiceEmailPreview | null>;
}

export function useApprovedInvoiceEmailDryRun(
  apiClient: ApprovedInvoiceEmailDryRunClient,
): ApprovedInvoiceEmailDryRunState {
  const [email, setEmail] = useState<ApprovedInvoiceEmailPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  function clearEmail(): void {
    setEmail(null);
    setErrorMessage(null);
  }

  function clearError(): void {
    setErrorMessage(null);
  }

  async function prepareEmail(
    id: string,
  ): Promise<ApprovedInvoiceEmailPreview | null> {
    setIsPreparing(true);
    setErrorMessage(null);

    try {
      const preparedEmail = await prepareApprovedInvoiceEmailDryRunWithClient(
        apiClient,
        id,
      );
      setEmail(preparedEmail);

      return preparedEmail;
    } catch (error) {
      setErrorMessage(getApprovedInvoiceEmailDryRunErrorMessage(error));

      return null;
    } finally {
      setIsPreparing(false);
    }
  }

  return {
    clearEmail,
    clearError,
    email,
    errorMessage,
    isPreparing,
    prepareEmail,
  };
}

export function prepareApprovedInvoiceEmailDryRunWithClient(
  client: ApprovedInvoiceEmailDryRunClient,
  id: string,
): Promise<ApprovedInvoiceEmailPreview> {
  return client.prepareApprovedInvoiceEmailDryRun(id);
}

export function getApprovedInvoiceEmailDryRunErrorMessage(
  error: unknown,
): string {
  if (error instanceof EkyApiError && error.status === 404) {
    return uiText.invoicing.approvedInvoiceNotFound;
  }

  return uiText.invoicing.invoiceEmailPrepareError;
}

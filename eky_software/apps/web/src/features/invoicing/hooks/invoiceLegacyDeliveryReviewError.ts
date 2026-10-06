import { EkyApiError } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';

const legacyDeliveryReviewRequiredCode =
  'INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED';

export function getInvoiceLegacyDeliveryReviewErrorMessage(
  error: unknown,
): string | null {
  if (!(error instanceof EkyApiError) || error.status !== 409) {
    return null;
  }

  const body = error.responseBody;

  if (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    'code' in body &&
    body.code === legacyDeliveryReviewRequiredCode
  ) {
    return uiText.invoicing.invoiceLegacyDeliveryReviewRequired;
  }

  return null;
}

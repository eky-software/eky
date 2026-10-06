import { EkyApiError } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { getInvoiceLegacyDeliveryReviewErrorMessage } from './invoiceLegacyDeliveryReviewError.js';
import { getApprovedInvoiceEmailDryRunErrorMessage } from './useApprovedInvoiceEmailDryRun.js';
import { getMarkApprovedInvoiceSentErrorMessage } from './useMarkApprovedInvoiceSent.js';
import { getReopenApprovedInvoiceErrorMessage } from './useReopenApprovedInvoiceForEditing.js';
import { getSendApprovedInvoiceEmailDryRunErrorMessage } from './useSendApprovedInvoiceEmailDryRun.js';
import { getSendApprovedInvoiceEmailSmtpErrorMessage } from './useSendApprovedInvoiceEmailSmtp.js';
import { getSendApprovedInvoiceEmailSmtpTestErrorMessage } from './useSendApprovedInvoiceEmailSmtpTest.js';
import { uiText } from '../../../i18n/fi.js';

const reviewCode = 'INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED';
const backendMessage =
  'Legacy invoice delivery history requires review before editing or sending.';

describe('getInvoiceLegacyDeliveryReviewErrorMessage', () => {
  it('recognizes the exact status and code without depending on error text', () => {
    const error = new EkyApiError('Changed backend text', {
      responseBody: { code: reviewCode },
      status: 409,
    });

    expect(getInvoiceLegacyDeliveryReviewErrorMessage(error)).toBe(
      uiText.invoicing.invoiceLegacyDeliveryReviewRequired,
    );
  });

  it('does not infer a review requirement from the English message', () => {
    const error = new EkyApiError(backendMessage, {
      responseBody: { error: backendMessage },
      status: 409,
    });

    expect(getInvoiceLegacyDeliveryReviewErrorMessage(error)).toBeNull();
  });

  it('requires an HTTP status even when the code matches', () => {
    const error = new EkyApiError(backendMessage, {
      responseBody: { code: reviewCode },
    });

    expect(getInvoiceLegacyDeliveryReviewErrorMessage(error)).toBeNull();
  });
});

describe.each([
  {
    operation: 'reopen edit',
    getMessage: getReopenApprovedInvoiceErrorMessage,
    genericMessage: uiText.invoicing.reopenApprovedInvoiceError,
    conflictMessage: uiText.invoicing.reopenApprovedInvoiceError,
    validationMessage: uiText.invoicing.reopenApprovedInvoiceError,
  },
  {
    operation: 'SMTP customer prepare/send',
    getMessage: getSendApprovedInvoiceEmailSmtpErrorMessage,
    genericMessage: uiText.invoicing.invoiceEmailSmtpError,
    conflictMessage: uiText.invoicing.invoiceEmailSmtpConflict,
    validationMessage: uiText.invoicing.invoiceEmailDryRunValidationError,
  },
  {
    operation: 'SMTP test prepare/send',
    getMessage: getSendApprovedInvoiceEmailSmtpTestErrorMessage,
    genericMessage: uiText.invoicing.invoiceEmailSmtpTestError,
    conflictMessage: uiText.invoicing.invoiceEmailSmtpTestConflict,
    validationMessage: uiText.invoicing.invoiceEmailDryRunValidationError,
  },
  {
    operation: 'dry-run prepare',
    getMessage: getApprovedInvoiceEmailDryRunErrorMessage,
    genericMessage: uiText.invoicing.invoiceEmailPrepareError,
    conflictMessage: uiText.invoicing.invoiceEmailPrepareError,
    validationMessage: uiText.invoicing.invoiceEmailPrepareError,
  },
  {
    operation: 'dry-run send',
    getMessage: getSendApprovedInvoiceEmailDryRunErrorMessage,
    genericMessage: uiText.invoicing.invoiceEmailDryRunSendError,
    conflictMessage: uiText.invoicing.invoiceEmailDryRunSendError,
    validationMessage: uiText.invoicing.invoiceEmailDryRunValidationError,
  },
  {
    operation: 'manual mark sent',
    getMessage: getMarkApprovedInvoiceSentErrorMessage,
    genericMessage: uiText.invoicing.markApprovedInvoiceSentError,
    conflictMessage: uiText.invoicing.markApprovedInvoiceSentError,
    validationMessage: uiText.invoicing.markApprovedInvoiceSentError,
  },
])('$operation legacy review feedback', ({
  getMessage,
  genericMessage,
  conflictMessage,
  validationMessage,
}) => {
  it('maps the backend contract to the shared Finnish review instruction', () => {
    const error = new EkyApiError(backendMessage, {
      responseBody: { code: reviewCode, error: backendMessage },
      status: 409,
    });

    expect(getMessage(error)).toBe(
      uiText.invoicing.invoiceLegacyDeliveryReviewRequired,
    );
  });

  it('never renders raw backend text or extra response fields', () => {
    const error = new EkyApiError('raw-provider-details', {
      responseBody: {
        code: reviewCode,
        error: '<script>raw-response-error</script>',
        stack: 'raw-stack-trace',
        password: 'secret-must-not-leak',
      },
      status: 409,
    });

    expect(getMessage(error)).toBe(
      uiText.invoicing.invoiceLegacyDeliveryReviewRequired,
    );
  });

  it.each([
    { name: 'missing body', body: undefined },
    { name: 'null body', body: null },
    { name: 'boolean body', body: false },
    { name: 'numeric body', body: 409 },
    { name: 'JSON string', body: JSON.stringify({ code: reviewCode }) },
    { name: 'array body', body: [{ code: reviewCode }] },
    { name: 'array with a code property', body: Object.assign([], { code: reviewCode }) },
    { name: 'missing code', body: { error: backendMessage } },
    { name: 'null code', body: { code: null } },
    { name: 'numeric code', body: { code: 409 } },
    { name: 'array code', body: { code: [reviewCode] } },
    { name: 'nested code', body: { error: { code: reviewCode } } },
    { name: 'unknown code', body: { code: 'INVOICE_OTHER_CONFLICT' } },
    { name: 'near-match code', body: { code: `${reviewCode} ` } },
  ])('preserves the conflict fallback for $name', ({ body }) => {
    const error = new EkyApiError(backendMessage, {
      responseBody: body,
      status: 409,
    });

    expect(getMessage(error)).toBe(conflictMessage);
  });

  it.each([400, 404, 429, 500, 502])(
    'preserves the existing fallback for HTTP %i even with the review code',
    (status) => {
      const error = new EkyApiError(backendMessage, {
        responseBody: { code: reviewCode, error: backendMessage },
        status,
      });
      const expectedMessage = status === 404
        ? uiText.invoicing.approvedInvoiceNotFound
        : status === 400
          ? validationMessage
          : status === 429
            ? conflictMessage
            : genericMessage;

      expect(getMessage(error)).toBe(expectedMessage);
    },
  );

  it.each([
    undefined,
    null,
    backendMessage,
    new Error(backendMessage),
    { status: 409, responseBody: { code: reviewCode } },
  ])('preserves the generic fallback for a non-API error: %j', (error) => {
    expect(getMessage(error)).toBe(genericMessage);
  });
});

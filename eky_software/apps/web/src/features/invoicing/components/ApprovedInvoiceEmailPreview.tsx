import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';
import {
  type InvoiceEmailFormErrors,
  validateInvoiceEmailForm,
} from '../approved/invoiceEmailFormValidation.js';
import styles from './ApprovedInvoiceEmailPreview.module.css';

interface ApprovedInvoiceEmailPreviewProps {
  email: ApprovedInvoiceEmailPreviewData;
  errorMessage: string | null;
  isSending: boolean;
  isSendingSmtp: boolean;
  isSendingSmtpTest: boolean;
  isResend: boolean;
  smtpErrorMessage: string | null;
  smtpSuccessMessage: string | null;
  smtpUnavailableMessage: string | null;
  smtpTestErrorMessage: string | null;
  smtpTestRecipient: string | null;
  smtpTestUnavailableMessage: string | null;
  smtpTestSuccessMessage: string | null;
  successMessage: string | null;
  onSendDryRun(input: ApprovedInvoiceEmailDryRunSendInput): void;
  onSendSmtp(input: ApprovedInvoiceEmailSmtpPrepareInput): void;
  onSendSmtpTest(input: ApprovedInvoiceEmailSmtpTestPrepareInput): void;
}

export function ApprovedInvoiceEmailPreview({
  email,
  errorMessage,
  isSending,
  isSendingSmtp,
  isSendingSmtpTest,
  isResend,
  smtpErrorMessage,
  smtpSuccessMessage,
  smtpUnavailableMessage,
  smtpTestErrorMessage,
  smtpTestRecipient,
  smtpTestUnavailableMessage,
  smtpTestSuccessMessage,
  successMessage,
  onSendDryRun,
  onSendSmtp,
  onSendSmtpTest,
}: ApprovedInvoiceEmailPreviewProps): React.JSX.Element {
  const [editableTo, setEditableTo] = useState(email.to);
  const [editableCc, setEditableCc] = useState('');
  const [editableSubject, setEditableSubject] = useState(email.subject);
  const [editableBody, setEditableBody] = useState(email.body);
  const [validationErrors, setValidationErrors] =
    useState<InvoiceEmailFormErrors>({});

  useEffect(() => {
    setEditableTo(email.to);
    setEditableCc('');
    setEditableSubject(email.subject);
    setEditableBody(email.body);
    setValidationErrors({});
  }, [email.body, email.invoiceId, email.subject, email.to]);

  function createValidatedSendInput(): ApprovedInvoiceEmailDryRunSendInput | null {
    const values = {
      body: editableBody,
      cc: editableCc,
      subject: editableSubject,
      to: editableTo,
    };
    const validationResult = validateInvoiceEmailForm(values);

    setValidationErrors(validationResult.errors);

    return validationResult.isValid ? createSendInput(values) : null;
  }

  return (
    <section className={styles.preview} aria-label={uiText.invoicing.invoiceEmailPreviewTitle}>
      <header className={styles.header}>
        <div>
          <p className="panel-kicker">{uiText.invoicing.invoiceEmailDryRunKicker}</p>
          <h3>{uiText.invoicing.invoiceEmailPreviewTitle}</h3>
        </div>
        <span className={styles.badge}>{uiText.invoicing.invoiceEmailDryRunBadge}</span>
      </header>
      <p className={styles.help}>{uiText.invoicing.invoiceEmailDryRunHelp}</p>
      <p className={styles.editHelp}>{uiText.invoicing.invoiceEmailEditHelp}</p>
      <div className={styles.fields}>
        <label htmlFor="invoice-email-to">
          {uiText.invoicing.invoiceEmailToInput}
        </label>
        <div className={styles.fieldControl}>
          <input
            aria-describedby={
              validationErrors.to === undefined
                ? undefined
                : 'invoice-email-to-error'
            }
            aria-invalid={validationErrors.to === undefined ? undefined : true}
            id="invoice-email-to"
            type="email"
            value={editableTo}
            placeholder={uiText.invoicing.invoiceEmailNoRecipient}
            onChange={(event) => {
              setEditableTo(event.currentTarget.value);
              clearValidationError('to', setValidationErrors);
            }}
          />
          <FieldError id="invoice-email-to-error" message={validationErrors.to} />
        </div>
        <label htmlFor="invoice-email-cc">
          {uiText.invoicing.invoiceEmailCc}
        </label>
        <div className={styles.fieldControl}>
          <input
            aria-describedby={
              validationErrors.cc === undefined
                ? undefined
                : 'invoice-email-cc-error'
            }
            aria-invalid={validationErrors.cc === undefined ? undefined : true}
            id="invoice-email-cc"
            type="email"
            value={editableCc}
            onChange={(event) => {
              setEditableCc(event.currentTarget.value);
              clearValidationError('cc', setValidationErrors);
            }}
          />
          <FieldError id="invoice-email-cc-error" message={validationErrors.cc} />
        </div>
        <label htmlFor="invoice-email-subject">
          {uiText.invoicing.invoiceEmailSubjectInput}
        </label>
        <div className={styles.fieldControl}>
          <input
            aria-describedby={
              validationErrors.subject === undefined
                ? undefined
                : 'invoice-email-subject-error'
            }
            aria-invalid={
              validationErrors.subject === undefined ? undefined : true
            }
            id="invoice-email-subject"
            value={editableSubject}
            onChange={(event) => {
              setEditableSubject(event.currentTarget.value);
              clearValidationError('subject', setValidationErrors);
            }}
          />
          <FieldError
            id="invoice-email-subject-error"
            message={validationErrors.subject}
          />
        </div>
        <div className={styles.attachmentLabel}>
          {uiText.invoicing.invoiceEmailAttachment}
        </div>
        <div className={styles.attachmentValue}>
          {email.attachment.fileName} ({formatBytes(email.attachment.sizeBytes)})
        </div>
        <label htmlFor="invoice-email-body">
          {uiText.invoicing.invoiceEmailBody}
        </label>
        <div className={styles.fieldControl}>
          <textarea
            aria-describedby={
              validationErrors.body === undefined
                ? undefined
                : 'invoice-email-body-error'
            }
            aria-invalid={validationErrors.body === undefined ? undefined : true}
            id="invoice-email-body"
            value={editableBody}
            onChange={(event) => {
              setEditableBody(event.currentTarget.value);
              clearValidationError('body', setValidationErrors);
            }}
          />
          <FieldError
            id="invoice-email-body-error"
            message={validationErrors.body}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <button
          className="primary-action"
          disabled={
            isSending ||
            isSendingSmtp ||
            isSendingSmtpTest ||
            smtpUnavailableMessage !== null
          }
          onClick={() => {
            const input = createValidatedSendInput();

            if (input !== null) {
              onSendSmtp(input);
            }
          }}
          type="button"
        >
          {isSendingSmtp
            ? uiText.invoicing.invoiceEmailSmtpSending
            : isResend
              ? uiText.invoicing.invoiceEmailSmtpResend
              : uiText.invoicing.invoiceEmailSmtpSend}
        </button>
      </div>
      {smtpUnavailableMessage !== null ? (
        <p className="message info-message" role="status">
          {smtpUnavailableMessage}
        </p>
      ) : null}
      {smtpSuccessMessage !== null ? (
        <p className="message success-message" role="status">
          {smtpSuccessMessage}
        </p>
      ) : null}
      {smtpErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {smtpErrorMessage}
        </p>
      ) : null}
      <details className={styles.testTools}>
        <summary>{uiText.invoicing.invoiceEmailTestTools}</summary>
        <section className={styles.smtpTest}>
          <p className={styles.smtpTestHelp}>
            {uiText.invoicing.invoiceEmailSmtpTestHelp}
          </p>
          <p className={styles.smtpTestRecipient}>
            <strong>
              {uiText.invoicing.invoiceEmailSmtpTestActualRecipient}:
            </strong>{' '}
            {smtpTestRecipient ??
              uiText.invoicing.invoiceEmailSmtpTestMissingRecipient}
          </p>
          {smtpTestUnavailableMessage !== null ? (
            <p className="message info-message" role="status">
              {smtpTestUnavailableMessage}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className="secondary-action"
              disabled={isSending || isSendingSmtp || isSendingSmtpTest}
              onClick={() => {
                const input = createValidatedSendInput();

                if (input !== null) {
                  onSendDryRun(input);
                }
              }}
              type="button"
            >
              {isSending
                ? uiText.invoicing.invoiceEmailDryRunSending
                : uiText.invoicing.invoiceEmailDryRunSend}
            </button>
            <button
              className="secondary-action"
              disabled={
                isSending ||
                isSendingSmtp ||
                isSendingSmtpTest ||
                smtpTestRecipient === null ||
                smtpTestUnavailableMessage !== null
              }
              onClick={() => {
                const input = createValidatedSendInput();

                if (input !== null) {
                  onSendSmtpTest(input);
                }
              }}
              type="button"
            >
              {isSendingSmtpTest
                ? uiText.invoicing.invoiceEmailSmtpTestSending
                : uiText.invoicing.invoiceEmailSmtpTestSend}
            </button>
          </div>
        </section>
      </details>
      {successMessage !== null ? (
        <p className="message success-message" role="status">
          {successMessage}
        </p>
      ) : null}
      {errorMessage !== null ? (
        <p className="message error-message" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {smtpTestSuccessMessage !== null ? (
        <p className="message success-message" role="status">
          {smtpTestSuccessMessage}
        </p>
      ) : null}
      {smtpTestErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {smtpTestErrorMessage}
        </p>
      ) : null}
    </section>
  );
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}): React.JSX.Element | null {
  return message === undefined ? null : (
    <span className={styles.fieldError} id={id} role="alert">
      {message}
    </span>
  );
}

function clearValidationError(
  field: keyof InvoiceEmailFormErrors,
  setValidationErrors: React.Dispatch<
    React.SetStateAction<InvoiceEmailFormErrors>
  >,
): void {
  setValidationErrors((currentErrors) => {
    if (currentErrors[field] === undefined) {
      return currentErrors;
    }

    const nextErrors = { ...currentErrors };
    delete nextErrors[field];

    return nextErrors;
  });
}

function createSendInput(input: {
  body: string;
  cc: string;
  subject: string;
  to: string;
}): ApprovedInvoiceEmailDryRunSendInput {
  const sendInput: ApprovedInvoiceEmailDryRunSendInput = {
    body: input.body,
    subject: input.subject,
    to: input.to,
  };

  if (input.cc.trim().length > 0) {
    sendInput.cc = input.cc;
  }

  return sendInput;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kilobytes = sizeBytes / 1024;

  return `${kilobytes.toFixed(1).replace('.', ',')} kt`;
}

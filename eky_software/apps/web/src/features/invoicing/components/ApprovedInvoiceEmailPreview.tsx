import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';
import styles from './ApprovedInvoiceEmailPreview.module.css';

interface ApprovedInvoiceEmailPreviewProps {
  email: ApprovedInvoiceEmailPreviewData;
  errorMessage: string | null;
  isSending: boolean;
  isSendingSmtpTest: boolean;
  smtpTestErrorMessage: string | null;
  smtpTestRecipient: string | null;
  smtpTestUnavailableMessage: string | null;
  smtpTestSuccessMessage: string | null;
  successMessage: string | null;
  onSendDryRun(input: ApprovedInvoiceEmailDryRunSendInput): void;
  onSendSmtpTest(input: ApprovedInvoiceEmailSmtpTestPrepareInput): void;
}

export function ApprovedInvoiceEmailPreview({
  email,
  errorMessage,
  isSending,
  isSendingSmtpTest,
  smtpTestErrorMessage,
  smtpTestRecipient,
  smtpTestUnavailableMessage,
  smtpTestSuccessMessage,
  successMessage,
  onSendDryRun,
  onSendSmtpTest,
}: ApprovedInvoiceEmailPreviewProps): React.JSX.Element {
  const [editableTo, setEditableTo] = useState(email.to);
  const [editableCc, setEditableCc] = useState('');
  const [editableSubject, setEditableSubject] = useState(email.subject);
  const [editableBody, setEditableBody] = useState(email.body);

  useEffect(() => {
    setEditableTo(email.to);
    setEditableCc('');
    setEditableSubject(email.subject);
    setEditableBody(email.body);
  }, [email.body, email.invoiceId, email.subject, email.to]);

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
        <input
          id="invoice-email-to"
          type="email"
          value={editableTo}
          placeholder={uiText.invoicing.invoiceEmailNoRecipient}
          onChange={(event) => setEditableTo(event.currentTarget.value)}
        />
        <label htmlFor="invoice-email-cc">
          {uiText.invoicing.invoiceEmailCc}
        </label>
        <input
          id="invoice-email-cc"
          type="email"
          value={editableCc}
          onChange={(event) => setEditableCc(event.currentTarget.value)}
        />
        <label htmlFor="invoice-email-subject">
          {uiText.invoicing.invoiceEmailSubjectInput}
        </label>
        <input
          id="invoice-email-subject"
          value={editableSubject}
          onChange={(event) => setEditableSubject(event.currentTarget.value)}
        />
        <div className={styles.attachmentLabel}>
          {uiText.invoicing.invoiceEmailAttachment}
        </div>
        <div className={styles.attachmentValue}>
          {email.attachment.fileName} ({formatBytes(email.attachment.sizeBytes)})
        </div>
        <label htmlFor="invoice-email-body">
          {uiText.invoicing.invoiceEmailBody}
        </label>
        <textarea
          id="invoice-email-body"
          value={editableBody}
          onChange={(event) => setEditableBody(event.currentTarget.value)}
        />
      </div>
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
      </section>
      <div className={styles.actions}>
        <button
          className="secondary-action"
          disabled={isSending || isSendingSmtpTest}
          onClick={() =>
            onSendDryRun(
              createSendInput({
                body: editableBody,
                cc: editableCc,
                subject: editableSubject,
                to: editableTo,
              }),
            )
          }
          type="button"
        >
          {isSending
            ? uiText.invoicing.invoiceEmailDryRunSending
            : uiText.invoicing.invoiceEmailDryRunSend}
        </button>
        <button
          className="primary-action"
          disabled={
            isSending ||
            isSendingSmtpTest ||
            smtpTestRecipient === null ||
            smtpTestUnavailableMessage !== null
          }
          onClick={() =>
            onSendSmtpTest(
              createSendInput({
                body: editableBody,
                cc: editableCc,
                subject: editableSubject,
                to: editableTo,
              }),
            )
          }
          type="button"
        >
          {isSendingSmtpTest
            ? uiText.invoicing.invoiceEmailSmtpTestSending
            : uiText.invoicing.invoiceEmailSmtpTestSend}
        </button>
      </div>
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

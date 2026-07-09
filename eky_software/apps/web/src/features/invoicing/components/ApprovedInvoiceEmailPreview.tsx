import type { ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData } from '@eky/api-client';
import { useEffect, useState } from 'react';

import { uiText } from '../../../i18n/fi.js';
import styles from './ApprovedInvoiceEmailPreview.module.css';

interface ApprovedInvoiceEmailPreviewProps {
  email: ApprovedInvoiceEmailPreviewData;
}

export function ApprovedInvoiceEmailPreview({
  email,
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
    </section>
  );
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kilobytes = sizeBytes / 1024;

  return `${kilobytes.toFixed(1).replace('.', ',')} kt`;
}

import type { ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';
import styles from './ApprovedInvoiceEmailPreview.module.css';

interface ApprovedInvoiceEmailPreviewProps {
  email: ApprovedInvoiceEmailPreviewData;
}

export function ApprovedInvoiceEmailPreview({
  email,
}: ApprovedInvoiceEmailPreviewProps): React.JSX.Element {
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
      <dl className={styles.details}>
        <div>
          <dt>{uiText.invoicing.invoiceEmailTo}</dt>
          <dd>{email.to || uiText.invoicing.invoiceEmailNoRecipient}</dd>
        </div>
        <div>
          <dt>{uiText.invoicing.invoiceEmailSubject}</dt>
          <dd>{email.subject}</dd>
        </div>
        <div>
          <dt>{uiText.invoicing.invoiceEmailAttachment}</dt>
          <dd>
            {email.attachment.fileName} ({formatBytes(email.attachment.sizeBytes)})
          </dd>
        </div>
      </dl>
      <div className={styles.body}>
        <p>{uiText.invoicing.invoiceEmailBody}</p>
        <pre>{email.body}</pre>
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

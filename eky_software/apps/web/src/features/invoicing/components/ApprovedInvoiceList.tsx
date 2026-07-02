import type { ApprovedInvoiceSummary } from '@eky/api-client';

import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './InvoiceDraftList.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceListProps {
  approvedInvoices: ApprovedInvoiceSummary[];
  errorMessage: string | null;
  isLoading: boolean;
  onOpenApprovedInvoice(id: string): void;
}

export function ApprovedInvoiceList({
  approvedInvoices,
  errorMessage,
  isLoading,
  onOpenApprovedInvoice,
}: ApprovedInvoiceListProps): React.JSX.Element {
  if (isLoading) {
    return <p className={styles.state}>{uiText.invoicing.approvedInvoicesLoading}</p>;
  }

  if (errorMessage) {
    return (
      <p className="message error-message" role="alert">
        {errorMessage}
      </p>
    );
  }

  if (approvedInvoices.length === 0) {
    return <p className={styles.state}>{uiText.invoicing.approvedInvoicesEmpty}</p>;
  }

  return (
    <div
      aria-label={uiText.invoicing.approvedInvoiceList}
      className={styles.table}
      role="table"
    >
      <div className={`${styles.row} ${styles.head}`} role="row">
        <span role="columnheader">{uiText.invoicing.invoice}</span>
        <span role="columnheader">{uiText.invoicing.customer}</span>
        <span role="columnheader">{uiText.invoicing.invoiceDate}</span>
        <span role="columnheader">{uiText.invoicing.dueDate}</span>
        <span className={styles.totalHeader} role="columnheader">
          {uiText.invoicing.total}
        </span>
        <span role="columnheader">{uiText.invoicing.status}</span>
        <span
          aria-label={uiText.invoicing.rowActions}
          role="columnheader"
        />
      </div>
      {approvedInvoices.map((invoice) => (
        <div className={styles.row} key={invoice.id} role="row">
          <div className={styles.mainCell} role="cell">
            <button
              className={styles.openButton}
              onClick={() => onOpenApprovedInvoice(invoice.id)}
              type="button"
          >
            {uiText.invoicing.invoiceNumber} {invoice.invoiceNumber}
          </button>
        </div>
          <span role="cell">
            {formatApprovedInvoiceCustomer(invoice)}
          </span>
          <time dateTime={invoice.invoiceDate} role="cell">
            {formatApprovedInvoiceDate(invoice.invoiceDate)}
          </time>
          <time dateTime={invoice.dueDate} role="cell">
            {formatApprovedInvoiceDate(invoice.dueDate)}
          </time>
          <strong className={styles.total} role="cell">
            {formatApprovedInvoiceCurrency(invoice.grossTotalCents)}
          </strong>
          <span className="status-pill status-pill-active" role="cell">
            {uiText.invoicing.statusApproved}
          </span>
          <div className={styles.rowActions} role="cell">
            <button
              className="ghost-button"
              onClick={() => onOpenApprovedInvoice(invoice.id)}
              type="button"
            >
              {uiText.invoicing.open}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatApprovedInvoiceCustomer(
  invoice: ApprovedInvoiceSummary,
): string {
  return `${invoice.customerNumberSnapshot} – ${invoice.customerNameSnapshot}`;
}

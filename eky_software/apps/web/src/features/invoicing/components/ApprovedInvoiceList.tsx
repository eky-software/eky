import type { ApprovedInvoiceSummary } from '@eky/api-client';

import {
  formatApprovedInvoiceDate,
  formatApprovedInvoicePresentedCurrency,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './InvoiceDraftList.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceListProps {
  approvedInvoices: ApprovedInvoiceSummary[];
  emptyMessage?: string;
  errorMessage: string | null;
  isLoading: boolean;
  listLabel?: string;
  loadingMessage?: string;
  onOpenApprovedInvoice(id: string): void;
}

export function ApprovedInvoiceList({
  approvedInvoices,
  emptyMessage = uiText.invoicing.approvedInvoicesEmpty,
  errorMessage,
  isLoading,
  listLabel = uiText.invoicing.approvedInvoiceList,
  loadingMessage = uiText.invoicing.approvedInvoicesLoading,
  onOpenApprovedInvoice,
}: ApprovedInvoiceListProps): React.JSX.Element {
  if (isLoading) {
    return <p className={styles.state}>{loadingMessage}</p>;
  }

  if (errorMessage) {
    return (
      <p className="message error-message" role="alert">
        {errorMessage}
      </p>
    );
  }

  if (approvedInvoices.length === 0) {
    return <p className={styles.state}>{emptyMessage}</p>;
  }

  return (
    <div
      aria-label={listLabel}
      className={`${styles.table} ${styles.invoiceStatusTable}`}
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
      </div>
      {approvedInvoices.map((invoice) => (
        <div className={styles.row} key={invoice.id} role="row">
          <div className={styles.mainCell} role="cell">
            <button
              className={styles.openButton}
              onClick={() => onOpenApprovedInvoice(invoice.id)}
              type="button"
            >
              {invoice.invoiceKind === 'credit'
                ? uiText.invoicing.creditInvoice
                : uiText.invoicing.invoiceNumber}{' '}
              {invoice.invoiceNumber}
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
            {formatApprovedInvoicePresentedCurrency(
              invoice.grossTotalCents,
              invoice.invoiceKind,
            )}
          </strong>
          <span className="status-pill status-pill-active" role="cell">
            {invoice.status === 'cancelled'
              ? uiText.invoicing.statusCancelled
              : invoice.status === 'sent'
                ? uiText.invoicing.statusSent
                : uiText.invoicing.statusApproved}
          </span>
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

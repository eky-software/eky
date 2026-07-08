import type { ApprovedInvoiceSummary } from '@eky/api-client';

import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './InvoiceDraftList.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceListProps {
  approvedInvoices: ApprovedInvoiceSummary[];
  copiedInvoiceId?: string | null;
  copyErrorMessage?: string | null;
  emptyMessage?: string;
  errorMessage: string | null;
  isLoading: boolean;
  listLabel?: string;
  onCopyApprovedInvoiceToDraft?(id: string): void;
  onOpenApprovedInvoice(id: string): void;
}

export function ApprovedInvoiceList({
  approvedInvoices,
  copiedInvoiceId = null,
  copyErrorMessage = null,
  emptyMessage = uiText.invoicing.approvedInvoicesEmpty,
  errorMessage,
  isLoading,
  listLabel = uiText.invoicing.approvedInvoiceList,
  onCopyApprovedInvoiceToDraft,
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
    return <p className={styles.state}>{emptyMessage}</p>;
  }

  return (
    <>
      {copyErrorMessage ? (
        <p className="message error-message" role="alert">
          {copyErrorMessage}
        </p>
      ) : null}
      <div
        aria-label={listLabel}
        className={`${styles.table} ${
          onCopyApprovedInvoiceToDraft ? styles.wideActionsTable : ''
        }`}
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
              {invoice.status === 'sent'
                ? uiText.invoicing.statusSent
                : uiText.invoicing.statusApproved}
            </span>
            <div className={styles.rowActions} role="cell">
              <button
                className="ghost-button"
                onClick={() => onOpenApprovedInvoice(invoice.id)}
                type="button"
              >
                {uiText.invoicing.open}
              </button>
              {invoice.status === 'sent' && onCopyApprovedInvoiceToDraft ? (
                <button
                  className="ghost-button"
                  disabled={copiedInvoiceId === invoice.id}
                  onClick={() => onCopyApprovedInvoiceToDraft(invoice.id)}
                  type="button"
                >
                  {copiedInvoiceId === invoice.id
                    ? uiText.invoicing.copiedApprovedInvoice
                    : uiText.invoicing.copyApprovedInvoice}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function formatApprovedInvoiceCustomer(
  invoice: ApprovedInvoiceSummary,
): string {
  return `${invoice.customerNumberSnapshot} – ${invoice.customerNameSnapshot}`;
}

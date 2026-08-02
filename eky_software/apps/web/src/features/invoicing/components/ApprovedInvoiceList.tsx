import type { ApprovedInvoiceSummary } from '@eky/api-client';

import styles from './InvoiceDraftList.module.css';
import { uiText } from '../../../i18n/fi.js';
import {
  InvoiceListTable,
  type InvoiceListTableLabels,
} from '../../../shared/invoiceList/index.js';

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
    <InvoiceListTable
      ariaLabel={listLabel}
      labels={invoiceListLabels}
      rows={approvedInvoices.map((invoice) => ({
        customer: formatApprovedInvoiceCustomer(invoice),
        dueDate: invoice.dueDate,
        invoiceDate: invoice.invoiceDate,
        key: invoice.id,
        reference: (
          <div className={styles.mainCell}>
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
        ),
        status: (
          <span className="status-pill status-pill-active">
            {invoice.status === 'cancelled'
              ? uiText.invoicing.statusCancelled
              : invoice.status === 'sent'
                ? uiText.invoicing.statusSent
                : uiText.invoicing.statusApproved}
          </span>
        ),
        totalCents:
          invoice.invoiceKind === 'credit'
            ? -Math.abs(invoice.grossTotalCents)
            : invoice.grossTotalCents,
      }))}
      showCustomer
    />
  );
}

function formatApprovedInvoiceCustomer(
  invoice: ApprovedInvoiceSummary,
): string {
  return `${invoice.customerNumberSnapshot} – ${invoice.customerNameSnapshot}`;
}

const invoiceListLabels: InvoiceListTableLabels = {
  actions: uiText.customers.actions,
  creditRelation: uiText.customers.creditRelation,
  customer: uiText.invoicing.customer,
  dueDate: uiText.invoicing.dueDate,
  invoice: uiText.invoicing.invoice,
  invoiceDate: uiText.invoicing.invoiceDate,
  status: uiText.invoicing.status,
  total: uiText.invoicing.total,
};

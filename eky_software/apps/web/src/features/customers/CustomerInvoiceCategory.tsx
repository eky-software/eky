import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import type { CustomerInvoiceRow } from './customerInvoiceRows.js';
import styles from './CustomerInvoicesSection.module.css';
import { uiText } from '../../i18n/fi.js';
import {
  InvoiceListPagination,
  InvoiceListTable,
  formatInvoiceListDate,
  type InvoiceListTableLabels,
} from '../../shared/invoiceList/index.js';

interface CustomerInvoiceCategoryProps {
  heading: string;
  onNextPage(): void;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
  onPreviousPage(): void;
  page: number;
  rows: CustomerInvoiceRow[];
  showCustomer?: boolean;
  totalCount: number;
  totalPages: number;
}

export function CustomerInvoiceCategory({
  heading,
  onNextPage,
  onOpenInvoice,
  onPreviousPage,
  page,
  rows,
  showCustomer = false,
  totalCount,
  totalPages,
}: CustomerInvoiceCategoryProps): React.JSX.Element | null {
  if (totalCount === 0) {
    return null;
  }

  const getReference = (row: CustomerInvoiceRow): React.JSX.Element => {
    const creditLabel = row.isCredit
      ? row.target.type === 'draft'
        ? uiText.customers.creditDraft
        : uiText.customers.creditInvoice
      : null;
    const subject = row.subject.trim();

    return (
      <span className={styles.invoiceReference}>
        <span>{row.reference}</span>
        {creditLabel !== null || subject.length > 0 ? (
          <span className={styles.invoiceReferenceDetail}>
            {creditLabel}
            {creditLabel !== null && subject.length > 0 ? ' · ' : null}
            {subject}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <section aria-label={heading} className={styles.category}>
      <header className={styles.categoryHeader}>
        <h3>{heading}</h3>
        <span className="count-badge">{totalCount}</span>
      </header>
      <InvoiceListTable
        ariaLabel={heading}
        labels={customerInvoiceListLabels}
        rows={rows.map((row) => ({
          action: (
            <button
              aria-label={uiText.customers.openInvoiceWithNumber(
                row.reference,
              )}
              className={`ghost-button ${styles.openInvoiceButton}`}
              onClick={() => onOpenInvoice(row.target)}
              type="button"
            >
              {uiText.customers.openInvoice}
            </button>
          ),
          customer: row.customer,
          dueDate: row.dueDate,
          invoiceDate: row.date,
          key: row.id,
          reference: getReference(row),
          status: row.status,
          statusDetail:
            row.paidOn === null ? undefined : (
              <span>
                {uiText.invoicing.invoicePaymentDate}{' '}
                <time dateTime={row.paidOn}>
                  {formatInvoiceListDate(row.paidOn)}
                </time>
              </span>
            ),
          totalCents: row.isCredit
            ? -Math.abs(row.grossTotalCents)
            : row.grossTotalCents,
        }))}
        showActions
        showCustomer={showCustomer}
      />
      {totalPages > 1 ? (
        <InvoiceListPagination
          ariaLabel={`${heading} ${uiText.customers.invoicePagination}`}
          className={styles.pagination}
          nextLabel={uiText.customers.nextPage}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          page={page}
          pageLabel={uiText.customers.page(page, totalPages)}
          previousLabel={uiText.customers.previousPage}
          totalPages={totalPages}
        />
      ) : null}
    </section>
  );
}

const customerInvoiceListLabels: InvoiceListTableLabels = {
  actions: uiText.customers.actions,
  creditRelation: uiText.customers.creditRelation,
  customer: uiText.invoicing.customer,
  dueDate: uiText.customers.dueDate,
  invoice: uiText.customers.invoice,
  invoiceDate: uiText.customers.invoiceDate,
  status: uiText.customers.status,
  total: uiText.customers.total,
};

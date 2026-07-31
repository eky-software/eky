import type { CustomerInvoiceOverviewState } from './hooks/useCustomerInvoices.js';
import {
  toApprovedRows,
  toDraftRows,
  toSentRows,
  type CustomerInvoiceRow,
} from './customerInvoiceRows.js';
import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import styles from './CustomerInvoicesSection.module.css';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerInvoicesSectionProps {
  invoiceState: CustomerInvoiceOverviewState;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
}

export function CustomerInvoicesSection({
  invoiceState,
  onOpenInvoice,
}: CustomerInvoicesSectionProps): React.JSX.Element {
  const draftRows = toDraftRows(invoiceState.drafts.items);
  const approvedRows = toApprovedRows(
    invoiceState.approved.items,
    'approved',
  );
  const sentRows = toSentRows(invoiceState.sent.items);
  const paidRows = toSentRows(invoiceState.paid.items);
  const creditedRows = toSentRows(invoiceState.credited.items);
  const cancelledRows = toApprovedRows(
    invoiceState.cancelled.items,
    'cancelled',
  );
  const isEmpty =
    !invoiceState.isLoading &&
    invoiceState.errorMessage === null &&
    draftRows.length === 0 &&
    approvedRows.length === 0 &&
    sentRows.length === 0 &&
    paidRows.length === 0 &&
    creditedRows.length === 0 &&
    cancelledRows.length === 0;

  return (
    <section
      aria-labelledby="customer-invoices-heading"
      className={`panel ${styles.panel}`}
    >
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.invoicing}</p>
          <h2 id="customer-invoices-heading">
            {uiText.customers.customerInvoices}
          </h2>
        </div>
      </div>

      {invoiceState.isLoading ? (
        <p className="message">{uiText.customers.invoiceLoading}</p>
      ) : null}
      {invoiceState.errorMessage !== null ? (
        <MessageBanner variant="error">
          {invoiceState.errorMessage}
        </MessageBanner>
      ) : null}
      {isEmpty ? (
        <p className="message">{uiText.customers.invoiceEmpty}</p>
      ) : null}

      {!invoiceState.isLoading ? (
        <div className={styles.categories}>
          <CustomerInvoiceCategory
            heading={uiText.customers.invoiceCategories.drafts}
            onNextPage={() =>
              invoiceState.goToPage('drafts', invoiceState.drafts.page + 1)
            }
            onOpenInvoice={onOpenInvoice}
            onPreviousPage={() =>
              invoiceState.goToPage('drafts', invoiceState.drafts.page - 1)
            }
            page={invoiceState.drafts.page}
            rows={draftRows}
            totalCount={invoiceState.drafts.totalCount}
            totalPages={invoiceState.drafts.totalPages}
          />
          <CustomerInvoiceCategory
            heading={uiText.customers.invoiceCategories.approved}
            onNextPage={() =>
              invoiceState.goToPage(
                'approved',
                invoiceState.approved.page + 1,
              )
            }
            onOpenInvoice={onOpenInvoice}
            onPreviousPage={() =>
              invoiceState.goToPage(
                'approved',
                invoiceState.approved.page - 1,
              )
            }
            page={invoiceState.approved.page}
            rows={approvedRows}
            totalCount={invoiceState.approved.totalCount}
            totalPages={invoiceState.approved.totalPages}
          />
          <CustomerInvoiceCategory
            heading={uiText.customers.invoiceCategories.sent}
            onNextPage={() =>
              invoiceState.goToPage('sent', invoiceState.sent.page + 1)
            }
            onOpenInvoice={onOpenInvoice}
            onPreviousPage={() =>
              invoiceState.goToPage('sent', invoiceState.sent.page - 1)
            }
            page={invoiceState.sent.page}
            rows={sentRows}
            totalCount={invoiceState.sent.totalCount}
            totalPages={invoiceState.sent.totalPages}
          />
          <CustomerInvoiceCategory
            heading={uiText.customers.invoiceCategories.paid}
            onNextPage={() =>
              invoiceState.goToPage('paid', invoiceState.paid.page + 1)
            }
            onOpenInvoice={onOpenInvoice}
            onPreviousPage={() =>
              invoiceState.goToPage('paid', invoiceState.paid.page - 1)
            }
            page={invoiceState.paid.page}
            rows={paidRows}
            totalCount={invoiceState.paid.totalCount}
            totalPages={invoiceState.paid.totalPages}
          />
          <CustomerInvoiceCategory
            heading={uiText.customers.invoiceCategories.credited}
            onNextPage={() =>
              invoiceState.goToPage(
                'credited',
                invoiceState.credited.page + 1,
              )
            }
            onOpenInvoice={onOpenInvoice}
            onPreviousPage={() =>
              invoiceState.goToPage(
                'credited',
                invoiceState.credited.page - 1,
              )
            }
            page={invoiceState.credited.page}
            rows={creditedRows}
            totalCount={invoiceState.credited.totalCount}
            totalPages={invoiceState.credited.totalPages}
          />
          <CustomerInvoiceCategory
            heading={uiText.customers.invoiceCategories.cancelled}
            onNextPage={() =>
              invoiceState.goToPage(
                'cancelled',
                invoiceState.cancelled.page + 1,
              )
            }
            onOpenInvoice={onOpenInvoice}
            onPreviousPage={() =>
              invoiceState.goToPage(
                'cancelled',
                invoiceState.cancelled.page - 1,
              )
            }
            page={invoiceState.cancelled.page}
            rows={cancelledRows}
            totalCount={invoiceState.cancelled.totalCount}
            totalPages={invoiceState.cancelled.totalPages}
          />
        </div>
      ) : null}
    </section>
  );
}

interface CustomerInvoiceCategoryProps {
  heading: string;
  onNextPage(): void;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
  onPreviousPage(): void;
  page: number;
  rows: CustomerInvoiceRow[];
  totalCount: number;
  totalPages: number;
}

function CustomerInvoiceCategory({
  heading,
  onNextPage,
  onOpenInvoice,
  onPreviousPage,
  page,
  rows,
  totalCount,
  totalPages,
}: CustomerInvoiceCategoryProps): React.JSX.Element | null {
  if (totalCount === 0) {
    return null;
  }

  return (
    <section aria-label={heading} className={styles.category}>
      <header className={styles.categoryHeader}>
        <h3>{heading}</h3>
        <span className="count-badge">{totalCount}</span>
      </header>
      <div className={styles.tableFrame}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{uiText.customers.invoice}</th>
              <th>{uiText.customers.invoiceDate}</th>
              <th>{uiText.customers.dueDate}</th>
              <th>{uiText.customers.total}</th>
              <th>{uiText.customers.status}</th>
              <th>{uiText.customers.creditRelation}</th>
              <th aria-label={uiText.customers.actions} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <CustomerInvoiceTableRow
                key={row.id}
                onOpenInvoice={onOpenInvoice}
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <nav
          aria-label={`${heading} ${uiText.customers.invoicePagination}`}
          className={styles.pagination}
        >
          <button
            className="ghost-button"
            disabled={page <= 1}
            onClick={onPreviousPage}
            type="button"
          >
            {uiText.customers.previousPage}
          </button>
          <span>{uiText.customers.page(page, totalPages)}</span>
          <button
            className="ghost-button"
            disabled={page >= totalPages}
            onClick={onNextPage}
            type="button"
          >
            {uiText.customers.nextPage}
          </button>
        </nav>
      ) : null}
    </section>
  );
}

interface CustomerInvoiceTableRowProps {
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
  row: CustomerInvoiceRow;
}

function CustomerInvoiceTableRow({
  onOpenInvoice,
  row,
}: CustomerInvoiceTableRowProps): React.JSX.Element {
  return (
    <tr>
      <td>
        <strong>{row.reference}</strong>
      </td>
      <td>{formatCustomerInvoiceDate(row.date)}</td>
      <td>{formatCustomerInvoiceDate(row.dueDate)}</td>
      <td className={styles.amount}>
        {formatCustomerInvoiceCurrency(
          row.isCredit ? -Math.abs(row.grossTotalCents) : row.grossTotalCents,
        )}
      </td>
      <td>{row.status}</td>
      <td>{row.relation || '-'}</td>
      <td className={styles.openCell}>
        <button
          className="ghost-button"
          onClick={() => onOpenInvoice(row.target)}
          type="button"
        >
          {uiText.customers.openInInvoicing}
        </button>
      </td>
    </tr>
  );
}

const customerInvoiceCurrencyFormatter = new Intl.NumberFormat('fi-FI', {
  currency: 'EUR',
  style: 'currency',
});

function formatCustomerInvoiceCurrency(cents: number): string {
  return customerInvoiceCurrencyFormatter.format(cents / 100);
}

function formatCustomerInvoiceDate(value: string): string {
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

  if (match === null) {
    return value;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

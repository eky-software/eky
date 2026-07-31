import { CustomerInvoiceCategory } from './CustomerInvoiceCategory.js';
import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import {
  toApprovedRows,
  toSentRows,
} from './customerInvoiceRows.js';
import {
  customerInvoicePageSizes,
  isCustomerInvoiceListPageSize,
  isCustomerInvoiceListSort,
} from './customerInvoiceListState.js';
import type { BillingRecipientInvoiceOverviewState } from './hooks/useBillingRecipientInvoices.js';
import styles from './CustomerInvoicesSection.module.css';
import { uiText } from '../../i18n/fi.js';
import {
  InvoiceListPageSizeSelect,
  InvoiceListSortSelect,
  type InvoiceListSortOption,
} from '../../shared/invoiceList/index.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface BillingRecipientInvoicesSectionProps {
  invoiceState: BillingRecipientInvoiceOverviewState;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
}

export function BillingRecipientInvoicesSection({
  invoiceState,
  onOpenInvoice,
}: BillingRecipientInvoicesSectionProps): React.JSX.Element {
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
    approvedRows.length === 0 &&
    sentRows.length === 0 &&
    paidRows.length === 0 &&
    creditedRows.length === 0 &&
    cancelledRows.length === 0;

  return (
    <section
      aria-labelledby="billing-recipient-invoices-heading"
      className={`panel ${styles.panel}`}
    >
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.invoicing}</p>
          <h2 id="billing-recipient-invoices-heading">
            {uiText.customers.billingRecipientInvoices}
          </h2>
        </div>
      </div>

      {invoiceState.isLoading ? (
        <p className="message">
          {uiText.customers.billingRecipientInvoiceLoading}
        </p>
      ) : null}
      {invoiceState.errorMessage !== null ? (
        <MessageBanner variant="error">
          {invoiceState.errorMessage}
        </MessageBanner>
      ) : null}
      {isEmpty ? (
        <p className="message">
          {uiText.customers.billingRecipientInvoiceEmpty}
        </p>
      ) : null}

      {!invoiceState.isLoading && !isEmpty ? (
        <div
          aria-label={uiText.customers.billingRecipientInvoiceListControls}
          className={styles.controls}
          role="group"
        >
          <InvoiceListSortSelect
            className={styles.control}
            label={uiText.invoicing.listSort}
            onChange={(value) => {
              if (isCustomerInvoiceListSort(value)) {
                invoiceState.setSort(value);
              }
            }}
            options={billingRecipientInvoiceSortOptions}
            value={invoiceState.sort}
          />
          <InvoiceListPageSizeSelect
            className={styles.control}
            label={uiText.customers.invoicePageSize}
            onChange={(value) => {
              if (isCustomerInvoiceListPageSize(value)) {
                invoiceState.setPageSize(value);
              }
            }}
            options={customerInvoicePageSizes}
            value={invoiceState.pageSize}
          />
        </div>
      ) : null}

      {!invoiceState.isLoading ? (
        <div className={styles.categories}>
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
            showCustomer
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
            showCustomer
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
            showCustomer
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
            showCustomer
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
            showCustomer
            totalCount={invoiceState.cancelled.totalCount}
            totalPages={invoiceState.cancelled.totalPages}
          />
        </div>
      ) : null}
    </section>
  );
}

const billingRecipientInvoiceSortOptions: readonly InvoiceListSortOption[] = [
  {
    label: uiText.invoicing.listSortNewest,
    value: 'invoiceDateDesc',
  },
  {
    label: uiText.invoicing.listSortOldest,
    value: 'invoiceDateAsc',
  },
  {
    label: uiText.invoicing.listSortDueDate,
    value: 'dueDateAsc',
  },
];

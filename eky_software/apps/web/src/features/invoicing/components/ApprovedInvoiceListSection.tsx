import type {
  ApprovedInvoiceListPageSize,
  ApprovedInvoiceListSort,
} from '@eky/api-client';

import { ApprovedInvoiceList } from './ApprovedInvoiceList.js';
import styles from './ApprovedInvoiceListSection.module.css';
import type { ApprovedInvoicePeriodMode } from '../approved/approvedInvoiceListFilters.js';
import type { ApprovedInvoicePageState } from '../hooks/useApprovedInvoicePage.js';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceListSectionProps {
  countLabel: string;
  emptyMessage: string;
  kicker: string;
  listLabel: string;
  loadingMessage: string;
  pageState: ApprovedInvoicePageState;
  title: string;
  onOpenApprovedInvoice(id: string): void;
}

const pageSizes: ApprovedInvoiceListPageSize[] = [20, 50, 100];

export function ApprovedInvoiceListSection({
  countLabel,
  emptyMessage,
  kicker,
  listLabel,
  loadingMessage,
  pageState,
  title,
  onOpenApprovedInvoice,
}: ApprovedInvoiceListSectionProps): React.JSX.Element {
  const visibleTotalPages = Math.max(1, pageState.totalPages);

  return (
    <section className={`panel ${styles.panel}`}>
      <header className={`panel-header ${styles.header}`}>
        <div>
          <p className="panel-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
        {!pageState.isLoading && pageState.errorMessage === null ? (
          <span className="count-badge" aria-label={countLabel}>
            {pageState.totalCount}
          </span>
        ) : null}
      </header>

      <div className={styles.controls} aria-label={uiText.invoicing.listFilters}>
        <label className={styles.control}>
          <span>{uiText.invoicing.listPeriod}</span>
          <select
            onChange={(event) =>
              pageState.setPeriodMode(
                event.currentTarget.value as ApprovedInvoicePeriodMode,
              )
            }
            value={pageState.controls.periodMode}
          >
            <option value="all">{uiText.invoicing.listPeriodAll}</option>
            <option value="month">{uiText.invoicing.listPeriodMonth}</option>
            <option
              disabled={!pageState.isFiscalYearFilterAvailable}
              value="fiscalYear"
            >
              {uiText.invoicing.listPeriodFiscalYear}
            </option>
          </select>
        </label>

        {pageState.controls.periodMode === 'month' ? (
          <label className={styles.control}>
            <span>{uiText.invoicing.listMonth}</span>
            <input
              onChange={(event) => pageState.setMonth(event.currentTarget.value)}
              type="month"
              value={pageState.controls.month}
            />
          </label>
        ) : null}

        {pageState.controls.periodMode === 'fiscalYear' ? (
          <label className={styles.control}>
            <span>{uiText.invoicing.listFiscalYearStart}</span>
            <input
              max="9998"
              min="1900"
              onChange={(event) =>
                pageState.setFiscalYearStartYear(
                  Number(event.currentTarget.value),
                )
              }
              type="number"
              value={pageState.controls.fiscalYearStartYear}
            />
          </label>
        ) : null}

        <label className={styles.control}>
          <span>{uiText.invoicing.listSort}</span>
          <select
            onChange={(event) =>
              pageState.setSort(
                event.currentTarget.value as ApprovedInvoiceListSort,
              )
            }
            value={pageState.controls.sort}
          >
            <option value="invoiceDateDesc">
              {uiText.invoicing.listSortNewest}
            </option>
            <option value="invoiceDateAsc">
              {uiText.invoicing.listSortOldest}
            </option>
            <option value="dueDateAsc">
              {uiText.invoicing.listSortDueDate}
            </option>
            <option value="customerNameAsc">
              {uiText.invoicing.listSortCustomer}
            </option>
          </select>
        </label>

        <label className={`${styles.control} ${styles.pageSizeControl}`}>
          <span>{uiText.invoicing.listPageSize}</span>
          <select
            onChange={(event) =>
              pageState.setPageSize(
                Number(event.currentTarget.value) as ApprovedInvoiceListPageSize,
              )
            }
            value={pageState.controls.pageSize}
          >
            {pageSizes.map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ApprovedInvoiceList
        approvedInvoices={pageState.invoices}
        emptyMessage={emptyMessage}
        errorMessage={pageState.errorMessage}
        isLoading={pageState.isLoading}
        listLabel={listLabel}
        loadingMessage={loadingMessage}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />

      {pageState.totalCount > 0 ? (
        <nav
          className={styles.pagination}
          aria-label={uiText.invoicing.listPages}
        >
          <button
            className="secondary-action"
            disabled={pageState.isLoading || pageState.controls.page <= 1}
            onClick={() => pageState.goToPage(pageState.controls.page - 1)}
            type="button"
          >
            {uiText.invoicing.listPreviousPage}
          </button>
          <span>
            {uiText.invoicing.listPageLabel(
              pageState.controls.page,
              visibleTotalPages,
            )}
          </span>
          <button
            className="secondary-action"
            disabled={
              pageState.isLoading ||
              pageState.totalPages === 0 ||
              pageState.controls.page >= pageState.totalPages
            }
            onClick={() => pageState.goToPage(pageState.controls.page + 1)}
            type="button"
          >
            {uiText.invoicing.listNextPage}
          </button>
        </nav>
      ) : null}
    </section>
  );
}

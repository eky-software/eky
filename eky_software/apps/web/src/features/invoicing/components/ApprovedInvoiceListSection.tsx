import type {
  ApprovedInvoiceListPageSize,
  ApprovedInvoiceListSort,
} from '@eky/api-client';

import { ApprovedInvoiceList } from './ApprovedInvoiceList.js';
import { SentInvoiceGroupList } from './SentInvoiceGroupList.js';
import styles from './ApprovedInvoiceListSection.module.css';
import type { ApprovedInvoicePeriodMode } from '../approved/approvedInvoiceListFilters.js';
import type { ApprovedInvoicePageState } from '../hooks/useApprovedInvoicePage.js';
import { uiText } from '../../../i18n/fi.js';
import {
  InvoiceListPageSizeSelect,
  InvoiceListPagination,
  InvoiceListSortSelect,
  type InvoiceListSortOption,
} from '../../../shared/invoiceList/index.js';

interface ApprovedInvoiceListSectionProps {
  countLabel: string;
  emptyMessage: string;
  kicker: string;
  listLabel: string;
  loadingMessage: string;
  pageState: ApprovedInvoicePageState;
  showPaidOn?: boolean;
  title: string;
  onOpenApprovedInvoice(id: string): void;
}

const pageSizes: ApprovedInvoiceListPageSize[] = [5, 20, 50, 100];

export function ApprovedInvoiceListSection({
  countLabel,
  emptyMessage,
  kicker,
  listLabel,
  loadingMessage,
  pageState,
  showPaidOn = false,
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

        <InvoiceListSortSelect
          className={styles.control}
          label={uiText.invoicing.listSort}
          onChange={(value) =>
            pageState.setSort(value as ApprovedInvoiceListSort)
          }
          options={sortOptions}
          value={pageState.controls.sort}
        />

        <InvoiceListPageSizeSelect
          className={`${styles.control} ${styles.pageSizeControl}`}
          label={uiText.invoicing.listPageSize}
          onChange={(value) =>
            pageState.setPageSize(value as ApprovedInvoiceListPageSize)
          }
          options={pageSizes}
          value={pageState.controls.pageSize}
        />
      </div>

      {pageState.invoiceGroups.length > 0 &&
      !pageState.isLoading &&
      pageState.errorMessage === null ? (
        <SentInvoiceGroupList
          groups={pageState.invoiceGroups}
          listLabel={listLabel}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
          showPaidOn={showPaidOn}
        />
      ) : (
        <ApprovedInvoiceList
          approvedInvoices={pageState.invoices}
          emptyMessage={emptyMessage}
          errorMessage={pageState.errorMessage}
          isLoading={pageState.isLoading}
          listLabel={listLabel}
          loadingMessage={loadingMessage}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
        />
      )}

      {pageState.totalCount > 0 ? (
        <InvoiceListPagination
          ariaLabel={uiText.invoicing.listPages}
          className={styles.pagination}
          disabled={pageState.isLoading}
          nextLabel={uiText.invoicing.listNextPage}
          onNextPage={() =>
            pageState.goToPage(pageState.controls.page + 1)
          }
          onPreviousPage={() =>
            pageState.goToPage(pageState.controls.page - 1)
          }
          page={pageState.controls.page}
          pageLabel={uiText.invoicing.listPageLabel(
            pageState.controls.page,
            visibleTotalPages,
          )}
          previousLabel={uiText.invoicing.listPreviousPage}
          totalPages={pageState.totalPages}
        />
      ) : null}
    </section>
  );
}

const sortOptions: InvoiceListSortOption[] = [
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
  {
    label: uiText.invoicing.listSortCustomer,
    value: 'customerNameAsc',
  },
];

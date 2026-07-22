import type {
  ApprovedInvoiceListPageSize,
  ApprovedInvoiceListQuery,
  ApprovedInvoiceListSort,
  ApprovedInvoiceViewStatus,
} from '@eky/api-client';

export type ApprovedInvoicePeriodMode = 'all' | 'month' | 'fiscalYear';

export interface ApprovedInvoiceListControls {
  fiscalYearStartYear: number;
  month: string;
  page: number;
  pageSize: ApprovedInvoiceListPageSize;
  periodMode: ApprovedInvoicePeriodMode;
  sort: ApprovedInvoiceListSort;
}

export function createDefaultApprovedInvoiceListControls(
  referenceDate = new Date(),
): ApprovedInvoiceListControls {
  return {
    fiscalYearStartYear: referenceDate.getFullYear(),
    month: `${referenceDate.getFullYear()}-${String(
      referenceDate.getMonth() + 1,
    ).padStart(2, '0')}`,
    page: 1,
    pageSize: 20,
    periodMode: 'all',
    sort: 'invoiceDateDesc',
  };
}

export function createApprovedInvoiceListQuery(
  status: ApprovedInvoiceViewStatus,
  controls: ApprovedInvoiceListControls,
  fiscalYearStartMonth: number | null,
): ApprovedInvoiceListQuery {
  const query: ApprovedInvoiceListQuery = {
    page: controls.page,
    pageSize: controls.pageSize,
    sort: controls.sort,
    status,
  };

  if (controls.periodMode === 'all') {
    return query;
  }

  if (controls.periodMode === 'month') {
    const range = getMonthDateRange(controls.month);

    return { ...query, ...range };
  }

  if (fiscalYearStartMonth === null) {
    throw new Error('Fiscal year start month is unavailable.');
  }

  return {
    ...query,
    ...getFiscalYearDateRange(
      controls.fiscalYearStartYear,
      fiscalYearStartMonth,
    ),
  };
}

export function getCurrentFiscalYearStartYear(
  referenceDate: Date,
  fiscalYearStartMonth: number,
): number {
  validateFiscalYearStartMonth(fiscalYearStartMonth);

  return referenceDate.getMonth() + 1 >= fiscalYearStartMonth
    ? referenceDate.getFullYear()
    : referenceDate.getFullYear() - 1;
}

export function getFiscalYearDateRange(
  startYear: number,
  fiscalYearStartMonth: number,
): { dateFrom: string; dateTo: string } {
  validateYear(startYear);
  validateFiscalYearStartMonth(fiscalYearStartMonth);

  return {
    dateFrom: formatIsoDate(startYear, fiscalYearStartMonth, 1),
    dateTo: formatDate(
      new Date(Date.UTC(startYear + 1, fiscalYearStartMonth - 1, 0)),
    ),
  };
}

export function getMonthDateRange(
  monthValue: string,
): { dateFrom: string; dateTo: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);

  if (match === null) {
    throw new Error('Invoice list month is invalid.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  validateYear(year);

  if (month < 1 || month > 12) {
    throw new Error('Invoice list month is invalid.');
  }

  return {
    dateFrom: formatIsoDate(year, month, 1),
    dateTo: formatDate(new Date(Date.UTC(year, month, 0))),
  };
}

function validateFiscalYearStartMonth(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 12) {
    throw new Error('Fiscal year start month is invalid.');
  }
}

function validateYear(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1900 || value > 9998) {
    throw new Error('Invoice list year is invalid.');
  }
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0',
  )}-${String(day).padStart(2, '0')}`;
}

function formatDate(date: Date): string {
  return formatIsoDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

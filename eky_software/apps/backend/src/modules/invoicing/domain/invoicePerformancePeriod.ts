import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export type InvoicePerformancePeriod =
  | { type: 'invoiceDate' }
  | { type: 'singleDate'; date: string }
  | { type: 'dateRange'; startDate: string; endDate: string };

export interface InvoicePerformancePeriodColumns {
  performanceDate: string | null;
  performancePeriodStart: string | null;
  performancePeriodEnd: string | null;
}

export function resolveInvoicePerformancePeriod(
  value: InvoicePerformancePeriod | undefined,
): InvoicePerformancePeriod {
  if (value === undefined || value.type === 'invoiceDate') {
    return { type: 'invoiceDate' };
  }

  if (value.type === 'singleDate') {
    return {
      type: 'singleDate',
      date: requireDateOnly(value.date, 'Performance date'),
    };
  }

  if (value.type === 'dateRange') {
    const startDate = requireDateOnly(
      value.startDate,
      'Performance period start',
    );
    const endDate = requireDateOnly(value.endDate, 'Performance period end');

    if (endDate < startDate) {
      throw new InvoiceDraftValidationError(
        'Performance period end cannot be before its start.',
      );
    }

    return {
      type: 'dateRange',
      startDate,
      endDate,
    };
  }

  throw new InvoiceDraftValidationError(
    'Invoice performance period is not supported.',
  );
}

export function toInvoicePerformancePeriodColumns(
  value: InvoicePerformancePeriod,
): InvoicePerformancePeriodColumns {
  if (value.type === 'singleDate') {
    return {
      performanceDate: value.date,
      performancePeriodStart: null,
      performancePeriodEnd: null,
    };
  }

  if (value.type === 'dateRange') {
    return {
      performanceDate: null,
      performancePeriodStart: value.startDate,
      performancePeriodEnd: value.endDate,
    };
  }

  return {
    performanceDate: null,
    performancePeriodStart: null,
    performancePeriodEnd: null,
  };
}

export function fromInvoicePerformancePeriodColumns(
  columns: InvoicePerformancePeriodColumns,
): InvoicePerformancePeriod {
  if (
    columns.performanceDate !== null &&
    columns.performancePeriodStart === null &&
    columns.performancePeriodEnd === null
  ) {
    return resolveInvoicePerformancePeriod({
      type: 'singleDate',
      date: columns.performanceDate,
    });
  }

  if (
    columns.performanceDate === null &&
    columns.performancePeriodStart !== null &&
    columns.performancePeriodEnd !== null
  ) {
    return resolveInvoicePerformancePeriod({
      type: 'dateRange',
      startDate: columns.performancePeriodStart,
      endDate: columns.performancePeriodEnd,
    });
  }

  if (
    columns.performanceDate === null &&
    columns.performancePeriodStart === null &&
    columns.performancePeriodEnd === null
  ) {
    return { type: 'invoiceDate' };
  }

  throw new InvoiceDraftValidationError(
    'Stored invoice performance period is invalid.',
  );
}

function requireDateOnly(value: string, fieldName: string): string {
  if (!dateOnlyPattern.test(value)) {
    throw new InvoiceDraftValidationError(
      `${fieldName} must use YYYY-MM-DD format.`,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new InvoiceDraftValidationError(`${fieldName} must be a valid date.`);
  }

  return value;
}

import { describe, expect, it } from 'vitest';

import {
  fromInvoicePerformancePeriodColumns,
  resolveInvoicePerformancePeriod,
  toInvoicePerformancePeriodColumns,
} from './invoicePerformancePeriod.js';
import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';

describe('invoice performance period', () => {
  it('uses the invoice date as the safe default', () => {
    expect(resolveInvoicePerformancePeriod(undefined)).toEqual({
      type: 'invoiceDate',
    });
    expect(
      toInvoicePerformancePeriodColumns({ type: 'invoiceDate' }),
    ).toEqual({
      performanceDate: null,
      performancePeriodStart: null,
      performancePeriodEnd: null,
    });
  });

  it('validates and round-trips a single performance date', () => {
    const period = resolveInvoicePerformancePeriod({
      type: 'singleDate',
      date: '2026-07-26',
    });

    expect(
      fromInvoicePerformancePeriodColumns(
        toInvoicePerformancePeriodColumns(period),
      ),
    ).toEqual(period);
  });

  it('validates and round-trips a performance date range', () => {
    const period = resolveInvoicePerformancePeriod({
      type: 'dateRange',
      startDate: '2026-07-01',
      endDate: '2026-07-26',
    });

    expect(
      fromInvoicePerformancePeriodColumns(
        toInvoicePerformancePeriodColumns(period),
      ),
    ).toEqual(period);
  });

  it('rejects invalid dates and reversed ranges', () => {
    expect(() =>
      resolveInvoicePerformancePeriod({
        type: 'singleDate',
        date: '2026-02-30',
      }),
    ).toThrow(InvoiceDraftValidationError);
    expect(() =>
      resolveInvoicePerformancePeriod({
        type: 'dateRange',
        startDate: '2026-07-27',
        endDate: '2026-07-26',
      }),
    ).toThrow(InvoiceDraftValidationError);
  });

  it('rejects mixed stored date and range columns', () => {
    expect(() =>
      fromInvoicePerformancePeriodColumns({
        performanceDate: '2026-07-26',
        performancePeriodStart: '2026-07-01',
        performancePeriodEnd: '2026-07-26',
      }),
    ).toThrow(InvoiceDraftValidationError);
  });
});

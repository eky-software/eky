import { describe, expect, it } from 'vitest';

import {
  createApprovedInvoiceListQuery,
  createDefaultApprovedInvoiceListControls,
  getCurrentFiscalYearStartYear,
  getFiscalYearDateRange,
  getMonthDateRange,
} from './approvedInvoiceListFilters.js';

describe('approved invoice list filters', () => {
  it('creates a month range including the final calendar day', () => {
    expect(getMonthDateRange('2026-02')).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    });
  });

  it('creates a fiscal year range from the configured start month', () => {
    expect(getFiscalYearDateRange(2026, 7)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2027-06-30',
    });
    expect(getCurrentFiscalYearStartYear(new Date(2026, 5, 30), 7)).toBe(
      2025,
    );
  });

  it('creates a scoped query without company-owned fields', () => {
    const controls = {
      ...createDefaultApprovedInvoiceListControls(new Date(2026, 6, 22)),
      fiscalYearStartYear: 2026,
      page: 3,
      pageSize: 50 as const,
      periodMode: 'fiscalYear' as const,
      sort: 'dueDateAsc' as const,
    };

    expect(createApprovedInvoiceListQuery('sent', controls, 7)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2027-06-30',
      page: 3,
      pageSize: 50,
      sort: 'dueDateAsc',
      status: 'sent',
    });
    expect(
      createApprovedInvoiceListQuery('sent', controls, 7),
    ).not.toHaveProperty('companyId');
  });

  it('rejects invalid periods before an API request is built', () => {
    expect(() => getMonthDateRange('2026-13')).toThrow();
    expect(() => getFiscalYearDateRange(2026, 0)).toThrow();
  });
});

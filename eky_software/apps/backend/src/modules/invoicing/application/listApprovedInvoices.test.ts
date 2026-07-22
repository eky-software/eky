import { describe, expect, it, vi } from 'vitest';

import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { listApprovedInvoices } from './listApprovedInvoices.js';

describe('listApprovedInvoices', () => {
  it('passes a company-scoped paginated query to the reader', async () => {
    const reader = createReader();
    vi.mocked(reader.listApprovedInvoiceSummaries).mockResolvedValue({
      invoices: [],
      totalCount: 41,
    });

    await expect(
      listApprovedInvoices(
        {
          companyId: 'dev-company',
          status: 'sent',
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
          page: 2,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).resolves.toEqual({
      invoices: [],
      page: 2,
      pageSize: 20,
      totalCount: 41,
      totalPages: 3,
    });
    expect(reader.listApprovedInvoiceSummaries).toHaveBeenCalledWith({
      companyId: 'dev-company',
      status: 'sent',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      limit: 20,
      offset: 20,
      sort: 'invoiceDateDesc',
    });
  });

  it.each([
    { page: 0, pageSize: 20, status: 'approved', sort: 'invoiceDateDesc' },
    { page: 1, pageSize: 25, status: 'approved', sort: 'invoiceDateDesc' },
    { page: 1, pageSize: 20, status: 'unknown', sort: 'invoiceDateDesc' },
    { page: 1, pageSize: 20, status: 'approved', sort: 'unknown' },
  ])('rejects invalid list controls: $page/$pageSize/$status/$sort', async (input) => {
    await expect(
      listApprovedInvoices(
        {
          companyId: 'dev-company',
          page: input.page,
          pageSize: input.pageSize,
          status: input.status as 'approved',
          sort: input.sort as 'invoiceDateDesc',
        },
        createReader(),
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
  });

  it('rejects invalid and reversed invoice-date ranges', async () => {
    await expect(
      listApprovedInvoices(
        {
          companyId: 'dev-company',
          status: 'approved',
          dateFrom: '2026-02-30',
          page: 1,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        createReader(),
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);

    await expect(
      listApprovedInvoices(
        {
          companyId: 'dev-company',
          status: 'approved',
          dateFrom: '2026-07-01',
          dateTo: '2026-06-30',
          page: 1,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        createReader(),
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
  });
});

function createReader(): ApprovedInvoiceReader {
  return {
    getApprovedInvoiceById: vi.fn(),
    listApprovedInvoiceSummaries: vi.fn(async () => ({
      invoices: [],
      totalCount: 0,
    })),
  };
}

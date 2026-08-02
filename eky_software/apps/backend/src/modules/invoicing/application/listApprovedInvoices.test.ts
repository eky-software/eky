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
          customerId: ' customer-1 ',
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
      customerId: 'customer-1',
      billingRecipientCustomerId: null,
      status: 'sent',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      limit: 20,
      offset: 20,
      sort: 'invoiceDateDesc',
    });
  });

  it('passes a normalized billing-recipient filter without changing ownership', async () => {
    const reader = createReader();

    await listApprovedInvoices(
      {
        companyId: 'dev-company',
        billingRecipientCustomerId: ' property-manager-1 ',
        status: 'approved',
        page: 1,
        pageSize: 20,
        sort: 'invoiceDateDesc',
      },
      reader,
    );

    expect(reader.listApprovedInvoiceSummaries).toHaveBeenCalledWith(
      expect.objectContaining({
        billingRecipientCustomerId: 'property-manager-1',
        customerId: null,
      }),
    );
  });

  it('rejects combined customer and billing-recipient filters before reading', async () => {
    const reader = createReader();

    await expect(
      listApprovedInvoices(
        {
          companyId: 'dev-company',
          customerId: 'customer-1',
          billingRecipientCustomerId: 'property-manager-1',
          status: 'approved',
          page: 1,
          pageSize: 20,
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(reader.listApprovedInvoiceSummaries).not.toHaveBeenCalled();
  });

  it('accepts the compact five-row page size', async () => {
    const reader = createReader();
    vi.mocked(reader.listApprovedInvoiceSummaries).mockResolvedValue({
      invoices: [],
      totalCount: 11,
    });

    await expect(
      listApprovedInvoices(
        {
          companyId: 'dev-company',
          status: 'approved',
          page: 2,
          pageSize: 5,
          sort: 'invoiceDateDesc',
        },
        reader,
      ),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 5,
      totalCount: 11,
      totalPages: 3,
    });
    expect(reader.listApprovedInvoiceSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 5 }),
    );
  });

  it.each([
    { page: 0, pageSize: 20, status: 'approved', sort: 'invoiceDateDesc' },
    { page: 1, pageSize: 4, status: 'approved', sort: 'invoiceDateDesc' },
    { page: 1, pageSize: 6, status: 'approved', sort: 'invoiceDateDesc' },
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

  it.each([
    { field: 'customerId' as const, value: '' },
    { field: 'customerId' as const, value: 'x'.repeat(201) },
    { field: 'billingRecipientCustomerId' as const, value: '' },
    {
      field: 'billingRecipientCustomerId' as const,
      value: 'x'.repeat(201),
    },
  ])(
    'rejects an invalid $field filter before calling the reader',
    async ({ field, value }) => {
      const reader = createReader();

      await expect(
        listApprovedInvoices(
          {
            companyId: 'dev-company',
            [field]: value,
            status: 'approved',
            page: 1,
            pageSize: 20,
            sort: 'invoiceDateDesc',
          },
          reader,
        ),
      ).rejects.toBeInstanceOf(InvoiceDraftValidationError);
      expect(reader.listApprovedInvoiceSummaries).not.toHaveBeenCalled();
    },
  );
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
